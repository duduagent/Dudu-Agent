// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { classify, extractContent, imageSize, listZip, magicOk, sanitizeName } from '../server/extract.mjs'
import { FileError, createFileStore, readiness } from '../server/files.mjs'
import { PNG_1X1, makeDocx, makeOds, makeOdt, makePdf, makePptx, makeXlsx, makeZip } from './helpers/make-samples.mjs'

const ex = (name, bytes) => extractContent(classify(name, bytes), bytes)

describe('ekstraksi dokumen (sampel SINTETIS buatan sendiri; verifikasi berkas asli ada di real-fixtures.test.mjs)', () => {
  it('TXT/MD/CSV/JSON/log/kode dibaca apa adanya; JSON rusak diberi catatan', async () => {
    expect((await ex('a.txt', Buffer.from('Halo dunia é'))).text).toBe('Halo dunia é')
    expect((await ex('a.csv', Buffer.from('a,b\n1,2'))).text).toBe('a,b\n1,2')
    expect((await ex('x.py', Buffer.from('print(1)'))).state).toBe('extracted')
    const bad = await ex('a.json', Buffer.from('{oops'))
    expect(bad.state).toBe('extracted'); expect(bad.note).toMatch(/JSON tidak valid/)
  })
  it('BOM UTF-16 dan Windows-1252 didekode', async () => {
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Halo', 'utf16le')])
    expect((await ex('u.txt', u16)).text).toBe('Halo')
    expect((await ex('w.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))).text).toBe('café')
  })
  it('DOCX: paragraf + tabel dipertahankan sebagai baris Markdown', async () => {
    const r = await ex('l.docx', makeDocx(['Judul Laporan', 'Isi & <data>'], [['Nama', 'Nilai'], ['Budi', '90']]))
    expect(r.state).toBe('extracted')
    expect(r.text).toContain('Judul Laporan'); expect(r.text).toContain('Isi & <data>')
    expect(r.text).toContain('| Nama | Nilai |'); expect(r.text).toContain('| Budi | 90 |')
  })
  it('PPTX: label [Slide N] + teks', async () => {
    const r = await ex('d.pptx', makePptx([['Pembuka', 'Agenda'], ['Penutup']]))
    expect(r.text).toBe('[Slide 1]\nPembuka\nAgenda\n\n[Slide 2]\nPenutup'); expect(r.pages).toBe(2)
  })
  it('XLSX: sharedStrings + angka, hasil CSV per sheet', async () => {
    const r = await ex('s.xlsx', makeXlsx([['Produk', 'Jumlah'], ['Kopi, Arabika', 10], ['Teh', 5.5]]))
    expect(r.text).toBe('## Sheet: Penjualan\nProduk,Jumlah\n"Kopi, Arabika",10\nTeh,5.5')
  })
  it('ODT dan ODS', async () => {
    expect((await ex('a.odt', makeOdt(['Satu', 'Dua']))).text).toContain('Satu')
    const ods = await ex('a.ods', makeOds([['x', 'y'], [1, 2]]))
    expect(ods.text).toBe('## Sheet: Data\nx,y\n1,2')
  })
  it('PDF teks: per halaman dengan penanda [Halaman N]', async () => {
    const r = await ex('p.pdf', makePdf(['Halaman pertama kopi', 'Halaman kedua teh']))
    expect(r.state).toBe('extracted'); expect(r.pages).toBe(2)
    expect(r.text).toMatch(/\[Halaman 1\]\nHalaman pertama kopi/); expect(r.text).toMatch(/\[Halaman 2\]\nHalaman kedua teh/)
  })
  it('PDF tanpa teks (pindaian) jujur dilaporkan tidak didukung, bukan "berhasil"', async () => {
    const r = await ex('scan.pdf', makePdf(['']))
    expect(r.state).toBe('unsupported'); expect(r.note).toMatch(/OCR belum tersedia/)
  })
  it('RTF dan HTML dasar; HTML tidak dirender dan skrip dibuang', async () => {
    expect((await ex('a.rtf', Buffer.from('{\\rtf1\\ansi Halo\\par Dunia}'))).text).toBe('Halo\nDunia')
    const h = await ex('a.html', Buffer.from('<h1>Judul</h1><script>alert(1)</script><p>Isi</p>'))
    expect(h.text).toContain('Judul'); expect(h.text).not.toContain('alert')
  })
  it('ZIP: hanya daftar entri; path berbahaya ditandai; isi tidak diekstrak', async () => {
    const zip = makeZip({ 'a.txt': 'x', '../evil.txt': 'y', 'dir/b.txt': 'zz' })
    const r = await ex('a.zip', zip)
    expect(r.text).toContain('a.txt'); expect(r.text).toContain('dir/b.txt')
    expect(r.warnings.join()).toMatch(/path berbahaya/); expect(r.text).not.toContain('evil.txt')
  })
  it('zip bomb ditolak berdasarkan total ukuran terdekompresi', async () => {
    const big = Buffer.from(zipSync({ 'big.bin': new Uint8Array(1024 * 1024).fill(65) })) // 1MB → ok
    expect(() => listZip(big)).not.toThrow()
    // 250 entri @ 1MB terdekompresi melebihi batas 200MB pada pemeriksaan header, tanpa mendekompresi
    const files = {}; for (let i = 0; i < 250; i++) files[`f${i}.bin`] = new Uint8Array(1024 * 1024)
    const bomb = Buffer.from(zipSync(files, { level: 9 }))
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024)
    const r = await ex('bomb.zip', bomb)
    expect(r.state).toBe('failed'); expect(r.note).toMatch(/zip bomb|melebihi/i)
  })
  it('file korup menghasilkan state failed, tidak melempar', async () => {
    expect((await ex('rusak.docx', Buffer.from('PK\x03\x04 bukan zip beneran'))).state).toBe('failed')
    expect((await ex('rusak.pdf', Buffer.from('%PDF-1.4 sampah'))).state).toBe('failed')
  })
  it('audio/video/gambar tidak pernah dilabeli "extracted"', async () => {
    expect((await ex('a.mp3', Buffer.from('ID3....'))).state).toBe('unsupported')
    const v = await ex('a.mp4', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]))
    expect(v.state).toBe('unsupported'); expect(v.note).toMatch(/belum diimplementasikan/)
    expect((await ex('a.png', PNG_1X1)).state).toBe('not_applicable')
  })
  it('klasifikasi, magic bytes, nama aman, dan ukuran gambar', () => {
    expect(classify('x.xlsx', Buffer.alloc(8)).category).toBe('data')
    expect(classify('noext', Buffer.from('plain text')).category).toBe('code')
    expect(classify('bin', Buffer.from([1, 0, 2, 0])).category).toBe('other')
    expect(magicOk('pdf', Buffer.from('MZ\x90\x00\x03'))).toBe(false)
    expect(magicOk('png', PNG_1X1)).toBe(true)
    expect(sanitizeName('../../etc/passwd')).toBe('passwd'); expect(sanitizeName('C:\\x\\y\\..\\a.txt')).toBe('a.txt'); expect(sanitizeName('\u0000\u0007')).toBe('tanpa-nama')
    expect(imageSize(PNG_1X1, 'png')).toEqual({ width: 1, height: 1 })
  })
})

describe('file store: validasi, penyimpanan aman, siklus hidup', () => {
  let dir, store
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-fs-')); store = createFileStore({ dataDir: dir, maxUploadBytes: 1024 * 1024 }) })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('menyimpan, mencantumkan, membaca ulang byte & teks, dan menghapus', async () => {
    const meta = await store.save({ name: 'catatan.md', bytes: Buffer.from('# Judul\nIsi') })
    expect(meta).toMatchObject({ name: 'catatan.md', category: 'document', size: 11 })
    expect(meta.sha256).toHaveLength(64); expect(meta.extraction.state).toBe('extracted')
    expect((await store.list()).map((f) => f.id)).toEqual([meta.id])
    expect((await store.readBytes(meta.id)).toString()).toBe('# Judul\nIsi')
    expect(await store.readText(meta.id)).toBe('# Judul\nIsi')
    expect(await store.remove(meta.id)).toBe(true)
    expect(await store.list()).toEqual([]); expect(await store.get(meta.id)).toBeNull()
  })
  it('nama dari pengguna TIDAK menjadi path di disk (path traversal)', async () => {
    const meta = await store.save({ name: '../../../etc/passwd.txt', bytes: Buffer.from('x') })
    expect(meta.name).toBe('passwd.txt')
    const entries = await fs.readdir(path.join(dir, 'files', meta.id))
    expect(entries.sort()).toEqual(['content.bin', 'meta.json', 'text.txt'])
    expect(await fs.readdir(path.dirname(dir)).then((l) => l.includes('etc'))).toBe(false)
  })
  it('menolak: kosong, terlalu besar, tipe executable, isi tidak cocok ekstensi', async () => {
    await expect(store.save({ name: 'a.txt', bytes: Buffer.alloc(0) })).rejects.toMatchObject({ status: 400, code: 'empty_file' })
    await expect(store.save({ name: 'a.txt', bytes: Buffer.alloc(1024 * 1024 + 1, 65) })).rejects.toMatchObject({ status: 413, code: 'file_too_large' })
    await expect(store.save({ name: 'virus.exe', bytes: Buffer.from('MZ') })).rejects.toMatchObject({ status: 415, code: 'blocked_type' })
    await expect(store.save({ name: 'palsu.pdf', bytes: Buffer.from('MZ bukan pdf') })).rejects.toMatchObject({ status: 415, code: 'content_mismatch' })
    await expect(store.save({ name: 'palsu.png', bytes: Buffer.from('<html>') })).rejects.toBeInstanceOf(FileError)
    expect(await store.list()).toEqual([]) // tidak ada sisa setengah-tersimpan
  })
  it('ID tidak valid ditolak sebelum menyentuh disk', async () => {
    await expect(store.get('../../x')).rejects.toMatchObject({ code: 'bad_id' })
    await expect(store.remove('..')).rejects.toBeInstanceOf(FileError)
  })
  it('metadata rusak/hilang tidak merusak daftar file', async () => {
    const a = await store.save({ name: 'a.txt', bytes: Buffer.from('a') })
    const b = await store.save({ name: 'b.txt', bytes: Buffer.from('b') })
    await fs.writeFile(path.join(dir, 'files', b.id, 'meta.json'), '{rusak')
    await fs.mkdir(path.join(dir, 'files', 'bukan-uuid'), { recursive: true })
    expect((await store.list()).map((f) => f.id)).toEqual([a.id])
  })
  it('readiness jujur: gambar butuh vision; audio butuh STT; PDF tanpa teks tidak siap', async () => {
    const caps = (v, s) => ({ vision: { configured: v }, stt: { configured: s } })
    const img = await store.save({ name: 'f.png', bytes: PNG_1X1 })
    expect(img.image).toEqual({ width: 1, height: 1 })
    expect(readiness(img, caps(false, false))).toMatchObject({ ready: false, reason: expect.stringMatching(/DUDU_VISION_MODEL/) })
    expect(readiness(img, caps(true, false)).ready).toBe(true)
    const au = await store.save({ name: 'v.mp3', bytes: Buffer.from('ID3....') })
    expect(readiness(au, caps(true, false)).ready).toBe(false); expect(readiness(au, caps(false, true)).ready).toBe(true)
    const pdf = await store.save({ name: 's.pdf', bytes: makePdf(['']) })
    expect(readiness(pdf, caps(true, true)).ready).toBe(false)
    const txt = await store.save({ name: 't.txt', bytes: Buffer.from('ok') })
    expect(readiness(txt, caps(false, false)).ready).toBe(true)
  })
})
