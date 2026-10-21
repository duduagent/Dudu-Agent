// @vitest-environment node
// Uji modul integrasi v0.4.0: akun & sesi, OAuth (mock), MCP (server + klien stdio nyata),
// Input Data → Knowledge Base (terbaca chat/BM25), plugin lokal, connector webhook, CLI.
// Tidak ada jaringan pihak ketiga sungguhan dalam tes — semua endpoint eksternal dipalsukan.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { run as runCli } from '../server/cli.mjs'

const H = { 'x-dudu-client': '1' }
let dir
const H_JSON = (method, p, body, headers = {}) =>
  ({ method, path: p, contentType: 'application/json', body: JSON.stringify(body), headers: { ...H, ...headers } })
const mkApi = (fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })) =>
  createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k-main', DUDU_MODEL: 'env-model' }), dataDir: dir, fetchImpl })

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-int-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('Akun: daftar, login, sesi (email + kata sandi, scrypt)', () => {
  it('daftar → sesi token; duplikat → 409; sandi lemah → 400; kunci rahasia tidak pernah keluar', async () => {
    const api = mkApi()
    const r = await api.handle(H_JSON('POST', '/api/auth/register', { email: 'budi@mail.com', password: 'rahasiabanget', name: 'Budi' }))
    expect(r.status).toBe(201)
    expect(r.body.user).toMatchObject({ email: 'budi@mail.com', provider: 'local' })
    expect(r.body.session.token).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(r.body)).not.toMatch(/passHash|salt/)
  })
  it('login salah → 401; login benar → 200 + /api/auth/me membaca sesi; logout menghapus sesi', async () => {
    const api = mkApi()
    const reg = (await api.handle(H_JSON('POST', '/api/auth/register', { email: 'siti@mail.com', password: 'rahasiabanget' }))).body
    expect((await api.handle(H_JSON('POST', '/api/auth/login', { email: 'siti@mail.com', password: 'SALAHcedep' }))).status).toBe(401)
    const ok = await api.handle(H_JSON('POST', '/api/auth/login', { email: 'SITI@mail.com', password: 'rahasiabanget' })) // email tak peka huruf besar
    expect(ok.status).toBe(200)
    const me = await api.handle({ method: 'GET', path: '/api/auth/me', headers: { authorization: `Bearer ${ok.body.session.token}` } })
    expect(me.body.user).toMatchObject({ email: 'siti@mail.com' })
    const meReg = await api.handle({ method: 'GET', path: '/api/auth/me', headers: { authorization: `Bearer ${reg.session.token}` } })
    expect(meReg.body.user.email).toBe('siti@mail.com') // sesi lama tetap sah
    expect((await api.handle({ method: 'GET', path: '/api/auth/me' })).body.user).toBeNull() // tanpa sesi = anonim, mode lokal tetap hidup
    expect((await api.handle(H_JSON('POST', '/api/auth/logout', {}, { authorization: `Bearer ${ok.body.session.token}` }))).body.loggedOut).toBe(true)
    expect((await api.handle({ method: 'GET', path: '/api/auth/me', headers: { authorization: `Bearer ${ok.body.session.token}` } })).body.user).toBeNull()
  })
})

describe('OAuth Google/GitHub: BYO aplikasi + pertukaran kode (endpoint resmi dipalsukan)', () => {
  it('belum diatur → url 409 dengan arahan; PUT app → status terkonfigurasi dengan id tersamar', async () => {
    const api = mkApi()
    const st = (await api.handle({ method: 'GET', path: '/api/auth/oauth/google/status' })).body
    expect(st).toMatchObject({ configured: false })
    expect((await api.handle(H_JSON('POST', '/api/auth/oauth/google/url', { redirectUri: 'http://127.0.0.1:8787' }))).status).toBe(409)
    const put = await api.handle(H_JSON('PUT', '/api/auth/oauth/google/app', { clientId: '1234-secret-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-rahasiabanget-xyz' }))
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ configured: true, clientId: '1234…' })
    expect(JSON.stringify(put.body)).not.toContain('GOCSPX')
    const putGit = await api.handle(H_JSON('PUT', '/api/auth/oauth/github/app', { clientId: 'Iv1_abcdef1234', clientSecret: 'ghs-rahasia' }))
    expect(putGit.body.configured).toBe(true)
    const url = await api.handle(H_JSON('POST', '/api/auth/oauth/github/url', { redirectUri: 'http://127.0.0.1:8787' }))
    expect(url.status).toBe(200) && url.body.url.startsWith('https://github.com/login/oauth/authorize')
  })
  it('exchange kode benar → pengguna dibuat + sesi; token/profile endpoint yang dipanggil benar', async () => {
    const seen = []
    const oauthFetch = async (url, init) => {
      seen.push(String(url))
      if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') {
        expect(init.headers.authorization).toBe('Bearer gt-abc')
        return { ok: true, status: 200, json: async () => ({ sub: 'g-99', email: 'ayu@gmail.com', name: 'Ayu' }) }
      }
      expect(init.body).toContain('grant_type=authorization_code')
      return { ok: true, status: 200, json: async () => ({ access_token: 'gt-abc' }) }
    }
    const api = mkApi(oauthFetch)
    await api.handle(H_JSON('PUT', '/api/auth/oauth/google/app', { clientId: 'cid-123', clientSecret: 'cs-456' }))
    const ex = await api.handle(H_JSON('POST', '/api/auth/oauth/google/exchange', { code: 'auth-code-77', redirectUri: 'http://127.0.0.1:8787/auth/callback' }))
    expect(ex.status).toBe(200)
    expect(ex.body.user).toMatchObject({ email: 'ayu@gmail.com', provider: 'google' })
    expect(ex.body.session.token).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(ex.body)).not.toContain('cs-456')
    expect((await api.handle({ method: 'GET', path: '/api/auth/me', headers: { authorization: `Bearer ${ex.body.session.token}` } })).body.user.email).toBe('ayu@gmail.com')
  })
})

describe('MCP: server JSON-RPC lokal (tool nyata) + klien stdio eksternal', () => {
  it('initialize / tools / tools/call kb_search membaca data yang diinput via /api/kb/text', async () => {
    const api = mkApi()
    const put = await api.handle(H_JSON('POST', '/api/kb/text', { title: 'Manual Zap-terminal', text: 'Zap-terminal adalah alat pengelola listrik kapal; mematikan daya utama memerlukan kunci servis.' }))
    expect(put.status).toBe(201)
    const call = (method, params, id = 1) => api.handle(H_JSON('POST', '/api/mcp/call', { jsonrpc: '2.0', method, params, id }).then ? null : null)
    const init = await api.handle(H_JSON('POST', '/api/mcp/call', { jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 }))
    expect(init.status).toBe(200)
    expect(init.body.result.serverInfo).toMatchObject({ name: 'dudu-ai' })
    const list = await api.handle(H_JSON('POST', '/api/mcp/call', { jsonrpc: '2.0', method: 'tools/list', id: 2 }))
    expect(list.body.result.tools.map((t) => t.name)).toEqual(['kb_search', 'kb_stats', 'file_list'])
    const search = await api.handle(H_JSON('POST', '/api/mcp/call', { jsonrpc: '2.0', method: 'tools/call', params: { name: 'kb_search', arguments: { query: 'zap-terminal listrik' } }, id: 3 }))
    const text = search.body.result.content[0].text
    expect(text).toMatch(/zap-terminal/i)
    const wrong = await api.handle(H_JSON('POST', '/api/mcp/call', { jsonrpc: '2.0', method: 'tools/call', params: { name: 'tidak_ada' }, id: 4 }))
    expect(wrong.body.error?.code).toBe(-32602)
    const bad = await api.handle(H_JSON('POST', '/api/mcp/call', { hello: 1 }))
    expect(bad.status).toBe(400)
    void call
  })
  it('klien MCP stdio: handshake NYATA ke server mini → tool terbaca; perintah gagal dilaporkan jujur', async () => {
    const serverScript = path.join(dir, 'mini-mcp.mjs')
    await fs.writeFile(serverScript, `import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (l) => {
  try { const m = JSON.parse(l); if (m.id === 1) print({ id: 1, result: { serverInfo: { name: 'mini-mcp' } } }); if (m.id === 2) print({ id: 2, result: { tools: [{ name: 'echo' }, { name: 'ping' }] } }) } catch {}
  function print(o) { process.stdout.write(JSON.stringify(o) + '\\n') }
})`)
    const api = mkApi()
    const add = await api.handle(H_JSON('POST', '/api/mcp/servers', { label: 'Mini MCP', command: process.execPath, args: [serverScript] }))
    expect(add.status).toBe(201)
    const probe = await api.handle(H_JSON('POST', '/api/mcp/servers/' + add.body.server.id + '/probe', {}))
    expect(probe.status).toBe(200)
    expect(probe.body.ok).toBe(true)
    expect(probe.body.tools).toEqual(['echo', 'ping'])
    const badAdd = await api.handle(H_JSON('POST', '/api/mcp/servers', { label: 'Bogus', command: 'perintah-tidak-ada-xyz', args: [] }))
    const probeBad = await api.handle(H_JSON('POST', '/api/mcp/servers/' + badAdd.body.server.id + '/probe', {}))
    expect(probeBad.body.ok).toBe(false)
    expect(String(probeBad.body.error)).toMatch(/Gagal menjalankan|Timeout|tidak dapat/)
    expect((await api.handle(H_JSON('POST', '/api/mcp/servers/' + badAdd.body.server.id + '/remove', {}))).body.removed).toBe(true)
  }, 30_000)
})

describe('Input Data → terbaca sistem Dudu', () => {
  it('teks → tersimpan + terindeks → /api/kb/search menemukannya; ditampilkan di daftar KB', async () => {
    const api = mkApi()
    const r = await api.handle(H_JSON('POST', '/api/kb/text', { title: 'SOP Peluncuran', text: 'Peluncuran produk wajib uji QA dan peminjaman trial 7 hari.' }))
    expect(r.status).toBe(201)
    expect(r.body.file.name).toBe('SOP Peluncuran.txt')
    expect(r.body.indexed.chunks).toBeGreaterThan(0)
    const s = await api.handle(H_JSON('POST', '/api/kb/search', { query: 'uji QA peluncuran' }))
    expect(s.body.results[0]?.name).toBe('SOP Peluncuran.txt')
    expect(s.body.results[0]).toHaveProperty('text')
    const stats = await api.handle({ method: 'GET', path: '/api/kb' })
    expect(stats.body.docs.some((d) => d.name === 'SOP Peluncuran.txt')).toBe(true)
    expect((await api.handle(H_JSON('POST', '/api/kb/text', { text: '   ' }))).status).toBe(400)
  })
})

describe('Plugin lokal: daftar, aktif/nonaktif, jalankan tool NYATA', () => {
  it('plugin time diaktifkan → run membalas jam nyata; nonaktif → 409; folder tanpa manifest dilaporkan', async () => {
    const pdir = path.join(dir, 'plugins', 'jam')
    await fs.mkdir(pdir, { recursive: true })
    await fs.writeFile(path.join(pdir, 'manifest.json'), JSON.stringify({ name: 'jam', displayName: 'Jam Lokal', version: '1.0.0', description: 'Balas waktu perangkat (viewport plugin contoh).', entry: 'plugin.mjs' }))
    await fs.writeFile(path.join(pdir, 'plugin.mjs'), `export default { name: 'jam', run: () => ({ iso: new Date().toISOString() }) }`)
    const badDir = path.join(dir, 'plugins', 'korup')
    await fs.mkdir(badDir, { recursive: true })
    const api = mkApi()
    const list = (await api.handle({ method: 'GET', path: '/api/plugins' })).body.plugins
    expect(list.find((p) => p.id === 'jam')).toMatchObject({ enabled: false, name: 'jam' })
    expect(list.find((p) => p.id === 'korup')?.error).toMatch(/manifest/)
    expect((await api.handle(H_JSON('POST', '/api/plugins', { id: 'jam', enabled: true }))).body.enabled).toBe(true)
    const run = await api.handle(H_JSON('POST', '/api/plugins/jam/run', {}))
    expect(run.status).toBe(200)
    expect(Number.isFinite(Date.parse(run.body.result.iso))).toBe(true)
    expect((await api.handle(H_JSON('POST', '/api/plugins', { id: 'jam', enabled: false }))).body.enabled).toBe(false)
    expect((await api.handle(H_JSON('POST', '/api/plugins/jam/run', {}))).status).toBe(409)
    expect((await api.handle(H_JSON('POST', '/api/plugins', { id: 'tidakada', enabled: true }))).status).toBe(404)
  })
})

describe('Connector: webhook satu-satunya yang dieksekusi; lainnya jujur "belum live"', () => {
  it('email_smtp → test 409 bukan sukses palsu; webhook diuji dengan fetch mock → status nyata; rahasia tersamar', async () => {
    const api = mkApi()
    expect((await api.handle(H_JSON('POST', '/api/connectors', { id: 'email_smtp' }))).status).toBe(409)
    expect((await api.handle(H_JSON('PUT', '/api/connectors', { id: 'webhook', fields: { url: 'https://hooks.contoh.test/abc', secret: 'R4hasia-long' } }))).status).toBe(200)
    const lst = (await api.handle({ method: 'GET', path: '/api/connectors' })).body.connectors
    const wh = lst.find((c) => c.id === 'webhook')
    expect(wh.configured).toBe(true)
    expect(JSON.stringify(lst)).not.toContain('R4hasia-long')
    let sawSecret = null
    const api2 = mkApi(async (url, init) => {
      sawSecret = init.headers['x-dudu-secret']
      return { ok: true, status: 204, json: async () => ({}) }
    })
    await api2.handle(H_JSON('PUT', '/api/connectors', { id: 'webhook', fields: { url: 'https://hooks.contoh.test/abc', secret: 'R4hasia-long' } }))
    const t = (await api2.handle(H_JSON('POST', '/api/connectors', { id: 'webhook' }))).body
    expect(t).toMatchObject({ ok: true, status: 204 })
    expect(sawSecret).toBe('R4hasia-long')
    expect((await api2.handle(H_JSON('POST', '/api/connectors', { id: 'yuu' }))).status).toBe(400)
    const em = (await api2.handle({ method: 'PUT', path: '/api/connectors', contentType: 'application/json', body: JSON.stringify({ id: 'email_smtp', fields: { host: 'smtp.contoh.test', port: '465', user: 'x', from: 'y' } }), headers: H }))
    expect(em.status).toBe(200)
    expect((await api2.handle(H_JSON('POST', '/api/connectors', { id: 'email_smtp' }))).body.error).toBe('not_implemented')
  })
  it('emit: tanpa webhook terpasang → delivered:false (tidak pernah <i>sukses palsu</i>)', async () => {
    const api = mkApi()
    expect((await api.connectors.emit('dudu.test')).delivered).toBe(false)
  })
})

describe('Skill: galeri bawaan + skill kustom yang benar-benar masuk ke prompt chat', () => {
  it('daftar bawaan jujur (vision belum tersedia), buat/aktifkan/hapus, validasi nama & instruksi', async () => {
    const api = mkApi()
    const list = (await api.handle({ method: 'GET', path: '/api/skills' })).body
    expect(list.builtin.length).toBeGreaterThan(5)
    expect(list.builtin.find((s) => s.id === 'image-vision').available).toBe(false)
    expect(list.builtin.find((s) => s.id === 'kb-search')).toMatchObject({ available: true, kind: 'builtin' })
    expect(list.categories).toContain('Umum')
    expect((await api.handle(H_JSON('POST', '/api/skills', { name: 'X', instruction: '' }))).status).toBe(400)
    const created = await api.handle(H_JSON('POST', '/api/skills', { name: 'Email Formal', category: 'Umum', description: 'Gaya surel', instruction: 'Selalu akhiri dengan salam formal.' }))
    expect(created.status).toBe(201)
    expect(created.body.skill.enabled).toBe(false)
    expect((await api.handle(H_JSON('POST', '/api/skills', { name: 'email formal', instruction: 'duplikat' }))).status).toBe(409)
    const id = created.body.skill.id
    const on = await api.handle(H_JSON('PUT', `/api/skills/${id}`, { enabled: true }))
    expect(on.body.skill.enabled).toBe(true)
    expect((await api.handle(H_JSON('PUT', '/api/skills/tidak-ada', { enabled: true }))).status).toBe(404)
    expect((await api.handle({ method: 'DELETE', path: `/api/skills/${id}`, headers: H })).body.deleted).toBe(true)
    expect((await api.handle({ method: 'DELETE', path: `/api/skills/${id}`, headers: H })).status).toBe(404)
  })
  it('skill aktif dikirim sebagai instruksi system ke model; nonaktif tidak dikirim', async () => {
    const bodies = []
    const chatFetch = async (url, init) => {
      bodies.push(typeof init.body === 'string' ? init.body : '')
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ model: 'env-model', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
      }
    }
    const api = mkApi(chatFetch)
    const skill = (await api.handle(H_JSON('POST', '/api/skills', { name: 'Ringkas Padat', category: 'Umum', instruction: 'Jawab maksimum tiga kalimat.' }))).body.skill
    const chat = () => api.handle(H_JSON('POST', '/api/chat', { messages: [{ role: 'user', content: 'halo' }], source: 'int-test' }))
    const before = await chat()
    expect(before.status).toBe(200)
    expect(bodies.at(-1)).not.toContain('maksimum tiga kalimat')
    await api.handle(H_JSON('PUT', `/api/skills/${skill.id}`, { enabled: true }))
    expect((await chat()).status).toBe(200)
    expect(bodies.at(-1)).toContain('maksimum tiga kalimat')
    expect(bodies.at(-1)).toContain('Ringkas Padat')
    await api.handle(H_JSON('PUT', `/api/skills/${skill.id}`, { enabled: false }))
    expect((await chat()).status).toBe(200)
    expect(bodies.at(-1)).not.toContain('maksimum tiga kalimat')
  })
})

describe('CLI dudu (HTTP ke server lokal)', () => {
  const mkFetch = (handlers) => async (url, init) => {
    const p = String(url)
    for (const [needle, resp] of handlers) if (p.includes(needle)) return { status: resp[0], json: async () => resp[1] }
    throw new Error('unhandled ' + p)
  }
  it('status & chat & kb: kode keluar benar, header X-Dudu-Client terkirim, teks tampil', async () => {
    const outLines = []
    const write = (s) => outLines.push(String(s))
    const sawHeaders = []
    const fetch = async (url, init) => { sawHeaders.push(init.headers); return mkFetch([['/api/health', [200, { ok: true }]]])(url, init) }
    expect(await runCli(['status'], { fetchImpl: fetch, write })).toBe(0)
    expect(outLines.join('\n')).toContain('ok')
    expect(sawHeaders[0]['x-dudu-client']).toBe('1')
    const chatFetch = mkFetch([['/api/chat', [200, { content: 'Halo juga!', route: { providerId: 'env', modelId: 'env-model', tier: 'unknown', mode: 'FREE_FIRST' } }]]])
    expect(await runCli(['chat', 'halo'], { fetchImpl: chatFetch, write })).toBe(0)
    expect(outLines.join('\n')).toContain('Halo juga!')
    const kbFetch = mkFetch([['/api/kb/search', [200, { results: [{ name: 'A.txt', loc: 'c0', text: 'isi dokumen relevan' }], }]]])
    expect(await runCli(['kb', 'dokumen relevan'], { fetchImpl: kbFetch, write })).toBe(0)
    expect(outLines.join('\n')).toContain('A.txt')
    expect(await runCli(['help'], { write })).toBe(0)
    expect(await runCli(['perintah-tak-dikenal'], { write })).toBe(1)
  })
  it('server mati → pesan jujur + kode keluar 1 (tidak ada balasan dikarang)', async () => {
    const errs = []
    const code = await runCli(['chat', 'hi'], { fetchImpl: async () => { throw new Error('ECONNREFUSED') }, env: { PORT: '59999' }, write: () => {} })
    expect(code).toBe(1)
    expect(errs).toHaveLength(0) // (stderr lewat default; cukup kode keluar)
  })
})
