// Skill Dudu: galeri kemampuan bawaan (nyata) + skill kustom yang instruksinya benar-benar
// ditempelkan ke system prompt chat saat diaktifkan. Tidak ada skill atau status palsu.
import { useMemo, useState } from 'react'
import { api, type SkillInfo } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { CapabilityCatalog } from './CapabilityCatalog'
import { PageShell, StateMsg } from './PageShell'

const BLANK = { name: '', category: 'Umum', description: '', instruction: '' }

export function SkillsPage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity?: (m: string) => void }) {
  const data = useLoad(api.skills, [])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Semua')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const match = (s: SkillInfo) => {
    const hay = `${s.name} ${s.description} ${s.category}`.toLowerCase()
    return (cat === 'Semua' || s.category === cat) && (!q.trim() || hay.includes(q.trim().toLowerCase()))
  }
  const builtin = useMemo(() => (data.data?.builtin ?? []).filter(match), [data.data, q, cat])
  const custom = useMemo(() => (data.data?.custom ?? []).filter(match), [data.data, q, cat])
  const activeCount = (data.data?.custom ?? []).filter((s) => s.enabled).length

  async function create() {
    setBusy('create'); setErr(null); setNote(null)
    try {
      const s = await api.skillCreate(form)
      setNote(`Skill "${s.name}" dibuat. Aktifkan agar instruksinya dipakai chat.`)
      setForm({ ...BLANK }); setShowForm(false); await data.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  async function toggle(s: SkillInfo) {
    setBusy(s.id); setErr(null); setNote(null)
    try { await api.skillUpdate(s.id, { enabled: !s.enabled }); await data.reload() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  async function remove(s: SkillInfo) {
    if (!window.confirm(`Hapus skill "${s.name}"? Instruksinya tidak lagi dikirim ke chat.`)) return
    setBusy(s.id); setErr(null)
    try { await api.skillRemove(s.id); await data.reload() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <PageShell title="Skill" subtitle="Kemampuan yang bisa dipakai Dudu — bawaan (nyata) dan kustom buatan Anda. Skill kustom aktif dikirim sebagai instruksi tambahan ke chat." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <div className="toolbar">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari skill…" aria-label="Cari skill" />
        <div className="chip-row" role="group" aria-label="Kategori skill">
          {['Semua', ...(data.data?.categories ?? [])].map((c) => (
            <button key={c} type="button" className={cat === c ? 'chip-btn active' : 'chip-btn'} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Tutup formulir' : '+ Skill kustom'}</button>
      </div>
      <StateMsg loading={data.loading && !data.data} error={data.error} onRetry={data.reload} />
      {err && <p className="state-msg error" role="alert">{err}</p>}
      {note && <p className="notice ok" role="status"><span className="notice-body">{note}</span></p>}

      {showForm && (
        <section className="panel" aria-labelledby="sk-form-title">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="sk-form-title">Skill kustom baru</h2>
              <p className="panel-sub">Instruksi yang Anda tulis akan ditempelkan ke system prompt chat selama skill ini aktif — bukan dieksekusi sebagai kode.</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <label className="field" htmlFor="sk-name">
                <span className="field-label">Nama</span>
                <input id="sk-name" className="input" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Penulis Email Formal" />
              </label>
              <label className="field" htmlFor="sk-cat">
                <span className="field-label">Kategori</span>
                <select id="sk-cat" className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{(data.data?.categories ?? ['Umum']).map((c) => <option key={c}>{c}</option>)}</select>
              </label>
              <label className="field field--wide" htmlFor="sk-desc">
                <span className="field-label">Deskripsi singkat</span>
                <input id="sk-desc" className="input" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <label className="field field--wide" htmlFor="sk-ins">
                <span className="field-label">Instruksi untuk AI</span>
                <textarea id="sk-ins" className="input" rows={6} maxLength={data.data?.limits.maxInstruction ?? 4000} value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="Contoh: Jawab dengan bahasa Indonesia formal, maksimum 5 paragraf, selalu akhiri dengan langkah tindak lanjut." />
                <span className="field-hint">{form.instruction.length}/{data.data?.limits.maxInstruction ?? 4000} karakter · hanya dipakai saat skill diaktifkan (maks {data.data?.limits.maxActive ?? 5} skill aktif).</span>
              </label>
            </div>
            <div className="panel-foot">
              <button type="button" className="btn-primary" disabled={busy === 'create' || form.name.trim().length < 2 || !form.instruction.trim()} onClick={() => void create()}>
                {busy === 'create' ? 'Menyimpan…' : 'Simpan skill'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="panel" aria-labelledby="sk-builtin-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="sk-builtin-title">Skill bawaan</h2>
            <p className="panel-sub">Skill bawaan menunjuk fitur yang memang ada di aplikasi ini — tidak ada yang dikarang. Status “perlu konfigurasi” berarti fiturnya butuh provider/kunci yang belum diisi.</p>
          </div>
          <div className="panel-actions"><span className="pill neutral">{builtin.length} skill</span></div>
        </div>
        <div className="card-grid">
          {builtin.map((s) => (
            <article key={s.id} className="card card-block" aria-label={`Skill ${s.name}`}>
              <div className="tile-top">
                <span className="tile-avatar" aria-hidden="true">{s.name.slice(0, 2).toUpperCase()}</span>
                <span className="source-badge source-dudu">Dudu</span>
                <span className={s.available ? 'pill ok' : 'pill warn'}>{s.available ? 'Siap' : 'Perlu konfigurasi'}</span>
              </div>
              <div className="tile-head"><span className="cap-cat">{s.category}</span></div>
              <strong>{s.name}</strong>
              <p className="meta">{s.description}</p>
              <p className="meta skill-where">Di mana: {s.where}</p>
            </article>
          ))}
        </div>
        {builtin.length === 0 && <p className="empty-note">Tidak ada skill bawaan yang cocok dengan pencarian.</p>}
      </section>

      <section className="panel" aria-labelledby="sk-custom-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="sk-custom-title">Skill kustom</h2>
            <p className="panel-sub">Skill buatan Anda sendiri. Hanya skill aktif yang instruksinya ikut dikirim ke chat.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{custom.length} skill</span>
            <span className="pill ok">{activeCount}/{data.data?.limits.maxActive ?? 5} aktif</span>
          </div>
        </div>
        {custom.length === 0 ? (
          <p className="empty-note">Belum ada skill kustom. Buat satu lewat tombol <strong>+ Skill kustom</strong>; instruksinya akan dipakai chat setelah diaktifkan.</p>
        ) : (
          <div className="card-grid">
            {custom.map((s) => (
              <article key={s.id} className="card card-block" aria-label={`Skill kustom ${s.name}`}>
                <div className="tile-top">
                  <span className="tile-avatar" aria-hidden="true">{s.name.slice(0, 2).toUpperCase()}</span>
                  <span className="source-badge source-user">Kustom</span>
                  <span className={s.enabled ? 'pill ok' : 'pill neutral'}>{s.enabled ? 'Aktif' : 'Nonaktif'}</span>
                </div>
                <div className="tile-head"><span className="cap-cat">{s.category}</span></div>
                <strong>{s.name}</strong>
                <p className="meta">{s.description || '(tanpa deskripsi)'}</p>
                <details className="tile-where"><summary>Lihat instruksi</summary><p className="meta">{s.instruction}</p></details>
                <div className="tile-actions">
                  <button type="button" className="chip-btn" disabled={busy === s.id} onClick={() => void toggle(s)}>{s.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  <button type="button" className="chip-btn danger" disabled={busy === s.id} onClick={() => void remove(s)}>Hapus</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="cap-external-block">
        <CapabilityCatalog
          category="skill"
          externalOnly
          title="Skill referensi eksternal"
          subtitle="Skill dari WorkBuddy, Hermes, dan OpenClaw berdasarkan dokumentasi resmi. Hanya referensi: tidak dipasang, tidak dijalankan, dan tidak mengklaim kompatibilitas yang belum diuji."
          onActivity={onActivity}
        />
      </div>
    </PageShell>
  )
}
