// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileStore } from '../server/files.mjs'
import { chunkText, createKnowledgeBase, tokenize, CHUNK_SIZE } from '../server/knowledge.mjs'

const fx = (n) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
let dir, files, kb
const fresh = () => createKnowledgeBase({ dataDir: dir, files })
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-kb-')); files = createFileStore({ dataDir: dir }); kb = fresh() })
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('chunking', () => {
  it('chunk ≤ ukuran maksimum, ada overlap antar chunk, tidak ada chunk hanya-overlap', () => {
    const para = Array.from({ length: 60 }, (_, i) => `Kalimat nomor ${i} tentang topik pengujian.`).join(' ')
    const cs = chunkText(para)
    expect(cs.length).toBeGreaterThan(1); expect(Math.max(...cs.map((c) => c.text.length))).toBeLessThanOrEqual(CHUNK_SIZE)
    const tail = cs[0].text.slice(-60); expect(cs[1].text.startsWith(cs[0].text.slice(-150).slice(0, 20)) || cs[1].text.includes(tail)).toBe(true)
    expect(cs.every((c) => c.text.length > 100)).toBe(true)
  })
  it('tokenizer: abaikan aksen, huruf besar, kata henti', () => { expect(tokenize('Café DAN the Kopi-Arabika!')).toEqual(['cafe', 'kopi', 'arabika']) })
})

describe('retrieval dari dokumen asli', () => {
  const add = async (name) => { const f = await files.save({ name, bytes: fx(name) }); await kb.indexFile(f.id); return f }
  it('PDF 2 halaman: kueri menemukan halaman yang benar dengan sumber dan lokasi', async () => {
    const pdf = await add('real.pdf')
    const a = await kb.search('berapa hari cuti tahunan karyawan')
    expect(a[0]).toMatchObject({ fileId: pdf.id, name: 'real.pdf', loc: 'hal. 1' }); expect(a[0].text).toContain('12 hari cuti tahunan')
    const b = await kb.search('prosedur pengajuan cuti atasan langsung')
    expect(b[0]).toMatchObject({ loc: 'hal. 2' })
  })
  it('beberapa dokumen: yang paling relevan di peringkat pertama; skor terurut menurun', async () => {
    const pdf = await add('real.pdf'), docx = await add('real.docx'), pptx = await add('real.pptx')
    const r = await kb.search('omzet Jawa Barat penjualan wilayah')
    expect(r[0].fileId).toBe(docx.id); expect(r.map((x) => x.score)).toEqual([...r.map((x) => x.score)].sort((a, b) => b - a))
    expect((await kb.search('anggaran peluncuran'))[0].fileId).toBe(pptx.id)
    expect((await kb.search('cuti'))[0].fileId).toBe(pdf.id)
  })
  it('tanpa kecocokan atau hanya kata henti → hasil kosong (tidak mengarang)', async () => {
    await add('real.pdf')
    expect(await kb.search('quantum chromodynamics')).toEqual([]); expect(await kb.search('yang dan di')).toEqual([])
  })
  it('reindeks idempoten, dan indeks persisten antar instance', async () => {
    const f = await add('real.pdf'); await kb.indexFile(f.id)
    expect((await kb.stats()).chunks).toBe(2)
    const again = fresh()
    expect((await again.stats()).docs.map((d) => d.fileId)).toEqual([f.id]); expect((await again.search('cuti tahunan'))[0].loc).toBe('hal. 1')
  })
  it('sinkronisasi penghapusan: dokumen dikeluarkan dari indeks dan hasil pencarian', async () => {
    const f = await add('real.pdf'); await add('real.docx')
    expect(await kb.removeFile(f.id)).toBe(true); expect(await kb.removeFile(f.id)).toBe(false)
    expect((await kb.search('cuti tahunan')).every((x) => x.fileId !== f.id)).toBe(true)
    expect((await fresh().stats()).docs).toHaveLength(1)
  })
  it('file yang tidak punya teks (PDF pindaian, gambar) ditolak jujur dari pengindeksan', async () => {
    const scan = await files.save({ name: 'scan.pdf', bytes: fx('scan.pdf') }), png = await files.save({ name: 'scan.png', bytes: fx('scan.png') })
    await expect(kb.indexFile(scan.id)).rejects.toMatchObject({ status: 422, code: 'not_indexable', message: expect.stringMatching(/OCR/) })
    await expect(kb.indexFile(png.id)).rejects.toMatchObject({ code: 'not_indexable' })
    await expect(kb.indexFile('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 })
    expect((await kb.stats()).chunks).toBe(0)
  })
  it('indeks rusak di disk → mulai kosong tanpa crash; dokumen yatim dilaporkan missing', async () => {
    await fs.mkdir(path.join(dir, 'kb'), { recursive: true }); await fs.writeFile(path.join(dir, 'kb', 'index.json'), '{{rusak')
    expect(await fresh().search('apa pun')).toEqual([])
    const f = await add('real.pdf'); await files.remove(f.id) // file hilang tanpa lewat API → indeks basi
    expect((await kb.stats()).docs[0]).toMatchObject({ fileId: f.id, missing: true })
  })
})
