import { beforeEach, describe, expect, it } from 'vitest'
import { INTERRUPTED_MESSAGE, loadActiveId, loadConversations, loadPrefs, sanitizeConversations, saveConversations } from '../src/lib/storage'
import type { Conversation } from '../src/lib/types'

beforeEach(() => localStorage.clear())

describe('storage: data lokal rusak tidak membuat aplikasi crash', () => {
  it.each([
    ['bukan JSON', '{{{ rusak'],
    ['objek, bukan array', '{"a":1}'],
    ['null', 'null'],
    ['angka', '42'],
  ])('loadConversations menangani %s', (_n, raw) => {
    localStorage.setItem('dudu.conversations.v1', raw)
    expect(loadConversations()).toEqual([])
  })

  it('membuang entri tidak valid dan duplikat, mempertahankan yang valid', () => {
    const good = { id: 'a', title: 'Satu', createdAt: 1, updatedAt: 2, messages: [{ id: 'm1', role: 'user', content: 'hai', createdAt: 3, status: 'done' }] }
    const out = sanitizeConversations([null, 5, { id: 7 }, good, { ...good, title: 'duplikat' }, { id: 'b', messages: 'bukan array' }])
    expect(out.map(c => c.id)).toEqual(['a', 'b'])
    expect(out[0].messages).toHaveLength(1)
    expect(out[1].messages).toEqual([])
    expect(out[1].title).toBe('Chat baru')
  })

  it('membuang pesan tak valid di dalam percakapan', () => {
    const out = sanitizeConversations([{ id: 'a', title: 't', messages: [{ id: 1 }, { id: 'x', role: 'hacker', content: 'x' }, { id: 'ok', role: 'user', content: 'ok' }] }])
    expect(out[0].messages.map(m => m.id)).toEqual(['ok'])
  })

  it('pesan "sending" yang tersimpan diubah menjadi error agar tidak mengetik selamanya', () => {
    const conv: Conversation = { id: 'a', title: 't', createdAt: 1, updatedAt: 1, messages: [{ id: 'm', role: 'assistant', content: '', createdAt: 1, status: 'sending' }] }
    saveConversations([conv])
    const [loaded] = loadConversations()
    expect(loaded.messages[0].status).toBe('error')
    expect(loaded.messages[0].error).toBe(INTERRUPTED_MESSAGE)
  })

  it('round-trip menyimpan dan memuat percakapan yang valid', () => {
    const conv: Conversation = { id: 'a', title: 'Judul', createdAt: 1, updatedAt: 2, messages: [{ id: 'm', role: 'user', content: 'isi', createdAt: 3, status: 'done' }] }
    expect(saveConversations([conv])).toBe(true)
    expect(loadConversations()).toEqual([conv])
  })

  it('prefs dan activeId rusak menghasilkan nilai aman', () => {
    localStorage.setItem('dudu.prefs.v1', '{"leftCollapsed":"ya"}')
    localStorage.setItem('dudu.activeConversation.v1', '{"x":1}')
    expect(loadPrefs()).toBeNull()
    expect(loadActiveId()).toBeNull()
  })
})
