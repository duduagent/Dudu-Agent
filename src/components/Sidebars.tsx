import { useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { STORAGE_NOTICE } from '../lib/storage'
import { useLoad } from '../lib/useLoad'
import type { ActivityEvent, Conversation, ViewId } from '../lib/types'
import { cx, timeAgo } from '../lib/util'
import { STATE_LABEL } from './pages/MissionsPage'
import { DuduMark, Icon, type IconName } from './ui'

/* ============================ SIDEBAR KIRI ============================ */

/** Menu dengan submenu nyata: setiap anak adalah halaman yang benar-benar ada (tidak ada anak kosong). */
const NAV: Array<{ id: ViewId; label: string; icon: IconName; children?: Array<{ id: ViewId; label: string }> }> = [
  { id: 'chat', label: 'Chat & Voice', icon: 'chat' },
  { id: 'missions', label: 'Misi & Tugas', icon: 'target' },
  { id: 'execution', label: 'Pusat Eksekusi', icon: 'terminal' },
  { id: 'workforce', label: 'Agent Workforce', icon: 'users' },
  { id: 'knowledge', label: 'Knowledge Base', icon: 'book', children: [
    { id: 'knowledge', label: 'Ringkasan & Cari' },
    { id: 'datainput', label: 'Input Data' },
  ] },
  { id: 'tools', label: 'Tools & Integrations', icon: 'plug', children: [
    { id: 'tools', label: 'Status Tools' },
    { id: 'skills', label: 'Skill' },
    { id: 'mcp', label: 'MCP' },
    { id: 'cli', label: 'CLI' },
    { id: 'plugins', label: 'Plugin' },
    { id: 'connectors', label: 'Connector' },
  ] },
  { id: 'files', label: 'Files & Artifacts', icon: 'folder' },
  { id: 'memory', label: 'Memory', icon: 'memory' },
  { id: 'settings', label: 'Pengaturan', icon: 'settings', children: [
    { id: 'settings', label: 'Gateway AI & Umum' },
    { id: 'account', label: 'Akun & Login' },
  ] },
]

interface LeftProps {
  collapsed: boolean
  onToggle: () => void
  view: ViewId
  onSelectView: (v: ViewId) => void
  conversations: Conversation[]
  activeId: string | null
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  user: { name: string; email: string; provider: string } | null
}

export function SidebarLeft(props: LeftProps) {
  const [q, setQ] = useState('')
  const sorted = [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  const filtered = sorted.filter(c => c.title.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <nav id="left-sidebar" className="sidebar sidebar-left" aria-label="Navigasi utama">
      <div className="side-head">
        <button type="button" className="brand" onClick={() => props.onSelectView('chat')} title="Beranda Dudu">
          <DuduMark size={30} />
          <span className="brand-text">
            <strong className="brand-name">Dudu</strong>
            <span className="brand-sub">AI Workforce & Agent OS</span>
          </span>
        </button>
        <button type="button" className="icon-btn collapse-btn" onClick={props.onToggle}
          aria-expanded={!props.collapsed} aria-controls="left-sidebar"
          title={props.collapsed ? 'Buka sidebar' : 'Tutup sidebar'}>
          <Icon name={props.collapsed ? 'chevronRight' : 'chevronLeft'} size={17} />
          <span className="sr-only">{props.collapsed ? 'Buka sidebar' : 'Tutup sidebar'}</span>
        </button>
      </div>

      <button type="button" className="new-chat" onClick={props.onNewChat} title="Mulai percakapan baru">
        <Icon name="plus" size={16} />
        <span className="nav-label">Chat Baru</span>
      </button>

      <ul className="nav-list" role="list">
        {NAV.map(item => (
          <li key={item.id}>
            {item.children ? (
              <NavGroup item={{ ...item, children: item.children }} view={props.view} onSelectView={props.onSelectView} />
            ) : (
              <button type="button" className={cx('nav-item', props.view === item.id && 'active')}
                aria-current={props.view === item.id ? 'page' : undefined}
                onClick={() => props.onSelectView(item.id)} title={item.label}>
                <Icon name={item.icon} size={17} />
                <span className="nav-label">{item.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {!props.collapsed && (
        <div className="conv-section">
          <div className="conv-search">
            <Icon name="search" size={13} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari percakapan…" aria-label="Cari percakapan" />
          </div>
          {filtered.length === 0 ? (
            <p className="conv-empty">Belum ada percakapan.</p>
          ) : (
            <ul className="conv-list" role="list">
              {filtered.map(c => (
                <ConvItem key={c.id} conv={c} active={c.id === props.activeId}
                  onSelect={() => props.onSelectConversation(c.id)}
                  onRename={props.onRename}
                  onDelete={() => props.onDelete(c.id)} />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="side-foot">
        <button type="button" className="user-chip" onClick={() => props.onSelectView('account')} title={props.user ? props.user.email : 'Daftar / Masuk'}>
          <span className="user-avatar" aria-hidden="true">{props.user ? (props.user.name[0] || 'A').toUpperCase() : 'L'}</span>
          <span className="user-meta">
            <strong className="user-name">{props.user ? props.user.name : 'Pengguna Lokal'}</strong>
            <span className="user-note" title={props.user ? `Masuk via ${props.user.provider} · ${props.user.email}` : STORAGE_NOTICE}>
              {props.user ? `${props.user.provider} · ${props.user.email}` : STORAGE_NOTICE}
            </span>
          </span>
        </button>
      </div>
    </nav>
  )
}

/** Grup navigasi dengan submenu: terbuka bila berisi view aktif; klik judul menuju halaman utamanya. */
function NavGroup({ item, view, onSelectView }: {
  item: { id: ViewId; label: string; icon: IconName; children: Array<{ id: ViewId; label: string }> }
  view: ViewId; onSelectView: (v: ViewId) => void
}) {
  const activeInside = item.children.some((c) => c.id === view)
  const [open, setOpen] = useState(activeInside)
  return (
    <>
      <button type="button" className={cx('nav-item nav-group', activeInside && 'active')}
        aria-expanded={open} title={item.label} aria-current={activeInside ? 'page' : undefined}
        onClick={() => { if (activeInside && open) setOpen(false); else { setOpen(true); onSelectView(item.id) } }}>
        <Icon name={item.icon} size={17} />
        <span className="nav-label">{item.label}</span>
        <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={12} />
      </button>
      {open && (
        <ul className="nav-sublist" role="list">
          {item.children.map((c) => (
            <li key={c.id}>
              <button type="button" className={cx('nav-item nav-sub', view === c.id && 'active')}
                aria-current={view === c.id ? 'page' : undefined}
                onClick={() => onSelectView(c.id)}>
                <span className="nav-label">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ConvItem({ conv, active, onSelect, onRename, onDelete }: {
  conv: Conversation; active: boolean; onSelect: () => void
  onRename: (id: string, title: string) => void; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conv.title)

  if (editing) {
    return (
      <li className="conv-item active">
        <input className="conv-edit" autoFocus value={draft} aria-label="Judul percakapan"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename(conv.id, draft); setEditing(false) }
            else if (e.key === 'Escape') { setDraft(conv.title); setEditing(false) }
          }}
          onBlur={() => { onRename(conv.id, draft); setEditing(false) }} />
      </li>
    )
  }

  return (
    <li className={cx('conv-item', active && 'active')}>
      <button type="button" className="conv-title" onClick={onSelect} title={conv.title}>{conv.title}</button>
      <span className="conv-meta">{timeAgo(conv.updatedAt)}</span>
      <span className="conv-acts">
        <button type="button" className="icon-btn" title="Ganti nama" aria-label={`Ganti nama: ${conv.title}`}
          onClick={() => { setDraft(conv.title); setEditing(true) }}>
          <Icon name="pencil" size={13} />
        </button>
        <button type="button" className="icon-btn" title="Hapus" aria-label={`Hapus: ${conv.title}`}
          onClick={() => { if (window.confirm(`Hapus percakapan "${conv.title}"?`)) onDelete() }}>
          <Icon name="x" size={13} />
        </button>
      </span>
    </li>
  )
}

/* ============================ SIDEBAR KANAN ============================ */
/* Semua data di sini adalah state nyata aplikasi atau status kosong yang JUJUR.
   Tidak ada agent/integrasi/misi palsu yang ditampilkan. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel-section"><h3>{title}</h3>{children}</section>
}

export function SidebarRight({ collapsed, onToggle, events }: {
  collapsed: boolean; onToggle: () => void; events: ActivityEvent[]
}) {
  // Data nyata dari server; disegarkan setiap ada aktivitas baru (misi dibuat/dijalankan, file diunggah, dll.).
  const missions = useLoad(api.missions, [events.length])
  const caps = useLoad(api.capabilities, [])
  const openMissions = (missions.data ?? []).filter(m => m.state !== 'completed')
  return (
    <aside id="right-sidebar" className="sidebar sidebar-right" aria-label="Panel konteks">
      <div className="panel-inner">
        <div className="side-head">
          <h2 className="panel-title">Ruang Konteks</h2>
          <button type="button" className="icon-btn collapse-btn" onClick={onToggle}
            aria-expanded={!collapsed} aria-controls="right-sidebar" title="Tutup panel konteks">
            <Icon name="chevronRight" size={17} />
            <span className="sr-only">Tutup panel konteks</span>
          </button>
        </div>
        <div className="panel-scroll">
          <Section title="Misi Aktif">
            {missions.error ? <p className="empty-note">Tidak dapat memuat misi (server tidak terjangkau).</p>
              : !missions.data ? <p className="empty-note" role="status">Memuat…</p>
              : openMissions.length === 0 ? <p className="empty-note">Belum ada misi aktif. Buat di Misi &amp; Tugas.</p>
              : <ul className="event-list" role="list" aria-label="Misi belum selesai">
                  {openMissions.slice(0, 4).map(m => <li key={m.id}><span className="event-msg">{m.title}</span><span className="event-time">{STATE_LABEL[m.state]}</span></li>)}
                </ul>}
            {missions.data && missions.data.length > 0 && <p className="meta">{missions.data.filter(m => m.state === 'completed').length} selesai · {missions.data.length} total</p>}
          </Section>
          <Section title="Status Agent">
            <p className="empty-note">Tersedia: Pelaksana Analisis Data (lokal, berbasis aturan). Agent eksternal atau agen otonom berbasis LLM: tidak terhubung.</p>
          </Section>
          <Section title="Tools & Integrations">
            {caps.error ? <p className="empty-note">Tidak dapat memuat status tool (server tidak terjangkau).</p>
              : !caps.data ? <p className="empty-note" role="status">Memuat…</p>
              : <ul className="event-list" role="list" aria-label="Ringkasan tool">
                  <li><span className="event-msg">Ekstraksi dokumen + analisis data + Knowledge Base (lokal)</span><span className="event-time">tersedia</span></li>
                  <li><span className="event-msg">Provider chat</span><span className="event-time">{caps.data.chat.configured ? 'dikonfigurasi' : 'belum'}</span></li>
                  <li><span className="event-msg">Vision (gambar)</span><span className="event-time">{caps.data.vision.configured ? 'dikonfigurasi' : 'belum diatur'}</span></li>
                  <li><span className="event-msg">Transkripsi audio</span><span className="event-time">{caps.data.stt.configured ? 'dikonfigurasi' : 'belum diatur'}</span></li>
                </ul>}
          </Section>
          <Section title="Aktivitas Terbaru">
            {events.length === 0 ? (
              <p className="empty-note">Belum ada aktivitas pada sesi ini.</p>
            ) : (
              <ul className="event-list" role="list">
                {events.slice(0, 6).map(ev => (
                  <li key={ev.id}>
                    <span className="event-msg">{ev.message}</span>
                    <time className="event-time">{timeAgo(ev.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </aside>
  )
}
