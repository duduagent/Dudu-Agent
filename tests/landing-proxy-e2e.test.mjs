// @vitest-environment node
// Uji integrasi end-to-end: landing page → reverse proxy → API Dudu (loopback) → berkas.
//
// Proxy di sini adalah "test double" yang MENERJEMAHKAN kebijakan berkas
// deploy/nginx/dudu-landing.conf (bukan nginx sungguhan — nginx tidak tersedia di
// lingkungan ini; lihat deploy/README.md untuk prosedur uji nginx yang sebenarnya).
// Yang diuji di sini: arsitektur same-origin, batas body, rate limit per-IP, penyaringan
// endpoint, perilaku backend mati, dan aturan logging tanpa email.
//
// Data yang dipakai: SINTETIS (alamat @example.invalid).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'

let dir
let apiServer
let proxyServer
let apiPort
let proxyPort
let backendUp = true
let proxyLog = []

const H_JSON = (method, p, body) => ({ method, path: p, contentType: 'application/json', body: JSON.stringify(body ?? {}), headers: H_JSON.headers })
H_JSON.headers = { 'x-dudu-client': '1' }

/** Server API Dudu sungguhan di loopback (meniru chat-server.mjs, tanpa fitur lain). */
function startApi() {
  const api = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
  apiServer = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const result = await api.handle({
        method: req.method,
        path: req.url,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
        headers: { 'x-dudu-client': req.headers['x-dudu-client'] ?? '' },
      })
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(result.body))
    })
  })
  return new Promise((resolve) => apiServer.listen(0, '127.0.0.1', () => { apiPort = apiServer.address().port; resolve() }))
}

/**
 * Test double reverse proxy. Aturannya MENYALIN deploy/nginx/dudu-landing.conf:
 *  - hanya POST /api/waiting-list yang diteruskan (API lain → 404)
 *  - batas ukuran body (16k)
 *  - rate limit per-IP (alamat klien, bukan XFF dari klien)
 *  - X-Dudu-Client disetel oleh proxy
 *  - backend mati → 503 dengan pesan sendiri
 */
function startProxy({ ratePerMinute = 5 } = {}) {
  const hits = new Map()
  proxyServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const clientIp = req.socket.remoteAddress || 'unknown'   // alamat klien asli
    const chunks = []
    let size = 0
    let tooLarge = false
    await new Promise((resolve) => {
      req.on('data', (c) => { size += c.length; if (size > 16 * 1024) tooLarge = true; else chunks.push(c) })
      req.on('end', resolve)
    })
    // Log TANPA body/query (tidak boleh mencatat email).
    proxyLog.push({ method: req.method, path: url.pathname, ip: clientIp, tooLarge })

    if (url.pathname === '/api/waiting-list') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return }
      if (tooLarge) { res.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'request_too_large' })); return }
      const now = Date.now()
      const list = (hits.get(clientIp) || []).filter((t) => now - t < 60_000)
      if (list.length >= ratePerMinute) { res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'rate_limited' })); return }
      list.push(now); hits.set(clientIp, list)
      if (!backendUp) {
        res.writeHead(503, { 'Content-Type': 'text/html', 'Retry-After': '60' })
          .end('<!doctype html><title>Dudu</title><h1>While we are down</h1>')
        return
      }
      const upstream = await new Promise((resolve) => {
        const r = http.request({ host: '127.0.0.1', port: apiPort, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'x-dudu-client': '1' } }, (rr) => {
          const c2 = []
          rr.on('data', (d) => c2.push(d))
          rr.on('end', () => resolve({ status: rr.statusCode, body: Buffer.concat(c2).toString('utf8') }))
        })
        r.on('error', () => resolve({ status: 502, body: '{"error":"bad_gateway"}' }))
        r.end(Buffer.concat(chunks))
      })
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' }).end(upstream.body)
      return
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not_found' })); return }
    // Landing page statis (diperlakukan sebagai file statis oleh proxy sungguhan).
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Dudu</title>')
  })
  return new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', () => { proxyPort = proxyServer.address().port; resolve() }))
}

const post = (path, body, headers = {}) => fetch(`http://127.0.0.1:${proxyPort}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
})

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-proxy-'))
  proxyLog = []
  backendUp = true
  await startApi()
  await startProxy()
})

afterEach(async () => {
  await new Promise((r) => { apiServer.close(r) })
  await new Promise((r) => { proxyServer.close(r) })
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Reverse proxy (test double) → API Dudu', () => {
  it('pendaftaran lewat proxy sampai ke berkas, dan tidak ada email di log proxy', async () => {
    const res = await post('/api/waiting-list', { email: 'e2e.one@example.invalid', platform: 'web' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const stored = await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8')
    expect(stored).toContain('e2e.one@example.invalid')
    // Log proxy tidak boleh memuat email (body tidak masuk log).
    expect(JSON.stringify(proxyLog)).not.toContain('e2e.one')
    expect(proxyLog[0]).toMatchObject({ method: 'POST', path: '/api/waiting-list' })
  })

  it('endpoint API lain TIDAK diekspos (404) — API Dudu tidak punya autentikasi', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/missions`)
    expect(res.status).toBe(404)
    const res2 = await fetch(`http://127.0.0.1:${proxyPort}/api/capability-registry`)
    expect(res2.status).toBe(404)
  })

  it('hanya POST yang diterima pada endpoint daftar tunggu', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/waiting-list`)
    expect(res.status).toBe(405)
  })

  it('body melebihi batas proxy → 413 dan tidak tersimpan', async () => {
    const res = await post('/api/waiting-list', { email: 'e2e.big@example.invalid', note: 'A'.repeat(20000) })
    expect(res.status).toBe(413)
    const stored = await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8').catch(() => '')
    expect(stored).not.toContain('e2e.big')
  })

  it('rate limit per-IP di proxy → 429 setelah ambang', async () => {
    const codes = []
    for (let i = 0; i < 8; i++) codes.push((await post('/api/waiting-list', { email: `e2e.rl.${i}@example.invalid` })).status)
    expect(codes.filter((c) => c === 201).length).toBe(5)   // batas 5/menit
    expect(codes.filter((c) => c === 429).length).toBe(3)
  })

  it('backend mati → 503 dengan pesan sendiri (bukan error proxy mentah)', async () => {
    backendUp = false
    const res = await post('/api/waiting-list', { email: 'e2e.down@example.invalid' })
    expect(res.status).toBe(503)
    expect(await res.text()).toMatch(/temporarily unavailable|down/i)
  })

  it('respons dari API tetap seragam untuk pendaftar baru & duplikat (melalui proxy)', async () => {
    const a = await post('/api/waiting-list', { email: 'e2e.same@example.invalid' })
    const b = await post('/api/waiting-list', { email: 'E2E.SAME@example.invalid' })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const [ja, jb] = [await a.json(), await b.json()]
    expect(Object.keys(jb).sort()).toEqual(Object.keys(ja).sort())
    expect(JSON.stringify(jb)).not.toContain('example.invalid')
  })
})
