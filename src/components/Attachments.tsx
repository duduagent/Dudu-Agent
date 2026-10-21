import { useEffect, useRef, useState } from 'react'
import { api, type Capabilities, type FileMeta } from '../lib/api'
import type { Att } from '../lib/attachments'
import { cx } from '../lib/util'
import { Icon } from './ui'

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

const ACCEPT = {
  documents: '.pdf,.docx,.pptx,.xlsx,.odt,.ods,.odp,.rtf,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.html',
  images: 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif',
  audio: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac',
  video: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm',
  other: '',
} as const
type Kind = keyof typeof ACCEPT

export function AttachButton({ caps, disabled, onFiles, onPickStored }: {
  caps: Capabilities | null; disabled?: boolean; onFiles: (f: File[]) => void; onPickStored: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  function choose(kind: Kind) {
    const input = inputRef.current
    if (!input) return
    if (ACCEPT[kind]) input.setAttribute('accept', ACCEPT[kind]); else input.removeAttribute('accept')
    setOpen(false)
    input.click()
  }

  const items: Array<{ kind: Kind; label: string; note?: string }> = [
    { kind: 'documents', label: 'Dokumen', note: 'PDF, Word, Excel, PowerPoint, ODF, teks' },
    { kind: 'images', label: 'Gambar', note: caps && !caps.vision.configured ? 'hanya disimpan — model vision belum dikonfigurasi' : 'PNG, JPG, WEBP, GIF' },
    { kind: 'audio', label: 'Audio', note: caps && !caps.stt.configured ? 'hanya disimpan — transkripsi belum dikonfigurasi' : 'MP3, WAV, M4A, OGG' },
    { kind: 'video', label: 'Video', note: 'hanya disimpan — pemrosesan video belum tersedia' },
    { kind: 'other', label: 'Data, arsip & kode', note: 'CSV, JSON, ZIP, log, kode sumber' },
  ]

  return (
    <div className="attach-wrap" ref={wrapRef}>
      <input ref={inputRef} type="file" multiple hidden data-testid="file-input" aria-hidden="true" tabIndex={-1}
        onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = '' }} />
      <button type="button" className="icon-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        title="Lampirkan file" onClick={() => setOpen(o => !o)}>
        <Icon name="paperclip" size={17} />
        <span className="sr-only">Lampirkan file</span>
      </button>
      {open && (
        <div className="attach-menu" role="menu" aria-label="Jenis lampiran">
          {items.map(it => (
            <button key={it.kind} type="button" role="menuitem" className="attach-item" onClick={() => choose(it.kind)}>
              <strong>{it.label}</strong>{it.note && <span>{it.note}</span>}
            </button>
          ))}
          <button type="button" role="menuitem" className="attach-item" onClick={() => { setOpen(false); onPickStored() }}>
            <strong>Dari Files &amp; Artifacts</strong><span>Pilih file yang sudah tersimpan</span>
          </button>
        </div>
      )}
    </div>
  )
}

const STAGE_LABEL = (a: Att) =>
  a.stage === 'selected' ? 'Dipilih' :
  a.stage === 'uploading' ? (a.progress >= 0 ? `Mengunggah ${a.progress}%` : 'Mengunggah…') :
  a.stage === 'ready' ? (a.category === 'image' ? 'Siap untuk AI (vision)' : 'Siap untuk AI') :
  a.stage === 'stored' ? `Tersimpan, belum dapat dibaca AI: ${a.note ?? ''}` :
  `Gagal: ${a.note ?? ''}`

export function AttachmentTray({ items, notices, onRemove, onDismiss }: {
  items: Att[]; notices: string[]; onRemove: (key: string) => void; onDismiss: () => void
}) {
  if (!items.length && !notices.length) return null
  return (
    <div className="att-tray" aria-label="Lampiran pesan">
      {notices.length > 0 && (
        <div className="att-notice" role="alert">
          <span>{notices.join(' ')}</span>
          <button type="button" className="link-btn" onClick={onDismiss}>Tutup</button>
        </div>
      )}
      <ul className="att-list">
        {items.map(a => (
          <li key={a.key} className={cx('att-chip', `stage-${a.stage}`)} data-stage={a.stage}>
            {a.previewUrl
              ? <img className="att-thumb" src={a.previewUrl} alt={`Pratinjau ${a.name}`} />
              : <span className="att-icon" aria-hidden="true"><Icon name="file" size={16} /></span>}
            <span className="att-body">
              <span className="att-name" title={a.name}>{a.name}</span>
              <span className="att-status">{fmtSize(a.size)} · {STAGE_LABEL(a)}</span>
              {a.stage === 'uploading' && (
                <span className={cx('att-bar', a.progress < 0 && 'indeterminate')} role="progressbar" aria-label={`Progres unggah ${a.name}`}
                  {...(a.progress >= 0 ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': a.progress } : { 'aria-busy': true })}>
                  <span style={a.progress >= 0 ? { width: `${a.progress}%` } : undefined} />
                </span>
              )}
            </span>
            <button type="button" className="icon-btn sm" onClick={() => onRemove(a.key)}
              aria-label={a.stage === 'uploading' ? `Batalkan unggahan ${a.name}` : `Hapus lampiran ${a.name}`}>
              <Icon name="x" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StoredFilePicker({ onPick, onClose }: { onPick: (f: FileMeta) => void; onClose: () => void }) {
  const [files, setFiles] = useState<FileMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.listFiles().then(f => { if (alive) setFiles(f) }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Gagal memuat file.') })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="picker" role="dialog" aria-label="Pilih file tersimpan">
      <div className="picker-head"><strong>File tersimpan</strong><button type="button" className="link-btn" onClick={onClose}>Tutup</button></div>
      {error && <p className="state-msg error" role="alert">{error}</p>}
      {!error && files === null && <p className="state-msg" role="status">Memuat…</p>}
      {files?.length === 0 && <p className="state-msg">Belum ada file. Unggah lewat tombol lampiran atau halaman Files &amp; Artifacts.</p>}
      <ul className="picker-list">
        {files?.map(f => (
          <li key={f.id}>
            <button type="button" className="picker-row" onClick={() => { onPick(f); onClose() }}>
              <span className="att-name">{f.name}</span>
              <span className="att-status">{fmtSize(f.size)} · {f.readiness.ready ? 'Siap untuk AI' : 'Belum dapat dibaca AI'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
