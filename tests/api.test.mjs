// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { PNG_1X1 } from './helpers/make-samples.mjs'

const fx = (n) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
let dir, api
const H = { 'x-dudu-client': '1' }
const mkApi = (env = {}, maxMB) => createApi({ getConfig: () => resolveConfig({ ...env, ...(maxMB ? { DUDU_MAX_UPLOAD_MB: String(maxMB) } : {}) }), dataDir: dir })
const upload = (name, bytes, headers = H) => api.handle({ method: 'POST', path: '/api/files', headers: { ...headers, 'x-file-name': encodeURIComponent(name) }, bytes })
const call = (method, p, body, headers = H) => api.handle({ method, path: p, headers, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) })
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-api-')); api = mkApi() })
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('API file', () => {
  it('upload → daftar → metadata → teks → unduh → hapus', async () => {
    const r = await upload('Laporan Ç.docx', fx('real.docx'))
    expect(r.status).toBe(201)
    const f = r.body.file
    expect(f).toMatchObject({ name: 'Laporan Ç.docx', category: 'document', extraction: { state: 'extracted' }, readiness: { ready: true } })
    expect((await call('GET', '/api/files')).body.files.map((x) => x.id)).toEqual([f.id])
    expect((await call('GET', `/api/files/${f.id}`)).body.file.sha256).toBe(f.sha256)
    expect((await call('GET', `/api/files/${f.id}/text`)).body.text).toContain('Laporan Kuartal Tiga')
    const dl = await call('GET', `/api/files/${f.id}/content`)
    expect(Buffer.compare(dl.raw, fx('real.docx'))).toBe(0)
    expect(dl.headers).toMatchObject({ 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" })
    expect(dl.headers['Content-Disposition']).toMatch(/^attachment; filename\*=UTF-8''Laporan%20%C3%87\.docx$/)
    expect((await call('DELETE', `/api/files/${f.id}`)).status).toBe(200)
    expect((await call('GET', `/api/files/${f.id}`)).status).toBe(404)
  })
  it('CSRF: semua request yang mengubah data wajib header X-Dudu-Client', async () => {
    expect((await upload('a.txt', Buffer.from('x'), {})).status).toBe(403)
    expect((await call('POST', '/api/missions', { goal: 'x'.repeat(10), fileId: 'x' }, {})).status).toBe(403)
    expect((await call('DELETE', '/api/files/00000000-0000-4000-8000-000000000000', undefined, {})).status).toBe(403)
    expect((await call('GET', '/api/files', undefined, {})).status).toBe(200) // GET tetap boleh
  })
  it('validasi upload: executable, isi palsu, terlalu besar, kosong, tanpa nama', async () => {
    expect(await upload('x.exe', Buffer.from('MZ'))).toMatchObject({ status: 415, body: { error: 'blocked_type' } })
    expect(await upload('x.pdf', Buffer.from('MZ palsu'))).toMatchObject({ status: 415, body: { error: 'content_mismatch' } })
    const small = mkApi({}, 1); api = small
    expect(await upload('big.txt', Buffer.alloc(1024 * 1024 + 1, 65))).toMatchObject({ status: 413, body: { error: 'file_too_large' } })
    expect((await api.handle({ method: 'POST', path: '/api/files', headers: { ...H, 'x-file-name': encodeURIComponent('a.txt') }, bytes: Buffer.alloc(0) })).body.error).toBe('empty_file')
    expect((await api.handle({ method: 'POST', path: '/api/files', headers: H, bytes: Buffer.from('x') })).body.error).toBe('missing_name')
    expect((await api.handle({ method: 'POST', path: '/api/files', headers: { ...H, 'x-file-name': '%E0%A4%A' }, bytes: Buffer.from('x') })).body.error).toBe('bad_name')
    expect((await call('GET', '/api/files')).body.files).toEqual([])
  })
  it('ID tidak valid / path traversal ditolak', async () => {
    for (const p of ['/api/files/..%2f..%2fetc', '/api/files/abc', '/api/files/abc/content', '/api/missions/xyz', '/api/missions/xyz/artifacts/a']) expect((await call('GET', p)).status).toBe(400)
    expect((await call('GET', '/api/files/00000000-0000-4000-8000-000000000000/content')).status).toBe(404)
  })
  it('XSS: HTML/SVG yang diunggah tidak pernah disajikan sebagai inline; hanya PNG/JPEG/WEBP/GIF yang boleh ?inline=1', async () => {
    const svg = (await upload('x.svg', Buffer.from('<svg onload="alert(1)"/>'))).body.file
    const html = (await upload('x.html', Buffer.from('<script>alert(1)</script>'))).body.file
    const png = (await upload('x.png', PNG_1X1)).body.file
    for (const f of [svg, html]) { const r = await call('GET', `/api/files/${f.id}/content?inline=1`); expect(r.headers['Content-Type']).toBe('application/octet-stream'); expect(r.headers['Content-Disposition']).toMatch(/^attachment/) }
    const ok = await call('GET', `/api/files/${png.id}/content?inline=1`)
    expect(ok.headers['Content-Type']).toBe('image/png'); expect(ok.headers['Content-Disposition']).toMatch(/^inline/); expect(ok.headers['Content-Security-Policy']).toContain('sandbox')
  })
  it('hapus file menyinkronkan Knowledge Base; endpoint KB end-to-end', async () => {
    const f = (await upload('real.pdf', fx('real.pdf'))).body.file
    expect((await call('POST', '/api/kb/docs', { fileId: f.id })).status).toBe(201)
    expect((await call('GET', '/api/kb')).body).toMatchObject({ chunks: 2, retrieval: 'bm25-lexical', embeddings: false })
    expect((await call('POST', '/api/kb/search', { query: 'cuti tahunan' })).body.results[0]).toMatchObject({ name: 'real.pdf', loc: 'hal. 1' })
    expect((await call('POST', '/api/kb/search', { query: '  ' })).status).toBe(400)
    await call('DELETE', `/api/files/${f.id}`)
    expect((await call('GET', '/api/kb')).body.docs).toEqual([]); expect((await call('POST', '/api/kb/search', { query: 'cuti tahunan' })).body.results).toEqual([])
    const scan = (await upload('scan.pdf', fx('scan.pdf'))).body.file
    expect(await call('POST', '/api/kb/docs', { fileId: scan.id })).toMatchObject({ status: 422, body: { error: 'not_indexable' } })
  })
  it('misi lewat API: buat → setujui → unduh artefak; unduh artefak di luar allowlist 404', async () => {
    const f = (await upload('sales.csv', fx('sales.csv'))).body.file
    const d = (await call('POST', '/api/missions', { goal: 'Analisis penjualan', fileId: f.id })).body.mission
    expect(d.state).toBe('draft')
    const m = (await call('POST', `/api/missions/${d.id}/approve`)).body.mission
    expect(m.state).toBe('completed')
    const art = await call('GET', `/api/missions/${d.id}/artifacts/report.md`)
    expect(art.status).toBe(200); expect(art.raw.toString()).toContain('Jumlah baris data: 4'); expect(art.headers['Content-Disposition']).toMatch(/^attachment/)
    expect((await call('GET', `/api/missions/${d.id}/artifacts/..%2Fsecret`)).status).toBe(404)
    expect((await call('POST', `/api/missions/${d.id}/approve`)).status).toBe(409)
    expect((await call('POST', `/api/missions/${d.id}/cancel`)).status).toBe(409) // misi completed tidak dapat dibatalkan
    expect((await call('POST', '/api/missions/xyz/cancel')).status).toBe(400) // ID tidak valid
    expect((await call('DELETE', `/api/missions/${d.id}`)).status).toBe(200)
  })
  it('kapabilitas dilaporkan jujur: vision/STT mati secara default; OCR/video/embedding tidak tersedia', async () => {
    const c = (await call('GET', '/api/capabilities')).body
    expect(c.vision.configured).toBe(false); expect(c.stt.configured).toBe(false); expect(c.chat.configured).toBe(false)
    expect(c.ocr.available).toBe(false); expect(c.video.supported).toBe(false); expect(c.embeddings).toMatchObject({ configured: false, retrieval: 'bm25-lexical' })
    const on = (await mkApi({ DUDU_PROVIDER_API_KEY: 'k', DUDU_VISION_MODEL: 'vm', DUDU_STT_MODEL: 'sm' }).handle({ method: 'GET', path: '/api/capabilities' })).body
    expect(on.vision).toMatchObject({ configured: true, model: 'vm' }); expect(on.stt).toMatchObject({ configured: true, model: 'sm' })
  })
  it('rute tak dikenal menghasilkan 404', async () => {
    expect((await call('GET', '/api/tidak-ada')).status).toBe(404)
  })
})
