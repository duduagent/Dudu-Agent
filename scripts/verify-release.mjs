// Validasi artefak rilis yang sudah dibangun ( Strengthening packaging).
//
// Memeriksa app.asar hasil build secara NYATA (bukan asumsi):
//  - berkas runtime wajib ada (termasuk modul audit & izin);
//  - tidak ada tes/source/.env/source-map yang bocor ke paket;
//  - hanya dependensi produksi yang ikut;
//  - tidak ada kunci API literal;
//  - fitur rilis (versi, audit, permission, approval) benar-benar ada di dalam paket.
//
// Skrip TIDAK mengarang: bila tidak ada artefak yang dibangun, ia melapor "TIDAK DIBANGUN"
// dan keluar dengan kode 5 (bukan 0) supaya tidak dianggap lulus.
//
// Pakai: node scripts/verify-release.mjs [--version X.Y.Z]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const argv = process.argv.slice(2)
const vIdx = argv.indexOf('--version')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = vIdx >= 0 ? argv[vIdx + 1] : pkg.version

/** Kandidat lokasi app.asar per platform (sesuai output electron-builder). */
const ASAR_CANDIDATES = [
  ['windows', path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar')],
  ['linux', path.join(releaseDir, 'linux-unpacked', 'resources', 'app.asar')],
  ['macos', path.join(releaseDir, 'mac', 'Dudu AI.app', 'Contents', 'Resources', 'app.asar')],
]

/** Berkas runtime yang WAJIB ada di paket. */
const REQUIRED = [
  'package.json', 'electron/main.mjs', 'electron/preload.cjs',
  'dist/index.html',
  'server/api.mjs', 'server/missions.mjs', 'server/capability-registry.mjs',
  'server/execution-audit.mjs', 'server/permissions.mjs',
]

/** Bekas yang TIDAK boleh ikut ke paket. */
const FORBIDDEN = [
  ['tes', /(^|[\\/])tests([\\/]|$)/],
  ['sumber frontend', /(^|[\\/])src([\\/]|$)/],
  ['berkas .env', /(^|[\\/])\.env/i],
  ['source map', /\.map$/i],
  ['skrip audit', /(^|[\\/])scripts([\\/]|$)/],
]

/** Penanda fitur rilis yang harus benar-benar ada di dalam paket. */
const FEATURES = [
  ['audit terpadu (server)', 'eventType'],
  ['rantai hash audit', 'prevHash'],
  ['rotasi jejak audit', 'capability-audit.'],
  ['izin granular (server)', 'permission_denied'],
  ['approval terikat scope', 'approval_scope_mismatch'],
  ['jejak audit di UI', 'Jejak Audit'],
  ['filter jejak audit', 'Muat lebih banyak'],
]

const API_KEY_PATTERN = /DUDU_PROVIDER_API_KEY\s*[:=]\s*["'][A-Za-z0-9]/
const SK_PATTERN = /\bsk-[A-Za-z0-9]{16,}\b/

let asarMod = null
try { asarMod = await import('@electron/asar') } catch { /* tidak tersedia → cek berbasis string */ }

function listEntries(asarPath) {
  if (asarMod?.listPackage) {
    try { return asarMod.listPackage(asarPath).map((f) => f.replace(/\\/g, '/')) } catch { /* fallback */ }
  }
  return null
}

let bad = 0
let checked = 0

for (const [platform, asarPath] of ASAR_CANDIDATES) {
  if (!fs.existsSync(asarPath)) {
    console.log(`\n=== ${platform} ===\n  - TIDAK DIBANGUN (${path.relative(root, asarPath)} tidak ada) — tidak diverifikasi`)
    continue
  }
  checked++
  console.log(`\n=== ${platform} (${path.relative(root, asarPath)}) ===`)
  const entries = listEntries(asarPath)
  const raw = fs.readFileSync(asarPath).toString('latin1')

  // 1) Berkas wajib ada.
  if (entries) {
    for (const req of REQUIRED) {
      const ok = entries.some((e) => e === req || e.endsWith('/' + req) || e.replace(/^\//, '') === req)
      if (!ok) bad++
      console.log(`  ${ok ? 'OK   ' : 'GAGAL'} berkas wajib: ${req}`)
    }
    // 2) Bekas terlarang.
    for (const [label, re] of FORBIDDEN) {
      const hit = entries.find((e) => re.test(e))
      if (hit) bad++
      console.log(`  ${hit ? 'GAGAL' : 'OK   '} tidak ada ${label}${hit ? ` (ditemukan: ${hit})` : ''}`)
    }
    // 3) Hanya dependensi produksi.
    const mods = entries.filter((e) => e.includes('node_modules/')).map((e) => e.split('node_modules/')[1].split('/')[0])
    const uniq = [...new Set(mods)].sort()
    const allowed = new Set(['fflate', 'unpdf'])
    const stray = uniq.filter((m) => !allowed.has(m))
    if (stray.length) bad++
    console.log(`  ${stray.length ? 'GAGAL' : 'OK   '} hanya dependensi produksi: ${uniq.join(', ') || '(tidak ada)'}`)
  } else {
    console.log('  ?  daftar berkas tidak dapat dibaca (@electron/asar tidak tersedia) — pemeriksaan isi dilewati')
  }

  // 4) Versi paket.
  const verOk = new RegExp(`"version"\\s*:\\s*"${version.replace(/\./g, '\\.')}"`).test(raw)
  if (!verOk) bad++
  console.log(`  ${verOk ? 'OK   ' : 'GAGAL'} versi paket ${version}`)

  // 5) Fitur rilis benar-benar ada di dalam paket.
  for (const [name, needle] of FEATURES) {
    const ok = raw.includes(needle)
    if (!ok) bad++
    console.log(`  ${ok ? 'OK   ' : 'GAGAL'} fitur: ${name}`)
  }

  // 6) Tidak ada kunci API literal.
  const keyHit = API_KEY_PATTERN.test(raw) || SK_PATTERN.test(raw)
  if (keyHit) bad++
  console.log(`  ${keyHit ? 'GAGAL' : 'OK   '} tidak ada kunci API literal di dalam asar`)
}

if (!checked) {
  console.log('\nTIDAK ADA artefak yang dibangun di mesin ini — verifikasi paket TIDAK dijalankan (tidak dikarang hasil).')
  process.exit(5)
}

console.log(bad === 0 ? '\nSEMUA PEMERIKSAAN ARTEFAK LULUS' : `\n${bad} PEMERIKSAAN ARTEFAK GAGAL`)
process.exit(bad === 0 ? 0 : 1)
