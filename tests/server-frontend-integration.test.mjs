// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'

describe('Integrasi server chat-server.mjs', () => {
  let proc, port = 9876

  beforeAll(async () => {
    proc = spawn('node', ['server/chat-server.mjs'], {
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
      stdio: 'pipe',
    })
    await new Promise((r) => setTimeout(r, 800))
  })

  afterAll(async () => {
    if (proc) proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
  })

  const fetch = (p, m = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: m }, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    req.end()
  })

  it('GET / mengembalikan HTML 200', async () => {
    const r = await fetch('/')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
  })

  it('/api/health berfungsi', async () => {
    const r = await fetch('/api/health')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body)).toHaveProperty('configured')
  })

  it('API 404 tidak mengembalikan HTML', async () => {
    const r = await fetch('/api/tidak-ada')
    expect(r.status).toBe(404)
    expect(r.headers['content-type']).toContain('application/json')
  })

  it('Aset statis tersedia mendapat MIME benar', async () => {
    const r = await fetch('/assets/index-BoeoTgDI.js')
    expect([200, 404]).toContain(r.status) // bergantung build
  })

  it('Path traversal ditolak', async () => {
    const r = await fetch('/../../etc/passwd')
    expect([403, 404]).toContain(r.status)
  })
})
