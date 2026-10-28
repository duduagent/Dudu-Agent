// Halaman modul ↔ server NYATA: navigasi, Files, Knowledge Base, Misi, Workforce, Tools, Memory, Pengaturan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import App from '../src/App'
import { installBackend, type Backend } from './helpers/real-backend.mjs'

const fx = (n: string) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
const asFile = (name: string, bytes: Buffer | string) => new File([bytes as BlobPart], name)
let be: Backend
beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { await act(async () => { await new Promise(r => setTimeout(r, 120)) }); vi.restoreAllMocks(); await be?.cleanup() })

const nav = (name: RegExp) => screen.getByRole('button', { name })
async function open(label: RegExp, heading: RegExp) {
  const user = userEvent.setup(); render(<App />)
  await user.click(nav(label))
  expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  return user
}
const confirmYes = () => vi.spyOn(window, 'confirm').mockReturnValue(true)

describe('navigasi sidebar', () => {
  it('setiap menu membuka halaman yang benar, dengan status aktif dan tanpa halaman placeholder', async () => {
    be = await installBackend(); const user = userEvent.setup(); render(<App />)
    const pages: Array<[RegExp, RegExp]> = [[/misi & tugas/i, /^misi & tugas$/i], [/agent workforce/i, /^agent workforce$/i], [/knowledge base/i, /^knowledge base$/i], [/tools & integrations/i, /^tools & integrations$/i],
      [/files & artifacts/i, /^files & artifacts$/i], [/^memory$/i, /^memory$/i], [/pengaturan/i, /^pengaturan$/i]]
    for (const [label, heading] of pages) {
      await user.click(nav(label))
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      expect(nav(label)).toHaveAttribute('aria-current', 'page')
      expect(screen.queryByText(/belum diimplementasikan\. tidak ada data simulasi/i)).toBeNull()
    }
    await user.click(nav(/chat & voice/i)); expect(await screen.findByLabelText(/pesan untuk dudu/i)).toBeInTheDocument(); expect(nav(/chat & voice/i)).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /chat baru/i })).toBeInTheDocument()
  })
  it('tombol menu di header halaman membuka/menutup sidebar (tidak ada jalan buntu di mobile)', async () => {
    be = await installBackend(); const user = await open(/files & artifacts/i, /files & artifacts/i)
    const btn = screen.getByRole('button', { name: /menu utama/i }); expect(btn).toHaveAttribute('aria-expanded', 'true')
    await user.click(btn); expect(btn).toHaveAttribute('aria-expanded', 'false'); expect(document.querySelector('.app')).toHaveClass('left-collapsed')
    await user.click(btn); expect(document.querySelector('.app')).not.toHaveClass('left-collapsed')
  })
})

describe('Files & Artifacts', () => {
  it('empty state, unggah via input, status ekstraksi + kesiapan AI yang jujur per file', async () => {
    be = await installBackend(); await open(/files & artifacts/i, /files & artifacts/i)
    expect(screen.getByText(/belum ada file\. unggah dokumen/i)).toBeInTheDocument(); expect(screen.getByText(/belum ada artefak/i)).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [asFile('laporan.docx', fx('real.docx')), asFile('scan.pdf', fx('scan.pdf'))] } })
    const card = async (name: string) => (await screen.findByText(name, { selector: 'strong' })).closest('.card') as HTMLElement
    const docx = await card('laporan.docx'), scan = await card('scan.pdf')
    expect(within(docx).getByText('Teks terbaca')).toBeInTheDocument(); expect(within(docx).getByText('Siap untuk AI')).toBeInTheDocument()
    expect(within(scan).getByText('Tidak dapat dibaca')).toBeInTheDocument(); expect(within(scan).getByText('Belum dapat dipahami AI')).toBeInTheDocument()
    expect(within(scan).getByText(/OCR belum tersedia/)).toBeInTheDocument()
    expect(within(scan).queryByRole('button', { name: /lihat teks/i })).toBeNull(); expect(within(scan).queryByRole('button', { name: /knowledge base/i })).toBeNull()
    expect(within(docx).getByRole('link', { name: /unduh/i })).toHaveAttribute('href', expect.stringMatching(/^\/api\/files\/[0-9a-f-]{36}\/content$/))
  })
  it('lihat teks hasil ekstraksi; hapus meminta konfirmasi dan mengirim DELETE dengan header anti-CSRF', async () => {
    be = await installBackend(); const f = await be.seedFile('catatan.md', Buffer.from('# Judul penting\nIsi catatan'))
    const user = await open(/files & artifacts/i, /files & artifacts/i)
    const card = (await screen.findByText('catatan.md', { selector: 'strong' })).closest('.card') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /lihat teks/i })); expect(await screen.findByLabelText(/teks catatan\.md/i)).toHaveTextContent('# Judul penting')
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(within(card).getByRole('button', { name: /hapus catatan\.md/i }))
    expect(be.state.fetchCalls.some(c => c.method === 'DELETE')).toBe(false)
    confirmYes(); await user.click(within(card).getByRole('button', { name: /hapus catatan\.md/i }))
    await waitFor(() => expect(screen.queryByText('catatan.md', { selector: 'strong' })).toBeNull())
    const del = be.state.fetchCalls.find(c => c.method === 'DELETE')!
    expect(del.path).toBe(`/api/files/${f.id}`); expect(del.headers).toMatchObject({ 'X-Dudu-Client': '1' })
  })
  it('error server tidak terjangkau: pesan jelas + Coba lagi yang benar-benar memuat ulang', async () => {
    be = await installBackend(); be.state.down = true
    const user = userEvent.setup(); render(<App />); await user.click(nav(/files & artifacts/i))
    const alerts = await screen.findAllByRole('alert'); expect(alerts[0]).toHaveTextContent(/server api tidak terjangkau/i)
    be.state.down = false; await user.click(screen.getAllByRole('button', { name: /coba lagi/i })[0])
    await waitFor(() => expect(screen.getByText(/belum ada file/i)).toBeInTheDocument())
  })
})

describe('Knowledge Base', () => {
  it('indeks dokumen, cari dengan sumber+lokasi, tanpa hasil → pesan jujur, keluarkan dari indeks', async () => {
    be = await installBackend(); await be.seedFile('kebijakan.pdf', fx('real.pdf')); await be.seedFile('scan.pdf', fx('scan.pdf')); await be.seedFile('foto.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    const user = await open(/knowledge base/i, /^knowledge base$/i)
    expect(screen.getByText(/knowledge base masih kosong/i)).toBeInTheDocument(); expect(screen.getByText(/bukan embedding semantik/i)).toBeInTheDocument()
    const select = screen.getByLabelText(/pilih file untuk diindeks/i)
    expect(within(select).queryByRole('option', { name: 'scan.pdf' })).toBeNull(); expect(within(select).queryByRole('option', { name: 'foto.png' })).toBeNull() // tanpa teks → tidak dapat diindeks
    await user.selectOptions(select, 'kebijakan.pdf'); await user.click(screen.getByRole('button', { name: /^indeks$/i }))
    expect(await screen.findByText(/"kebijakan\.pdf" diindeks: 2 potongan/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/kata kunci pencarian/i), 'cuti tahunan karyawan'); await user.click(screen.getByRole('button', { name: /^cari$/i }))
    expect(await screen.findByText(/\[1\] kebijakan\.pdf — hal\. 1/)).toBeInTheDocument(); expect(screen.getByText(/12 hari cuti tahunan/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/kata kunci pencarian/i)); await user.type(screen.getByLabelText(/kata kunci pencarian/i), 'quantum chromodynamics'); await user.click(screen.getByRole('button', { name: /^cari$/i }))
    expect(await screen.findByText(/tidak ada bagian yang cocok/i)).toBeInTheDocument()
    confirmYes(); await user.click(screen.getByRole('button', { name: /keluarkan kebijakan\.pdf/i }))
    await waitFor(() => expect(screen.getByText(/knowledge base masih kosong/i)).toBeInTheDocument())
    expect((await be.api.handle({ method: 'GET', path: '/api/kb', headers: {} })).body).toMatchObject({ chunks: 0 })
  })
})

describe('Misi & Tugas', () => {
  it('Draft → persetujuan manusia → Selesai: kriteria lulus dengan bukti, langkah ber-ID eksekusi, artefak terunduh', async () => {
    be = await installBackend(); await be.seedFile('sales.csv', fx('sales.csv'))
    const user = await open(/misi & tugas/i, /^misi & tugas$/i)
    expect(screen.getByText(/belum ada misi\. buat misi pertama/i)).toBeInTheDocument(); expect(screen.getByText(/bukan agen ai otonom/i)).toBeInTheDocument()
    const create = screen.getByRole('button', { name: /buat misi \(draft\)/i }); expect(create).toBeDisabled()
    await user.type(screen.getByLabelText(/tujuan misi/i), 'Analisis penjualan dan kualitas data'); expect(create).toBeDisabled()
    await user.selectOptions(screen.getByLabelText(/file sumber/i), 'sales.csv'); await user.click(create)
    expect(await screen.findByTestId('mission-state')).toHaveTextContent('Draft')
    expect(screen.getByText(/menunggu persetujuan anda/i)).toBeInTheDocument(); expect(screen.getAllByText('belum diperiksa')).toHaveLength(5)
    expect(screen.getByText(/perencana: berbasis aturan \(bukan model ai\)/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /setujui & jalankan/i }))
    await waitFor(() => expect(screen.getByTestId('mission-state')).toHaveTextContent('Selesai'))
    expect(screen.getAllByText('lulus')).toHaveLength(5); expect(screen.getByText(/hitung-ulang=4, laporan=4, profile\.json=4/)).toBeInTheDocument()
    const steps = document.querySelectorAll('.steps li'); expect(steps).toHaveLength(5)
    steps.forEach(s => { expect(s).toHaveTextContent(/selesai · exec [0-9a-f]{8}/) })
    const links = screen.getAllByRole('link', { name: /unduh/i }); expect(links.map(l => l.getAttribute('download'))).toEqual(expect.arrayContaining(['report.md', 'profile.json']))
    expect(screen.queryByRole('button', { name: /setujui & jalankan/i })).toBeNull()
  })
  it('kegagalan input: sumber dihapus setelah Draft → Gagal dengan klasifikasi input_invalid dan tanpa tombol Coba ulang', async () => {
    be = await installBackend(); const f = await be.seedFile('sales.csv', fx('sales.csv'))
    const user = await open(/misi & tugas/i, /^misi & tugas$/i)
    await user.type(screen.getByLabelText(/tujuan misi/i), 'Analisis yang sumbernya hilang'); await user.selectOptions(screen.getByLabelText(/file sumber/i), 'sales.csv'); await user.click(screen.getByRole('button', { name: /buat misi \(draft\)/i }))
    await screen.findByText(/menunggu persetujuan anda/i)
    await be.api.handle({ method: 'DELETE', path: `/api/files/${f.id}`, headers: { 'x-dudu-client': '1' } })
    await user.click(screen.getByRole('button', { name: /setujui & jalankan/i }))
    await waitFor(() => expect(screen.getByTestId('mission-state')).toHaveTextContent('Gagal'))
    expect(screen.getByRole('alert')).toHaveTextContent(/input_invalid/); expect(screen.getByRole('alert')).toHaveTextContent(/file sumber sudah dihapus/i)
    expect(screen.queryByRole('button', { name: /coba ulang/i })).toBeNull()
  })
  it('hapus misi dengan konfirmasi; tab Pengingat tetap menyediakan fitur Reminder yang lama', async () => {
    be = await installBackend(); await be.seedFile('sales.csv', fx('sales.csv'))
    const user = await open(/misi & tugas/i, /^misi & tugas$/i)
    await user.type(screen.getByLabelText(/tujuan misi/i), 'Misi yang akan dihapus'); await user.selectOptions(screen.getByLabelText(/file sumber/i), 'sales.csv'); await user.click(screen.getByRole('button', { name: /buat misi \(draft\)/i }))
    await screen.findByText(/menunggu persetujuan anda/i)
    confirmYes(); await user.click(screen.getByRole('button', { name: /hapus misi/i }))
    await waitFor(() => expect(screen.getByText(/belum ada misi\. buat misi pertama/i)).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: /pengingat/i }))
    expect(screen.getByRole('tabpanel')).toBeInTheDocument(); expect(document.querySelector('.reminders-page')).not.toBeNull()
  })
})

describe('Panel konteks kanan menampilkan data nyata, bukan klaim statis', () => {
  it('menampilkan misi yang belum selesai dengan statusnya, lalu menyegar setelah misi selesai', async () => {
    be = await installBackend(); await be.seedFile('sales.csv', fx('sales.csv'))
    const user = await open(/misi & tugas/i, /^misi & tugas$/i)
    const right = () => within(screen.getByRole('complementary', { name: /panel konteks/i }))
    expect(right().getByText(/belum ada misi aktif/i)).toBeInTheDocument()
    expect(right().queryByText(/direncanakan pada milestone/i)).toBeNull(); expect(right().queryByText(/milestone f/i)).toBeNull()
    await user.type(screen.getByLabelText(/tujuan misi/i), 'Analisis di panel kanan'); await user.selectOptions(screen.getByLabelText(/file sumber/i), 'sales.csv'); await user.click(screen.getByRole('button', { name: /buat misi \(draft\)/i }))
    const list = await right().findByRole('list', { name: /misi belum selesai/i }); expect(list).toHaveTextContent('Analisis di panel kanan'); expect(list).toHaveTextContent('Draft')
    await user.click(screen.getByRole('button', { name: /setujui & jalankan/i }))
    await waitFor(() => expect(right().getByText(/belum ada misi aktif/i)).toBeInTheDocument()); expect(right().getByText(/1 selesai · 1 total/)).toBeInTheDocument()
  })
  it('ringkasan tool mengikuti konfigurasi nyata', async () => {
    be = await installBackend({ env: { DUDU_VISION_MODEL: 'v' } }); render(<App />)
    const tools = await screen.findByRole('list', { name: /ringkasan tool/i }); expect(tools).toHaveTextContent('Provider chat'); expect(tools).toHaveTextContent('dikonfigurasi'); expect(within(tools).getByText('Vision (gambar)').closest('li')).toHaveTextContent('dikonfigurasi'); expect(within(tools).getByText('Transkripsi audio').closest('li')).toHaveTextContent('belum diatur')
  })
})

describe('Workforce, Tools, Pengaturan: status jujur, tanpa klaim palsu', () => {
  it('Workforce hanya mendaftar pelaksana yang ada dan menyatakan yang belum ada', async () => {
    be = await installBackend(); await open(/agent workforce/i, /^agent workforce$/i)
    expect(screen.getByText(/pelaksana analisis data \(lokal\)/i)).toBeInTheDocument()
    expect(screen.getAllByText('Belum diimplementasikan')).toHaveLength(3); expect(screen.getByText(/bukan "tenaga kerja agen otonom"/i)).toBeInTheDocument()
  })
  it('Tools: tanpa konfigurasi → vision/STT "Belum dikonfigurasi", OCR/video/embedding "Tidak tersedia"; provider "Dikonfigurasi (koneksi belum diuji)"', async () => {
    be = await installBackend({ env: { DUDU_STT_MODEL: 'stt-1' } }); await open(/tools & integrations/i, /^tools & integrations$/i)
    const row = (name: string) => screen.getByText(name, { selector: 'strong' }).closest('.card') as HTMLElement
    expect(row('Vision (gambar)')).toHaveTextContent('Belum dikonfigurasi'); expect(row('Transkripsi audio')).toHaveTextContent('Dikonfigurasi (koneksi belum diuji)')
    expect(row('Provider chat')).toHaveTextContent('Dikonfigurasi (koneksi belum diuji)')
    for (const n of ['OCR (PDF/gambar pindaian)', 'Pemrosesan video', 'Embedding semantik']) expect(row(n)).toHaveTextContent('Tidak tersedia')
    expect(row('Knowledge Base')).toHaveTextContent('Tersedia (kata kunci)'); expect(screen.getByText(/tidak ada integrasi pihak ketiga/i)).toBeInTheDocument()
  })
  it('Pengaturan menampilkan batas dan lokasi data; kunci API tidak pernah muncul di DOM', async () => {
    be = await installBackend({ env: { DUDU_PROVIDER_API_KEY: 'RAHASIA-123', DUDU_MAX_UPLOAD_MB: '10' } }); await open(/pengaturan/i, /^pengaturan$/i)
    expect(await screen.findByText(/10 MB \(DUDU_MAX_UPLOAD_MB\)/)).toBeInTheDocument(); expect(screen.getByText(/tidak ada\. data hanya keluar/i)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('RAHASIA-123')
  })
})

describe('Memory eksplisit', () => {
  it('tambah/nonaktifkan/hapus catatan; hanya catatan aktif masuk system prompt chat', async () => {
    be = await installBackend(); const user = await open(/^memory$/i, /^memory$/i)
    expect(screen.getByText(/belum ada catatan memori/i)).toBeInTheDocument(); expect(screen.getByText(/dudu tidak menyimpan memori otomatis/i)).toBeInTheDocument()
    for (const t of ['Saya suka jawaban singkat', 'Panggil saya Bu Rina']) { await user.type(screen.getByLabelText(/catatan baru/i), t); await user.click(screen.getByRole('button', { name: /simpan catatan/i })) }
    await user.click(screen.getAllByRole('button', { name: /nonaktifkan/i })[0]) // terbaru = "Panggil saya Bu Rina"
    expect(JSON.parse(localStorage.getItem('dudu.memory.v1')!).map((n: { enabled: boolean }) => n.enabled)).toEqual([false, true])
    await user.click(nav(/chat & voice/i)); await user.type(await screen.findByLabelText(/pesan untuk dudu/i), 'halo'); await user.keyboard('{Enter}')
    await waitFor(() => expect(be.upstream).toHaveLength(1))
    const sys = be.upstream[0].body.messages[0].content as string
    expect(sys).toContain('Saya suka jawaban singkat'); expect(sys).not.toContain('Bu Rina')
    await user.click(nav(/^memory$/i)); confirmYes(); await user.click(screen.getByRole('button', { name: /hapus catatan: saya suka/i }))
    expect(JSON.parse(localStorage.getItem('dudu.memory.v1')!)).toHaveLength(1)
  })
  it('memori rusak di localStorage tidak membuat crash', async () => {
    be = await installBackend(); localStorage.setItem('dudu.memory.v1', '{"bukan":"array"}'); await open(/^memory$/i, /^memory$/i)
    expect(screen.getByText(/belum ada catatan memori/i)).toBeInTheDocument()
  })
})

describe('Chat → Misi: jembatan satu arah ke Mission Engine yang sama (tanpa mesin kedua)', () => {
  // Batas waktu longgar: unggahan lewat XHR palsu bisa lebih lambat dari 1 dtk saat suite berjalan paralel.
  const T = { timeout: 8000 }
  it('lampiran tabular ready + tujuan di composer → misi Draft dibuat via POST /api/missions; tidak dieksekusi otomatis; bisa dibuka di Misi & Tugas', async () => {
    be = await installBackend(); const user = userEvent.setup(); render(<App />)
    await act(async () => { await new Promise(r => setTimeout(r, 80)) }) // health check + caps
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [asFile('sales.csv', fx('sales.csv'))] } })
    expect((await screen.findAllByText('sales.csv', {}, T)).length).toBeGreaterThan(0) // chip lampiran muncul
    const bridge = await screen.findByRole('button', { name: /jadikan misi analisis data/i }, T)
    expect(bridge).toBeDisabled() // tujuan < 5 karakter → belum bisa
    await user.type(screen.getByLabelText(/pesan untuk dudu/i), 'Analisis penjualan kuartal pertama')
    expect(bridge).toBeEnabled()
    await user.click(bridge)
    const note = await screen.findByRole('status', {}, T)
    expect(note.textContent).toMatch(/misi dibuat.*draft.*(setuju)/i)
    // Tidak ada pesan chat palsu yang mengaku model menganalisis data
    expect(screen.queryByText(/jumlah baris data/i)).toBeNull()
    // Tombol navigasi membuka Misi & Tugas; misi ada di daftar dengan status Draft dari server
    await user.click(within(note).getByRole('button', { name: /buka misi & tugas/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /^misi & tugas$/i })).toBeInTheDocument()
    expect(await screen.findByTestId('mission-state')).toHaveTextContent('Draft')
    const list = (((await be.api.handle({ method: 'GET', path: '/api/missions', headers: {} })).body) as { missions: Array<Record<string, unknown>> }).missions
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ state: 'draft', fileName: 'sales.csv', goal: 'Analisis penjualan kuartal pertama' })
  })
  it('lampiran non-tabular tidak menampilkan tombol jembatan; tujuan pendek → tidak ada POST misi', async () => {
    be = await installBackend(); const user = userEvent.setup(); render(<App />)
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [asFile('catatan.md', Buffer.from('# catatan biasa'))] } })
    expect((await screen.findAllByText('catatan.md', {}, T)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /jadikan misi analisis data/i })).toBeNull()
    const postsBefore = be.state.fetchCalls.filter(c => c.method === 'POST' && c.path === '/api/missions').length
    // Lampiran tabular + tujuan terlalu pendek → ditekan di UI (tombol tetap disabled)
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [asFile('sales.csv', fx('sales.csv'))] } })
    const bridge = await screen.findByRole('button', { name: /jadikan misi analisis data/i }, T)
    await user.type(screen.getByLabelText(/pesan untuk dudu/i), 'abc')
    expect(bridge).toBeDisabled()
    expect(be.state.fetchCalls.filter(c => c.method === 'POST' && c.path === '/api/missions')).toHaveLength(postsBefore)
  })
})

describe('Bukti kapabilitas di UI', () => {
  it('bukti yang dilampirkan ke misi tampil di detail misi dengan tautan unduh bukti', async () => {
    be = await installBackend()
    const file = await be.seedFile('sales.csv', fx('sales.csv'))
    const H = { 'x-dudu-client': '1', 'content-type': 'application/json' }
    const created = await be.api.handle({ method: 'POST', path: '/api/missions', headers: H, contentType: 'application/json', body: JSON.stringify({ goal: 'Analisis penjualan dengan bukti kapabilitas', fileId: file.id }) })
    const missionId = (((created.body) as { mission: { id: string } }).mission).id
    // v0.6.3: run kapabilitas dalam misi butuh persetujuan terikat tindakan.
    const req = await be.api.handle({ method: 'POST', path: `/api/missions/${missionId}/approvals`, headers: H, contentType: 'application/json', body: JSON.stringify({ capabilityId: 'dudu.mcp.tool.kb_stats', operation: 'run', args: {} }) })
    expect(req.status).toBe(201)
    const approvalId = ((req.body) as { approval: { id: string } }).approval.id
    await be.api.handle({ method: 'POST', path: `/api/missions/${missionId}/approvals/${approvalId}`, headers: H, contentType: 'application/json', body: JSON.stringify({ decision: 'approved' }) })
    const run = await be.api.handle({ method: 'POST', path: `/api/missions/${missionId}/capabilities/${encodeURIComponent('dudu.mcp.tool.kb_stats')}/run`, headers: H, contentType: 'application/json', body: JSON.stringify({ args: {} }) })
    expect(run.status).toBe(200)
    await open(/misi & tugas/i, /^misi & tugas$/i)
    expect(await screen.findByRole('heading', { level: 3, name: /bukti kapabilitas/i })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: /unduh/i })
    expect(link).toHaveAttribute('href', expect.stringMatching(new RegExp(`/api/missions/${missionId}/evidence/`)))
    expect(screen.getAllByText(/dudu\.mcp\.tool\.kb_stats/).length).toBeGreaterThanOrEqual(1)
    // Bukti tidak boleh mengubah status misi: kriteria & artefak misi tetap kosong
    expect(screen.getByTestId('mission-state')).toHaveTextContent('Draft')
  })

  it('kapabilitas runnable bisa dijalankan dari halaman misi; hasil dilampirkan sebagai bukti tanpa menuntaskan misi', async () => {
    be = await installBackend()
    const file = await be.seedFile('sales.csv', fx('sales.csv'))
    const H = { 'x-dudu-client': '1', 'content-type': 'application/json' }
    await be.api.handle({ method: 'POST', path: '/api/missions', headers: H, contentType: 'application/json', body: JSON.stringify({ goal: 'Misi untuk menjalankan kapabilitas dari UI', fileId: file.id }) })
    await open(/misi & tugas/i, /^misi & tugas$/i)
    const section = await screen.findByRole('region', { name: /kapabilitas yang bisa dijalankan/i })
    const card = within(section).getByText('kb_stats', { selector: 'strong' }).closest('.card') as HTMLElement
    await userEvent.setup().click(within(card).getByRole('button', { name: /^jalankan$/i }))
    // v0.6.3: tindakan dalam misi butuh persetujuan terikat → UI menawarkan permintaan persetujuan.
    const approveBtn = await within(card).findByRole('button', { name: /setujui tindakan/i }, { timeout: 8000 })
    await userEvent.setup().click(approveBtn)
    expect(await within(card).findByText(/berhasil dalam \d+ ms [\u2014-] bukti dilampirkan:/i)).toBeInTheDocument()
    // Bukti kini terlihat di panel bukti, dan misi tetap Draft (kkapabilitas tidak boleh otomatis menuntaskan misi)
    expect(await screen.findByRole('heading', { level: 3, name: /bukti kapabilitas/i })).toBeInTheDocument()
    expect(screen.getByTestId('mission-state')).toHaveTextContent('Draft')
    expect(screen.getAllByText(/belum diperiksa/i)).toHaveLength(5) // 5 kriteria penerimaan tetap belum diperiksa
  })
})
