// Uji polling adaptif Pusat Eksekusi (v0.6.2).
// Fokus: satu siklus hidup per tampilan, tanpa request bertumpuk, backoff saat gagal,
// berhenti saat misi terminal, berhenti saat tab tersembunyi, lanjut saat aktif lagi,
// dan request dibatalkan saat komponen dilepas.
//
// API modul dipalsukan (vi.mock) agar timing polling dapat dikendalikan penuh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => {
  const base = {
    goal: 'g', template: 'data-analysis', planner: 'rule-based',
    fileId: 'f1', fileName: 'sales.csv', createdAt: 1, updatedAt: 1,
    policy: { requiresApproval: true, writeScope: 'artefak', network: false, destructive: false, maxAutoRetries: 1 },
    approval: { status: 'approved' as const },
    acceptance: [{ id: 'ac1', text: 'Kriteria', status: 'pending' as const }],
    artifacts: [], failure: null, log: [] as Array<{ at: number; level: string; msg: string }>,
  }
  const running = {
    ...base, id: 'm-running', title: 'Misi berjalan', state: 'running' as const,
    steps: [{ id: 's1', tool: 'input.validate', title: 'Validasi', status: 'running' as const, attempts: [{ execId: 'e1', startedAt: 1, attempt: 1 }] }],
  }
  const done = {
    ...base, id: 'm-done', title: 'Misi selesai', state: 'completed' as const,
    steps: [{ id: 's1', tool: 'input.validate', title: 'Validasi', status: 'done' as const, attempts: [{ execId: 'e1', startedAt: 1, finishedAt: 2, ok: true, attempt: 1 }] }],
  }
  return {
    base, running, done,
    calls: { getMission: 0, missions: 0, registry: 0, approve: 0, cancel: 0 },
    inFlight: 0, maxInFlight: 0,
    impl: {
      getMission: async (_id: string, _signal?: AbortSignal): Promise<typeof running | typeof done> => running,
    },
  }
})

vi.mock('../src/lib/api', () => ({
  api: {
    missions: async () => { h.calls.missions += 1; return [h.running] },
    getMission: async (id: string, signal?: AbortSignal) => {
      h.calls.getMission += 1
      h.inFlight += 1
      h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
      try { return await h.impl.getMission(id, signal) } finally { h.inFlight -= 1 }
    },
    capabilityRegistry: async () => { h.calls.registry += 1; return { items: [] } },
    approveMission: async () => { h.calls.approve += 1; return h.done },
    retryMission: async () => h.done,
    cancelMission: async () => { h.calls.cancel += 1; return h.running },
  },
}))

const { ExecutionCenterPage } = await import('../src/components/pages/ExecutionCenterPage')

let hidden = false
beforeEach(() => {
  h.calls = { getMission: 0, missions: 0, registry: 0, approve: 0, cancel: 0 }
  h.inFlight = 0
  h.maxInFlight = 0
  h.impl.getMission = async () => h.running
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
})
afterEach(() => { vi.useRealTimers() })

const renderPage = () => render(
  <ExecutionCenterPage onToggleLeft={() => {}} leftCollapsed={false} onActivity={() => {}} />,
)

const selectRunning = async () => {
  const btn = await screen.findByRole('button', { name: /pantau/i })
  await act(async () => { btn.click() })
}

describe('Polling adaptif Pusat Eksekusi', () => {
  it('tidak pernah menjalankan request bertumpuk dan berhenti saat misi terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await act(async () => { await Promise.resolve() })
    await selectRunning()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(h.calls.getMission).toBeGreaterThan(1)
    expect(h.maxInFlight).toBe(1)              // tidak ada request bertumpuk

    // Misi selesai → polling berhenti.
    h.impl.getMission = async () => h.done
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    const callsAfterDone = h.calls.getMission
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(h.calls.getMission).toBe(callsAfterDone)  // berhenti setelah terminal
  })

  it('melambat (backoff) saat server sering gagal dan menampilkan indikator koneksi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    h.impl.getMission = async () => { throw new Error('jaringan mati') }
    renderPage()
    await selectRunning()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(await screen.findByText(/koneksi ke server bermasalah/i)).toBeInTheDocument()
    // Backoff: jumlah permintaan dalam jendela tetap tidak melonjak (jeda antar permintaan memanjang).
    const before = h.calls.getMission
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(h.calls.getMission - before).toBeLessThanOrEqual(2)
  })

  it('berhenti polling saat tab tersembunyi dan lanjut saat aktif lagi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await selectRunning()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    const before = h.calls.getMission
    hidden = true
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(5000) })
    expect(h.calls.getMission).toBe(before)   // tidak ada polling saat tersembunyi
    hidden = false
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(50) })
    await waitFor(() => expect(h.calls.getMission).toBeGreaterThan(before))
  })

  it('melepas timer dan membatalkan request saat komponen dilepas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let aborted = false
    h.impl.getMission = (_id: string, signal?: AbortSignal) => new Promise((_res, rej) => {
      signal?.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')) })
    })
    const { unmount } = renderPage()
    await selectRunning()
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    const calls = h.calls.getMission
    await act(async () => { unmount() })
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(h.calls.getMission).toBe(calls)   // tidak ada polling setelah unmount
    expect(aborted).toBe(true)               // request yang berjalan dibatalkan
  })

  it('menampilkan status misi nyata (bukan karangan) tanpa mengulang aksi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await selectRunning()
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(await screen.findByText(/0 dari 1 langkah selesai/i)).toBeInTheDocument()
    // Aksi navigasi tidak boleh diduplikasi (satu tombol per tujuan).
    expect(screen.queryAllByRole('button', { name: /^buka misi & tugas$/i }).length).toBeLessThanOrEqual(1)
    expect(screen.queryAllByRole('button', { name: /^segarkan$/i }).length).toBeLessThanOrEqual(1)
  })
})
