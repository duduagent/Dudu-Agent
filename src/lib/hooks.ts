import { useCallback, useEffect, useState } from 'react'
import { api, authState, type SessionUser } from './api'
import * as store from './storage'
import type { ActivityEvent, Conversation, Message, Prefs } from './types'
import { uid } from './util'

export function useAuthUser() {
  const [user, setUser] = useState<SessionUser | null>(null)
  useEffect(() => {
    let alive = true
    const stop = authState.subscribe(setUser)
    // Sinkronisasi sesi saat mulai: token tersimpan tetap valid? (server yang memutuskan)
    api.authMe().then((r) => { if (alive) setUser(r.user) }).catch(() => { /* server tidak terjangkau: pakai nilai dari subscribe */ })
    return () => { alive = false; stop() }
  }, [])
  return user
}

export function usePrefs(initial: Prefs) {
  const [prefs, setPrefs] = useState<Prefs>(() => store.loadPrefs() ?? initial)
  useEffect(() => { store.savePrefs(prefs) }, [prefs])
  const update = useCallback((patch: Partial<Prefs>) => setPrefs(p => ({ ...p, ...patch })), [])
  return [prefs, update] as const
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(() => store.loadConversations())
  const [activeId, setActiveId] = useState<string | null>(() => {
    const id = store.loadActiveId()
    return id && store.loadConversations().some(c => c.id === id) ? id : null
  })
  const [storageError, setStorageError] = useState(false)
  useEffect(() => { setStorageError(!store.saveConversations(conversations)) }, [conversations])
  useEffect(() => { store.saveActiveId(activeId) }, [activeId])

  const create = useCallback((): string => {
    const conv: Conversation = { id: uid(), title: 'Chat baru', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
    setConversations(cs => [conv, ...cs])
    setActiveId(conv.id)
    return conv.id
  }, [])

  const select = useCallback((id: string | null) => setActiveId(id), [])

  const remove = useCallback((id: string) => {
    setConversations(cs => cs.filter(c => c.id !== id))
    setActiveId(a => (a === id ? null : a))
  }, [])

  const rename = useCallback((id: string, title: string) => {
    const t = title.trim().slice(0, 80)
    if (!t) return
    setConversations(cs => cs.map(c => (c.id === id ? { ...c, title: t } : c)))
  }, [])

  const addMessage = useCallback((convId: string, msg: Omit<Message, 'id' | 'createdAt'> & { id?: string }): string => {
    const id = msg.id ?? uid()
    const full: Message = { ...msg, id, createdAt: Date.now() }
    setConversations(cs => cs.map(c => {
      if (c.id !== convId) return c
      const isFirstUser = full.role === 'user' && !c.messages.some(m => m.role === 'user')
      return {
        ...c,
        updatedAt: Date.now(),
        title: isFirstUser ? full.content.slice(0, 48) : c.title,
        messages: [...c.messages, full],
      }
    }))
    return id
  }, [])

  const updateMessage = useCallback((convId: string, msgId: string, patch: Partial<Message>) => {
    setConversations(cs => cs.map(c => (c.id !== convId ? c : {
      ...c,
      messages: c.messages.map(m => (m.id === msgId ? { ...m, ...patch } : m)),
    })))
  }, [])

  const deleteMessage = useCallback((convId: string, msgId: string) => {
    setConversations(cs => cs.map(c => (c.id !== convId ? c : { ...c, messages: c.messages.filter(m => m.id !== msgId) })))
  }, [])

  return { conversations, activeId, storageError, create, select, remove, rename, addMessage, updateMessage, deleteMessage }
}

export function useActivity() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const push = useCallback((message: string) => {
    setEvents(es => [{ id: uid(), message, at: Date.now() }, ...es].slice(0, 30))
  }, [])
  return [events, push] as const
}

export function useIsMobile(query = '(max-width: 880px)') {
  const [m, setM] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = () => setM(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [query])
  return m
}
