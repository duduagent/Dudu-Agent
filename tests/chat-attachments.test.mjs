// @vitest-environment node
// Membuktikan bahwa isi lampiran / hasil Knowledge Base benar-benar masuk ke permintaan yang dikirim ke model,
// dan bahwa lampiran yang tidak terbaca dilaporkan jujur. Provider = fetch palsu yang merekam payload SEBENARNYA.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { PNG_1X1 } from './helpers/make-samples.mjs'

const fx = (n) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
const H = { 'x-dudu-client': '1' }
let dir, calls, errSpy
const ENV = { DUDU_PROVIDER_API_KEY: 'k-main', DUDU_PROVIDER_BASE_URL: 'https://p.test/v1', DUDU_MODEL: 'text-model' }

function mkApi(env = {}, sttText = 'transkrip: halo dunia') {
  calls = []
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init })
    if (String(url).endsWith('/audio/transcriptions')) return { ok: true, status: 200, text: async () => JSON.stringify({ text: sttText }) }
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: JSON.parse(init.body).model, choices: [{ message: { content: 'balasan' } }] }) }
  })
  return createApi({ getConfig: () => resolveConfig({ ...ENV, ...env }), dataDir: dir, fetchImpl })
}
const up = async (api, name, bytes) => (await api.handle({ method: 'POST', path: '/api/files', headers: { ...H, 'x-file-name': encodeURIComponent(name) }, bytes })).body.file
const chat = (api, messages, extra = {}) => api.handle({ method: 'POST', path: '/api/chat', contentType: 'application/json', body: JSON.stringify({ messages, ...extra }) })
const chatCall = () => calls.filter((c) => String(c.url).endsWith('/chat/completions')).at(-1)
const sent = () => JSON.parse(chatCall().init.body)

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-ch-')); errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { errSpy.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) })

describe('lampiran dokumen', () => {
  it('isi DOCX nyata masuk ke pesan pengguna yang dikirim ke model; laporan used=true', async () => {
    const api = mkApi(); const f = await up(api, 'laporan.docx', fx('real.docx'))
    const r = await chat(api, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Ringkas lampiran ini', fileIds: [f.id] }])
    expect(r.status).toBe(200)
    const user = sent().messages.find((m) => m.role === 'user')
    expect(typeof user.content).toBe('string'); expect(user.content).toContain('Ringkas lampiran ini'); expect(user.content).toContain('[Lampiran: laporan.docx]')
    expect(user.content).toContain('Penjualan naik 12 persen'); expect(user.content).toContain('| Jawa Barat | 1500 |')
    expect(r.body.attachments).toEqual([expect.objectContaining({ id: f.id, name: 'laporan.docx', used: true })])
    expect(sent().model).toBe('text-model'); expect(chatCall().init.headers.Authorization).toBe('Bearer k-main')
  })
  it('PDF per halaman, XLSX, dan beberapa lampiran sekaligus', async () => {
    const api = mkApi(); const a = await up(api, 'k.pdf', fx('real.pdf')), b = await up(api, 's.xlsx', fx('real.xlsx'))
    await chat(api, [{ role: 'user', content: 'bandingkan', fileIds: [a.id, b.id] }])
    const c = sent().messages[0].content
    expect(c).toContain('[Halaman 2]'); expect(c).toContain('12 hari cuti tahunan'); expect(c).toContain('## Sheet: Penjualan'); expect(c).toContain('Kopi Arabika,Jawa Barat,10,55000.5')
  })
  it('PDF pindaian: tidak ada isi dikirim; model diberi tahu TIDAK terbaca; laporan used=false dengan alasan OCR', async () => {
    const api = mkApi(); const f = await up(api, 'scan.pdf', fx('scan.pdf'))
    const r = await chat(api, [{ role: 'user', content: 'apa isinya?', fileIds: [f.id] }])
    expect(r.body.attachments[0]).toMatchObject({ used: false, reason: expect.stringMatching(/OCR belum tersedia/) })
    expect(sent().messages[0].content).toMatch(/TIDAK dapat dibaca.*Jangan berpura-pura/)
  })
  it('file yang sudah dihapus dilaporkan; ID aneh menghasilkan 400', async () => {
    const api = mkApi(); const f = await up(api, 'a.txt', Buffer.from('isi'))
    await api.handle({ method: 'DELETE', path: `/api/files/${f.id}`, headers: H })
    const r = await chat(api, [{ role: 'user', content: 'x', fileIds: [f.id] }])
    expect(r.body.attachments[0]).toMatchObject({ used: false, reason: expect.stringMatching(/tidak ditemukan/) })
    expect((await chat(api, [{ role: 'user', content: 'x', fileIds: 'bukan-array' }])).status).toBe(400)
    expect((await chat(api, [{ role: 'user', content: 'x', fileIds: Array(9).fill('a') }])).status).toBe(400)
  })
  it('anggaran konteks: file besar dipotong dan ditandai; total ≤ batas', async () => {
    const api = mkApi(); const ids = []
    for (let i = 0; i < 4; i++) ids.push((await up(api, `b${i}.txt`, Buffer.from(`F${i} ` + 'kata '.repeat(10000)))).id) // ±50k char masing-masing
    const r = await chat(api, [{ role: 'user', content: 'x', fileIds: ids }])
    const used = r.body.attachments.filter((a) => a.used)
    expect(used.every((a) => a.truncated && a.chars <= 15000)).toBe(true)
    expect(r.body.attachments.reduce((n, a) => n + (a.chars ?? 0), 0)).toBeLessThanOrEqual(40000)
    expect(r.body.attachments.some((a) => !a.used && /Batas konteks/.test(a.reason))).toBe(true)
  })
  it('anggaran dialokasikan newest-first: lampiran giliran terbaru tidak kehabisan jatah oleh lampiran lama', async () => {
    const api = mkApi(); const old = []
    for (let i = 0; i < 3; i++) old.push((await up(api, `lama${i}.txt`, Buffer.from(`LAMA${i} ` + 'x '.repeat(9000)))).id)
    const baru = await up(api, 'baru.txt', Buffer.from('ISI-TERBARU-PENTING'))
    const r = await chat(api, [{ role: 'user', content: 'giliran 1', fileIds: old }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'giliran 2', fileIds: [baru.id] }])
    expect(sent().messages[2].content).toContain('ISI-TERBARU-PENTING')
    expect(r.body.attachments.find((a) => a.name === 'baru.txt')).toMatchObject({ used: true })
    expect(r.body.attachments.map((a) => a.name)).toEqual(['lama0.txt', 'lama1.txt', 'lama2.txt', 'baru.txt']) // urutan kronologis
    expect(r.body.attachments.reduce((n, a) => n + (a.chars ?? 0), 0)).toBeLessThanOrEqual(40000)
  })
  it('respons tanpa lampiran tidak memuat field attachments/sources (kontrak lama utuh)', async () => {
    const api = mkApi(); const r = await chat(api, [{ role: 'user', content: 'halo' }])
    expect(r.body).toEqual({ content: 'balasan', model: 'text-model', route: expect.anything(), usage: expect.anything(), cost: expect.anything() })
    expect(r.body).not.toHaveProperty('attachments'); expect(r.body).not.toHaveProperty('sources')
  })
})

describe('gambar (vision)', () => {
  it('TANPA DUDU_VISION_MODEL: gambar tidak dikirim, model diberi tahu, laporan jujur', async () => {
    const api = mkApi(); const f = await up(api, 'foto.png', PNG_1X1)
    const r = await chat(api, [{ role: 'user', content: 'apa ini?', fileIds: [f.id] }])
    expect(JSON.stringify(sent())).not.toContain('image_url'); expect(sent().model).toBe('text-model')
    expect(r.body.attachments[0]).toMatchObject({ used: false, reason: expect.stringMatching(/DUDU_VISION_MODEL/) })
    expect(sent().messages[0].content).toMatch(/foto\.png" TIDAK dapat dibaca/)
  })
  it('DENGAN DUDU_VISION_MODEL: byte gambar dikirim base64 sebagai image_url ke model vision', async () => {
    const api = mkApi({ DUDU_VISION_MODEL: 'vision-model' }); const f = await up(api, 'foto.png', PNG_1X1)
    const r = await chat(api, [{ role: 'user', content: 'apa ini?', fileIds: [f.id] }])
    const body = sent()
    expect(body.model).toBe('vision-model')
    const parts = body.messages[0].content
    expect(parts[0]).toEqual({ type: 'text', text: 'apa ini?' })
    expect(parts[1].type).toBe('image_url'); expect(parts[1].image_url.url).toBe(`data:image/png;base64,${PNG_1X1.toString('base64')}`)
    expect(r.body.attachments[0]).toMatchObject({ used: true, via: 'vision' }); expect(r.body.model).toBe('vision-model')
  })
  it('endpoint/kunci vision terpisah dipakai bila diatur; SVG tidak pernah dikirim', async () => {
    const api = mkApi({ DUDU_VISION_MODEL: 'vm', DUDU_VISION_BASE_URL: 'https://v.test/api', DUDU_VISION_API_KEY: 'k-vis' })
    const f = await up(api, 'f.png', PNG_1X1)
    await chat(api, [{ role: 'user', content: 'x', fileIds: [f.id] }])
    expect(chatCall().url).toBe('https://v.test/api/chat/completions'); expect(chatCall().init.headers.Authorization).toBe('Bearer k-vis')
    const svg = await up(api, 'g.svg', Buffer.from('<svg/>'))
    const r = await chat(api, [{ role: 'user', content: 'x', fileIds: [svg.id] }])
    expect(r.body.attachments[0]).toMatchObject({ used: false, reason: expect.stringMatching(/SVG/) }); expect(JSON.stringify(sent())).not.toContain('image_url')
  })
})

describe('audio (transkripsi)', () => {
  it('TANPA DUDU_STT_MODEL: audio tidak dipahami, dilaporkan jujur', async () => {
    const api = mkApi(); const f = await up(api, 'rekam.mp3', Buffer.from('ID3....'))
    const r = await chat(api, [{ role: 'user', content: 'transkripsikan', fileIds: [f.id] }])
    expect(r.body.attachments[0]).toMatchObject({ used: false }); expect(calls.some((c) => String(c.url).includes('audio'))).toBe(false)
  })
  it('DENGAN STT: transkrip diminta ke endpoint, disertakan ke model, di-cache (tidak ditranskripsi dua kali)', async () => {
    const api = mkApi({ DUDU_STT_MODEL: 'stt-model' }); const f = await up(api, 'rekam.mp3', Buffer.from('ID3....'))
    const r = await chat(api, [{ role: 'user', content: 'apa isi rekaman?', fileIds: [f.id] }])
    const stt = calls.find((c) => String(c.url).endsWith('/audio/transcriptions'))
    expect(stt.init.body.get('model')).toBe('stt-model'); expect(stt.init.body.get('file').name).toBe('rekam.mp3')
    expect(sent().messages[0].content).toContain('transkrip: halo dunia'); expect(r.body.attachments[0]).toMatchObject({ used: true, via: 'stt' })
    expect((await api.files.get(f.id)).extraction).toMatchObject({ state: 'extracted', method: 'stt:stt-model' })
    await chat(api, [{ role: 'user', content: 'lagi', fileIds: [f.id] }])
    expect(calls.filter((c) => String(c.url).endsWith('/audio/transcriptions'))).toHaveLength(1)
  })
  it('kegagalan STT dilaporkan sebagai lampiran tidak terbaca, chat tetap berjalan', async () => {
    const api = mkApi({ DUDU_STT_MODEL: 'm' }, '')
    const f = await up(api, 'k.mp3', Buffer.from('ID3....'))
    const r = await chat(api, [{ role: 'user', content: 'x', fileIds: [f.id] }])
    expect(r.status).toBe(200); expect(r.body.attachments[0]).toMatchObject({ used: false, reason: expect.stringMatching(/Transkripsi kosong/) })
  })
})

describe('Knowledge Base di chat (RAG end-to-end)', () => {
  it('konteks hasil retrieval disuntikkan sebagai pesan sistem dengan penanda [S#]; sumber dikembalikan', async () => {
    const api = mkApi(); const f = await up(api, 'kebijakan.pdf', fx('real.pdf'))
    await api.handle({ method: 'POST', path: '/api/kb/docs', headers: H, contentType: 'application/json', body: JSON.stringify({ fileId: f.id }) })
    const r = await chat(api, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Berapa hari cuti tahunan karyawan?' }], { useKnowledge: true })
    const msgs = sent().messages
    const ctx = msgs.find((m) => m.role === 'system' && m.content.includes('Knowledge Base'))
    expect(ctx.content).toContain('[S1] kebijakan.pdf (hal. 1)'); expect(ctx.content).toContain('12 hari cuti tahunan')
    expect(msgs.indexOf(ctx)).toBeGreaterThan(0); expect(msgs.at(-1)).toMatchObject({ role: 'user' })
    expect(r.body.sources[0]).toMatchObject({ n: 1, fileId: f.id, name: 'kebijakan.pdf', loc: 'hal. 1' })
  })
  it('tanpa hasil relevan: model diperintah untuk tidak mengarang; sources kosong', async () => {
    const api = mkApi(); const f = await up(api, 'k.pdf', fx('real.pdf'))
    await api.handle({ method: 'POST', path: '/api/kb/docs', headers: H, contentType: 'application/json', body: JSON.stringify({ fileId: f.id }) })
    const r = await chat(api, [{ role: 'user', content: 'quantum chromodynamics' }], { useKnowledge: true })
    expect(r.body.sources).toEqual([]); expect(JSON.stringify(sent().messages)).toMatch(/tidak ada bagian yang cocok.*Jangan mengarang/)
  })
  it('tanpa useKnowledge: tidak ada retrieval dan tidak ada field sources', async () => {
    const api = mkApi(); const f = await up(api, 'k.pdf', fx('real.pdf'))
    await api.handle({ method: 'POST', path: '/api/kb/docs', headers: H, contentType: 'application/json', body: JSON.stringify({ fileId: f.id }) })
    const r = await chat(api, [{ role: 'user', content: 'cuti tahunan' }])
    expect(r.body.sources).toBeUndefined(); expect(JSON.stringify(sent())).not.toContain('Knowledge Base')
  })
  it('log error tidak memuat isi file atau kunci API', async () => {
    const api = createApi({ getConfig: () => resolveConfig(ENV), dataDir: dir, fetchImpl: async () => { throw new TypeError('fetch failed') } })
    const f = await up(api, 'rahasia.txt', Buffer.from('ISI-SANGAT-RAHASIA'))
    const r = await chat(api, [{ role: 'user', content: 'x', fileIds: [f.id] }])
    expect(r.status).toBe(502)
    const logged = errSpy.mock.calls.flat().join(' '); expect(logged).not.toContain('ISI-SANGAT-RAHASIA'); expect(logged).not.toContain('k-main')
  })
})
