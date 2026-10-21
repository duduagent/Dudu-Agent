import { useState, type FormEvent } from 'react'
import { api, type KbHit } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { cx } from '../../lib/util'
import { PageShell, StateMsg, fmtDate } from './PageShell'

export function KnowledgePage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity: (m: string) => void }) {
  const kb = useLoad(api.kb)
  const files = useLoad(api.listFiles)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<KbHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  const indexed = new Set((kb.data?.docs ?? []).map(d => d.fileId))
  const candidates = (files.data ?? []).filter(f => f.extraction.state === 'extracted' && !indexed.has(f.id))

  async function add() {
    if (!pick) return
    setBusy(true); setMsg(null)
    try { const r = await api.kbIndex(pick); setMsg({ ok: true, text: `"${r.name}" diindeks: ${r.chunks} potongan.` }); setPick(''); kb.reload(); onActivity(`Diindeks ke Knowledge Base: ${r.name}`) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gagal mengindeks.' }) } finally { setBusy(false) }
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Keluarkan "${name}" dari Knowledge Base? File aslinya tidak dihapus.`)) return
    try { await api.kbRemove(id); kb.reload(); setHits(null); onActivity(`Dikeluarkan dari Knowledge Base: ${name}`) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gagal.' }) }
  }
  async function search(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setSearching(true); setMsg(null)
    try { setHits(await api.kbSearch(q)) } catch (err) { setHits(null); setMsg({ ok: false, text: err instanceof Error ? err.message : 'Pencarian gagal.' }) } finally { setSearching(false) }
  }

  return (
    <PageShell title="Knowledge Base" subtitle="Dokumen yang diindeks untuk dikutip Dudu di chat — lengkap dengan sumber." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <StateMsg loading={kb.loading && !kb.data} error={kb.error} onRetry={kb.reload} />
      {msg && <p className={cx('notice', msg.ok ? 'ok' : 'err')} role={msg.ok ? 'status' : 'alert'}><span className="notice-body">{msg.text}</span></p>}

      <section className="panel" aria-labelledby="kb-index-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="kb-index-title">Dokumen terindeks</h2>
            <p className="panel-sub">Setiap dokumen dipecah menjadi potongan dan dicari dengan pencocokan kata kunci (BM25) — bukan embedding semantik. Aktifkan “Knowledge Base” di composer chat agar hasilnya ikut dikirim ke model.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{kb.data?.docs.length ?? 0} dokumen</span>
            <span className="pill neutral">{kb.data?.chunks ?? 0} potongan</span>
          </div>
        </div>

        {kb.data?.docs.length === 0 && (
          <div className="empty-state">
            <h3>Knowledge Base masih kosong</h3>
            <p>Unggah file di Files &amp; Artifacts lalu indeks di bawah — atau tempel teks langsung lewat halaman Input Data.</p>
          </div>
        )}

        <ul className="cards">
          {kb.data?.docs.map(d => (
            <li key={d.fileId} className="card">
              <div className="card-text"><strong>{d.name}</strong><span className="meta">{d.chunks} potongan · diindeks {fmtDate(d.indexedAt)}</span>
                {d.missing && <span className="pill err">File sumber sudah tidak ada — hapus dari indeks</span>}</div>
              <div className="card-actions"><button type="button" className="chip-btn danger" onClick={() => void remove(d.fileId, d.name)} aria-label={`Keluarkan ${d.name} dari Knowledge Base`}>Keluarkan</button></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="kb-add-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="kb-add-title">Tambahkan dokumen</h2>
            <p className="panel-sub">Hanya file yang teksnya sudah terbaca yang bisa diindeks. File tanpa teks (gambar, PDF pindaian, audio) perlu ekstraksi lebih dulu.</p>
          </div>
        </div>
        <div className="toolbar">
          <label className="sr-only" htmlFor="kb-pick">Pilih file untuk diindeks</label>
          <select id="kb-pick" value={pick} onChange={e => setPick(e.target.value)} className="select">
            <option value="">{candidates.length ? 'Pilih file yang teksnya terbaca…' : 'Tidak ada file baru yang dapat diindeks'}</option>
            {candidates.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button type="button" className="btn-primary" disabled={!pick || busy} onClick={() => void add()}>{busy ? 'Mengindeks…' : 'Indeks'}</button>
        </div>
        <p className="field-hint">Unggah file lebih dulu di Files &amp; Artifacts.</p>
      </section>

      <section className="panel" aria-labelledby="kb-search-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="kb-search-title">Uji pencarian</h2>
            <p className="panel-sub">Cari kata kunci untuk memeriksa potongan mana yang akan dikutip.</p>
          </div>
        </div>
        <form className="toolbar" onSubmit={e => void search(e)} role="search">
          <label className="sr-only" htmlFor="kb-q">Kata kunci pencarian</label>
          <input id="kb-q" className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Mis. kebijakan cuti tahunan" maxLength={500} />
          <button type="submit" className="btn-primary" disabled={!q.trim() || searching}>{searching ? 'Mencari…' : 'Cari'}</button>
        </form>
        {hits && hits.length === 0 && <p className="empty-note">Tidak ada bagian yang cocok dengan kata kunci tersebut.</p>}
        <ul className="cards">
          {hits?.map((h, i) => (
            <li key={h.fileId + i} className="card"><div className="card-text">
              <strong>[{i + 1}] {h.name}{h.loc ? ` — ${h.loc}` : ''}</strong><span className="meta">skor {h.score}</span><p className="snippet">{h.text.length > 360 ? h.text.slice(0, 360) + '…' : h.text}</p>
            </div></li>
          ))}
        </ul>
      </section>
    </PageShell>
  )
}
