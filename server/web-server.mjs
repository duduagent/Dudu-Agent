// server/web-server.mjs — mode produksi web (Railway/VPS):
// satu proses Node melayani (1) API Dudu dan (2) berkas statis frontend hasil `vite build`.
// Aplikasi desktop TIDAK memakai file ini.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createApi } from './api.mjs'
import { MAX_BODY_BYTES } from './chat-api.mjs'
import { parseEnvFile, resolveConfig } from './config.mjs'

const HOST = '0.0.0.0' // Railway: wajib mendengar semua interface, bukan loopback
const DIST = path.resolve(process.cwd(), 'dist')

let fileValues = {}
try { fileValues = parseEnvFile(fs.readFileSync('.env', 'utf8')) } catch { /* .env opsional */ }
const config = resolveConfig(process.env, fileValues)
const dataDir = path.resolve(process.env.DUDU_DATA_DIR || '.dudu-data')
const api = createApi({ getConfig: () => config, dataDir })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

const send = (res, result) => {
  if (res.writableEnded || res.destroyed) return
  if (result.raw) { res.writeHead(result.status, { ...result.headers, 'Content-Length': result.raw.length }); return res.end(result.raw) }
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(result.body))
}

const serveStatic = (res, urlPath) => {
  let filePath
  try { filePath = path.join(DIST, decodeURIComponent(urlPath)) } catch { res.writeHead(400); return res.end('bad request') }
  if (!filePath.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end('forbidden') }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

if (!fs.existsSync(DIST)) { console.error('dist/ tidak ditemukan. Jalankan `npm run build` dulu.'); process.exit(1) }

/* ---------- SEED MULTI-PROVIDER & ROUTING DARI ENV (idempotent) ----------
   Variabel Railway:
   DUDU_PROVIDERS=[{"id":"google","key":"AIza..."},{"id":"openrouter","key":"sk-or-..."},{"id":"groq","key":"gsk_..."}]
   DUDU_ROUTING_MODE=FREE_FIRST   (FREE_ONLY | FREE_FIRST | BEST_VALUE | BEST_QUALITY | MANUAL | ROTATE)
   DUDU_MAX_FALLBACKS=3           (0–4)
   DUDU_BUDGET_USD_MONTHLY=0      (0 = belum membatasi; mis. 2 = maks $2/bulan)
*/
const MODES = ['FREE_ONLY', 'FREE_FIRST', 'BEST_VALUE', 'BEST_QUALITY', 'MANUAL', 'ROTATE']
let seededProviders = []
try { seededProviders = JSON.parse(process.env.DUDU_PROVIDERS || '[]') } catch { console.error('[seed] DUDU_PROVIDERS bukan JSON valid — diabaikan.') }
if (Array.isArray(seededProviders) && seededProviders.length) {
  const providersFile = path.join(dataDir, 'providers.json')
  let store = { version: 1, providers: {} }
  try { store = JSON.parse(fs.readFileSync(providersFile, 'utf8')) } catch { /* belum ada */ }
  if (!store || typeof store !== 'object') store = { version: 1, providers: {} }
  store.providers = (store.providers && typeof store.providers === 'object') ? store.providers : {}
  for (const p of seededProviders) {
    const id = String(p?.id ?? '').trim()
    const key = String(p?.key ?? '').trim()
    if (!id || key.length < 8) continue
    const rec = store.providers[id] ?? { id, enabled: false, configured: false, apiKey: null, baseUrl: null, keyUpdatedAt: null, status: null }
    if (rec.apiKey !== key) {
      rec.apiKey = key
      rec.configured = true
      rec.enabled = true
      rec.keyUpdatedAt = Date.now()
      console.log(`[seed] ${id}: kunci API diperbarui dari env`)
    } else if (rec.configured && !rec.enabled) {
      rec.enabled = true
    }
    if (typeof p.baseUrl === 'string' && p.baseUrl.trim()) rec.baseUrl = p.baseUrl.trim()
    store.providers[id] = rec
  }
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(providersFile, JSON.stringify(store, null, 2), { mode: 0o600 })
  console.log('[seed] providers.json diperbarui dari DUDU_PROVIDERS')
}

const settingsFile = path.join(dataDir, 'routing-settings.json')
if (!fs.existsSync(settingsFile)) {
  const mode = MODES.includes(process.env.DUDU_ROUTING_MODE) ? process.env.DUDU_ROUTING_MODE : 'FREE_FIRST'
  const mf = Number.parseInt(process.env.DUDU_MAX_FALLBACKS ?? '', 10)
  const maxFallbacks = Number.isFinite(mf) ? Math.min(Math.max(mf, 0), 4) : 3
  const b = Number(process.env.DUDU_BUDGET_USD_MONTHLY)
  const budget = Number.isFinite(b) && b >= 0 ? b : 0
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify({ version: 1, defaultMode: mode, maxFallbacks, privacyLocalPreferred: true, budget: { paidUsdMonthly: budget }, manualSelection: null }, null, 2), { mode: 0o600 })
  console.log(`[seed] routing-settings.json → mode=${mode}, maxFallbacks=${maxFallbacks}, budget=$${budget}/bulan`)
}

// Sisipkan waktu nyata ke pesan user terakhir (model tidak bisa mengabaikannya)
const injectTimeContext = (rawBody) => {
  try {
    const payload = JSON.parse(rawBody || '{}')
    if (!Array.isArray(payload.messages)) return rawBody
    const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const konteks = `[KONTEKS WAKTU] Saat ini ${waktu} WIB. Jika pengguna bertanya tentang tanggal, hari, atau jam, jawab berdasarkan informasi ini.\n\n`
    for (let i = payload.messages.length - 1; i >= 0; i--) {
      const m = payload.messages[i]
      if (m.role === 'user' && typeof m.content === 'string' && !m.content.includes('[KONTEKS WAKTU]')) {
        payload.messages[i] = { ...m, content: konteks + m.content }
        console.log('[waktu-terinject]', waktu)
        return JSON.stringify(payload)
      }
    }
    return rawBody
  } catch { return rawBody }
}

const server = http.createServer((req, res) => {
  const urlPath = String(req.url).split('?')[0]
  if (!urlPath.startsWith('/api/')) return serveStatic(res, urlPath)

  const ac = new AbortController()
  res.on('close', () => { if (!res.writableFinished) ac.abort() })
  const isUpload = req.method === 'POST' && urlPath === '/api/files'
  const limit = isUpload ? config.maxUploadBytes : MAX_BODY_BYTES
  const chunks = []
  let size = 0
  let tooLarge = false
  req.on('data', (chunk) => { size += chunk.length; if (size > limit) { tooLarge = true; return } chunks.push(chunk) })
  req.on('end', async () => {
    if (tooLarge) return send(res, { status: 413, body: { error: 'request_too_large' } })
    const bytes = Buffer.concat(chunks)
    const result = await api.handle({ method: req.method, path: req.url, contentType: req.headers['content-type'], headers: req.headers, body: isUpload ? '' : injectTimeContext(bytes.toString('utf8')), bytes, signal: ac.signal })
    send(res, result)
  })
})

server.listen(config.port, HOST, () => {
  console.log(`Dudu web → http://${HOST}:${config.port} | provider: ${config.apiKey ? 'TERKONFIGURASI' : 'BELUM DIKONFIGURASI'} | data: ${dataDir}`)
})
