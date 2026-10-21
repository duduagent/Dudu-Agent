// @vitest-environment node
// Verifikasi terhadap berkas yang dihasilkan perangkat lunak INDEPENDEN (python-docx, openpyxl, python-pptx,
// reportlab, LibreOffice), bukan generator buatan sendiri. Fixture di tests/fixtures/.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, extractContent } from '../server/extract.mjs'
import { chunkText } from '../server/knowledge.mjs'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ex = async (name) => { const b = fs.readFileSync(path.join(dir, name)); return extractContent(classify(name, b), b) }

describe('ekstraksi berkas asli dari software independen', () => {
  it('DOCX (python-docx): heading, run berformat, Unicode, tabel', async () => {
    const r = await ex('real.docx')
    expect(r.state).toBe('extracted')
    expect(r.text).toContain('Laporan Kuartal Tiga')
    expect(r.text).toContain('Penjualan naik 12 persen dibanding kuartal lalu — café & "kopi".')
    expect(r.text).toContain('| Jawa Barat | 1500 |'); expect(r.text).toContain('| Bali | 980 |')
  })
  it('XLSX (openpyxl): 2 sheet, string+angka+sel kosong; formula tanpa nilai tersimpan tidak dikarang', async () => {
    const r = await ex('real.xlsx')
    expect(r.text).toContain('## Sheet: Penjualan'); expect(r.text).toContain('## Sheet: Catatan')
    expect(r.text).toContain('Kopi Arabika,Jawa Barat,10,55000.5'); expect(r.text).toContain('Gula,,20,15000')
    expect(r.text).not.toContain('550005') // openpyxl tidak menyimpan hasil formula → tidak boleh muncul angka karangan
  })
  it('PPTX (python-pptx): label slide', async () => {
    const r = await ex('real.pptx')
    expect(r.text).toBe('[Slide 1]\nRencana Peluncuran\nTarget pasar: Indonesia\nTanggal: Maret\n\n[Slide 2]\nAnggaran\nTotal Rp 250 juta'); expect(r.pages).toBe(2)
  })
  it('ODT/ODS/ODP (LibreOffice): paragraf, tabel berlabel, sheet, slide tanpa halaman catatan', async () => {
    const odt = await ex('real.odt'); expect(odt.text).toContain('café & "kopi"'); expect(odt.text).toContain('## Tabel: Table1'); expect(odt.text).toContain('Jawa Barat,1500')
    const ods = await ex('real.ods'); expect(ods.text).toContain('## Sheet: Penjualan'); expect(ods.text).toContain('Kopi Arabika,Jawa Barat,10,55000.5,550005') // LibreOffice menyimpan hasil formula
    const odp = await ex('real.odp'); expect(odp.pages).toBe(2); expect(odp.text).toMatch(/\[Slide 2\][\s\S]*Total Rp 250 juta/)
  })
  it('RTF (LibreOffice): hanya teks; tidak ada sampah dari tabel font/warna/gaya (regresi bug nyata)', async () => {
    const r = await ex('real.rtf')
    expect(r.state).toBe('extracted')
    expect(r.text).toContain('Laporan Kuartal Tiga'); expect(r.text).toContain('café'); expect(r.text).toContain('Jawa Barat | 1500')
    expect(r.text).not.toMatch(/[\u0000-\u0008]/); expect(r.text.length).toBeLessThan(300)
  })
  it('PDF (reportlab dan LibreOffice): teks per halaman; PDF pindaian dilaporkan tidak terbaca', async () => {
    const a = await ex('real.pdf')
    expect(a.pages).toBe(2); expect(a.text).toContain('[Halaman 2]\nProsedur pengajuan'); expect(a.text).toContain('12 hari cuti tahunan')
    const b = await ex('libreoffice.pdf'); expect(b.text).toContain('café'); expect(b.text).toContain('Jawa Barat 1500')
    const scan = await ex('scan.pdf'); expect(scan.state).toBe('unsupported'); expect(scan.text).toBeUndefined()
  })
  it('pengaman: teks hasil ekstraksi yang penuh karakter kontrol ditandai rusak, bukan sukses', async () => {
    const r = await extractContent({ ext: 'txt', category: 'document', kind: 'text' }, Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), Buffer.from('ab')]))
    expect(r.state).toBe('failed'); expect(r.text).toBeUndefined()
  })
  it('chunking menjaga lokasi sumber dari ekstraksi nyata', async () => {
    const pdf = chunkText((await ex('real.pdf')).text)
    expect(pdf.map((c) => c.loc)).toEqual(['hal. 1', 'hal. 2'])
    const odp = chunkText((await ex('real.odp')).text); expect(odp.map((c) => c.loc)).toEqual(['slide 1', 'slide 2'])
    const xl = chunkText((await ex('real.xlsx')).text); expect(xl.map((c) => c.loc)).toEqual(['sheet Penjualan', 'sheet Catatan'])
  })
})
