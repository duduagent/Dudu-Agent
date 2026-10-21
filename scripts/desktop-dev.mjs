// Menjalankan mode development desktop: Vite (HMR) + server API lokal + jendela Electron.
// Pakai: npm run desktop:dev   (Ctrl+C untuk menghentikan semuanya)
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronBin = require('electron') // path biner Electron
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const PORT = 5174
const URL_DEV = `http://localhost:${PORT}`
const children = []

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === npx, ...opts })
  children.push(child)
  return child
}
function stopAll(code = 0) {
  for (const c of children) { try { c.kill() } catch { /* sudah berhenti */ } }
  process.exit(code)
}
process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

run(process.execPath, ['server/chat-server.mjs'])
const vite = run(npx, ['vite', '--port', String(PORT), '--strictPort'])
vite.on('exit', (code) => stopAll(code ?? 1))

async function waitForVite() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(URL_DEV); if (r.ok) return true } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

if (!(await waitForVite())) { console.error('Vite tidak siap dalam 60 detik.'); stopAll(1) }
const app = run(electronBin, ['.'], { env: { ...process.env, DUDU_DEV_URL: URL_DEV } })
app.on('exit', (code) => stopAll(code ?? 0))
