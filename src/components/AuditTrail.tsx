// Jejak Unified Execution Audit — tampilan yang dapat ditelusuri untuk aktivitas misi & eksekusi.
//
// Aturan tampilan (sengaja ketat):
//  - Data diambil dari API server (`/api/missions/:id/audit` atau `/api/capability-registry/audit`).
//    Frontend TIDAK pernah membaca berkas audit langsung, dan tidak pernah membuat event sendiri.
//  - `detail` TIDAK ditampilkan mentah: hanya kunci dari daftar putih, nilai dipotong,
//    `args`/`result`/`output` tidak pernah dirender.
//  - Aktor ditampilkan apa adanya: 'system' → "sistem", 'local' → "lokal"; tidak diklaim
//    sebagai identitas manusia.
//  - Event legacy (sebelum v0.6.3, tanpa eventType) diberi label jelas, bukan dipalsukan.
//  - Pagination: halaman 25 event per muat, "Muat lebih banyak" menambah halaman berikutnya.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLoad } from '../lib/useLoad'
import { api, type AuditEvent, type AuditIntegrity, type AuditPage } from '../lib/api'
import { cx } from '../lib/util'
import { StateMsg } from './pages/PageShell'

const PAGE_SIZE = 25

/** Jenis event yang dikenali (label Indonesia). Event di luar daftar → nama aslinya. */
const EVENT_LABEL: Record<string, string> = {
  'mission.created': 'Misi dibuat',
  'mission.approval_requested': 'Persetujuan diminta',
  'mission.approved': 'Misi disetujui',
  'mission.rejected': 'Persetujuan ditolak',
  'mission.started': 'Eksekusi dimulai',
  'mission.cancel_requested': 'Pembatalan diminta',
  'mission.cancelled': 'Misi dibatalkan',
  'task.started': 'Langkah dimulai',
  'tool.execution_started': 'Eksekusi alat dimulai',
  'tool.execution_succeeded': 'Alat berhasil',
  'tool.execution_failed': 'Alat gagal',
  'tool.retry_scheduled': 'Percobaan ulang dijadwalkan',
  'artifact.created': 'Artefak dibuat',
  'verification.passed': 'Verifikasi lulus',
  'verification.failed': 'Verifikasi gagal',
  'mission.completed': 'Misi selesai',
  'mission.failed': 'Misi gagal',
  'mission.needs_attention': 'Perlu ditinjau',
  'capability.validated': 'Kapabilitas divalidasi',
  'permission.denied': 'Izin ditolak',
  'approval.expired': 'Persetujuan kedaluwarsa',
}

/** Kunci detail yang boleh ditampilkan (daftar putih). `args`/`result`/`output` TIDAK ada di sini. */
const DETAIL_KEYS = [
  'tool', 'attempt', 'nextAttempt', 'maxAutoRetries', 'durationMs', 'sideEffects', 'confirm',
  'checks', 'class', 'missing', 'required', 'granted', 'scope', 'digest', 'paramsDigest',
  'expiresAt', 'approvalId', 'operation', 'target', 'template', 'steps', 'criteria',
  'criteriaPassed', 'artifacts', 'failed', 'passed', 'reason', 'state', 'resource', 'action',
] as const

const OUTCOME_LABEL: Record<string, string> = {
  requested: 'diminta', succeeded: 'berhasil', failed: 'gagal', denied: 'ditolak',
  cancelled: 'dibatalkan', rejected: 'ditolak', unverified: 'belum terverifikasi',
}
/** Pill: denied/failed = err · unverified/rejected = warn · succeeded = ok · requested = info. */
const OUTCOME_CLS: Record<string, string> = {
  requested: 'info', succeeded: 'ok', failed: 'err', denied: 'err',
  cancelled: 'neutral', rejected: 'warn', unverified: 'warn',
}

const ACTOR_LABEL: Record<string, string> = { system: 'sistem', local: 'lokal (tanpa sesi)' }

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

function detailValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return truncate(v, 120)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `${v.length} butir`
  return '[objek]'
}

function detailOf(e: AuditEvent): Array<[string, string]> {
  const d = e.detail
  if (!d || typeof d !== 'object') return []
  const out: Array<[string, string]> = []
  for (const k of DETAIL_KEYS) {
    if (!(k in d)) continue
    out.push([k, detailValue((d as Record<string, unknown>)[k])])
    if (out.length >= 6) break
  }
  return out
}

const fmtTime = (iso: string | null, ts: number | null) => {
  const t = ts ?? (iso ? Date.parse(iso) : NaN)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })
}

export function AuditTrail({ missionId, missionTitle, onActivity }: {
  /** Bila diisi → jejak audit misi tersebut. Bila kosong → jejak seluruh aktivitas + filter misi. */
  missionId?: string | null
  missionTitle?: string
  onActivity?: (m: string) => void
}) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eventType, setEventType] = useState('')
  const [outcome, setOutcome] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [missionFilter, setMissionFilter] = useState('')
  const [integrity, setIntegrity] = useState<AuditIntegrity['integrity'] | null>(null)
  const seq = useRef(0)
  const missions = useLoad(() => (typeof api.missions === 'function' ? api.missions() : Promise.resolve([])), [])

  const toEpoch = (v: string) => {
    if (!v) return null
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }

  const fetchPage = useCallback(async (offset: number, replace: boolean) => {
    const my = ++seq.current
    if (replace) setLoading(true); else setLoadingMore(true)
    try {
      const filters = { limit: PAGE_SIZE, offset, eventType: eventType || null, outcome: outcome || null, since: toEpoch(since), until: toEpoch(until) }
      const loader = missionId
        ? (typeof api.missionAudit === 'function' ? api.missionAudit(missionId, filters) : null)
        : (typeof api.capabilityAudit === 'function' ? api.capabilityAudit(PAGE_SIZE, { ...filters, missionId: missionFilter || null }) : null)
      if (!loader) throw new Error('Server belum menyediakan jejak audit.')
      const page: AuditPage = await loader
      if (my !== seq.current) return
      setEvents(prev => (replace ? page.events : [...prev, ...page.events]))
      setTotal(page.total ?? page.count ?? 0)
      setHasMore(Boolean(page.hasMore))
      setError(null)
    } catch (e) {
      if (my !== seq.current) return
      setError(e instanceof Error ? e.message : 'Gagal memuat jejak audit.')
    } finally {
      if (my === seq.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [missionId, missionFilter, eventType, outcome, since, until])

  useEffect(() => { void fetchPage(0, true) }, [fetchPage])

  // Integritas rantai hash — indikator jujur (bukan klaim keamanan menyeluruh).
  useEffect(() => {
    let alive = true
    const fn = api.auditIntegrity
    if (typeof fn !== 'function') { setIntegrity(null); return }
    fn()
      .then(r => { if (alive) setIntegrity(r.integrity) })
      .catch(() => { if (alive) setIntegrity(null) })
    return () => { alive = false }
  }, [])

  const applied = useMemo(() => ({ eventType, outcome, since, until }), [eventType, outcome, since, until])
  void applied

  function reset() {
    setEventType(''); setOutcome(''); setSince(''); setUntil('')
  }

  const legend = (
    <span className="meta">
      {integrity
        ? integrity.ok
          ? `Rantai hash utuh (${integrity.checked} event diperiksa${integrity.legacy ? `, ${integrity.legacy} event lama tanpa hash` : ''}).`
          : `Rantai hash TERPUTUS di baris ${integrity.brokenAt ?? '?'}: ${integrity.reason ?? 'alasan tidak diketahui'}.`
        : 'Status integritas jejak belum dapat dimuat.'}
    </span>
  )

  return (
    <section className="panel" aria-labelledby="audit-trail-title">
      <div className="panel-head">
        <div>
          <h2 className="panel-title" id="audit-trail-title">Jejak Audit</h2>
          <p className="panel-sub">
            Riwayat tindakan yang benar-benar tercatat di server (waktu, jenis, aktor, hasil, referensi eksekusi).
            {missionTitle ? ` Misi: ${missionTitle}.` : ' Semua aktivitas misi & kapabilitas.'} Nilai sensitif sudah disamarkan server;
            isi file pengguna tidak pernah ditampilkan.
          </p>
        </div>
        <div className="panel-actions">
          <span className="pill neutral">{events.length} dari {total} event</span>
          <button type="button" className="btn-ghost" onClick={() => void fetchPage(0, true)} disabled={loading}>Muat ulang</button>
        </div>
      </div>

      {/* ---------- Filter ---------- */}
      <div className="audit-filters" role="group" aria-label="Filter jejak audit">
        {!missionId && (
          <label className="field">
            <span>Misi</span>
            <select className="select" value={missionFilter} onChange={e => setMissionFilter(e.target.value)}>
              <option value="">Semua misi</option>
              {(missions.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>Jenis event</span>
          <select className="select" value={eventType} onChange={e => setEventType(e.target.value)}>
            <option value="">Semua jenis</option>
            {Object.keys(EVENT_LABEL).map(k => <option key={k} value={k}>{EVENT_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Hasil</span>
          <select className="select" value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="">Semua hasil</option>
            {Object.keys(OUTCOME_LABEL).map(k => <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Dari waktu</span>
          <input className="input" type="datetime-local" value={since} onChange={e => setSince(e.target.value)} />
        </label>
        <label className="field">
          <span>Sampai waktu</span>
          <input className="input" type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} />
        </label>
        <div className="field audit-filter-actions">
          <span>&nbsp;</span>
          <div className="audit-filter-buttons">
            <button type="button" className="btn-ghost" onClick={reset}>Bersihkan filter</button>
          </div>
        </div>
      </div>

      <StateMsg loading={loading && events.length === 0} error={error} onRetry={() => void fetchPage(0, true)} />
      {legend}

      {/* ---------- Daftar event ---------- */}
      {events.length === 0 && !loading && !error && (
        <div className="empty-state">
          <p>Belum ada event audit untuk filter ini. Jejak audit terisi saat ada aktivitas yang benar-benar tercatat.</p>
        </div>
      )}

      <ol className="audit-list" data-testid="audit-list" hidden={events.length === 0}>
        {events.map((e, i) => {
            const legacy = !e.eventType
            const type = e.eventType ?? 'event lama (tanpa tipe)'
            const label = EVENT_LABEL[type] ?? type
            const actor = e.actor ? (ACTOR_LABEL[e.actor] ?? e.actor) : 'tidak diketahui'
            const outcome = e.outcome ?? null
            const details = detailOf(e)
            const errText = typeof e.error === 'string' ? e.error : null
            return (
              <li key={`${e.eventId ?? 'legacy'}-${i}`} className={cx('audit-item', legacy && 'legacy')}>
                <div className="audit-head">
                  <span className="audit-time">{fmtTime(e.at, e.ts)}</span>
                  <span className={cx('pill', outcome ? (OUTCOME_CLS[outcome] ?? 'neutral') : 'neutral')}>
                    {outcome ? (OUTCOME_LABEL[outcome] ?? outcome) : (legacy ? 'format lama' : 'hasil tidak dicatat')}
                  </span>
                  <strong className="audit-type">{label}</strong>
                  {legacy && <span className="pill neutral">sebelum v0.6.3</span>}
                </div>
                <div className="audit-meta">
                  <span>aktor: {actor}</span>
                  {e.taskId && <span>· langkah {e.taskId}</span>}
                  {e.execId && <span>· exec <code>{e.execId.slice(0, 8)}</code></span>}
                  {e.capabilityId && <span>· kapabilitas <code>{e.capabilityId}</code></span>}
                  {e.correlationId && <span>· korelasi <code>{e.correlationId.slice(0, 8)}</code></span>}
                  {e.hash && <span>· hash <code>{e.hash.slice(0, 12)}</code></span>}
                </div>
                {(details.length > 0 || errText) && (
                  <dl className="audit-detail">
                    {details.map(([k, v]) => (
                      <div key={k} className="audit-detail-row"><dt>{k}</dt><dd>{v}</dd></div>
                    ))}
                    {errText && (
                      <div className="audit-detail-row"><dt>error</dt><dd>{truncate(errText, 200)}</dd></div>
                    )}
                  </dl>
                )}
              </li>
            )
          })}
      </ol>

      {hasMore && (
        <div className="audit-more">
          <button type="button" className="btn-ghost" disabled={loadingMore} onClick={() => void fetchPage(events.length, false)}>
            {loadingMore ? 'Memuat…' : `Muat lebih banyak (${events.length} dari ${total})`}
          </button>
        </div>
      )}
      {onActivity && events.length > 0 && (
        <button type="button" className="sr-only" onClick={() => onActivity('Jejak audit dimuat')}>Jejak audit dimuat</button>
      )}
    </section>
  )
}
