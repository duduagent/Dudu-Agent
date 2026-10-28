import { useEffect, useState, type DragEvent } from 'react'
import { api, type FileMeta } from '../../lib/api'
import { useAttachments } from '../../lib/attachments'
import { useLoad } from '../../lib/useLoad'
import { cx } from '../../lib/util'
import { AttachmentTray, fmtSize } from '../Attachments'
import { Icon } from '../ui'
import { PageShell, StateMsg, fmtDate } from './PageShell'

const CAT: Record<string, string> = { document: 'Dokumen', image: 'Gambar', audio: 'Audio', video: 'Video', data: 'Data', archive: 'Arsip', code: 'Kode/Teks', other: 'Lainnya' }
const EX: Record<string, string> = { extracted: 'Teks terbaca', unsupported: 'Tidak dapat dibaca', failed: 'Ekstraksi gagal', not_applicable: 'Bukan teks' }

export function FilesPage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity: (m: string) => void }) {
  const files = useLoad(api.listFiles)
  const missions = useLoad(api.missions)
  const caps = useLoad(api.capabilities)
  const att = useAttachments(20, caps.data?.limits.maxUploadBytes ?? 25 * 1024 * 1024)
  const [drag, setDrag] = useState(false)
  const [preview, setPreview] = useState<{ id: string; text: string | null; err?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const done = att.items.filter(i => i.stage === 'ready' || i.stage === 'stored')
    if (done.length) { done.forEach(d => att.remove(d.key)); files.reload(); onActivity(`${done.length} file diunggah`) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.items])

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); att.addFiles(Array.from(e.dataTransfer.files)) }

  async function del(f: FileMeta) {
    if (!window.confirm(`Hapus "${f.name}" secara permanen? File juga dikeluarkan dari Knowledge Base.`)) return
    setBusy(f.id)
    try { await api.deleteFile(f.id); setMsg({ ok: true, text: `"${f.name}" dihapus.` }); onActivity(`File dihapus: ${f.name}`); files.reload() }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gagal menghapus.' }) } finally { setBusy(null) }
  }
  async function toKb(f: FileMeta) {
    setBusy(f.id)
    try { const r = await api.kbIndex(f.id); setMsg({ ok: true, text: `"${f.name}" diindeks: ${r.chunks} potongan.` }); onActivity(`Diindeks ke Knowledge Base: ${f.name}`) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gagal mengindeks.' }) } finally { setBusy(null) }
  }
  async function togglePreview(f: FileMeta) {
    if (preview?.id === f.id) return setPreview(null)
    try { const r = await api.fileText(f.id); setPreview({ id: f.id, text: r.text }) } catch (e) { setPreview({ id: f.id, text: null, err: e instanceof Error ? e.message : 'Gagal memuat.' }) }
  }

  const artifacts = (missions.data ?? []).filter(m => m.artifacts.length)

  return (
    <PageShell title="Files & Artifacts" subtitle="File yang Anda unggah dan artefak hasil misi — tersimpan lokal di perangkat ini." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}
      actions={<label className="btn-primary"><Icon name="upload" size={14} /> Unggah file
        <input type="file" multiple hidden data-testid="files-input" onChange={e => { att.addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} /></label>}>
      <div className={cx('dropzone', drag && 'over')} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        Tarik dan lepas file di sini, atau gunakan tombol Unggah. Batas {Math.round((caps.data?.limits.maxUploadBytes ?? 26214400) / 1048576)} MB per file.
      </div>
      <AttachmentTray items={att.items} notices={att.notices} onRemove={att.remove} onDismiss={att.dismissNotices} />
      {msg && <p className={cx('notice', msg.ok ? 'ok' : 'err')} role={msg.ok ? 'status' : 'alert'}><span className="notice-body">{msg.text}</span></p>}

      <section className="panel" aria-labelledby="files-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="files-title">File</h2>
            <p className="panel-sub">Berkas yang tersimpan di perangkat ini. Status “Siap untuk AI” berarti isinya benar-benar bisa dibaca model.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{files.data?.length ?? 0} file</span>
            <span className="pill ok">{files.data?.filter((f) => f.readiness.ready).length ?? 0} siap untuk AI</span>
          </div>
        </div>
        <StateMsg loading={files.loading && !files.data} error={files.error} onRetry={files.reload} />
        {files.data?.length === 0 && (
          <div className="empty-state">
            <p>Belum ada file. Unggah dokumen, gambar, audio, atau data untuk mulai — semua diproses di perangkat ini.</p>
          </div>
        )}
        <ul className="cards">
        {files.data?.map(f => (
          <li key={f.id} className="card">
            <div className="card-main">
              {f.category === 'image' && f.kind !== 'svg'
                ? <img className="thumb" src={api.fileUrl(f.id, true)} alt={`Pratinjau ${f.name}`} loading="lazy" />
                : <span className="thumb ph" aria-hidden="true"><Icon name="file" size={20} /></span>}
              <div className="card-text">
                <strong title={f.name}>{f.name}</strong>
                <span className="meta">{CAT[f.category]} · {fmtSize(f.size)} · {fmtDate(f.createdAt)}{f.extraction.pages ? ` · ${f.extraction.pages} hal./slide/sheet` : ''}{f.image ? ` · ${f.image.width}×${f.image.height}` : ''}</span>
                <span className="statusline">
                  <span className={cx('pill', f.extraction.state === 'extracted' ? 'ok' : f.extraction.state === 'failed' ? 'err' : 'warn')}>{EX[f.extraction.state]}</span>
                  <span className={cx('pill', f.readiness.ready ? 'ok' : 'warn')}>{f.readiness.ready ? 'Siap untuk AI' : 'Belum dapat dipahami AI'}</span>
                </span>
                {(f.extraction.note || f.readiness.reason) && !f.readiness.ready && <span className="meta">{f.readiness.reason ?? f.extraction.note}</span>}
                {f.extraction.note && f.readiness.ready && <span className="meta">{f.extraction.note}</span>}
              </div>
            </div>
            <div className="card-actions">
              {f.extraction.state === 'extracted' && <button type="button" className="chip-btn" onClick={() => void togglePreview(f)} aria-expanded={preview?.id === f.id}>Lihat teks</button>}
              {f.extraction.state === 'extracted' && <button type="button" className="chip-btn" disabled={busy === f.id} onClick={() => void toKb(f)}>Tambah ke Knowledge Base</button>}
              <a className="chip-btn" href={api.fileUrl(f.id)} download={f.name}><Icon name="download" size={12} /> Unduh</a>
              <button type="button" className="chip-btn danger" disabled={busy === f.id} onClick={() => void del(f)} aria-label={`Hapus ${f.name}`}><Icon name="trash" size={12} /> Hapus</button>
            </div>
            {preview?.id === f.id && <pre className="preview" aria-label={`Teks ${f.name}`}>{preview.err ?? (preview.text ? preview.text : '(kosong)')}</pre>}
          </li>
        ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="artifacts-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="artifacts-title">Artefak misi</h2>
            <p className="panel-sub">Berkas hasil eksekusi misi — laporan dan profil data, lengkap dengan checksum SHA-256.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{artifacts.reduce((n, m) => n + m.artifacts.length, 0)} artefak</span>
          </div>
        </div>
        {artifacts.length === 0 && <div className="empty-state"><h3>Belum ada artefak</h3><p>Artefak muncul setelah misi dijalankan di Misi &amp; Tugas.</p></div>}
        <ul className="cards">
          {artifacts.map(m => (
            <li key={m.id} className="card">
              <div className="card-text"><strong>{m.title}</strong><span className="meta">Misi {m.state === 'completed' ? 'selesai' : m.state} · {fmtDate(m.updatedAt)}</span></div>
              <div className="card-actions">
                {m.artifacts.map(a => <a key={a.name} className="chip-btn" href={api.artifactUrl(m.id, a.name)} download={a.name}><Icon name="download" size={12} /> {a.name} ({fmtSize(a.size)})</a>)}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  )
}
