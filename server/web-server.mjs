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
    const result = await api.handle({ method: req.method, path: req.url, contentType: req.headers['content-type'], headers: req.headers, body: isUpload ? '' : bytes.toString('utf8'), bytes, signal: ac.signal })
    send(res, result)
  })
})

server.listen(config.port, HOST, () => {
  console.log(`Dudu web → http://${HOST}:${config.port} | provider: ${config.apiKey ? 'TERKONFIGURASI' : 'BELUM DIKONFIGURASI'} | data: ${dataDir}`)
})
