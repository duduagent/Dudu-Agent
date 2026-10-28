import { cloneElement, useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { ProviderNotConfigured, sendChat, unreachableMessage } from '../lib/provider'
import { api, type Capabilities } from '../lib/api'
import { useAttachments, type Att } from '../lib/attachments'
import { memoryPrompt } from '../lib/memory'
import type { Conversation, Message, ModelRoute, MsgAttachment, ProviderInfo, Role, ViewId } from '../lib/types'
import { cx, timeAgo } from '../lib/util'
import { AttachButton, AttachmentTray, StoredFilePicker } from './Attachments'
import { DuduMark, Icon } from './ui'

const SYSTEM_PROMPT =
  'Kamu adalah Dudu, asisten AI pribadi untuk perencanaan, analisis, dan eksekusi tugas. ' +
  'Jawab dalam bahasa Indonesia secara ringkas, jelas, dan terstruktur menggunakan Markdown standar. ' +
  'Jangan menulis tag HTML seperti <br>, <div>, atau <p> sebagai teks. ' +
  'Gunakan baris baru untuk memisahkan paragraf. ' +
  'Untuk tabel, gunakan Markdown standar: setiap baris pada baris tersendiri, sertakan pemisah | --- | --- |, dan gunakan tanda | untuk memisahkan kolom. ' +
  'Jika tabel tidak diperlukan, gunakan judul dan daftar berpoin. ' +
  'Jangan mengklaim kemampuan atau status yang belum benar-benar tersedia.'

const MAX_CHARS = 8000
type ChatMsg = { role: Role; content: string; fileIds?: string[] }
const KB_PREF = 'dudu.useKnowledge.v1'

const STARTERS = [
  'Rangkum tujuan proyek saya dan susun rencana kerja',
  'Buat checklist peluncuran produk minggu ini',
  'Jelaskan arsitektur aplikasi ini dengan bahasa sederhana',
  'Buat draft email follow-up ke klien',
]

interface Props {
  conv: Conversation | null
  leftCollapsed: boolean
  rightCollapsed: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
  onCreateConversation: () => string
  onAddMessage: (convId: string, msg: { role: Role; content: string; status?: Message['status']; attachments?: MsgAttachment[] }) => string
  onUpdateMessage: (convId: string, msgId: string, patch: Partial<Message>) => void
  onDeleteMessage: (convId: string, msgId: string) => void
  onActivity: (msg: string) => void
  /** Opsional: navigasi ke halaman lain (mis. Misi & Tugas) dari banner hasil aksi. */
  onNavigate?: (view: ViewId) => void
}

export function ChatWorkspace(props: Props) {
  const { conv, onCreateConversation, onAddMessage, onUpdateMessage, onDeleteMessage, onActivity } = props
  const [composer, setComposer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [provider, setProvider] = useState<ProviderInfo>({ state: 'unknown' })
  const abortRef = useRef<AbortController | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [kbDocs, setKbDocs] = useState(0)
  const [useKb, setUseKb] = useState(() => { try { return localStorage.getItem(KB_PREF) === '1' } catch { return false } })
  const [picker, setPicker] = useState(false)
  const [missionNote, setMissionNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [creatingMission, setCreatingMission] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const att = useAttachments(caps?.limits.maxAttachments ?? 8, caps?.limits.maxUploadBytes ?? 25 * 1024 * 1024)
  const convIdRef = useRef<string | null>(conv?.id ?? null)

  useEffect(() => {
    let alive = true
    api.capabilities().then(c => { if (alive) setCaps(c) }).catch(() => { /* server tidak terjangkau: ditangani oleh health check */ })
    api.kb().then(k => { if (alive) setKbDocs(k.docs.filter(d => !d.missing).length) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const toggleKb = () => setUseKb(v => { const n = !v; try { localStorage.setItem(KB_PREF, n ? '1' : '0') } catch { /* abaikan */ } return n })

  // Lampiran yang belum terkirim milik percakapan sebelumnya tidak boleh ikut ke percakapan lain.
  useEffect(() => {
    if (convIdRef.current !== (conv?.id ?? null)) { convIdRef.current = conv?.id ?? null; att.clear(); setMissionNote(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.id])

  // Health check nyata saat mount — pill status mencerminkan kondisi server, bukan angan-angan.
  useEffect(() => {
    let alive = true
    fetch('/api/health')
      .then(r => r.json())
      .then((d: { configured?: boolean }) => {
        if (!alive) return
        setProvider(p => p.state === 'unknown' && !d.configured
          ? { state: 'unconfigured', detail: 'Server berjalan tanpa kredensial provider.' } : p)
      })
      .catch(() => {
        if (alive) setProvider(p => p.state === 'unknown'
          ? { state: 'unconfigured', detail: unreachableMessage() } : p)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [conv?.messages.length, streaming])

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'
  }, [composer])

  function historyFrom(messages: Message[], extraUser?: string, extraFileIds?: string[]): ChatMsg[] {
    const base: ChatMsg[] = messages.filter(m => m.status !== 'error' && m.content).slice(-20)
      .map(m => ({ role: m.role, content: m.content, ...(m.attachments?.length ? { fileIds: m.attachments.map(a => a.fileId) } : {}) }))
    const hist: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT + memoryPrompt() }, ...base]
    if (extraUser) hist.push({ role: 'user', content: extraUser, ...(extraFileIds?.length ? { fileIds: extraFileIds } : {}) })
    return hist
  }

  async function runGeneration(convId: string, history: ChatMsg[], userMsgId?: string, userAtts?: MsgAttachment[]) {
    const aiId = onAddMessage(convId, { role: 'assistant', content: '', status: 'sending' })
    const ac = new AbortController()
    abortRef.current = ac
    setStreaming(true)
    try {
      const reply = await sendChat(history, ac.signal, { useKnowledge: useKb && kbDocs > 0 })
      onUpdateMessage(convId, aiId, { content: reply.content, status: 'done', ...(reply.sources?.length ? { sources: reply.sources } : {}), ...(reply.route ? { route: reply.route } : {}) })
      // Status lampiran berasal dari laporan server: 'analyzed' hanya jika isinya benar-benar dikirim ke model.
      if (userMsgId && userAtts?.length && reply.attachments) {
        const byId = new Map(reply.attachments.map(r => [r.id, r]))
        onUpdateMessage(convId, userMsgId, { attachments: userAtts.map(a => {
          const r = byId.get(a.fileId)
          return r ? { ...a, state: r.used ? 'analyzed' : 'not_readable', ...(r.used ? {} : { reason: r.reason }) } as MsgAttachment : a
        }) })
      }
      setProvider({ state: 'ok', model: reply.model })
      onActivity(reply.model ? `Respons diterima (${reply.model})` : 'Respons diterima')
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onDeleteMessage(convId, aiId)
        onActivity('Pembuatan respons dihentikan')
      } else if (err instanceof ProviderNotConfigured) {
        onUpdateMessage(convId, aiId, { status: 'error', error: err.message })
        setProvider({ state: 'unconfigured', detail: err.message })
        onActivity('Provider belum dikonfigurasi')
      } else {
        const msg = err instanceof Error ? err.message : 'Kesalahan tak diketahui'
        onUpdateMessage(convId, aiId, { status: 'error', error: msg })
        setProvider({ state: 'error', detail: msg })
        onActivity('Gagal memanggil provider')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  // ---- Chat → Misi (jembatan satu arah ke Mission Engine yang sudah ada) ----
  // Syarat jujur: tepat satu lampiran tabular yang "ready" (isi benar-benar terbaca),
  // tujuan diambil dari teks composer (min. 5 karakter, divalidasi ulang oleh server).
  // Misi dibuat sebagai Draft — TIDAK dieksekusi otomatis; eksekusi tetap butuh persetujuan.
  const tabularAtt = att.items.find(i => i.category === 'data' && i.stage === 'ready' && i.fileId)

  async function createMissionFromChat(a: Att) {
    const goal = composer.trim()
    if (goal.length < 5) {
      setMissionNote({ kind: 'err', text: 'Tulis dulu tujuan analisis (minimal 5 karakter) di composer, lalu jadikan misi.' })
      return
    }
    setCreatingMission(true)
    try {
      const m = await api.createMission(goal, a.fileId as string)
      att.remove(a.key)
      setComposer('')
      setMissionNote({ kind: 'ok', text: `Misi dibuat: "${m.title}" — status Draft, menunggu persetujuan Anda; tidak dieksekusi otomatis.` })
      onActivity(`Misi dibuat dari chat: ${m.title}`)
    } catch (e) {
      setMissionNote({ kind: 'err', text: e instanceof Error ? e.message : 'Gagal membuat misi.' })
    } finally {
      setCreatingMission(false)
    }
  }

  async function sendText(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming || trimmed.length > MAX_CHARS || att.busy) return
    const sendable = att.items.filter(i => i.fileId && (i.stage === 'ready' || i.stage === 'stored'))
    const msgAtts: MsgAttachment[] = sendable.map(i => ({ fileId: i.fileId as string, name: i.name, category: i.category, state: 'sent' }))
    setComposer('')
    const convId = conv?.id ?? onCreateConversation()
    const history = historyFrom(conv?.messages ?? [], trimmed, msgAtts.map(a => a.fileId))
    const userMsgId = onAddMessage(convId, { role: 'user', content: trimmed, status: 'done', ...(msgAtts.length ? { attachments: msgAtts } : {}) })
    att.clear()
    onActivity(msgAtts.length ? `Pesan dikirim dengan ${msgAtts.length} lampiran` : 'Pesan dikirim')
    await runGeneration(convId, history, userMsgId, msgAtts)
  }

  function retryAssistant(msgId: string) {
    if (!conv || streaming) return
    onDeleteMessage(conv.id, msgId)
    onActivity('Respons dicoba ulang')
    const lastUser = [...conv.messages].reverse().find(m => m.role === 'user')
    void runGeneration(conv.id, historyFrom(conv.messages), lastUser?.id, lastUser?.attachments)
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229) return  // IME-safe (keyCode 229 = Safari/WebKit)
    e.preventDefault()
    void sendText(composer)
  }

  function onPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (!files.length) return
    e.preventDefault()  // gambar/file yang ditempel menjadi lampiran, bukan teks
    att.addFiles(files)
  }
  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const dnd = {
    onDragEnter: (e: ReactDragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true) },
    onDragOver: (e: ReactDragEvent) => { if (hasFiles(e)) e.preventDefault() },
    onDragLeave: (e: ReactDragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) },
    onDrop: (e: ReactDragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false); att.addFiles(Array.from(e.dataTransfer.files)) },
  }
  const addStored = useCallback(att.addStored, [att.addStored])

  const pill =
    provider.state === 'ok' ? { cls: 'ok', label: `Terhubung${provider.model ? ` · ${provider.model}` : ''}` } :
    provider.state === 'unconfigured' ? { cls: 'warn', label: 'Provider belum dikonfigurasi' } :
    provider.state === 'error' ? { cls: 'err', label: 'Provider error' } :
    { cls: '', label: 'Provider: belum diverifikasi' }

  const hasMessages = !!conv && conv.messages.length > 0

  return (
    <>
      <header className="chat-header">
        <div className="header-left">
          <button type="button" className="icon-btn" onClick={props.onToggleLeft}
            aria-expanded={!props.leftCollapsed} aria-controls="left-sidebar"
            title={props.leftCollapsed ? 'Buka sidebar kiri' : 'Tutup sidebar kiri'}>
            <Icon name="menu" size={18} />
            <span className="sr-only">Menu utama</span>
          </button>
          <div className="header-title">
            <strong>{conv?.title ?? 'Chat Baru'}</strong>
            <span className={cx('pill', pill.cls)}>{pill.label}</span>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={props.onToggleRight}
          aria-expanded={!props.rightCollapsed} aria-controls="right-sidebar"
          title={props.rightCollapsed ? 'Buka panel konteks' : 'Tutup panel konteks'}>
          <Icon name="panel" size={18} />
          <span className="sr-only">Panel konteks</span>
        </button>
      </header>

      {!hasMessages ? (
        <div className="welcome">
          <DuduMark size={96} />
          <h1>Halo! Saya Dudu.</h1>
          <p className="sub">Apa yang ingin kita selesaikan hari ini?</p>
          <div className="starters">
            {STARTERS.map(s => (
              <button type="button" key={s} className="starter"
                onClick={() => { setComposer(s); taRef.current?.focus() }}>{s}</button>
            ))}
          </div>
          {provider.state !== 'ok' && (
            <p className="local-note">
              Mode lokal: percakapan tersimpan di perangkat ini (bukan cloud), dan respons model belum aktif
              sampai provider dikonfigurasi (DUDU_PROVIDER_API_KEY). Tidak ada respons palsu yang ditampilkan.
            </p>
          )}
        </div>
      ) : (
        <div className="chat-scroll">
          <div className="chat-col">
            {conv!.messages.map(m => (
              <MessageRow key={m.id} msg={m} onRetry={() => retryAssistant(m.id)} />
            ))}
            <div ref={endRef} />
          </div>
        </div>
      )}

      <div className={cx('composer-zone', dragging && 'dragging')} {...dnd}>
        {dragging && <div className="drop-hint" role="status">Lepas file di sini untuk melampirkan</div>}
        {missionNote && (
          <div className={cx('mission-note', missionNote.kind)} role="status">
            <span className="mission-note-text">{missionNote.text}</span>
            <span className="mission-note-actions">
              {missionNote.kind === 'ok' && props.onNavigate && (
                <button type="button" className="chip-btn" onClick={() => { props.onNavigate?.('missions'); setMissionNote(null) }}>Buka Misi &amp; Tugas</button>
              )}
              <button type="button" className="icon-btn" aria-label="Tutup pesan" onClick={() => setMissionNote(null)}>
                <Icon name="x" size={12} /><span className="sr-only">Tutup pesan</span>
              </button>
            </span>
          </div>
        )}
        {picker && <StoredFilePicker onPick={addStored} onClose={() => setPicker(false)} />}
        <div className="composer-box">
          <AttachmentTray items={att.items} notices={att.notices} onRemove={att.remove} onDismiss={att.dismissNotices} />
          <textarea id="composer" ref={taRef} value={composer} rows={1}
            onChange={e => setComposer(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            placeholder="Tulis pesan untuk Dudu…"
            aria-label="Pesan untuk Dudu"
            maxLength={MAX_CHARS} />
          <div className="composer-tools">
            <AttachButton caps={caps} disabled={streaming} onFiles={att.addFiles} onPickStored={() => setPicker(true)} />
            {tabularAtt && (
              <button type="button" className="chip-toggle"
                disabled={creatingMission || att.busy || streaming || composer.trim().length < 5}
                title="Buat misi analisis data dari teks composer + lampiran tabular ini. Misi berstatus Draft dan menunggu persetujuan Anda — tidak dieksekusi otomatis."
                onClick={() => void createMissionFromChat(tabularAtt)}>
                <Icon name="target" size={14} /> {creatingMission ? 'Membuat misi…' : 'Jadikan Misi Analisis Data'}
              </button>
            )}
            {kbDocs > 0 && (
              <button type="button" className={cx('chip-toggle', useKb && 'on')} aria-pressed={useKb} onClick={toggleKb}
                title="Cari di Knowledge Base (kecocokan kata kunci) dan sertakan hasilnya sebagai konteks">
                <Icon name="book" size={14} /> Knowledge Base: {useKb ? 'aktif' : 'mati'}
              </button>
            )}
            <span className="tools-spacer" />
            <button type="button" className="icon-btn" disabled
              title="Rekam suara belum tersedia: butuh layanan transkripsi dan UI rekaman yang belum diimplementasikan">
              <Icon name="mic" size={17} />
              <span className="sr-only">Rekam suara (belum tersedia)</span>
            </button>
            {streaming ? (
              <button type="button" className="btn-stop" onClick={() => abortRef.current?.abort()}>
                <Icon name="stop" size={14} /> Hentikan
              </button>
            ) : (
              <button type="button" className="btn-send" onClick={() => void sendText(composer)}
                disabled={!composer.trim() || att.busy} title={att.busy ? 'Tunggu unggahan selesai' : 'Kirim (Enter)'}>
                <Icon name="send" size={16} />
                <span className="sr-only">Kirim pesan</span>
              </button>
            )}
          </div>
        </div>
        <div className="composer-foot">
          <span>Enter untuk kirim · Shift+Enter baris baru</span>
          {composer.length > 7000 && (
            <span className={cx('char-count', composer.length >= MAX_CHARS && 'over')}>
              {composer.length}/{MAX_CHARS}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

/* ---------- Pesan & Markdown minimal ---------- */

function MessageRow({ msg, onRetry }: { msg: Message; onRetry: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard tidak tersedia di lingkungan ini */ }
  }

  if (msg.role === 'user') {
    return (
      <div className="msg-row user">
        <div className="msg user-msg">
          <div className="msg-text">{renderContent(msg.content)}</div>
          {msg.attachments && msg.attachments.length > 0 && (
            <ul className="msg-atts" aria-label="Lampiran">
              {msg.attachments.map(a => (
                <li key={a.fileId} className={cx('msg-att', a.state)} title={a.reason}>
                  <Icon name="file" size={13} /> <span className="att-name">{a.name}</span>
                  <span className="att-state">{a.state === 'analyzed' ? 'dianalisis' : a.state === 'not_readable' ? `tidak terbaca${a.reason ? `: ${a.reason}` : ''}` : 'terkirim'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="msg-meta">{timeAgo(msg.createdAt)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="msg-row assistant">
      <DuduMark size={28} />
      <div className="msg assistant-msg">
        {msg.status === 'sending' ? (
          <div className="typing" role="status" aria-label="Dudu sedang mengetik"><span /><span /><span /></div>
        ) : msg.status === 'error' ? (
          <div className="msg-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{msg.error}</span>
            <button type="button" className="link-btn" onClick={onRetry}>
              <Icon name="retry" size={13} /> Coba lagi
            </button>
          </div>
        ) : (
          <>
            <div className="msg-text">{renderContent(msg.content)}</div>
            {msg.sources && msg.sources.length > 0 && (
              <div className="msg-sources" aria-label="Sumber">
                <strong>Sumber Knowledge Base</strong>
                <ul>{msg.sources.map(src => <li key={src.n}>[S{src.n}] {src.name}{src.loc ? ` (${src.loc})` : ''}</li>)}</ul>
              </div>
            )}
            {msg.content && (
              <div className="msg-actions">
                <button type="button" className="chip-btn" onClick={copy}>
                  <Icon name="copy" size={13} /> {copied ? 'Tersalin' : 'Salin'}
                </button>
              </div>
            )}
            {msg.route && <RouteChip route={msg.route} />}
          </>
        )}
      </div>
    </div>
  )
}

/** Chip rute dari server yang menunjukkan provider/model mana yang benar-benar dipakai (bukan tebakan UI). */
function RouteChip({ route }: { route: ModelRoute }) {
  const detailParts = [
    `${route.providerId}/${route.modelId}`,
    `tier: ${route.tier}${route.tier === 'unknown' ? ' (tidak diketahui)' : ''}`,
    `mode: ${route.mode}`,
    route.usageProvenance === 'ESTIMATED' ? 'token: estimasi lokal (chars/4)' : 'token: dilaporkan provider',
    ...(route.escalationReason ? [`eskalasi: ${route.escalationReason}`] : []),
    ...(route.fallback?.length ? [`fallback: ${route.fallback.join(' | ')}`] : []),
    ...(route.budget && route.budget.state !== 'unset' ? [`anggaran: ${route.budget.state}`] : []),
  ]
  const label = route.estimated
    ? `${route.providerId}/${route.modelId} · ${route.tier === 'unknown' ? 'tier ?' : route.tier}`
    : `${route.providerId}/${route.modelId} · ${route.tier}`
  return (
    <div className="msg-route" title={detailParts.join(' — ')}>
      <span className={cx('pill', route.tier === 'free' ? 'ok' : route.tier === 'paid' ? 'warn' : route.tier === 'local' ? 'ok' : '')}>
        {label}
      </span>
      {route.estimated && (
        <span className="meta">pemakaian token = estimasi lokal, bukan angka provider</span>
      )}
    </div>
  )
}

function inlineTokens(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Order matters: strikethrough and bold must be matched before single *emphasis*.
  const re = /(~~[^~\n]+~~|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyBase}-${i++}`

    if (token.startsWith('~~')) {
      out.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('`')) {
      out.push(<code key={key} className="inline-code">{token.slice(1, -1)}</code>)
    } else {
      out.push(<a key={key} href={token} target="_blank" rel="noreferrer">{token}</a>)
    }
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type ListEntry = { depth: number; ordered: boolean; text: string }

function TextBlock({ text, k }: { text: string; k: string }) {
  const nodes: ReactNode[] = []
  // Repair providers that flatten a Markdown table into a single line.
  const lines = text.split('\n').flatMap((rawLine) => {
    const line = rawLine.trim()
    if (!line.includes('|') || !/\|\s*:?-{3,}:?\s*\|/.test(line)) return [rawLine]
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
    const separatorAt = cells.findIndex(cell => /^:?-{3,}:?$/.test(cell))
    if (separatorAt < 0) return [rawLine]
    let columnCount = 0
    for (let j = separatorAt; j < cells.length && /^:?-{3,}:?$/.test(cells[j]); j++) columnCount++
    if (columnCount < 2) return [rawLine]
    const hasHeaders = separatorAt >= columnCount
    const headers = hasHeaders ? cells.slice(separatorAt - columnCount, separatorAt) : []
    const data = cells.slice(separatorAt + columnCount)
    if (data.length < columnCount) return [rawLine]
    const effectiveHeaders = headers.length === columnCount ? headers : Array.from({ length: columnCount }, (_, index) => `Kolom ${index + 1}`)
    const tableLines = [`| ${effectiveHeaders.join(' | ')} |`, `| ${effectiveHeaders.map(() => '---').join(' | ')} |`]
    for (let j = 0; j + columnCount <= data.length; j += columnCount) tableLines.push(`| ${data.slice(j, j + columnCount).join(' | ')} |`)
    return tableLines
  })

  let paragraph: string[] = []
  let list: ListEntry[] = []
  let i = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    const content = paragraph.join(' ').trim()
    if (content) nodes.push(<p key={`${k}-p${i++}`}>{inlineTokens(content, `${k}-inline${i}`)}</p>)
    paragraph = []
  }

  const renderListTree = (entries: ListEntry[]): ReactNode[] => {
    const renderLevel = (start: number, depth: number, ordered: boolean, key: string): { node: ReactNode; next: number } => {
      const children: ReactNode[] = []
      let index = start
      while (index < entries.length) {
        const entry = entries[index]
        if (entry.depth < depth) break
        if (entry.depth > depth) {
          const nested = renderLevel(index, depth + 1, entries[index].ordered, `${key}-nested${index}`)
          if (children.length) {
            const last = children.pop() as ReactElement
            children.push(cloneElement(last, { children: <>{last.props.children}{nested.node}</> }))
          }
          index = nested.next
          continue
        }
        if (entry.ordered !== ordered) break
        children.push(<li key={`${key}-li${index}`}>{inlineTokens(entry.text, `${key}-text${index}`)}</li>)
        index++
        if (index < entries.length && entries[index].depth > depth) {
          const nested = renderLevel(index, depth + 1, entries[index].ordered, `${key}-nested${index}`)
          const last = children.pop() as ReactElement
          children.push(cloneElement(last, { children: <>{last.props.children}{nested.node}</> }))
          index = nested.next
        }
      }
      const Tag = ordered ? 'ol' : 'ul'
      return { node: <Tag key={key}>{children}</Tag>, next: index }
    }
    const result: ReactNode[] = []
    let index = 0
    while (index < entries.length) {
      const depth = entries[index].depth
      const ordered = entries[index].ordered
      const rendered = renderLevel(index, depth, ordered, `${k}-list${i++}`)
      result.push(rendered.node)
      if (rendered.next <= index) index++
      else index = rendered.next
    }
    return result
  }

  const flushList = () => {
    if (!list.length) return
    nodes.push(...renderListTree(list))
    list = []
  }

  const isTableRow = (line: string) => line.includes('|') && line.trim().split('|').length >= 3
  const parseCells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
  const isSeparatorRow = (line: string): boolean => {
    const cells = parseCells(line)
    return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
  }

  while (i < lines.length) {
    const line = lines[i].trim()
    if (isTableRow(line) && i + 1 < lines.length && isTableRow(lines[i + 1].trim()) && isSeparatorRow(lines[i + 1].trim())) {
      flushParagraph(); flushList()
      const headers = parseCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i].trim()) && !isSeparatorRow(lines[i].trim())) {
        rows.push(parseCells(lines[i])); i++
      }
      nodes.push(<div className="markdown-table-wrap" key={`${k}-table${i}`}><table className="markdown-table"><thead><tr>{headers.map((cell, index) => <th key={index}>{inlineTokens(cell, `${k}-th${index}`)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, colIndex) => <td key={colIndex}>{inlineTokens(row[colIndex] ?? '', `${k}-td${rowIndex}-${colIndex}`)}</td>)}</tr>)}</tbody></table></div>)
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph(); flushList()
      const level = heading[1].length
      const content = inlineTokens(heading[2], `${k}-heading${i}`)
      if (level === 1) nodes.push(<h2 key={`${k}-h${i}`}>{content}</h2>)
      else if (level === 2) nodes.push(<h3 key={`${k}-h${i}`}>{content}</h3>)
      else nodes.push(<h4 key={`${k}-h${i}`}>{content}</h4>)
      i++; continue
    }

    if (/^(---+|\*\*\*+|___+)$/.test(line)) {
      flushParagraph(); flushList()
      nodes.push(<hr key={`${k}-hr${i}`} />)
      i++; continue
    }

    const bullet = line.match(/^([ \t]*)([-*+])\s+(.+)$/)
    const numbered = line.match(/^([ \t]*)(\d+)[.)]\s+(.+)$/)
    if (bullet || numbered) {
      flushParagraph()
      const match = (bullet || numbered)!
      const indent = match[1].replace(/\t/g, '  ').length
      const depth = Math.floor(indent / 2)
      list.push({ depth, ordered: !!numbered, text: numbered ? numbered[3] : bullet![3] })
      i++; continue
    }

    if (!line) { flushParagraph(); flushList(); i++; continue }
    flushList(); paragraph.push(line); i++
  }
  flushParagraph(); flushList()
  return <>{nodes}</>
}

function renderContent(content: string): ReactNode {
  if (!content) return null

  const normalized = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;br\s*\/?&gt;/gi, '\n')
    .replace(/\r\n?/g, '\n')

  return (
    <>
      {normalized.split('```').map((part, index) => {
        if (index % 2 === 1) {
          const newline = part.indexOf('\n')
          const language =
            newline > -1 ? part.slice(0, newline).trim() : ''
          const code =
            newline > -1 ? part.slice(newline + 1) : part

          return (
            <pre
              key={index}
              className="code-block"
              tabIndex={0}
            >
              {language && (
                <span className="code-lang">{language}</span>
              )}
              <code>{code.replace(/\n+$/, '')}</code>
            </pre>
          )
        }

        return (
          <TextBlock
            key={index}
            text={part}
            k={`block${index}`}
          />
        )
      })}
    </>
  )
}
