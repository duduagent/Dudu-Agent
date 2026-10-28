// Server HTTP untuk DEVELOPMENT / mode web. Aplikasi desktop TIDAK memakai file ini:
// di sana API dijalankan di dalam proses utama Electron tanpa membuka port TCP.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createApi } from './api.mjs'
import { MAX_BODY_BYTES } from './chat-api.mjs'
import { parseEnvFile, resolveConfig } from './config.mjs'

// Railway & produksi lainnya: dengarkan pada semua antarmuka (0.0.0.0)
// Desktop & lokal: tetap pada 127.0.0.1 untuk keamanan.
const HOST = process.env.NODE_ENV === 'production' || process.env.RAILWAY_STATIC_URL ? '0.0.0.0' : '127.0.0.1'

let fileValues = {}
try { fileValues = parseEnvFile(fs.readFileSync('.env', 'utf8')) } catch { /* .env opsional */ }
const config = resolveConfig(process.env, fileValues)
const dataDir = path.resolve(process.env.DUDU_DATA_DIR || '.dudu-data')
const api = createApi({ getConfig: () => config, dataDir })

const send = (res, result) => {
  if (res.writableEnded || res.destroyed) return
  if (result.raw) { res.writeHead(result.status, { ...result.headers, 'Content-Length': result.raw.length }); return res.end(result.raw) }
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(result.body))
}

// Handler API khusus - teruskan ke router API
const apiHandler = (req, res) => {
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableFinished) ac.abort() })

  const isUpload = req.method === 'POST' && String(req.url).split('?')[0] === '/api/files'
  const limit = isUpload ? config.maxUploadBytes : MAX_BODY_BYTES
  const chunks = []
  let size = 0
  let tooLarge = false
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > limit) { tooLarge = true; return }
    chunks.push(chunk)
  })
  req.on('end', async () => {
    if (tooLarge) return send(res, { status: 413, body: { error: 'request_too_large' } })
    const bytes = Buffer.concat(chunks)
    const result = await api.handle({
      method: req.method,
      path: req.url,
      contentType: req.headers['content-type'],
      headers: req.headers,
      body: isUpload ? '' : bytes.toString('utf8'),
      bytes,
      signal: ac.signal,
    })
    send(res, result)
  })
}

/**
 * Normalisasi path dan pastikan berada di dalam direktori root (dist/).
 * Mengembalikan path absolut jika aman, null jika path traversal.
 */
function resolveStaticFile(root, urlPathname) {
  let decoded
  try { decoded = decodeURIComponent(urlPathname) } catch { return null }
  if (decoded.includes('\0')) return null
  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const resolvedRoot = path.resolve(root)
  const full = path.resolve(resolvedRoot, rel)
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) return null
  return full
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.eot': 'application/octet-stream',
}

// Handler frontend statis + SPA fallback
const frontendHandler = (req, res) => {
  const distDir = path.join(process.cwd(), 'dist')
  const normalizedPath = String(req.url).split('?')[0]

  // 1. API routes → apiHandler
  if (normalizedPath.startsWith('/api/')) {
    return apiHandler(req, res)
  }

  // Reject obvious path traversal attempts
  if (normalizedPath.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Forbidden')
  }

  // 2. Static assets (file dengan ekstensi) → serve file atau 404
  const hasExtension = /\.[a-z0-9]+$/i.test(normalizedPath.split('/').pop() ?? '')
  if (hasExtension) {
    const filePath = resolveStaticFile(distDir, normalizedPath)
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Forbidden')
    }
    return serveFile(res, filePath)
  }

  // 3. Frontend routes (tanpa ekstensi) → SPA fallback ke index.html
  const indexPath = path.join(distDir, 'index.html')
  return serveFile(res, indexPath)
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // File tidak ditemukan
      if (filePath.endsWith('index.html')) {
        // index.html itu sendiri hilang → 500 (server tidak siap)
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Frontend build not found. Run "npm run build" first.')
      } else {
        // Aset/halaman frontend tidak ditemukan → 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
      }
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })

    const stream = fs.createReadStream(filePath)
    stream.on('error', () => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal server error')
      }
    })
    stream.pipe(res)
  })
}

const server = http.createServer((req, res) => {
  // Header keamanan untuk respons frontend (non-API)
  if (!req.url.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
  }

  frontendHandler(req, res)
})

server.listen(config.port, HOST, () => {
  console.log(`Dudu API + frontend → http://${HOST}:${config.port} | provider: ${config.apiKey ? 'TERKONFIGURASI' : 'BELUM DIKONFIGURASI'} | data: ${dataDir}`)
})

// Graceful shutdown
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`)
  server.close(() => {
    console.log('Server closed.')
    process.exit(0)
  })
  // Force close after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout.')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
