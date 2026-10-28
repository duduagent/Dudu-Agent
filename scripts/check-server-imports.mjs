// Memastikan modul server dapat dimuat oleh ESM NATIVE Node (bukan transformasi vitest).
//
// Alasan: vitest/esbuild mentoleransi sebagian kesalahan linking ESM (mis. export ganda),
// sedangkan Node & Electron menolaknya → aplikasi terpaket gagal start meski tes hijau.
// Skrip ini menutup celah tersebut.
//
// Pakai: node scripts/check-server-imports.mjs
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = [
  './server/api.mjs',
  './server/missions.mjs',
  './server/capability-registry.mjs',
  './server/execution-audit.mjs',
  './server/permissions.mjs',
  './server/chat-api.mjs',
  './server/gateway.mjs',
  './server/connectors.mjs',
  './server/plugins.mjs',
  './server/mcp.mjs',
  './server/knowledge.mjs',
  './server/files.mjs',
  './server/credentials.mjs',
]

const script = MODULES.map((m) => `await import('${m}')`).join('\n')
const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' })
if (res.status === 0) {
  console.log(`IMPORT_OK — ${MODULES.length} modul server dimuat oleh ESM native Node.`)
  process.exit(0)
}
console.error('IMPORT_GAGAL — modul server tidak dapat dimuat oleh ESM native:')
console.error((res.stderr || res.stdout || '').split('\n').slice(0, 12).join('\n'))
process.exit(1)
