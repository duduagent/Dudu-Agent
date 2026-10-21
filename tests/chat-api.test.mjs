// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatApi, MAX_BODY_BYTES } from '../server/chat-api.mjs'
import { ENV_TEMPLATE, parseEnvFile, resolveConfig } from '../server/config.mjs'

const cfg = (over = {}) => ({ apiKey: 'sk-test', baseUrl: 'https://provider.test/v1', model: 'm1', timeoutMs: 5000, ...over })
const post = (api, body, extra = {}) =>
  api.handle({ method: 'POST', path: '/api/chat', contentType: 'application/json', body: JSON.stringify(body), ...extra })
const ok = (content = 'halo', extra = {}) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }], ...extra }) })
const msgs = [{ role: 'user', content: 'hai' }]

// Jalur gagal sengaja men-log ke console.error; tahan agar keluaran tes bersih dan pastikan log tidak membocorkan kunci.
let errSpy
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => {
  const logged = errSpy.mock.calls.flat().join(' ')
  errSpy.mockRestore()
  expect(logged).not.toContain('sk-test')
})

describe('chat API', () => {
  it('GET /api/health melaporkan configured tanpa membocorkan kunci', async () => {
    const r = await createChatApi(cfg()).handle({ method: 'GET', path: '/api/health?x=1' })
    expect(r).toEqual({ status: 200, body: { configured: true, model: 'm1' } })
    expect(JSON.stringify(r)).not.toContain('sk-test')
    expect((await createChatApi(cfg({ apiKey: undefined })).handle({ method: 'GET', path: '/api/health' })).body.configured).toBe(false)
  })

  it('404 untuk rute lain', async () => {
    expect((await createChatApi(cfg()).handle({ method: 'GET', path: '/x' })).status).toBe(404)
    expect((await createChatApi(cfg()).handle({ method: 'GET', path: '/api/chat' })).status).toBe(404)
  })

  it('501 bila kunci provider belum diatur, tanpa memanggil upstream', async () => {
    const f = vi.fn()
    const r = await post(createChatApi(cfg({ apiKey: undefined }), f), { messages: msgs })
    expect(r.status).toBe(501)
    expect(f).not.toHaveBeenCalled()
  })

  it('415 bila Content-Type bukan JSON (proteksi request lintas-situs)', async () => {
    const f = vi.fn()
    const r = await post(createChatApi(cfg(), f), { messages: msgs }, { contentType: 'text/plain' })
    expect(r.status).toBe(415)
    expect(f).not.toHaveBeenCalled()
  })

  it('400 untuk JSON rusak dan payload tidak valid', async () => {
    const api = createChatApi(cfg(), vi.fn())
    expect((await api.handle({ method: 'POST', path: '/api/chat', contentType: 'application/json', body: '{x' })).status).toBe(400)
    expect((await post(api, { messages: [] })).status).toBe(400)
    expect((await post(api, { messages: [{ role: 'root', content: 'x' }] })).status).toBe(400)
    expect((await post(api, {})).status).toBe(400)
  })

  it('413 untuk badan permintaan terlalu besar', async () => {
    const r = await createChatApi(cfg(), vi.fn()).handle({ method: 'POST', path: '/api/chat', contentType: 'application/json', body: 'x'.repeat(MAX_BODY_BYTES + 1) })
    expect(r.status).toBe(413)
  })

  it('sukses: meneruskan model + Authorization ke upstream dan mengembalikan konten', async () => {
    const f = vi.fn(async () => ok('Jawaban', { model: 'upstream-model' }))
    const r = await post(createChatApi(cfg(), f), { messages: msgs })
    expect(r).toEqual({ status: 200, body: { content: 'Jawaban', model: 'upstream-model' } })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://provider.test/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body)).toEqual({ model: 'm1', messages: msgs })
  })

  it('error HTTP upstream → 502 dengan detail dari provider', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }) }))
    const r = await post(createChatApi(cfg(), f), { messages: msgs })
    expect(r.status).toBe(502)
    expect(r.body).toMatchObject({ error: 'upstream_error', status: 401, details: 'Invalid API key' })
  })

  it('respons upstream bukan JSON atau tanpa konten → 502', async () => {
    const a = await post(createChatApi(cfg(), vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>' }))), { messages: msgs })
    expect(a.status).toBe(502)
    const b = await post(createChatApi(cfg(), vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"choices":[]}' }))), { messages: msgs })
    expect(b.status).toBe(502)
    expect(b.body.error).toBe('bad_upstream_response')
  })

  it('kegagalan jaringan → 502 provider_connection_failed (tidak melempar)', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed') })
    const r = await post(createChatApi(cfg(), f), { messages: msgs })
    expect(r.status).toBe(502)
    expect(r.body.error).toBe('provider_connection_failed')
  })

  it('timeout → 504', async () => {
    const f = vi.fn((_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))))
    const r = await post(createChatApi(cfg({ timeoutMs: 20 }), f), { messages: msgs })
    expect(r.status).toBe(504)
    expect(r.body.error).toBe('provider_timeout')
  })

  it('pembatalan oleh klien → 499 dan tidak dianggap error provider', async () => {
    const ac = new AbortController()
    const f = vi.fn((_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))))
    const p = post(createChatApi(cfg(), f), { messages: msgs }, { signal: ac.signal })
    ac.abort()
    expect((await p).status).toBe(499)
  })
})

describe('konfigurasi', () => {
  it('parseEnvFile: komentar, kutip, export, nilai kosong', () => {
    const v = parseEnvFile('# c\nA=1\nexport B="dua"\nC=\'tiga\'\nD=empat # komentar\nE=\n bukan valid\n1X=z\n')
    expect(v).toEqual({ A: '1', B: 'dua', C: 'tiga', D: 'empat', E: '' })
  })

  it('resolveConfig: env menang atas file; nilai kosong diabaikan; default aman', () => {
    const c = resolveConfig({ DUDU_MODEL: 'dari-env' }, { DUDU_MODEL: 'dari-file', DUDU_PROVIDER_API_KEY: 'k', DUDU_PROVIDER_BASE_URL: 'https://x.test/v1///' })
    expect(c).toMatchObject({ model: 'dari-env', apiKey: 'k', baseUrl: 'https://x.test/v1' })
    const d = resolveConfig({}, { DUDU_PROVIDER_API_KEY: '   ' })
    expect(d.apiKey).toBeUndefined()
    expect(d.timeoutMs).toBe(30_000)
    expect(d.port).toBe(8787)
  })

  it('template env tidak berisi kunci rahasia', () => {
    expect(parseEnvFile(ENV_TEMPLATE).DUDU_PROVIDER_API_KEY).toBe('')
  })
})
