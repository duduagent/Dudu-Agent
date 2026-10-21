// UI ↔ server NYATA: composer multimodal, lampiran, status per tahap, KB di chat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import App from '../src/App'
import { installBackend, type Backend } from './helpers/real-backend.mjs'

const fx = (n: string) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
const asFile = (name: string, bytes: Buffer | string, type = '') => new File([bytes as BlobPart], name, { type })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let be: Backend
beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { await act(async () => { await new Promise(r => setTimeout(r, 120)) }); vi.restoreAllMocks(); await be?.cleanup() })

const input = () => screen.getByTestId('file-input') as HTMLInputElement
const composer = () => screen.getByLabelText(/pesan untuk dudu/i) as HTMLTextAreaElement
const chip = (name: string) => screen.getByText(name, { selector: '.att-name' }).closest('.att-chip') as HTMLElement
const userRows = () => Array.from(document.querySelectorAll<HTMLElement>('.msg-row.user'))
// Tunggu panggilan awal (health, kapabilitas, KB) selesai dan state React tersalurkan.
async function ready() {
  await waitFor(() => { const p = be.state.fetchCalls.map(c => c.path); for (const x of ['/api/health', '/api/capabilities', '/api/kb']) expect(p).toContain(x) })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
}

describe('menu lampiran dan kapabilitas jujur', () => {
  it('menu menampilkan jenis lampiran; catatan menyatakan vision/STT/video belum tersedia bila tidak dikonfigurasi', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />); await ready()
    await user.click(screen.getByRole('button', { name: /lampirkan file/i }))
    const menu = screen.getByRole('menu', { name: /jenis lampiran/i })
    for (const label of ['Dokumen', 'Gambar', 'Audio', 'Video', 'Data, arsip & kode', 'Dari Files & Artifacts']) expect(within(menu).getByRole('menuitem', { name: new RegExp(label.replace(/&/g, '&'), 'i') })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /gambar/i })).toHaveTextContent(/model vision belum dikonfigurasi/i)
    expect(within(menu).getByRole('menuitem', { name: /audio/i })).toHaveTextContent(/transkripsi belum dikonfigurasi/i)
    expect(within(menu).getByRole('menuitem', { name: /video/i })).toHaveTextContent(/pemrosesan video belum tersedia/i)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('catatan vision hilang bila DUDU_VISION_MODEL dikonfigurasi; mic tetap nonaktif dan jujur', async () => {
    be = await installBackend({ env: { DUDU_VISION_MODEL: 'vm' } })
    const user = userEvent.setup(); render(<App />); await ready()
    await user.click(screen.getByRole('button', { name: /lampirkan file/i }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /gambar/i })).not.toHaveTextContent(/belum dikonfigurasi/i))
    expect(screen.getByRole('button', { name: /rekam suara \(belum tersedia\)/i })).toBeDisabled()
  })
})

describe('progress unggahan jujur', () => {
  it('tanpa event progress dari transport (seperti dudu:// di desktop): indikator tak-tentu, TANPA persen palsu', async () => {
    be = await installBackend(); be.state.hold = true; be.state.silentProgress = true
    render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('a.txt', 'isi')] } })
    await waitFor(() => expect(chip('a.txt')).toHaveAttribute('data-stage', 'uploading'))
    expect(chip('a.txt')).toHaveTextContent('Mengunggah…'); expect(chip('a.txt')).not.toHaveTextContent(/\d+%/)
    const bar = within(chip('a.txt')).getByRole('progressbar'); expect(bar).not.toHaveAttribute('aria-valuenow'); expect(bar).toHaveAttribute('aria-busy', 'true')
    await be.releaseUploads(); await waitFor(() => expect(chip('a.txt')).toHaveAttribute('data-stage', 'ready'))
  })
})

describe('alur lampiran end-to-end', () => {
  it('pilih DOCX → progress → "Siap untuk AI" → kirim → server memasukkan isi ke model → pesan ditandai "dianalisis"', async () => {
    be = await installBackend(); be.state.hold = true
    const user = userEvent.setup(); render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('laporan.docx', fx('real.docx'))] } })
    await waitFor(() => expect(chip('laporan.docx')).toHaveAttribute('data-stage', 'uploading'))
    expect(within(chip('laporan.docx')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    await user.type(composer(), 'Ringkas file ini'); expect(screen.getByRole('button', { name: /kirim pesan/i })).toBeDisabled() // menunggu unggahan
    await user.keyboard('{Enter}'); expect(userRows()).toHaveLength(0)

    await be.releaseUploads()
    await waitFor(() => expect(chip('laporan.docx')).toHaveAttribute('data-stage', 'ready'))
    expect(chip('laporan.docx')).toHaveTextContent('Siap untuk AI')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(userRows()).toHaveLength(1))
    // Bukti: isi DOCX benar-benar ada di permintaan ke provider
    await waitFor(() => expect(be.upstream).toHaveLength(1))
    const sent = be.upstream[0].body.messages.find(m => m.role === 'user')!.content as string
    expect(sent).toContain('Ringkas file ini'); expect(sent).toContain('Penjualan naik 12 persen'); expect(sent).toContain('| Jawa Barat | 1500 |')
    await waitFor(() => expect(within(userRows()[0]).getByText('dianalisis')).toBeInTheDocument())
    expect(document.querySelector('.att-chip')).toBeNull() // tray dikosongkan setelah kirim
    expect(be.state.xhrs[0].headers['X-Dudu-Client']).toBe('1')
  })

  it('file yang tidak dapat dibaca (PDF pindaian) dilabeli jujur di chip dan di pesan: "tidak terbaca" + alasan', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('scan.pdf', fx('scan.pdf'))] } })
    await waitFor(() => expect(chip('scan.pdf')).toHaveAttribute('data-stage', 'stored'))
    expect(chip('scan.pdf')).toHaveTextContent(/belum dapat dibaca AI.*OCR belum tersedia/)
    expect(chip('scan.pdf')).not.toHaveTextContent('Siap untuk AI')
    await user.type(composer(), 'Apa isinya?'); await user.keyboard('{Enter}')
    await waitFor(() => expect(within(userRows()[0]).getByText(/tidak terbaca: .*OCR belum tersedia/)).toBeInTheDocument())
    expect(JSON.stringify(be.upstream[0].body)).toMatch(/TIDAK dapat dibaca/)
  })

  it('gambar tanpa vision: "Tersimpan, belum dapat dibaca AI" + alasan DUDU_VISION_MODEL; dengan vision: siap dan dikirim sebagai image_url', async () => {
    be = await installBackend()
    let user = userEvent.setup(); const r1 = render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('foto.png', PNG, 'image/png')] } })
    await waitFor(() => expect(chip('foto.png')).toHaveAttribute('data-stage', 'stored'))
    expect(chip('foto.png')).toHaveTextContent(/DUDU_VISION_MODEL/)
    r1.unmount(); await be.cleanup(); localStorage.clear()

    be = await installBackend({ env: { DUDU_VISION_MODEL: 'vision-x' } }); user = userEvent.setup(); render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('foto.png', PNG, 'image/png')] } })
    await waitFor(() => expect(chip('foto.png')).toHaveAttribute('data-stage', 'ready'))
    expect(chip('foto.png')).toHaveTextContent('Siap untuk AI (vision)')
    expect(within(chip('foto.png')).getByAltText(/pratinjau foto\.png/i)).toBeInTheDocument()
    await user.type(composer(), 'Apa ini?'); await user.keyboard('{Enter}')
    await waitFor(() => expect(be.upstream).toHaveLength(1))
    expect(be.upstream[0].body.model).toBe('vision-x')
    const parts = be.upstream[0].body.messages.find(m => m.role === 'user')!.content as Array<{ type: string; image_url?: { url: string } }>
    expect(parts[1].image_url!.url).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    await waitFor(() => expect(within(userRows()[0]).getByText('dianalisis')).toBeInTheDocument())
  })

  it('unggahan gagal (tipe diblokir / isi palsu) tampil sebagai "Gagal: …" dan tidak ikut terkirim', async () => {
    be = await installBackend(); const user = userEvent.setup(); render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('virus.exe', 'MZ'), asFile('palsu.pdf', 'bukan pdf beneran')] } })
    await waitFor(() => expect(chip('virus.exe')).toHaveAttribute('data-stage', 'failed'))
    await waitFor(() => expect(chip('palsu.pdf')).toHaveAttribute('data-stage', 'failed'))
    expect(chip('virus.exe')).toHaveTextContent(/Gagal: .*diblokir/); expect(chip('palsu.pdf')).toHaveTextContent(/Gagal: .*tidak cocok/)
    await user.type(composer(), 'tes'); await user.keyboard('{Enter}')
    await waitFor(() => expect(be.upstream).toHaveLength(1))
    expect(JSON.stringify(be.upstream[0].body)).not.toContain('virus.exe')
    expect(userRows()[0].querySelector('.msg-atts')).toBeNull()
  })

  it('batas klien: file melebihi batas dan lebih dari 8 lampiran ditolak tanpa mengunggah', async () => {
    be = await installBackend({ env: { DUDU_MAX_UPLOAD_MB: '1' } }); render(<App />); await ready()
    await waitFor(() => expect(be.state.fetchCalls.some(c => c.path === '/api/capabilities')).toBe(true))
    await new Promise(r => setTimeout(r, 30))
    fireEvent.change(input(), { target: { files: [asFile('besar.txt', Buffer.alloc(1024 * 1024 + 1, 65))] } })
    await waitFor(() => expect(chip('besar.txt')).toHaveAttribute('data-stage', 'failed'))
    expect(chip('besar.txt')).toHaveTextContent(/Melebihi batas 1 MB/); expect(be.state.xhrs).toHaveLength(0)
    fireEvent.change(input(), { target: { files: Array.from({ length: 9 }, (_, i) => asFile(`f${i}.txt`, 'x')) } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Maksimal 8 lampiran/)
  })
})

describe('membatalkan, menghapus, drag-drop, paste', () => {
  it('membatalkan unggahan: XHR di-abort dan chip hilang; menghapus lampiran gambar me-revoke object URL', async () => {
    be = await installBackend(); be.state.hold = true
    const revoke = vi.spyOn(URL, 'revokeObjectURL'); const user = userEvent.setup(); render(<App />); await ready()
    fireEvent.change(input(), { target: { files: [asFile('besar.docx', fx('real.docx')), asFile('gambar.png', PNG, 'image/png')] } })
    await waitFor(() => expect(chip('besar.docx')).toHaveAttribute('data-stage', 'uploading'))
    await user.click(screen.getByRole('button', { name: /batalkan unggahan besar\.docx/i }))
    expect(screen.queryByText('besar.docx', { selector: '.att-name' })).toBeNull()
    expect(be.state.xhrs[0].aborted).toBe(true)
    await user.click(screen.getByRole('button', { name: /batalkan unggahan gambar\.png/i }))
    expect(revoke).toHaveBeenCalled(); expect(document.querySelector('.att-chip')).toBeNull()
    await be.releaseUploads() // unggahan yang dibatalkan tidak boleh menyimpan file
    expect(await be.api.handle({ method: 'GET', path: '/api/files', headers: {} })).toMatchObject({ body: { files: [] } })
  })
  it('drag-and-drop file menambah lampiran; drag non-file diabaikan', async () => {
    be = await installBackend(); render(<App />); await ready()
    const zone = document.querySelector('.composer-zone') as HTMLElement
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'] } }); expect(screen.queryByText(/lepas file di sini/i)).toBeNull()
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } }); expect(screen.getByText(/lepas file di sini/i)).toBeInTheDocument()
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [asFile('catatan.md', '# Judul')] } })
    expect(screen.queryByText(/lepas file di sini/i)).toBeNull()
    await waitFor(() => expect(chip('catatan.md')).toHaveAttribute('data-stage', 'ready'))
  })
  it('paste gambar dari clipboard menjadi lampiran dan tidak menyisipkan teks', async () => {
    be = await installBackend({ env: { DUDU_VISION_MODEL: 'v' } }); render(<App />); await ready()
    fireEvent.paste(composer(), { clipboardData: { files: [asFile('image.png', PNG, 'image/png')], getData: () => '' } })
    await waitFor(() => expect(chip('image.png')).toHaveAttribute('data-stage', 'ready'))
    expect(composer().value).toBe('')
  })
  it('lampiran yang belum terkirim dibersihkan saat berpindah percakapan', async () => {
    be = await installBackend(); const user = userEvent.setup(); render(<App />); await ready()
    await user.type(composer(), 'percakapan satu'); await user.keyboard('{Enter}'); await waitFor(() => expect(userRows()).toHaveLength(1))
    fireEvent.change(input(), { target: { files: [asFile('sisa.txt', 'x')] } }); await waitFor(() => expect(chip('sisa.txt')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /chat baru/i }))
    await waitFor(() => expect(document.querySelector('.att-chip')).toBeNull())
  })
  it('pilih dari Files & Artifacts: file tersimpan menjadi lampiran tanpa unggah ulang', async () => {
    be = await installBackend(); const stored = await be.seedFile('arsip.md', Buffer.from('# Isi arsip'))
    const user = userEvent.setup(); render(<App />); await ready()
    await user.click(screen.getByRole('button', { name: /lampirkan file/i })); await user.click(screen.getByRole('menuitem', { name: /dari files/i }))
    await user.click(await screen.findByRole('button', { name: /arsip\.md/i }))
    expect(chip('arsip.md')).toHaveAttribute('data-stage', 'ready'); expect(be.state.xhrs).toHaveLength(0)
    await user.type(composer(), 'baca'); await user.keyboard('{Enter}'); await waitFor(() => expect(be.upstream).toHaveLength(1))
    expect(JSON.stringify(be.upstream[0].body)).toContain('# Isi arsip'); expect(stored.id).toBeTruthy()
  })
})

describe('Knowledge Base di chat', () => {
  it('toggle hanya muncul bila KB berisi dokumen; saat aktif, sumber [S1] tampil di bawah jawaban', async () => {
    be = await installBackend({ reply: () => 'Menurut kebijakan, 12 hari [S1].' })
    const f = await be.seedFile('kebijakan.pdf', fx('real.pdf'))
    const user = userEvent.setup(); const first = render(<App />); await ready()
    expect(screen.queryByRole('button', { name: /knowledge base:/i })).toBeNull()
    first.unmount()
    await be.api.kb.indexFile(f.id)
    render(<App />); await ready()
    const toggle = await screen.findByRole('button', { name: /knowledge base: mati/i })
    await user.click(toggle); expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await user.type(composer(), 'Berapa hari cuti tahunan?'); await user.keyboard('{Enter}')
    expect(await screen.findByText(/Menurut kebijakan/)).toBeInTheDocument()
    expect(JSON.stringify(be.upstream[0].body.messages)).toContain('[S1] kebijakan.pdf (hal. 1)')
    const src = document.querySelector('.msg-sources') as HTMLElement
    expect(src).toHaveTextContent('[S1] kebijakan.pdf (hal. 1)')
  })
  it('KB dimatikan: tidak ada retrieval dan tidak ada blok sumber', async () => {
    be = await installBackend(); const f = await be.seedFile('k.pdf', fx('real.pdf')); await be.api.kb.indexFile(f.id)
    const user = userEvent.setup(); render(<App />); await ready()
    await user.type(composer(), 'cuti tahunan'); await user.keyboard('{Enter}'); await waitFor(() => expect(be.upstream).toHaveLength(1))
    expect(JSON.stringify(be.upstream[0].body)).not.toContain('Knowledge Base'); expect(document.querySelector('.msg-sources')).toBeNull()
  })
})

describe('ketahanan', () => {
  it('respons kapabilitas yang bentuknya salah tidak membuat aplikasi crash (regresi)', async () => {
    be = await installBackend()
    be.state.rawFetch = async (input) => String(input) === '/api/capabilities' ? new Response('{"configured":true}', { status: 200 }) : new Response('{"configured":false}', { status: 200 })
    render(<App />)
    expect(screen.getByRole('heading', { name: /halo! saya dudu/i })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.pill.warn')).not.toBeNull())
    expect(screen.getByRole('button', { name: /lampirkan file/i })).toBeEnabled()
  })
})
