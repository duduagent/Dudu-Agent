// Server HTTP untuk DEVELOPMENT / mode web. Aplikasi desktop TIDAK memakai file ini:
// di sana API dijalankan di dalam proses utama Electron tanpa membuka port TCP.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createApi } from './api.mjs'
import { MAX_BODY_BYTES } from './chat-api.mjs'
import { parseEnvFile, resolveConfig } from './config.mjs'

const HOST = '127.0.0.1' // hanya loopback; jangan buka endpoint berkunci API ke jaringan

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

const server = http.createServer((req, res) => {
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
})

server.listen(config.port, HOST, () => {
  console.log(`Dudu API → http://${HOST}:${config.port} | provider: ${config.apiKey ? 'TERKONFIGURASI' : 'BELUM DIKONFIGURASI'} | data: ${dataDir}`)
})
