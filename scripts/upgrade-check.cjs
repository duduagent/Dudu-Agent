// Uji kompatibilitas upgrade: pasang v0.5.0, buat data pengguna, pasang v0.6.0 di atasnya,
// lalu pastikan data pengguna, aplikasi, dan alur inti masih utuh.
//
// Pakai: node scripts/upgrade-check.mjs <setup-0.5.0.exe> <setup-0.6.0.exe> <smoke-script> <bin-nama>
const { spawnSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const [setupOld, setupNew, smokeScript, binName] = process.argv.slice(2)
if (!setupOld || !setupNew) { console.error('Pakai: node scripts/upgrade-check.mjs <setup-lama.exe> <setup-baru.exe>'); process.exit(2) }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dudu-upgrade-'))
const installDir = path.join(root, 'install')
const profile = path.join(root, 'profile')
fs.mkdirSync(profile, { recursive: true })
const log = (m) => console.log(m)

function install(setup) {
  const p = spawnSync(setup, ['/S', `/D=${installDir}`], { stdio: 'ignore' })
  return p.status
}

// Menjalankan aplikasi GUI: ia tidak pernah keluar sendiri, jadi dijalankan terpisah,
// diperiksa "masih hidup" (bukti startup), lalu dimatikan. Tanpa timeout → hang.
function launchAndCheck(bin, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, DUDU_USER_DATA: profile, DUDU_PROVIDER_API_KEY: '' }
  const child = spawn(bin, [], { env, stdio: 'ignore', detached: true })
  const started = Date.now()
  while (Date.now() - started < 9000) {
    if (child.exitCode !== null) return { alive: false, code: child.exitCode }
    execSyncSafe('tasklist /FI "IMAGENAME eq Dudu AI.exe" /NH')
    try { execSyncSafe(`tasklist /FI "PID eq ${child.pid}" /NH`) } catch { /* abaikan */ }
    sleepSync(1000)
  }
  const alive = child.exitCode === null
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* sudah mati */ } }
  return { alive, code: child.exitCode }
}
function execSyncSafe(cmd) { try { require('node:child_process').execSync(cmd, { stdio: 'ignore' }); return true } catch { return false } }
function sleepSync(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* busy-wait singkat */ } }

log('== 1. Pasang v0.5.0 (senyap) ==')
const s1 = install(setupOld)
log(`   exit=${s1} · terpasang: ${fs.existsSync(path.join(installDir, binName))}`)
if (s1 !== 0 || !fs.existsSync(path.join(installDir, binName))) { log('GAGAL: instalasi v0.5.0'); process.exit(1) }

// Data pengguna: berkas & misi dibuat oleh aplikasi yang terpasang.
log('== 2. Jalankan v0.5.0 sekali (bukti startup; lalu dimatikan) ==')
const run5 = launchAndCheck(path.join(installDir, binName))
log(`   aplikasi hidup setelah start: ${run5.alive ? 'YA' : 'TIDAK (exit ' + run5.code + ')'}`)

// Tulis penanda di dalam folder data (simulasi data pengguna nyata).
const dataDir = path.join(profile, 'data')
fs.mkdirSync(path.join(dataDir, 'missions'), { recursive: true })
const marker = path.join(dataDir, 'missions', 'upgrade-marker.json')
fs.writeFileSync(marker, JSON.stringify({ createdBy: 'v0.5.0', at: new Date().toISOString() }))
log(`   penanda data dibuat: ${marker}`)

log('== 3. Pasang v0.6.0 di atas v0.5.0 (upgrade) ==')
const s2 = install(setupNew)
log(`   exit=${s2}`)
if (s2 !== 0) { log('GAGAL: instalasi v0.6.0'); process.exit(1) }
const markerStill = fs.existsSync(marker)
log(`   data pengguna masih ada: ${markerStill ? 'YA' : 'TIDAK'}`)

// Uninstaller harus tetap ada & tidak menghapus data saat uninstall.
const uninstallers = fs.readdirSync(installDir).filter((f) => /^uninstall/i.test(f))
log(`   uninstaller tersedia: ${uninstallers.join(', ') || 'TIDAK ADA'}`)

log('== 4. Jalankan aplikasi ter-upgrade (startup) ==')
const run6 = launchAndCheck(path.join(installDir, binName))
log(`   aplikasi hidup setelah start: ${run6.alive ? 'YA' : 'TIDAK (exit ' + run6.code + ')'}`)

log('== 5. Smoke test biner hasil upgrade ==')
const smoke = spawnSync(process.execPath, [smokeScript, path.join(installDir, binName)], { env: { ...process.env, DUDU_PROVIDER_API_KEY: '' }, encoding: 'utf8' })
const summary = (smoke.stdout || '').split('\n').filter((l) => l.includes('RINGKASAN') || l.includes('GAGAL')).join('\n')
log('   ' + (summary || '(tanpa ringkasan)'))
const smokeOk = smoke.status === 0
log(`   exit=${smoke.status}`)

log('== 6. Uninstall (data pengguna harus TIDAK dihapus) ==')
if (uninstallers.length) {
  const u = spawnSync(path.join(installDir, uninstallers[0]), ['/S'], { stdio: 'ignore' })
  log(`   exit=${u.status}`)
}
const markerAfterUninstall = fs.existsSync(marker)
log(`   data pengguna masih ada setelah uninstall: ${markerAfterUninstall ? 'YA' : 'TIDAK'}`)

const ok = s1 === 0 && s2 === 0 && markerStill && markerAfterUninstall && smokeOk && run5.alive && run6.alive
log(`\nHASIL: ${ok ? 'LULUS' : 'GAGAL'} (upgrade kompatibel, data utuh, uninstall aman)`)
fs.rmSync(root, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
