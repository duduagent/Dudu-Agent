// Uji Pusat Eksekusi (v0.6.1): timeline hidup + pusat "butuh perhatian" memakai server API nyata.
// Yang diperiksa: misi Draft muncul sebagai "menunggu persetujuan", menjalankan misi dari pusat
// menampilkan langkah & waktu NYATA dari server, dan status akhirnya "Selesai" tanpa persentase karangan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import App from '../src/App'
import { installBackend, type Backend } from './helpers/real-backend.mjs'

const fx = (n: string) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
let be: Backend
beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { await act(async () => { await new Promise(r => setTimeout(r, 80)) }); vi.restoreAllMocks(); await be?.cleanup() })

const H = { 'x-dudu-client': '1', 'content-type': 'application/json' }

async function makeMission(goal: string) {
  const file = await be.seedFile('sales.csv', fx('sales.csv'))
  const created = await be.api.handle({ method: 'POST', path: '/api/missions', headers: H, contentType: 'application/json', body: JSON.stringify({ goal, fileId: file.id }) })
  return (((created.body) as { mission: { id: string; title: string } }).mission)
}

async function openCenter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /pusat eksekusi/i }))
  await screen.findByRole('heading', { level: 1, name: /pusat eksekusi/i })
}

describe('Pusat Eksekusi', () => {
  it('misi Draft tampil sebagai "menunggu persetujuan" dengan aksi nyata', async () => {
    be = await installBackend()
    const m = await makeMission('Analisis penjualan untuk pusat eksekusi')
    const user = userEvent.setup(); render(<App />)
    await openCenter(user)
    const group = await screen.findByText(/menunggu persetujuan anda/i)
    const card = group.closest('div')?.parentElement?.querySelector('.cards') as HTMLElement
    expect(within(card).getByText(m.title)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /setujui & jalankan/i })).toBeInTheDocument()
  }, 20000)

  it('menjalankan misi menampilkan timeline langkah nyata dan berakhir "Selesai"', async () => {
    be = await installBackend()
    const m = await makeMission('Analisis penjualan dengan timeline')
    const user = userEvent.setup(); render(<App />)
    await openCenter(user)
    const group = await screen.findByText(/menunggu persetujuan anda/i)
    const card = group.closest('div')?.parentElement?.querySelector('.cards') as HTMLElement
    expect(within(card).getByText(m.title)).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /setujui & jalankan/i }))

    // Timeline langkah dari server: nama tool nyata + stempel waktu.
    const timeline = await screen.findByRole('list', { name: /langkah eksekusi/i }, { timeout: 8000 })
    expect(within(timeline).getByText('input.validate')).toBeInTheDocument()
    expect(within(timeline).getByText('data.profile')).toBeInTheDocument()
    // Stempel waktu berasal dari server (tidak dikarang): tunggu sampai langkah benar-benar berjalan.
    // Format waktu mengikuti locale id-ID (bisa "12.00.00" atau "12:00:00") → pola dibuat bebas.
    await waitFor(() => expect(within(timeline).getAllByText(/mulai \d{2}[:.]\d{2}[:.]\d{2}/).length).toBeGreaterThan(0), { timeout: 15000 })

    // Status akhir berasal dari server (polling), bukan tebakan.
    await waitFor(() => expect(screen.getByText(/5 dari 5 langkah selesai/i)).toBeInTheDocument(), { timeout: 15000 })
    await waitFor(() => expect(screen.getAllByText('Selesai').length).toBeGreaterThan(0), { timeout: 15000 })
    // Tidak ada persentase karangan.
    expect(document.body.textContent).not.toMatch(/\d+\s*%/)
  }, 40000)

  it('butir konfigurasi diambil dari registry nyata (bukan daftar manual)', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />)
    await openCenter(user)
    // Instalasi bersih memang punya integrasi yang belum dikonfigurasi → harus muncul apa adanya.
    const group = await screen.findByText(/integrasi belum siap/i, {}, { timeout: 8000 })
    const card = group.closest('div')?.parentElement?.querySelector('.cards') as HTMLElement
    expect(within(card).getByText(/dudu\.connector\.webhook/)).toBeInTheDocument()
    // Aksi ada satu kali per grup (bukan diulang per kartu).
    expect(screen.getAllByRole('button', { name: /buka tools & integrations/i }).length).toBe(1)
    // Tidak ada eksekusi yang berjalan pada instalasi bersih → empty state yang jujur.
    expect(screen.getByText(/tidak ada eksekusi yang dipantau/i)).toBeInTheDocument()
  }, 20000)
})
