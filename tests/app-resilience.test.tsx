import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 501, json: async () => ({}) })))
})
afterEach(() => vi.unstubAllGlobals())

// Health check di ChatWorkspace selesai secara asinkron; tunggu agar tidak bocor ke luar tes.
const settleHealthCheck = () => waitFor(() => expect(document.querySelector('.pill.warn')).not.toBeNull())

describe('App tahan terhadap data lokal rusak', () => {
  it('tidak crash saat penyimpanan berisi data sampah', async () => {
    localStorage.setItem('dudu.conversations.v1', '{"bukan":"array"}')
    localStorage.setItem('dudu.activeConversation.v1', '"id-tak-ada"')
    localStorage.setItem('dudu.prefs.v1', '[]')
    render(<App />)
    expect(screen.getByRole('heading', { name: /halo! saya dudu/i })).toBeInTheDocument()
    await settleHealthCheck()
  })

  it('menampilkan pesan "sending" yang tertinggal sebagai error dengan tombol Coba lagi', async () => {
    localStorage.setItem('dudu.conversations.v1', JSON.stringify([{ id: 'c1', title: 'X', createdAt: 1, updatedAt: 1, messages: [
      { id: 'u1', role: 'user', content: 'Halo', createdAt: 1, status: 'done' },
      { id: 'a1', role: 'assistant', content: '', createdAt: 1, status: 'sending' },
    ] }]))
    localStorage.setItem('dudu.activeConversation.v1', '"c1"')
    render(<App />)
    expect(screen.queryByRole('status', { name: /sedang mengetik/i })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/terputus/i)
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument()
    await settleHealthCheck()
  })
})

describe('Percakapan', () => {
  it('Chat Baru membuat percakapan terpisah, bisa berpindah dan menghapus', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)
    const send = async (t: string) => {
      await user.type(screen.getByLabelText(/pesan untuk dudu/i), t)
      await user.keyboard('{Enter}')
      await screen.findByText(/DUDU_PROVIDER_API_KEY/)
    }
    await send('Percakapan satu')
    await user.click(screen.getByRole('button', { name: /chat baru/i }))
    expect(document.querySelectorAll('.msg-row')).toHaveLength(0)
    await send('Percakapan dua')

    const convs = JSON.parse(localStorage.getItem('dudu.conversations.v1') ?? '[]')
    expect(convs).toHaveLength(2)
    expect(new Set(convs.map((c: { id: string }) => c.id)).size).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Percakapan satu' }))
    expect(document.querySelector('.msg-row.user')).toHaveTextContent('Percakapan satu')

    await user.click(screen.getByRole('button', { name: /hapus: percakapan satu/i }))
    expect(JSON.parse(localStorage.getItem('dudu.conversations.v1') ?? '[]')).toHaveLength(1)
  })
})
