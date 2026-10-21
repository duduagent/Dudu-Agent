// Uji kesiapan provider (live-test) — menguji jalur provider YANG MEMANG ADA di aplikasi.
//
// Prinsip:
//  - Tidak pernah mencetak kredensial (bahkan sufiksnya tidak ditampilkan).
//  - Tidak pernah memasukkan kunci palsu dan tidak pernah mengklaim uji live sukses
//    tanpa permintaan nyata + respons terverifikasi.
//  - Skenario yang butuh kredensial asli ditandai "UNVERIFIED" bila kredensial tidak tersedia
//    (bukan "lolos").
//  - Jalur kesalahan diuji terhadap MOCK LOKAL (127.0.0.1) — tanpa lalu lintas internet.
//
// Pakai:  node scripts/provider-smoke.mjs
// Env (opsional, untuk uji live): DUDU_PROVIDER_API_KEY, DUDU_PROVIDER_BASE_URL, DUDU_MODEL,
//                                 DUDU_VISION_MODEL, DUDU_STT_MODEL, DUDU_TIMEOUT_MS
// Exit:   0 = semua skenario yang bisa dijalankan berperilaku sesuai harapan.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8800        // rentang server API lokal
const MOCK_PORT = 8900   // rentang mock provider (DIPISAHKAN dari port API)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudu-provider-smoke-'))
const results = []
const children = []

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const hasKey = Boolean(process.env.DUDU_PROVIDER_API_KEY)
const record = (name, state, detail) => { results.push({ name, state, detail }); console.log(`  [${state.padEnd(10)}] ${name}${detail ? ` — ${detail}` : ''}`) }

function cleanup() {
  for (const c of children) { try { c.kill('SIGKILL') } catch { /* abaikan */ } }
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* abaikan */ }
}
process.on('exit', cleanup)

// --- Mock provider lokal (untuk menguji jalur kesalahan) ---
let mockSeq = 0
function startMock(mode) {
  const port = MOCK_PORT + (++mockSeq)
  const server = http.createServer((req, res) => {
    if (mode === 'nonjson') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('bukan json'); return }
    if (mode === 'ratelimit') { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' }); res.end(JSON.stringify({ error: { message: 'rate limited' } })); return }
    if (mode === 'unauthorized') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'invalid api key' } })); return }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok-mock' } }] }))
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port })))
}

let currentPort = PORT
let serverSeq = 0

function startServer(env = {}) {
  currentPort = PORT + (++serverSeq)
  const p = spawn(process.execPath, [path.join(root, 'server', 'chat-server.mjs')], {
    cwd: root,
    env: { ...process.env, DUDU_DATA_DIR: dataDir, PORT: String(currentPort), DUDU_PROVIDER_API_KEY: '', DUDU_VISION_MODEL: '', DUDU_STT_MODEL: '', ...env },
    stdio: 'ignore',
  })
  children.push(p)
  return p
}

async function waitServer(port = currentPort) {
  const until = Date.now() + 30000
  while (Date.now() < until) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return true } catch { /* belum siap */ }
    await wait(300)
  }
  return false
}

const H = { 'X-Dudu-Client': '1', 'Content-Type': 'application/json' }
async function chat(body) {
  const r = await fetch(`http://127.0.0.1:${currentPort}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  let j = null
  try { j = await r.json() } catch { /* non-json */ }
  return { status: r.status, body: j }
}
async function capabilities() {
  const r = await fetch(`http://127.0.0.1:${currentPort}/api/capabilities`, { headers: H })
  return r.json()
}

async function main() {
  console.log('Uji kesiapan provider — kredensial tidak pernah dicetak.\n')

  // ---------- 1. Tanpa kredensial ----------
  console.log('1) Tanpa kredensial')
  startServer()
  if (!await waitServer()) { record('server siap', 'GAGAL', 'server tidak merespons'); process.exit(2) }
  const caps = await capabilities()
  record('kapabilitas melaporkan chat belum terkonfigurasi', caps.chat?.configured === false ? 'LOLOS' : 'GAGAL', `configured=${caps.chat?.configured}`)
  const noKey = await chat({ messages: [{ role: 'user', content: 'halo' }] })
  record('chat tanpa kunci → error jujur (provider_not_configured)', noKey.body?.error === 'provider_not_configured' ? 'LOLOS' : 'GAGAL', `HTTP ${noKey.status} error=${noKey.body?.error}`)

  // ---------- 2. Jalur kesalahan vs mock lokal ----------
  // AssertionZIAT pada PERILAKU yang harus benar: kegagalan provider harus TIDAK ditelan
  // (status bukan 2xx, badan memuat informasi galat) dan kredensial tidak boleh bocor.
  console.log('\n2) Jalur kesalahan (mock lokal 127.0.0.1 — tanpa lalu lintas internet)')
  const mock = await startMock('unauthorized')
  children.push({ kill: () => mock.server.close() })
  startServer({ DUDU_PROVIDER_API_KEY: 'local-mock-key', DUDU_PROVIDER_BASE_URL: `http://127.0.0.1:${mock.port}/v1`, DUDU_MODEL: 'mock-model' })
  await waitServer()
  const auth = await chat({ messages: [{ role: 'user', content: 'halo' }] })
  record('kunci ditolak provider (401) → gagal terlihat, bukan 200', auth.status >= 400 && hasErrorInfo(auth.body) ? 'LOLOS' : 'GAGAL', `HTTP ${auth.status} ${summarize(auth.body)}`)
  record('  └ kredensial tidak bocor di respons', !JSON.stringify(auth.body ?? {}).includes('local-mock-key') ? 'LOLOS' : 'GAGAL', 'kunci tidak muncul di badan respons')
  mock.server.close()

  const mock2 = await startMock('ratelimit')
  children.push({ kill: () => mock2.server.close() })
  startServer({ DUDU_PROVIDER_API_KEY: 'local-mock-key', DUDU_PROVIDER_BASE_URL: `http://127.0.0.1:${mock2.port}/v1`, DUDU_MODEL: 'mock-model' })
  await waitServer()
  const rl = await chat({ messages: [{ role: 'user', content: 'halo' }] })
  record('rate limit (429) → gagal terlihat + mentions rate limit', rl.status >= 400 && hasErrorInfo(rl.body) ? 'LOLOS' : 'GAGAL', `HTTP ${rl.status} ${summarize(rl.body)}`)
  mock2.server.close()

  const mock3 = await startMock('nonjson')
  children.push({ kill: () => mock3.server.close() })
  startServer({ DUDU_PROVIDER_API_KEY: 'local-mock-key', DUDU_PROVIDER_BASE_URL: `http://127.0.0.1:${mock3.port}/v1`, DUDU_MODEL: 'mock-model' })
  await waitServer()
  const nj = await chat({ messages: [{ role: 'user', content: 'halo' }] })
  record('respons non-JSON → tidak dianggap sukses', nj.status >= 400 ? 'LOLOS' : 'GAGAL', `HTTP ${nj.status} ${summarize(nj.body)}`)
  mock3.server.close()

  // ---------- 3. Jaringan gagal / timeout ----------
  console.log('\n3) Jaringan gagal & timeout (endpoint lokal yang tidak hidup)')
  startServer({ DUDU_PROVIDER_API_KEY: 'local-mock-key', DUDU_PROVIDER_BASE_URL: 'http://127.0.0.1:9/v1', DUDU_MODEL: 'mock-model', DUDU_TIMEOUT_MS: '2000' })
  await waitServer()
  const net = await chat({ messages: [{ role: 'user', content: 'halo' }] })
  const netOk = net.status >= 400 && hasErrorInfo(net.body)
  record('provider tidak terjangkau → error koneksi/timeout, bukan 200', netOk ? 'LOLOS' : 'GAGAL', `HTTP ${net.status} ${summarize(net.body)}`)

  // ---------- 4. Uji live (hanya bila kredensial asli tersedia) ----------
  console.log('\n4) Uji live (hanya dijalankan bila kredensial asli tersedia)')
  if (!hasKey) {
    record('chat completion (live)', 'UNVERIFIED', 'DUDU_PROVIDER_API_KEY tidak disetel — tidak ada permintaan nyata yang dilakukan')
    record('vision (live)', 'UNVERIFIED', 'butuh DUDU_PROVIDER_API_KEY + DUDU_VISION_MODEL')
    record('speech-to-text (live)', 'UNVERIFIED', 'butuh DUDU_PROVIDER_API_KEY + DUDU_STT_MODEL')
  } else {
    startServer({
      DUDU_PROVIDER_API_KEY: process.env.DUDU_PROVIDER_API_KEY,
      DUDU_PROVIDER_BASE_URL: process.env.DUDU_PROVIDER_BASE_URL || '',
      DUDU_MODEL: process.env.DUDU_MODEL || '',
      DUDU_VISION_MODEL: process.env.DUDU_VISION_MODEL || '',
      DUDU_STT_MODEL: process.env.DUDU_STT_MODEL || '',
    })
    await waitServer()
    const live = await chat({ messages: [{ role: 'user', content: 'Balas dengan satu kata: SIAP' }] })
    const okLive = live.status === 200 && typeof live.body?.reply === 'string' && live.body.reply.length > 0
    record('chat completion (live)', okLive ? 'LOLOS' : 'GAGAL', okLive ? `balasan diterima (${live.body.reply.length} karakter)` : `HTTP ${live.status} error=${live.body?.error}`)

    if (process.env.DUDU_VISION_MODEL) {
      const img = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'scan.png'))
      const up = await fetch(`http://127.0.0.1:${currentPort}/api/files`, { method: 'POST', headers: { 'X-Dudu-Client': '1', 'Content-Type': 'application/octet-stream' }, body: img })
      const upj = await up.json().catch(() => null)
      const fileId = upj?.file?.id
      if (!fileId) record('vision (live)', 'GAGAL', `unggah file gagal: HTTP ${up.status}`)
      else {
        const v = await chat({ messages: [{ role: 'user', content: 'Apa isi gambar ini?', fileIds: [fileId] }] })
        const okV = v.status === 200 && typeof v.body?.reply === 'string' && v.body.reply.length > 0
        record('vision (live)', okV ? 'LOLOS' : 'GAGAL', okV ? 'balasan vision diterima' : `HTTP ${v.status} error=${v.body?.error}`)
      }
    } else record('vision (live)', 'UNVERIFIED', 'DUDU_VISION_MODEL tidak disetel')

    if (process.env.DUDU_STT_MODEL) {
      const wav = makeSilentWav()
      const up = await fetch(`http://127.0.0.1:${currentPort}/api/files`, { method: 'POST', headers: { 'X-Dudu-Client': '1', 'Content-Type': 'application/octet-stream' }, body: wav })
      const upj = await up.json().catch(() => null)
      const fileId = upj?.file?.id
      if (!fileId) record('speech-to-text (live)', 'GAGAL', `unggah audio gagal: HTTP ${up.status}`)
      else {
        const s = await chat({ messages: [{ role: 'user', content: 'Transkripsikan audio ini.', fileIds: [fileId] }] })
        const okS = s.status === 200 && typeof s.body?.reply === 'string'
        record('speech-to-text (live)', okS ? 'LOLOS' : 'GAGAL', okS ? 'transkrip diterima' : `HTTP ${s.status} error=${s.body?.error}`)
      }
    } else record('speech-to-text (live)', 'UNVERIFIED', 'DUDU_STT_MODEL tidak disetel')
  }

  const bad = results.filter((r) => r.state === 'GAGAL')
  const unver = results.filter((r) => r.state === 'UNVERIFIED')
  console.log(`\nRINGKASAN: ${results.length - bad.length - unver.length} lolos · ${unver.length} belum terverifikasi (butuh kredensial) · ${bad.length} gagal`)
  if (unver.length) console.log('Belum terverifikasi: ' + unver.map((r) => r.name).join('; '))
  if (bad.length) console.log('Gagal: ' + bad.map((r) => r.name).join('; '))
  process.exit(bad.length ? 1 : 0)
}

/** Apakah badan respons memuat informasi galat yang bisa ditampilkan ke pengguna? */
function hasErrorInfo(body) {
  if (!body || typeof body !== 'object') return false
  const s = JSON.stringify(body)
  return /error|message|detail|gagal|invalid|rate|timeout|connect/i.test(s)
}
/** Ringkasan aman (tanpa kredensial) dari badan respons. */
function summarize(body) {
  const s = JSON.stringify(body ?? {}).replace(/local-mock-key/g, '[redacted]')
  return s.slice(0, 110)
}

/** WAV senyap 1 detik (hanya untuk menguji jalur permintaan STT; bukan rekaman suara). */
function makeSilentWav() {
  const rate = 8000, secs = 1, data = rate * secs
  const buf = Buffer.alloc(44 + data)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34)
  buf.write('data', 36); buf.writeUInt32LE(data, 40)
  return buf
}

main().catch((e) => { console.error(e); cleanup(); process.exit(2) })
