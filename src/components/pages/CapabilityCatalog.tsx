// Katalog kapabilitas terpadu: membaca /api/capability-registry (agregasi store nyata).
// Tidak ada status yang dikarang di UI: semua badge berasal dari server. Aksi validasi/eksekusi
// memanggil backend dan menampilkan hasil mentahnya, termasuk kegagalan.
import { useMemo, useState } from 'react'
import { api, type CapabilityEntry, type CapabilityValidationCheck } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { cx } from '../../lib/util'
import { fmtDate } from './PageShell'

const SOURCE_CLASS: Record<string, string> = { dudu: 'source-dudu', workbuddy: 'source-workbuddy', hermes: 'source-hermes', openclaw: 'source-openclaw' }
const AVAIL_CLASS: Record<string, string> = { available: 'ok', needs_configuration: 'warn', disabled: '', unavailable: 'danger', unverified: 'warn' }
const IMPL_LABEL: Record<string, string> = {
  implemented: 'Diimplementasikan',
  scaffold: 'Kerangka',
  not_implemented: 'Belum diimplementasikan',
  reference_only: 'Referensi',
}
const COMPAT_LABEL: Record<string, string> = {
  native: 'Native',
  adapter_required: 'Butuh adapter',
  unverified: 'Belum diverifikasi',
  incompatible: 'Tidak kompatibel',
}
const SIDE_LABEL: Record<string, string> = {
  none: 'tanpa efek samping',
  network: 'jaringan keluar',
  local_process: 'proses lokal',
  local_code: 'kode lokal',
}
const RISK_LABEL: Record<string, string> = { low: 'risiko rendah', medium: 'risiko sedang', high: 'risiko tinggi' }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'D'

function CheckList({ checks }: { checks: CapabilityValidationCheck[] }) {
  return (
    <ul className="cap-checks">
      {checks.map((c, i) => (
        <li key={`${c.id}-${i}`} className={c.ok ? 'check-ok' : 'check-fail'}>
          <span aria-hidden="true">{c.ok ? '✓' : '×'}</span>
          <span><strong>{c.id}</strong> — {c.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export function CapabilityCatalog({ category, externalOnly = false, title = 'Katalog Kapabilitas', subtitle = 'Satu registry untuk skill, tool, plugin, connector, MCP, workflow, dan referensi eksternal.', onActivity }: {
  category?: string
  externalOnly?: boolean
  title?: string
  subtitle?: string
  onActivity?: (m: string) => void
}) {
  const data = useLoad(api.capabilityRegistry, [])
  const [q, setQ] = useState('')
  const [source, setSource] = useState('semua')
  const [availability, setAvailability] = useState('semua')
  const [runnableOnly, setRunnableOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [args, setArgs] = useState('{}')
  const [lastRun, setLastRun] = useState<{ ok: boolean; result: unknown; error: string | null; at: number } | null>(null)

  const all = data.data?.items ?? []
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((e) => {
      if (category && e.category !== category) return false
      if (externalOnly && e.sourceType !== 'external-reference') return false
      if (source !== 'semua' && e.sourceProject !== source) return false
      if (availability !== 'semua' && e.status.availability !== availability) return false
      if (runnableOnly && !e.runnable) return false
      if (!needle) return true
      return [e.name, e.description, e.sourceLabel, e.categoryLabel, ...(e.tags ?? [])].join(' ').toLowerCase().includes(needle)
    })
  }, [all, category, externalOnly, q, source, availability, runnableOnly])

  const selected = all.find((e) => e.id === selectedId) ?? null
  const sources = (data.data?.filters.sources ?? []).filter((s) => !externalOnly || s.id !== 'dudu')
  const counts = useMemo(() => {
    const pool = externalOnly ? all.filter((e) => e.sourceType === 'external-reference') : all
    const c: Record<string, number> = { semua: pool.length }
    for (const e of pool) c[e.sourceProject] = (c[e.sourceProject] ?? 0) + 1
    return c
  }, [all, externalOnly])

  function open(entry: CapabilityEntry) {
    setSelectedId(entry.id)
    setArgs(entry.kind === 'mcp_tool' && (entry.meta as { tool?: string }).tool === 'kb_search' ? '{"query":"knowledge base"}' : '{}')
    setErr(null); setNote(null); setLastRun(null)
    setTimeout(() => document.getElementById('cap-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0)
  }

  async function validate(entry: CapabilityEntry) {
    setBusy(`validate:${entry.id}`); setErr(null); setNote(null)
    try {
      const out = await api.capabilityValidate(entry.id)
      setNote(out.verdict === 'passed' ? 'Validasi lulus.' : out.verdict === 'not_applicable' ? (out.error ?? 'Validasi tidak berlaku untuk referensi eksternal.') : `Validasi gagal: ${out.error ?? 'lihat rincian'}`
      )
      onActivity?.(`Validasi ${entry.name}: ${out.verdict}`)
      await data.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  async function run(entry: CapabilityEntry) {
    let parsed: Record<string, unknown>
    try {
      const v = JSON.parse(args || '{}')
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Argumen harus berupa objek JSON.')
      parsed = v as Record<string, unknown>
    } catch (e) { setErr(`Argumen JSON tidak valid: ${e instanceof Error ? e.message : String(e)}`); return }
    if (entry.sideEffects !== 'none' && !window.confirm(`Jalankan "${entry.name}"? Operasi ini berefek samping: ${SIDE_LABEL[entry.sideEffects] ?? entry.sideEffects}.`)) return
    setBusy(`run:${entry.id}`); setErr(null); setNote(null); setLastRun(null)
    try {
      const out = await api.capabilityRun(entry.id, parsed, entry.sideEffects !== 'none')
      setLastRun({ ok: out.ok, result: out.result, error: out.error, at: out.at })
      setNote(out.ok ? `Eksekusi selesai dalam ${out.durationMs} ms.` : `Eksekusi gagal: ${out.error ?? 'tanpa keterangan'}`)
      onActivity?.(`Kapabilitas ${entry.name} dijalankan (${out.ok ? 'berhasil' : 'gagal'})`)
      await data.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <section className="cap-registry panel" aria-labelledby="cap-registry-title">
      <div className="panel-head">
        <div>
          <h2 id="cap-registry-title" className="panel-title">{title}</h2>
          <p className="panel-sub">{subtitle}</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn-ghost" onClick={() => void data.reload()} disabled={data.loading}>Muat ulang</button>
        </div>
      </div>

      <p className="notice info">
        <span className="notice-body">
          Sumber status: store lokal Dudu, hasil validasi, probe nyata, dan audit eksekusi. Referensi {data.data?.summary.externalReferences ?? 0} entri eksternal
          berasal dari dokumentasi resmi (diverifikasi {data.data?.sourceVerifiedAt ?? '—'}) dan <strong>tidak dapat dijalankan</strong>.
        </span>
      </p>

      {data.error && <p className="state-msg error" role="alert">{data.error} <button type="button" className="link-btn" onClick={data.reload}>Coba lagi</button></p>}

      <div className="toolbar">
        <label className="sr-only" htmlFor="cap-q">Cari kapabilitas</label>
        <input id="cap-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, sumber, atau tag…" />
        <select className="select" aria-label="Filter sumber" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="semua">Semua sumber</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="select" aria-label="Filter ketersediaan" value={availability} onChange={(e) => setAvailability(e.target.value)}>
          <option value="semua">Semua status</option>
          <option value="available">Tersedia</option>
          <option value="needs_configuration">Perlu konfigurasi</option>
          <option value="disabled">Nonaktif</option>
          <option value="unavailable">Tidak tersedia</option>
          <option value="unverified">Belum diverifikasi</option>
        </select>
        <label className="checkbox-field"><input type="checkbox" checked={runnableOnly} onChange={(e) => setRunnableOnly(e.target.checked)} /><span>Bisa dijalankan</span></label>
      </div>

      <div className="chip-row" role="group" aria-label="Sumber kapabilitas">
        <button type="button" className={cx('chip-btn', source === 'semua' && 'active')} onClick={() => setSource('semua')}>Semua <span>{counts.semua ?? 0}</span></button>
        {sources.map((s) => (
          <button key={s.id} type="button" className={cx('chip-btn', source === s.id && 'active')} onClick={() => setSource(s.id)}>
            <span className={`source-dot ${SOURCE_CLASS[s.id] ?? ''}`} aria-hidden="true" /> {s.label} <span>{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="cap-counts meta" role="status">
        Menampilkan {list.length} dari {all.length} kapabilitas
        {data.data ? ` · ${data.data.summary.runnable} bisa dijalankan langsung · ${data.data.summary.externalReferences} referensi eksternal` : ''}
      </div>

      {data.loading && !data.data && <p className="state-msg" role="status">Memuat registry kapabilitas…</p>}

      <ul className="cap-grid" aria-label="Daftar kapabilitas">
        {list.map((e) => (
          <li key={e.id} className={cx('cap-card', selectedId === e.id && 'selected')}>
            <div className="cap-card-top">
              <span className={cx('cap-avatar', SOURCE_CLASS[e.sourceProject])} aria-hidden="true">{initials(e.name)}</span>
              <span className={cx('source-badge', SOURCE_CLASS[e.sourceProject])}>{e.sourceLabel}</span>
              <span className={cx('pill', AVAIL_CLASS[e.status.availability] ?? 'neutral')}>{e.statusLabel}</span>
            </div>
            <div className="cap-card-title">
              <strong>{e.name}</strong>
              <span className="cap-cat">{e.categoryLabel}{e.priority ? ` · ${e.priority}` : ''}</span>
            </div>
            <p className="cap-desc">{e.description}</p>
            <div className="cap-tags">
              <span className="mini-badge">{IMPL_LABEL[e.status.implementation] ?? e.status.implementation}</span>
              <span className="mini-badge">{COMPAT_LABEL[e.compatibility] ?? e.compatibility}</span>
              {e.runnable && <span className="mini-badge ok">bisa dijalankan</span>}
              {e.risk === 'high' && <span className="mini-badge danger">risiko tinggi</span>}
            </div>
            <div className="cap-card-actions">
              <button type="button" className="chip-btn" onClick={() => open(e)}>Detail</button>
              <button type="button" className="chip-btn" disabled={busy === `validate:${e.id}`} onClick={() => void validate(e)}>
                {busy === `validate:${e.id}` ? 'Memvalidasi…' : 'Validasi'}
              </button>
              {e.runnable && <button type="button" className="chip-btn active" disabled={busy === `run:${e.id}`} onClick={() => { open(e); void run(e) }}>
                {busy === `run:${e.id}` ? 'Menjalankan…' : 'Jalankan'}
              </button>}
            </div>
          </li>
        ))}
        {!data.loading && list.length === 0 && <li className="empty-note">Tidak ada kapabilitas yang cocok dengan filter.</li>}
      </ul>

      {selected && (
        <div id="cap-detail" className="cap-detail" aria-live="polite">
          <div className="cap-detail-head">
            <div>
              <span className={cx('source-badge', SOURCE_CLASS[selected.sourceProject])}>{selected.sourceLabel}</span>
              <h3>{selected.name}</h3>
              <p className="meta">{selected.categoryLabel} · {selected.id}{selected.version ? ` · v${selected.version}` : ''}</p>
            </div>
            <button type="button" className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Tutup detail">×</button>
          </div>
          <p>{selected.description}</p>
          <dl className="kv cap-status-grid">
            <dt>Implementasi</dt><dd>{IMPL_LABEL[selected.status.implementation] ?? selected.status.implementation}</dd>
            <dt>Ketersediaan</dt><dd>{selected.statusLabel} ({selected.status.availability})</dd>
            <dt>Koneksi</dt><dd>{selected.status.connection}</dd>
            <dt>Eksekusi terakhir</dt><dd>{selected.status.execution}{selected.lastExecutionAt ? ` · ${fmtDate(selected.lastExecutionAt)}` : ''}</dd>
            <dt>Kompatibilitas</dt><dd>{COMPAT_LABEL[selected.compatibility] ?? selected.compatibility}</dd>
            <dt>Lisensi</dt><dd>{selected.license ?? '—'}</dd>
            <dt>Efek samping</dt><dd>{SIDE_LABEL[selected.sideEffects] ?? selected.sideEffects} · {RISK_LABEL[selected.risk] ?? selected.risk}</dd>
            <dt>Izin</dt><dd>{selected.permissions.length ? selected.permissions.join(', ') : 'tidak ada'}</dd>
            <dt>Runtime</dt><dd>{selected.runtime ?? '—'}{selected.entryPoint ? ` · ${selected.entryPoint}` : ''}</dd>
            {selected.duduEquivalent && <><dt>Padanan Dudu</dt><dd>{selected.duduEquivalent}</dd></>}
            {selected.sourceCode && <><dt>Kode sumber</dt><dd><a href={selected.sourceCode} target="_blank" rel="noreferrer">{selected.sourceCode}</a></dd></>}
          </dl>

          {selected.docs.length > 0 && (
            <div className="cap-facts">
              <strong>Dokumentasi resmi</strong>
              <ul>{selected.docs.map((d) => <li key={d.url}><a href={d.url} target="_blank" rel="noreferrer">{d.label}</a></li>)}</ul>
            </div>
          )}
          {selected.facts.length > 0 && (
            <div className="cap-facts"><strong>Fakta yang diverifikasi</strong><ul>{selected.facts.map((f) => <li key={f}>{f}</li>)}</ul></div>
          )}
          {selected.lastValidation && (
            <div className="cap-validation">
              <strong>Validasi terakhir: {selected.lastValidation.verdict}</strong> <span className="meta">({fmtDate(selected.lastValidation.at)})</span>
              <CheckList checks={selected.lastValidation.checks} />
            </div>
          )}

          {selected.runnable && (
            <div className="cap-run">
              <label htmlFor="cap-args"><strong>Argumen JSON</strong></label>
              <textarea id="cap-args" className="input cap-args" rows={3} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
              <div className="cap-card-actions">
                <button type="button" className="btn-secondary" disabled={busy === `validate:${selected.id}`} onClick={() => void validate(selected)}>Validasi</button>
                <button type="button" className="btn-primary" disabled={busy === `run:${selected.id}`} onClick={() => void run(selected)}>
                  {busy === `run:${selected.id}` ? 'Menjalankan…' : 'Jalankan sekarang'}
                </button>
              </div>
              <p className="meta">Operasi berefek samping selalu meminta konfirmasi. Hasil dan kegagalan dicatat di capability-audit.jsonl (argumen sensitif disamarkan).</p>
            </div>
          )}

          {selected.lastExecution && (
            <details className="cap-last">
              <summary>Eksekusi terakhir ({selected.lastExecution.ok ? 'berhasil' : 'gagal'}) — {fmtDate(selected.lastExecution.at)}</summary>
              <pre>{JSON.stringify(selected.lastExecution, null, 2)}</pre>
            </details>
          )}
          {selected.lastError && <p className="state-msg error" role="alert">Error terakhir: {selected.lastError}</p>}
          {err && <p className="state-msg error" role="alert">{err}</p>}
          {note && <p className="state-msg" role="status">{note}</p>}
          {lastRun && (
            <div className="cap-run-result">
              <strong>{lastRun.ok ? 'Hasil eksekusi' : 'Eksekusi gagal'}</strong>
              <pre>{JSON.stringify(lastRun.ok ? lastRun.result : { error: lastRun.error }, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
