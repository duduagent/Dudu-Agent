import type { Conversation, Message, MsgAttachment, MsgSource, Prefs } from './types'

const CONV_KEY = 'dudu.conversations.v1'
const ACTIVE_KEY = 'dudu.activeConversation.v1'
const PREFS_KEY = 'dudu.prefs.v1'

export const INTERRUPTED_MESSAGE = 'Respons terputus karena aplikasi ditutup atau dimuat ulang. Coba lagi.'

// BATASAN EKSPLISIT: ini penyimpanan LOKAL (browser atau folder data aplikasi desktop), bukan cloud.
export const STORAGE_NOTICE =
  typeof window !== 'undefined' && window.dudu?.isDesktop
    ? 'Data lokal di perangkat ini — bukan cloud.'
    : 'Data lokal di browser ini — bukan cloud.'

function readRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false /* kuota penuh / private mode */ }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isRole = (x: unknown): x is Message['role'] => x === 'user' || x === 'assistant' || x === 'system'
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback)

function sanitizeMessage(x: unknown): Message | null {
  if (!isObj(x) || typeof x.id !== 'string' || !isRole(x.role) || typeof x.content !== 'string') return null
  const msg: Message = { id: x.id, role: x.role, content: x.content, createdAt: num(x.createdAt, Date.now()) }
  if (x.status === 'done' || x.status === 'error') msg.status = x.status
  if (typeof x.error === 'string') msg.error = x.error
  if (Array.isArray(x.attachments)) {
    const atts = x.attachments.filter((a): a is Record<string, unknown> => isObj(a) && typeof a.fileId === 'string' && typeof a.name === 'string')
      .map((a): MsgAttachment => ({
        fileId: a.fileId as string, name: (a.name as string).slice(0, 200), category: typeof a.category === 'string' ? a.category : 'other',
        state: a.state === 'analyzed' || a.state === 'not_readable' ? a.state : 'sent', ...(typeof a.reason === 'string' ? { reason: a.reason.slice(0, 300) } : {}),
      }))
    if (atts.length) msg.attachments = atts.slice(0, 8)
  }
  if (Array.isArray(x.sources)) {
    const src = x.sources.filter((a): a is Record<string, unknown> => isObj(a) && typeof a.fileId === 'string' && typeof a.name === 'string' && typeof a.n === 'number')
      .map((a): MsgSource => ({ n: a.n as number, fileId: a.fileId as string, name: (a.name as string).slice(0, 200), loc: typeof a.loc === 'string' ? a.loc : null }))
    if (src.length) msg.sources = src.slice(0, 10)
  }
  // Pembuatan respons yang terputus tidak boleh menampilkan indikator mengetik selamanya.
  if (x.status === 'sending') {
    msg.status = 'error'
    msg.error = INTERRUPTED_MESSAGE
  }
  return msg
}

/** Membuang entri rusak alih-alih membuat aplikasi crash saat startup. */
export function sanitizeConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Conversation[] = []
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== 'string' || seen.has(c.id)) continue
    seen.add(c.id)
    const messages = Array.isArray(c.messages) ? c.messages.map(sanitizeMessage).filter((m): m is Message => m !== null) : []
    out.push({
      id: c.id,
      title: typeof c.title === 'string' && c.title.trim() ? c.title : 'Chat baru',
      createdAt: num(c.createdAt, Date.now()),
      updatedAt: num(c.updatedAt, Date.now()),
      messages,
    })
  }
  return out
}

export const loadConversations = (): Conversation[] => sanitizeConversations(readRaw(CONV_KEY))
export const saveConversations = (c: Conversation[]) => write(CONV_KEY, c)
export const loadActiveId = (): string | null => {
  const v = readRaw(ACTIVE_KEY)
  return typeof v === 'string' ? v : null
}
export const saveActiveId = (id: string | null) => write(ACTIVE_KEY, id)

export function loadPrefs(): Prefs | null {
  const v = readRaw(PREFS_KEY)
  if (!isObj(v) || typeof v.leftCollapsed !== 'boolean' || typeof v.rightCollapsed !== 'boolean') return null
  return { leftCollapsed: v.leftCollapsed, rightCollapsed: v.rightCollapsed }
}
export const savePrefs = (p: Prefs) => write(PREFS_KEY, p)
