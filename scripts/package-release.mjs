// Package rilis: membuat ZIP distributif + berkas SHA256SUMS untuk satu platform.
// Dipakai di mesin build mana pun (Windows/Linux/macOS) dan juga di workflow CI.
//
// Pakai:  node scripts/package-release.mjs <platform> [--version 0.6.0]
//         platform: windows | linux | macos | source
//
// Perilaku: skrip TIDAK mengarang artefak. Artefak yang tidak ada di folder release
// dilaporkan sebagai "TIDAK DIBANGUN" dan tidak masuk ZIP maupun daftar hash.
// Aturan pencocokan terikat versi, jadi artefak versi lama tidak ikut terbawa.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').toUpperCase()

const DOCS = ['README.md', 'PACKAGING.md', 'TEST_REPORT.md', 'CHANGELOG.md', 'ROADMAP_V0.6.0.md',
  'CAPABILITY_INVENTORY.md', 'CAPABILITY_COMPATIBILITY_MATRIX.md', 'CAPABILITY_ARCHITECTURE.md', 'CAPABILITY_SECURITY.md', 'CAPABILITY_ROADMAP.md']

/**
 * Aturan pencocokan artefak per platform. Regex dibangun dari `version` saat ini supaya
 * artefak versi lain (mis. 0.3.0) TIDAK ikut terbawa ke paket rilis.
 */
export function buildRules(version) {
  const V = version.replace(/\./g, '\\.')
  return {
    windows: [
      ['installer (NSIS)', new RegExp(`^Dudu-AI-Setup-${V}-x64\\.exe$`)],
      ['portable', new RegExp(`^Dudu-AI-Portable-${V}-x64\\.exe$`)],
    ],
    linux: [
      ['installer (deb)', new RegExp(`^dudu-ai_${V}_(amd64|x86_64)\\.deb$`)],
      ['portable (AppImage)', new RegExp(`^Dudu-AI-${V}-(x86_64|x64|amd64)\\.AppImage$`)],
      ['portable (tar.gz direktori aplikasi)', new RegExp(`^Dudu-AI-${V}-linux-x64-portable\\.tar\\.gz$`)],
    ],
    macos: [
      ['installer (dmg)', new RegExp(`^Dudu-AI-${V}-(x64|arm64)\\.dmg$`)],
      ['portable (.app zip)', new RegExp(`^Dudu-AI-Portable-${V}-(x64|arm64)\\.zip$`)],
    ],
  }
}

function packageSource(version) {
  const stage = path.join(releaseDir, `.stage-source-${version}`)
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage, { recursive: true })
  const ROOT_FILES = ['package.json', 'package-lock.json', 'electron-builder.yml', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', '.env.example', '.gitignore']
  const DIRS = ['src', 'server', 'electron', 'scripts', 'build', 'tests']
  const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true, dereference: false }) }
  for (const f of ROOT_FILES) { const p = path.join(root, f); if (fs.existsSync(p)) copy(p, path.join(stage, f)) }
  for (const d of DIRS) { const p = path.join(root, d); if (fs.existsSync(p)) copy(p, path.join(stage, d)) }
  for (const d of DOCS) { const p = path.join(root, d); if (fs.existsSync(p)) copy(p, path.join(stage, d)) }
  const zipName = `Dudu-AI-${version}-source.zip`
  const zipPath = path.join(releaseDir, zipName)
  fs.rmSync(zipPath, { force: true })
  const tar = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', stage, '.'], { stdio: 'inherit' })
  if (tar.status !== 0) { console.error('Gagal membuat ZIP sumber:', tar.error?.message ?? `exit ${tar.status}`); process.exit(4) }
  fs.rmSync(stage, { recursive: true, force: true })
  const sumsPath = path.join(releaseDir, `SHA256SUMS-${version}-source.txt`)
  fs.writeFileSync(sumsPath, `${sha(zipPath)}  ${zipName}\n`, 'utf8')
  console.log(`\n=== Paket sumber v${version} ===`)
  console.log(`${sha(zipPath)}  ${zipName}  (${fs.statSync(zipPath).size} B)`)
  console.log(`Daftar hash: ${path.relative(root, sumsPath)}`)
}

function packagePlatform(platform, version) {
  const RULES = buildRules(version)
  const files = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : []
  const found = []
  const missing = []
  const seen = new Set()
  for (const [label, pattern] of RULES[platform]) {
    if (seen.has(pattern.source)) continue
    seen.add(pattern.source)
    const hit = files.find((f) => pattern.test(f))
    if (hit) found.push({ label, file: hit })
    else missing.push({ label, pattern: pattern.source })
  }
  if (!found.length) {
    console.error(`Tidak ada artefak ${platform} v${version} di ${releaseDir}. Yang diharapkan: ${RULES[platform].map((r) => r[1].source).join(', ')}`)
    process.exit(3)
  }

  const PLAT = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }[platform]
  // 1) Hash artefak (ditulis lebih dulu agar ikut terbawa di dalam ZIP).
  const sumsPath = path.join(releaseDir, `SHA256SUMS-${version}-${PLAT}.txt`)
  const artifactSums = found.map((f) => ({ name: f.file, hash: sha(path.join(releaseDir, f.file)), size: fs.statSync(path.join(releaseDir, f.file)).size }))
  fs.writeFileSync(sumsPath, artifactSums.map((s) => `${s.hash}  ${s.name}`).join('\n') + '\n', 'utf8')

  // 2) Susun isi ZIP: artefak + dokumen + daftar hash.
  const stage = path.join(releaseDir, `.stage-${platform}-${version}`)
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage, { recursive: true })
  for (const f of found) fs.copyFileSync(path.join(releaseDir, f.file), path.join(stage, f.file))
  for (const d of DOCS) { const p = path.join(root, d); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(stage, d)) }
  fs.copyFileSync(sumsPath, path.join(stage, path.basename(sumsPath)))
  fs.writeFileSync(path.join(stage, 'BACA-DULU.txt'), [
    `Dudu AI ${version} — paket ${PLAT} x64`,
    '',
    `Artefak: ${found.map((f) => f.file).join(', ')}`,
    `Status rilis: ${missing.length ? `SEBAGIAN artefak tidak dibangun di mesin ini (${missing.map((m) => m.pattern).join(', ')})` : 'lengkap'}`,
    '',
    'Dokumentasi: README.md, PACKAGING.md, TEST_REPORT.md, CHANGELOG.md, ROADMAP_V0.6.0.md.',
    'Hash: ' + path.basename(sumsPath) + ' (isi paket ini) dan SHA256SUMS-' + version + '.txt (daftar lengkap lintas platform).',
    'Paket ini BELUM ditandatangani (tidak ada sertifikat kode-signing).',
    '',
  ].join('\n'), 'utf8')

  const zipName = `Dudu-AI-${version}-${PLAT}-x64.zip`
  const zipPath = path.join(releaseDir, zipName)
  fs.rmSync(zipPath, { force: true })
  // bsdtar (tar -a) tersedia di Windows 10+, macOS, dan Linux; membuat ZIP sesuai ekstensi.
  const tar = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', stage, '.'], { stdio: 'inherit' })
  if (tar.status !== 0) { console.error('Gagal membuat ZIP:', tar.error?.message ?? `exit ${tar.status}`); process.exit(4) }
  fs.rmSync(stage, { recursive: true, force: true })

  const sums = [...artifactSums, { name: zipName, hash: sha(zipPath), size: fs.statSync(zipPath).size }]
  console.log(`\n=== Paket ${PLAT} v${version} ===`)
  for (const s of sums) console.log(`${s.hash}  ${s.name}  (${s.size} B)`)
  console.log(`Daftar hash: ${path.relative(root, sumsPath)}`)
  if (missing.length) {
    console.log('\nTIDAK DIBANGUN di mesin ini (tidak dimasukkan ke ZIP, tidak dikarang):')
    for (const m of missing) console.log(` - ${m.label}: ${m.pattern}`)
    process.exitCode = 5
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  const argv = process.argv.slice(2)
  const platform = (argv[0] ?? '').toLowerCase()
  if (!['windows', 'linux', 'macos', 'source'].includes(platform)) {
    console.error('Pakai: node scripts/package-release.mjs <windows|linux|macos|source> [--version X.Y.Z]')
    process.exit(2)
  }
  const vIdx = argv.indexOf('--version')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const version = vIdx >= 0 ? argv[vIdx + 1] : pkg.version
  if (platform === 'source') packageSource(version)
  else packagePlatform(platform, version)
}
