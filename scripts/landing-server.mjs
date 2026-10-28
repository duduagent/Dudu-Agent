// Server statis untuk pratinjau lokal landing page.
// Tanpa dependensi baru (node:http + node:fs).
//
// Pakai: node scripts/landing-server.mjs [port]   (default 4173)
// buka http://127.0.0.1:4173/
//
// Catatan: API waiting-list (/api/waiting-list) TIDAK dilayani di sini.
// Formulir akan menampilkan pesan jujur bahwa endpoint tidak terjangkau,
// kecuali server API Dudu juga berjalan di origin yang sama (proxy/reverse proxy).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const siteDir = path.join(root, 'landing')
const port = Number(process.argv[2]) || 4173
const HOST = '127.0.0.1'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${port}`)
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const target = path.join(siteDir, path.normalize(rel).replace(/^([\\/])+/, ''))
  // Cegah path traversal di luar folder landing.
  if (!target.startsWith(siteDir)) { res.writeHead(403).end('Forbidden'); return }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(data)
  })
})

server.listen(port, HOST, () => {
  console.log(`Landing page (pratinjau statis): http://${HOST}:${port}/`)
  console.log('API waiting-list tidak dilayani di sini — jalankan API Dudu juga bila perlu.')
})
