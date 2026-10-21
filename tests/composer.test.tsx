import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: false, status: 501, json: async () => ({ error: 'provider_not_configured' }) })))
})
afterEach(() => vi.unstubAllGlobals())

// Teks pesan juga muncul sebagai judul percakapan (sidebar + header), jadi pesan pengguna
// harus dicari di dalam baris pesannya, bukan lewat teks global.
const userRows = () => Array.from(document.querySelectorAll<HTMLElement>('.msg-row.user'))

describe('Composer', () => {
  it('Enter mengirim pesan; textarea dikosongkan', async () => {
    const user = userEvent.setup()
    render(<App />)
    const ta = screen.getByLabelText(/pesan untuk dudu/i) as HTMLTextAreaElement
    await user.type(ta, 'Halo Dudu')
    await user.keyboard('{Enter}')
    // renderContent() membungkus teks dalam <p>, jadi teks berada di `.msg-text > p`.
    // Verifikasi perilaku yang terlihat pengguna: teks tampil di dalam baris pesan pengguna.
    await waitFor(() => expect(userRows()).toHaveLength(1))
    const text = within(userRows()[0]).getByText('Halo Dudu')
    expect(text.closest('.msg-text')).not.toBeNull()
    expect(ta.value).toBe('')
  })

  it('Shift+Enter menyisipkan baris baru tanpa mengirim', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const ta = screen.getByLabelText(/pesan untuk dudu/i) as HTMLTextAreaElement
    await user.type(ta, 'baris1{Shift>}{Enter}{/Shift}baris2')
    expect(ta.value).toBe('baris1\nbaris2')
    expect(container.querySelector('.msg-row.user')).toBeNull()
  })

  it('IME-safe: Enter saat composition tidak mengirim; setelah composition selesai baru mengirim', async () => {
    const { container } = render(<App />)
    const ta = screen.getByLabelText(/pesan untuk dudu/i) as HTMLTextAreaElement

    fireEvent.change(ta, { target: { value: 'nihongo' } })
    fireEvent.compositionStart(ta)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(ta.value).toBe('nihongo')
    expect(container.querySelector('.msg-row.user')).toBeNull()
    expect(fetch).not.toHaveBeenCalledWith('/api/chat', expect.anything())

    // Safari/WebKit: Enter penutup komposisi datang dengan keyCode 229.
    fireEvent.compositionEnd(ta)
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229 })
    expect(container.querySelector('.msg-row.user')).toBeNull()

    fireEvent.keyDown(ta, { key: 'Enter' })
    await waitFor(() => expect(userRows()).toHaveLength(1))
    expect(within(userRows()[0]).getByText('nihongo')).toBeInTheDocument()
    expect(ta.value).toBe('')
  })

  it('provider 501 → pesan error jujur + tombol Coba lagi, tanpa respons palsu', async () => {
    const user = userEvent.setup()
    render(<App />)
    const ta = screen.getByLabelText(/pesan untuk dudu/i)
    await user.type(ta, 'Uji provider')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/DUDU_PROVIDER_API_KEY/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument()
  })

  it('pesan pengguna tetap tampil dan tidak ganda saat jaringan gagal; Coba lagi tidak menggandakan pesan', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/health') return { ok: true, status: 200, json: async () => ({ configured: true }) }
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText(/pesan untuk dudu/i), 'Tes jaringan')
    await user.keyboard('{Enter}')

    expect(await screen.findByText(/server api tidak terjangkau/i)).toBeInTheDocument()
    expect(userRows()).toHaveLength(1)
    expect(within(userRows()[0]).getByText('Tes jaringan')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /coba lagi/i }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/chat')).toHaveLength(2))
    await screen.findByRole('button', { name: /coba lagi/i })
    expect(userRows()).toHaveLength(1)
    const chatCalls = fetchMock.mock.calls.filter(c => c[0] === '/api/chat')
    expect(chatCalls).toHaveLength(2)
    // Riwayat yang dikirim ulang tidak memuat pesan error dan memuat pesan pengguna tepat sekali.
    const retryBody = JSON.parse((chatCalls[1][1] as RequestInit).body as string) as { messages: Array<{ role: string; content: string }> }
    expect(retryBody.messages.filter(m => m.role === 'user')).toHaveLength(1)
  })

  it('error HTTP 502 menampilkan detail dari server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/health'
      ? { ok: true, status: 200, json: async () => ({ configured: true }) }
      : { ok: false, status: 502, json: async () => ({ error: 'upstream_error', details: 'Kunci API tidak valid' }) }))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText(/pesan untuk dudu/i), 'Halo')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/provider merespons 502: kunci api tidak valid/i)).toBeInTheDocument()
  })

  it('balasan sukses ditampilkan sebagai pesan assistant', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/health'
      ? { ok: true, status: 200, json: async () => ({ configured: true }) }
      : { ok: true, status: 200, json: async () => ({ content: 'Halo juga!', model: 'tes-model' }) }))
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.type(screen.getByLabelText(/pesan untuk dudu/i), 'Halo')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Halo juga!')).toBeInTheDocument()
    expect(container.querySelectorAll('.msg-row.user')).toHaveLength(1)
    expect(container.querySelectorAll('.msg-row.assistant')).toHaveLength(1)
  })

  it('percakapan dan pesan dipulihkan setelah aplikasi dibuka ulang', async () => {
    const user = userEvent.setup()
    const first = render(<App />)
    await user.type(screen.getByLabelText(/pesan untuk dudu/i), 'Pesan tersimpan')
    await user.keyboard('{Enter}')
    await screen.findByText(/DUDU_PROVIDER_API_KEY/)
    first.unmount()

    render(<App />)
    await waitFor(() => expect(userRows()).toHaveLength(1))
    expect(within(userRows()[0]).getByText('Pesan tersimpan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument()
  })
})
