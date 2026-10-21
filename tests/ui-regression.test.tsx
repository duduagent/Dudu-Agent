// Regresi UI (v0.6.2): kontrak token kontras di stylesheet + perilaku komponen yang
// pernah bermasalah (kontras tombol, batas/fokus kontrol, semantik badge, status integrasi
// yang jujur, keadaan kosong misi, aksi navigasi, dan duplikasi konten/aksi).
//
// Tidak memakai snapshot: assertion dilakukan pada isi yang terlihat, state, semantik ARIA,
// dan perilaku (salin, status, teks).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import App from '../src/App'
import { installBackend, type Backend } from './helpers/real-backend.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8')

// ---- utilitas kontras (WCAG 2.x) ----
const rgb = (hex: string) => {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lum = (c: number[]) => {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const ratio = (a: string, b: string) => {
  const l1 = lum(rgb(a)), l2 = lum(rgb(b))
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,8})`))
  return m?.[1] ?? null
}

let be: Backend
beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { await act(async () => { await new Promise(r => setTimeout(r, 80)) }); vi.restoreAllMocks(); await be?.cleanup() })

describe('Kontrak token kontras (styles.css)', () => {
  it('tombol utama memakai emas yang lolos AA untuk teks normal (>= 4.5:1)', () => {
    const btn = token('gold-btn')
    expect(btn).not.toBeNull()
    expect(ratio('#FFFFFF', btn!)).toBeGreaterThanOrEqual(4.5)
    expect(css).toMatch(/\.btn-primary\{[^}]*background:var\(--gold-btn\)/)
  })

  it('emas terang tidak lagi dipakai sebagai warna teks', () => {
    // Cegah regresi: --gold-deep (4.43:1) tidak boleh menjadi WARNA TEKS.
    // (border-color/accent-color boleh: itu komponen non-teks dengan ambang 3:1.)
    const offenders = css.split('\n').filter((l) => /(?<![-\w])color:var\(--gold-deep\)/.test(l))
    expect(offenders).toEqual([])
    expect(ratio(token('gold-ink')!, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  it('batas kontrol form memenuhi WCAG 1.4.11 (>= 3:1) dan fokus memakai warna yang terlihat', () => {
    const ctl = token('line-ctl')
    expect(ctl).not.toBeNull()
    expect(ratio(ctl!, '#FFFFFF')).toBeGreaterThanOrEqual(3)
    expect(css).toMatch(/\.input:focus[^{]*\{[^}]*border-color:var\(--gold-deep\)/)
    expect(ratio(token('gold-deep')!, '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })

  it('tidak ada penggunaan !important yang berlebihan', () => {
    const n = (css.match(/!important/g) ?? []).length
    expect(n).toBeLessThanOrEqual(2)
  })
})

describe('Perilaku komponen (server API nyata)', () => {
  it('CLI: tombol Salin memberi umpan balik hanya setelah berhasil', async () => {
    be = await installBackend()
    const user = userEvent.setup()   //CATATAN: setup() memasang stub navigator.clipboard sendiri → mock di bawah harus dipasang SESUDAHNYA
    const writeText = vi.fn(async () => { /* berhasil */ })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
    render(<App />)
    await user.click(screen.getByRole('button', { name: /tools & integrations/i }))
    await user.click(screen.getByRole('button', { name: /^cli$/i }))
    await screen.findByRole('heading', { level: 1, name: /^cli$/i })
    const salin = screen.getAllByRole('button', { name: /salin perintah/i })[0]
    await user.click(salin)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Tersalin')).toBeInTheDocument()
  })

  it('CLI: tidak ada umpan balik "Tersalin" bila clipboard ditolak', async () => {
    be = await installBackend()
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('ditolak') }) }, configurable: true, writable: true })
    render(<App />)
    await user.click(screen.getByRole('button', { name: /tools & integrations/i }))
    await user.click(screen.getByRole('button', { name: /^cli$/i }))
    await screen.findByRole('heading', { level: 1, name: /^cli$/i })
    await user.click(screen.getAllByRole('button', { name: /salin perintah/i })[0])
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(screen.queryByText('Tersalin')).toBeNull()
  })

  it('Connector: status jujur — scaffold tidak punya tombol uji koneksi', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: /tools & integrations/i }))
    await user.click(screen.getByRole('button', { name: /^connector$/i }))
    await screen.findByRole('heading', { level: 1, name: /^connector$/i })
    const email = (await screen.findByText('Email (SMTP kirim saja)')).closest('.card') as HTMLElement
    expect(within(email).getByText(/kerangka — belum live/i)).toBeInTheDocument()
    expect(within(email).queryByRole('button', { name: /uji koneksi/i })).toBeNull()
    const webhook = (await screen.findByText('Webhook')).closest('.card') as HTMLElement
    expect(within(webhook).getByText(/perlu konfigurasi/i)).toBeInTheDocument()
  })

  it('Misi: keadaan kosong jujur dan tidak menampilkan persen karangan', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: /misi & tugas/i }))
    await screen.findByRole('heading', { level: 1, name: /^misi & tugas$/i })
    expect(await screen.findByText(/belum ada misi\. buat misi pertama/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d+\s*%/)
  })

  it('Pusat Eksekusi: badge status mengikuti state nyata & butir konfigurasi dari registry', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: /pusat eksekusi/i }))
    await screen.findByRole('heading', { level: 1, name: /pusat eksekusi/i })
    // Status yang tampil harus berasal dari state server (registry nyata), bukan daftar manual.
    await waitFor(() => expect(screen.getByText(/integrasi belum siap/i)).toBeInTheDocument())
    expect(screen.getByText(/dudu\.connector\.webhook/)).toBeInTheDocument()
    // Tidak ada duplikasi aksi navigasi.
    expect(screen.getAllByRole('button', { name: /buka tools & integrations/i }).length).toBe(1)
  })

  it('Navigasi: Pusat Eksekusi tersedia dan menandai halaman aktif', async () => {
    be = await installBackend()
    const user = userEvent.setup(); render(<App />)
    const nav = screen.getByRole('button', { name: /pusat eksekusi/i })
    expect(nav).toBeInTheDocument()
    await user.click(nav)
    await screen.findByRole('heading', { level: 1, name: /pusat eksekusi/i })
    expect(nav).toHaveAttribute('aria-current', 'page')
  })
})
