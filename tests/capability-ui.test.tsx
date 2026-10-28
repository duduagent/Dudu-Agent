// Uji UI katalog kapabilitas v0.5.0: data berasal dari backend nyata, referensi eksternal
// ditandai jelas, dan halaman Skill/Connector/Plugin menampilkan katalog tanpa status palsu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import { installBackend, type Backend } from './helpers/real-backend.mjs'

let be: Backend
beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 80)) }); vi.restoreAllMocks(); await be?.cleanup() })

async function openGroup(label: RegExp) {
  const user = userEvent.setup(); render(<App />)
  await user.click(screen.getByRole('button', { name: label }))
  return user
}

describe('Katalog kapabilitas di UI', () => {
  it('Tools & Integrations menampilkan registry + referensi dari tiga proyek eksternal', async () => {
    be = await installBackend()
    await openGroup(/tools & integrations/i)
    expect(await screen.findByRole('heading', { level: 1, name: /^tools & integrations$/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /katalog kapabilitas/i })).toBeInTheDocument()
    expect(await screen.findByText(/skill marketplace workbuddy/i)).toBeInTheDocument()
    expect(screen.getByText(/skills skill\.md \(hermes\)/i)).toBeInTheDocument()
    expect(screen.getByText(/skills skill\.md \+ gating/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /workbuddy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hermes agent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /openclaw/i })).toBeInTheDocument()
    expect(screen.getAllByText(/referensi eksternal/i).length).toBeGreaterThan(0)
  })

  it('filter sumber dan detail menampilkan dokumentasi resmi; referensi tidak punya tombol jalankan', async () => {
    be = await installBackend()
    const user = await openGroup(/tools & integrations/i)
    await screen.findByText(/skill marketplace workbuddy/i)
    await user.click(screen.getByRole('button', { name: /workbuddy/i }))
    await waitFor(() => expect(screen.queryByText(/skills skill\.md \(hermes\)/i)).not.toBeInTheDocument())
    const card = screen.getByText(/skill marketplace workbuddy/i).closest('li')
    expect(card).not.toBeNull()
    await user.click(within(card as HTMLElement).getByRole('button', { name: /^detail$/i }))
    expect(await screen.findByRole('heading', { level: 3, name: /skill marketplace workbuddy/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dokumentasi resmi skill market/i })).toHaveAttribute('href', expect.stringContaining('workbuddy.ai/docs'))
    expect(screen.queryByRole('button', { name: /jalankan sekarang/i })).not.toBeInTheDocument()
    expect(screen.getAllByText(/referensi eksternal/i).length).toBeGreaterThan(0)
  })

  it('halaman Skill, Connector, dan Plugin punya katalog referensi masing-masing', async () => {
    be = await installBackend()
    const user = await openGroup(/tools & integrations/i)
    await screen.findByRole('heading', { name: /katalog kapabilitas/i })
    await user.click(screen.getByRole('button', { name: /^skill$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /^skill$/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /skill referensi eksternal/i })).toBeInTheDocument()
    expect(await screen.findByText(/skills skill\.md \(hermes\)/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^connector$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /^connector$/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /referensi connector eksternal/i })).toBeInTheDocument()
    expect(await screen.findByText(/connector oauth workbuddy/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^plugin$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /^plugin$/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /referensi plugin eksternal/i })).toBeInTheDocument()
    expect(await screen.findByText(/plugin catalog hermes/i)).toBeInTheDocument()
  })
})
