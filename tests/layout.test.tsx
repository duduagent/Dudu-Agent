import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ configured: false }) })))
})
afterEach(() => vi.unstubAllGlobals())

// Render lalu tunggu health check asinkron di ChatWorkspace selesai sebelum berinteraksi.
async function renderSettled() {
  const result = render(<App />)
  await waitFor(() => expect(document.querySelector('.pill.warn')).not.toBeNull())
  return result
}

const appEl = (c: HTMLElement) => c.querySelector('.app') as HTMLElement

describe('Layout tiga region', () => {
  it('sidebar kiri dan kanan collapse secara independen', async () => {
    const { container } = await renderSettled()
    const app = appEl(container)
    expect(app.className).not.toContain('left-collapsed')
    expect(app.className).not.toContain('right-collapsed')

    fireEvent.click(screen.getByRole('button', { name: 'Menu utama' }))
    expect(app.className).toContain('left-collapsed')
    expect(app.className).not.toContain('right-collapsed')

    fireEvent.click(screen.getByRole('button', { name: 'Panel konteks' }))
    expect(app.className).toContain('right-collapsed')
  })

  it('kedua sidebar bisa tertutup bersamaan (center melebar via flex 1fr)', async () => {
    const { container } = await renderSettled()
    const app = appEl(container)
    fireEvent.click(screen.getByRole('button', { name: 'Menu utama' }))
    fireEvent.click(screen.getByRole('button', { name: 'Panel konteks' }))
    expect(app.className).toContain('left-collapsed')
    expect(app.className).toContain('right-collapsed')
    // Verifikasi piksel nyata butuh browser — lihat checklist manual di README.
  })

  it('preferensi collapse dipersistenkan ke localStorage', async () => {
    await renderSettled()
    fireEvent.click(screen.getByRole('button', { name: 'Menu utama' }))
    fireEvent.click(screen.getByRole('button', { name: 'Panel konteks' }))
    const prefs = JSON.parse(localStorage.getItem('dudu.prefs.v1') ?? '{}')
    expect(prefs.leftCollapsed).toBe(true)
    expect(prefs.rightCollapsed).toBe(true)
  })
})

describe('layar sempit: overlay sidebar tidak boleh menutupi konten (regresi)', () => {
  const mockViewport = (narrow: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({
    matches: narrow && q.includes('max-width'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }))
  it('preferensi "terbuka" dari sesi lebar tidak membuka overlay di layar sempit', async () => {
    localStorage.setItem('dudu.prefs.v1', JSON.stringify({ leftCollapsed: false, rightCollapsed: false }))
    mockViewport(true)
    const { container } = await renderSettled()
    expect(container.querySelector('.app')).toHaveClass('left-collapsed', 'right-collapsed')
    expect(container.querySelector('.app')).not.toHaveClass('has-overlay')
  })
  it('memilih halaman di layar sempit menutup sidebar kiri agar konten terlihat', async () => {
    mockViewport(true)
    const { container } = await renderSettled()
    fireEvent.click(screen.getByRole('button', { name: /menu utama|buka sidebar kiri/i }))
    expect(container.querySelector('.app')).not.toHaveClass('left-collapsed')
    fireEvent.click(screen.getByRole('button', { name: /files & artifacts/i }))
    expect(container.querySelector('.app')).toHaveClass('left-collapsed')
    expect(await screen.findByRole('heading', { level: 1, name: /files & artifacts/i })).toBeInTheDocument()
    await act(async () => { await new Promise(r => setTimeout(r, 60)) }) // biarkan pemuatan halaman selesai
  })
  it('di layar lebar, memilih halaman TIDAK menutup sidebar', async () => {
    mockViewport(false)
    const { container } = await renderSettled()
    fireEvent.click(screen.getByRole('button', { name: /files & artifacts/i }))
    expect(container.querySelector('.app')).not.toHaveClass('left-collapsed')
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  })
})
