// Verifikasi UI otomatis: menyalakan API + dev server, menjalankan audit responsif
// (overflow + screenshot) dan audit kontras ter-render, lalu mematikan server.
//
// Pakai:  node scripts/verify-ui.mjs
// Exit:   0 = semua audit lolos; 1 = ada temuan; 2 = lingkungan tidak siap.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_PORT = 8791
const WEB_PORT = 5183
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudu-verify-ui-'))
const outDir = path.join(root, 'ui-verify')
const electronBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron')

const children = []
const cleanup = () => {
  for (const c of children) {
    try {
      if (process.platform === 'win32') { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }) }
      else { process.kill(-c.pid, 'SIGKILL') }
    } catch { /* abaikan */ }
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* abaikan */ }
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitHttp(url, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok || r.status === 404) return true } catch { /* belum siap */ }
    await wait(400)
  }
  return false
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

async function main() {
  if (!fs.existsSync(electronBin)) { console.error('Biner electron tidak ditemukan:', electronBin); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  console.log('1/4 menyalakan API server…')
  const api = spawn(process.execPath, [path.join(root, 'server', 'chat-server.mjs')], {
    cwd: root, env: { ...process.env, DUDU_DATA_DIR: dataDir, PORT: String(API_PORT) }, stdio: 'ignore', detached: process.platform !== 'win32',
  })
  children.push(api)
  if (!await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`)) { console.error('API server tidak siap'); process.exit(2) }

  console.log('2/4 menyalakan dev server (vite)…')
  const viteBin = process.platform === 'win32'
    ? path.join(root, 'node_modules', '.bin', 'vite.cmd')
    : path.join(root, 'node_modules', '.bin', 'vite')
  const vite = spawn(viteBin, ['--port', String(WEB_PORT), '--strictPort'], {
    cwd: root, env: { ...process.env }, stdio: 'ignore', detached: process.platform !== 'win32',
  })
  children.push(vite)
  if (!await waitHttp(`http://localhost:${WEB_PORT}/`)) { console.error('Dev server tidak siap'); process.exit(2) }

  const env = { UI_AUDIT_URL: `http://localhost:${WEB_PORT}` }
  console.log('3/4 audit responsif (16 rute × 6 lebar)…')
  const a1 = run(electronBin, [path.join(root, 'scripts', 'ui-audit.cjs')], { ...env, UI_AUDIT_OUT: path.join(outDir, 'responsive') })
  console.log(a1.out.split('\n').filter((l) => l.includes('TEMUAN') || l.includes('[')).join('\n') || '   (tidak ada temuan)')
  console.log('4/4 audit kontras ter-render…')
  const a2 = run(electronBin, [path.join(root, 'scripts', 'contrast-audit.cjs')], { ...env, UI_AUDIT_OUT: path.join(outDir, 'contrast') })
  console.log(a2.out.split('\n').filter((l) => l.includes('pasangan') || l.includes('[') || l.includes('Semua')).join('\n') || '   (tidak ada temuan)')

  const ok = a1.code === 0 && a2.code === 0
  console.log(`\nHASIL VERIFIKASI UI: ${ok ? 'LOLOS' : 'GAGAL'} (responsif exit ${a1.code}, kontras exit ${a2.code})`)
  console.log(`Laporan: ${path.relative(root, outDir)}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); cleanup(); process.exit(2) })
