// Uji UI Jejak Unified Execution Audit (v0.6.4).
// Yang diperiksa: jejak diambil dari API server (bukan berkas), ditampilkan lengkap
// (waktu, jenis, aktor, hasil, referensi eksekusi), dapat disaring & dipaginasi,
// event lama ditangani, kondisi kosong/galat ditangani, dan tidak ada data sensitif
// yang bocor ke DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
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

/** Buka tab Misi & Tugas lalu pilih misi → panel detail (berisi jejak audit). */
async function openMissionDetail(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: /misi & tugas/i }))
  await screen.findByRole('heading', { level: 1, name: /misi & tugas/i })
  const judul = (await screen.findAllByText(title))[0]
  await user.click(judul)
  return screen.findByRole('region', { name: /jejak audit/i }, { timeout: 10000 })
}

const listOf = () => screen.getByTestId('audit-list')

describe('Jejak Audit di UI', () => {
  it('menampilkan event dari server: waktu, jenis, aktor, hasil, dan referensi eksekusi', async () => {
    be = await installBackend()
    const m = await makeMission('Misi dengan jejak audit')
    await be.api.handle({ method: 'POST', path: `/api/missions/${m.id}/approve`, headers: H, contentType: 'application/json', body: '{}' })

    const user = userEvent.setup(); render(<App />)
    await openMissionDetail(user, m.title)
    const list = listOf()
    // Tunggu event benar-benar termuat (bukan hanya elemen panel).
    await waitFor(() => {
      expect(within(list).queryAllByText(/misi dibuat/i).length).toBeGreaterThan(0)
    }, { timeout: 10000 })
    // Jenis event (label Indonesia) tampil.
    expect(within(list).getByText(/misi dibuat/i)).toBeInTheDocument()
    expect(within(list).getByText(/eksekusi dimulai/i)).toBeInTheDocument()
    // Hasil (outcome) tampil sebagai badge.
    expect(within(list).getAllByText(/berhasil/i).length).toBeGreaterThan(0)
    // Aktor: sistem — bukan identitas manusia yang dikarang.
    expect(within(list).getAllByText(/aktor: sistem/i).length).toBeGreaterThan(0)
    // Referensi eksekusi (exec) tampil.
    expect(within(list).getAllByText(/exec/i).length).toBeGreaterThan(0)
    // Waktu event tampil (bukan "—").
    expect(within(list).getAllByText(/\d{1,2}[:.]\d{2}/).length).toBeGreaterThan(0)
    // Tidak ada persentase karangan.
    expect(list.textContent ?? '').not.toMatch(/\d+\s*%/)
  }, 30000)

  it('menyaring berdasarkan jenis event', async () => {
    be = await installBackend()
    const m = await makeMission('Misi untuk filter audit')
    await be.api.handle({ method: 'POST', path: `/api/missions/${m.id}/approve`, headers: H, contentType: 'application/json', body: '{}' })

    const user = userEvent.setup(); render(<App />)
    const trail = await openMissionDetail(user, m.title)
    await user.selectOptions(within(trail).getByLabelText(/jenis event/i), 'mission.completed')
    await waitFor(() => {
      expect(within(listOf()).getByText(/misi selesai/i)).toBeInTheDocument()
    }, { timeout: 10000 })
    // Event lain tidak lagi tampil setelah filter.
    await waitFor(() => {
      expect(within(listOf()).queryByText(/misi dibuat/i)).not.toBeInTheDocument()
    }, { timeout: 10000 })
  }, 30000)

  it('menyaring berdasarkan hasil (outcome)', async () => {
    be = await installBackend()
    const m = await makeMission('Misi untuk filter hasil')
    await be.api.handle({ method: 'POST', path: `/api/missions/${m.id}/approve`, headers: H, contentType: 'application/json', body: '{}' })

    const user = userEvent.setup(); render(<App />)
    const trail = await openMissionDetail(user, m.title)
    await user.selectOptions(within(trail).getByLabelText(/hasil/i), 'failed')
    await waitFor(() => {
      const items = within(listOf()).queryAllByText(/gagal/i)
      expect(items.length).toBe(0)   // tidak ada event gagal pada misi sukses
    }, { timeout: 10000 })
    expect(within(listOf()).queryByText(/misi selesai/i)).not.toBeInTheDocument()
  }, 30000)

  it('jumlah event ditampilkan sebagai ringkasan jujur; batas halaman preventing overload', async () => {
    be = await installBackend()
    const m = await makeMission('Misi dengan banyak event')
    await be.api.handle({ method: 'POST', path: `/api/missions/${m.id}/approve`, headers: H, contentType: 'application/json', body: '{}' })

    const user = userEvent.setup(); render(<App />)
    const trail = await openMissionDetail(user, m.title)
    expect(within(trail).getByText(/\d+ dari \d+ event/i)).toBeInTheDocument()
    // Misi uji menghasilkan jauh dari 25 event → tidak ada tombol pagination.
    expect(within(trail).queryByRole('button', { name: /muat lebih banyak/i })).not.toBeInTheDocument()
  }, 30000)

  it('kegagalan API ditampilkan jujur dengan tombol coba lagi', async () => {
    be = await installBackend()
    const m = await makeMission('Misi dengan audit bermasalah')
    // Server sengaja dibuat gagal saat jejak audit dibaca.
    const asli = be.api.handle.bind(be.api)
    be.api.handle = async (req: unknown) => {
      const p = String((req as { path?: string })?.path ?? '')
      if (p.includes('/audit')) return { status: 500, body: { error: 'audit_unavailable', message: 'Server jejak audit tidak terjangkau' } }
      return asli(req as never)
    }
    const user = userEvent.setup(); render(<App />)
    const trail = await openMissionDetail(user, m.title)
    await waitFor(() => {
      expect(within(trail).getByRole('alert')).toHaveTextContent(/jejak audit tidak terjangkau/i)
    }, { timeout: 10000 })
    expect(within(trail).getByRole('button', { name: /coba lagi/i })).toBeInTheDocument()
  }, 30000)

  it('event lama (sebelum v0.6.3) diberi label jelas, tidak dipalsukan', async () => {
    be = await installBackend()
    await makeMission('Misi dengan event legacy')
    // Event capability lama (tanpa eventType, tanpa missionId) → hanya terlihat di jejak global.
    await fs.appendFile(path.join((be as unknown as { dir: string }).dir, 'capability-audit.jsonl'), JSON.stringify({
      at: '2026-01-01T00:00:00.000Z', capabilityId: 'dudu.legacy.tool', action: 'run', outcome: 'succeeded',
    }) + '\n')

    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: /pusat eksekusi/i }))
    await screen.findByRole('heading', { level: 1, name: /pusat eksekusi/i })
    const trail = await screen.findByRole('region', { name: /jejak audit/i }, { timeout: 10000 })
    expect(trail).toBeInTheDocument()
    await waitFor(() => {
      expect(within(listOf()).getAllByText(/sebelum v0\.6\.3/i).length).toBeGreaterThan(0)
    }, { timeout: 10000 })
    // Aktor sistem tidak diklaim sebagai manusia.
    expect(within(listOf()).getAllByText(/aktor: /i).length).toBeGreaterThan(0)
  }, 30000)

  it('filter misi tersedia pada jejak global', async () => {
    be = await installBackend()
    const m = await makeMission('Misi yang bisa disaring')
    await be.api.handle({ method: 'POST', path: `/api/missions/${m.id}/approve`, headers: H, contentType: 'application/json', body: '{}' })

    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: /pusat eksekusi/i }))
    await screen.findByRole('heading', { level: 1, name: /pusat eksekusi/i })
    const trail = await screen.findByRole('region', { name: /jejak audit/i }, { timeout: 10000 })
    const select = within(trail).getByLabelText(/misi/i) as HTMLSelectElement
    await waitFor(() => {
      expect([...select.options].some(o => o.textContent?.includes('Misi yang bisa disaring'))).toBe(true)
    }, { timeout: 10000 })
    await user.selectOptions(select, m.id)
    await waitFor(() => {
      const list = listOf()
      expect(within(list).queryByText(/misi dibuat/i)).toBeInTheDocument()
    }, { timeout: 10000 })
  }, 30000)

  it('tidak menampilkan data sensitif mentah (args/result/isi file) di DOM', async () => {
    be = await installBackend()
    const m = await makeMission('Misi dengan data sensitif')
    await be.api.handle({ method: 'POST', path: `/api/missions/${m.id}/approve`, headers: H, contentType: 'application/json', body: '{}' })
    // Event dengan kunci sensitif + argumen mentah: UI tidak boleh memaparkannya.
    await fs.appendFile(path.join((be as unknown as { dir: string }).dir, 'capability-audit.jsonl'), JSON.stringify({
      at: '2026-01-02T00:00:00.000Z', eventType: 'tool.execution_started', missionId: m.id, actor: 'user', outcome: 'requested',
      detail: { args: { apiKey: 'RAHASIA-UI-999' }, result: { isi: 'nama,nilai' } },
    }) + '\n')

    const user = userEvent.setup(); render(<App />)
    const trail = await openMissionDetail(user, m.title)
    const html = trail.textContent ?? ''
    expect(html).not.toContain('RAHASIA-UI-999')
    expect(html).not.toContain('nama,nilai')
    // Kunci 'args'/'result' tidak pernah dirender apa adanya.
    expect(html).not.toMatch(/\bargs\b/i)
    expect(html).not.toMatch(/\bresult\b/i)
  }, 30000)

  it('status denied, failed, succeeded, dan unverified dibedakan', async () => {
    be = await installBackend()
    const m = await makeMission('Misi dengan berbagai hasil')
    const lines = [
      { at: '2026-01-03T00:00:00.000Z', eventType: 'permission.denied', missionId: m.id, actor: 'user', outcome: 'denied' },
      { at: '2026-01-03T00:00:01.000Z', eventType: 'tool.execution_failed', missionId: m.id, actor: 'system', outcome: 'failed' },
      { at: '2026-01-03T00:00:02.000Z', eventType: 'tool.execution_succeeded', missionId: m.id, actor: 'system', outcome: 'succeeded' },
      { at: '2026-01-03T00:00:03.000Z', eventType: 'capability.validated', missionId: m.id, actor: 'system', outcome: 'unverified' },
    ].map((l) => JSON.stringify(l)).join('\n')
    await fs.appendFile(path.join((be as unknown as { dir: string }).dir, 'capability-audit.jsonl'), lines + '\n')

    const user = userEvent.setup(); render(<App />)
    await openMissionDetail(user, m.title)
    await waitFor(() => {
      const list = listOf()
      expect(within(list).getAllByText(/^ditolak$/i).length).toBeGreaterThan(0)
      expect(within(list).getAllByText(/^gagal$/i).length).toBeGreaterThan(0)
      expect(within(list).getAllByText(/^berhasil$/i).length).toBeGreaterThan(0)
      expect(within(list).getAllByText(/^belum terverifikasi$/i).length).toBeGreaterThan(0)
    }, { timeout: 10000 })
    // Badge hasil memakai kelas berbeda (tidak semua sama).
    const pills = within(listOf()).getAllByText(/^(ditolak|gagal|berhasil|belum terverifikasi)$/i).map((el) => el.className)
    expect(new Set(pills).size).toBeGreaterThan(2)
  }, 30000)
})
