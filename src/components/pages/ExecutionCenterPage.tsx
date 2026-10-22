// Pusat Eksekusi: satu layar untuk dua hal yang saling terkait —
//   1) Timeline eksekusi hidup (misi yang sedang berjalan, dengan langkah + timestamp nyata).
//   2) Pusat "butuh perhatian" (misi menunggu persetujuan, gagal, perlu ditinjau, integrasi belum siap).
//
// Sumber kebenaran: state yang disimpan server (GET /api/missions/:id). Tidak ada persentase
// karangan, tidak ada identitas agen rekaan — hanya langkah, waktu, dan status yang benar-benar ada.
// Strategi pembaruan: polling (server tidak menyediakan streaming/SSE), dengan tombol segarkan manual.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Mission, type MissionState, type MissionStep } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import type { ViewId } from '../../lib/types'
import { cx } from '../../lib/util'
import { AuditTrail } from '../AuditTrail'
import { Icon } from '../ui'
import { PageShell, StateMsg, fmtDate } from './PageShell'

const TERMINAL: MissionState[] = ['completed', 'failed', 'cancelled']
const isLive = (s: MissionState) => s === 'queued' || s === 'running'

/** Poll adaptif: batas bawah/atas, dan rasio perlambatan saat jaringan sering gagal. */
const POLL = { min: 1000, max: 15000, backoff: 1.6, listEveryNTicks: 3 }
/** Data dianggap basi bila tidak ada pembaruan sukses selama ini. */
const STALE_MS = 12000

const STATE_LABEL: Record<MissionState, string> = {
  draft: 'Menunggu persetujuan', queued: 'Antre', running: 'Berjalan',
  needs_attention: 'Perlu ditinjau', completed: 'Selesai', failed: 'Gagal', cancelled: 'Dibatalkan',
}
const STATE_CLS: Record<MissionState, string> = {
  draft: 'warn', queued: 'warn', running: 'warn', needs_attention: 'warn',
  completed: 'ok', failed: 'err', cancelled: 'err',
}
const STEP_LABEL: Record<MissionStep['status'], string> = { pending: 'menunggu', running: 'berjalan', done: 'selesai', failed: 'gagal' }
const dur = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
const clock = (t?: number) => (t ? new Date(t).toLocaleTimeString('id-ID', { hour12: false }) : '—')

export function ExecutionCenterPage({ onToggleLeft, leftCollapsed, onActivity, onNavigate }: {
  onToggleLeft: () => void
  leftCollapsed: boolean
  onActivity: (m: string) => void
  onNavigate?: (view: ViewId) => void
}) {
  const missions = useLoad(api.missions)
  const registry = useLoad(() => api.capabilityRegistry(), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [live, setLive] = useState<Mission | null>(null)
  const [liveErr, setLiveErr] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const list = missions.data ?? []
  const liveMissions = useMemo(() => list.filter(m => isLive(m.state)), [list])
  const attention = useMemo(() => ({
    approval: list.filter(m => m.state === 'draft'),
    retryable: list.filter(m => (m.state === 'failed' || m.state === 'needs_attention') && m.failure?.retryable),
    review: list.filter(m => m.state === 'needs_attention' && !m.failure?.retryable),
    cancelled: list.filter(m => m.state === 'cancelled'),
  }), [list])

  const refresh = useCallback(async (id: string) => {
    try {
      const m = await api.getMission(id)
      setLive(m); setLiveErr(null); setUpdatedAt(Date.now())
      return m
    } catch (e) {
      setLiveErr(e instanceof Error ? e.message : 'Gagal memuat misi.')
      return null
    }
  }, [])

  // ---- Poll adaptif: satu siklus hidup per tampilan, tanpa tumpang tindih ----
  const inFlight = useRef(false)
  const timer = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const failCount = useRef(0)
  const tickCount = useRef(0)
  const [stale, setStale] = useState(false)

  const interval = () => Math.min(POLL.max, POLL.min * Math.pow(POLL.backoff, failCount.current))

  const pollOnce = useCallback(async (id: string) => {
    if (inFlight.current) return null          // cegah request bertumpuk
    inFlight.current = true
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const m = await api.getMission(id, ac.signal)
      failCount.current = 0
      setLiveErr(null); setUpdatedAt(Date.now()); setStale(false)
      setLive(m)
      return m
    } catch (e) {
      if (ac.signal.aborted) return null       // request dibatalkan (unmount/pindah misi) → bukan error
      failCount.current += 1
      setLiveErr(e instanceof Error ? e.message : 'Gagal memuat misi.')
      return null
    } finally {
      inFlight.current = false
      if (abortRef.current === ac) abortRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!selectedId) { setLive(null); setStale(false); return }
    let stopped = false
    failCount.current = 0
    tickCount.current = 0

    const clearTimer = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }

    const tick = async () => {
      if (stopped) return
      if (document.hidden) { schedule(); return }   // jangan agresif saat tab tersembunyi
      const m = await pollOnce(selectedId)
      if (stopped) return
      if (m && TERMINAL.includes(m.state)) { missions.reload(); return }  // selesai → berhenti polling
      // Deteksi perubahan misi dari luar (mis. dibatalkan di tab lain) tiap beberapa tick.
      tickCount.current += 1
      if (tickCount.current % POLL.listEveryNTicks === 0) missions.reload()
      schedule()
    }
    const schedule = () => {
      clearTimer()
      if (!stopped) timer.current = window.setTimeout(() => { void tick() }, interval())
    }
    const resume = () => {
      if (stopped) return
      if (document.hidden) return
      clearTimer()
      void tick()                                  // lanjut segera saat aktif lagi
    }
    const onVis = () => { if (!document.hidden) resume() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', resume)
    void tick()
    return () => {
      stopped = true
      clearTimer()
      abortRef.current?.abort()                    // batalkan request yang masih berjalan
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', resume)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pollOnce])

  // Tandai data basi bila pembaruan terakhir sudah lama (mis. koneksiDiam /app tersuspend).
  useEffect(() => {
    const t = window.setInterval(() => {
      setStale(updatedAt != null && Date.now() - updatedAt > STALE_MS)
    }, 2000)
    return () => window.clearInterval(t)
  }, [updatedAt])

  async function start(m: Mission) {
    setBusy(m.id); setActionErr(null); setSelectedId(m.id)
    try {
      // Sengaja tidak di-await: eksekusi berjalan di server, timeline di-poll dari state nyata.
      void api.approveMission(m.id).catch(() => { /* kegagalan tampil lewat state misi */ })
      onActivity(`Misi dijalankan: ${m.title}`)
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Gagal menjalankan misi.')
    } finally { setBusy(null) }
  }
  async function retry(m: Mission) {
    setBusy(m.id); setActionErr(null); setSelectedId(m.id)
    try {
      void api.retryMission(m.id).catch(() => { /* kegagalan tampil lewat state misi */ })
      onActivity(`Percobaan ulang: ${m.title}`)
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Gagal mencoba ulang.')
    } finally { setBusy(null) }
  }
  async function cancel(m: Mission) {
    setBusy(m.id); setActionErr(null)
    try {
      await api.cancelMission(m.id)
      await refresh(m.id)                           // segarkan segera setelah aksi pengguna
      missions.reload()
      onActivity(`Misi dibatalkan: ${m.title}`)
    } catch (e) { setActionErr(e instanceof Error ? e.message : 'Gagal membatalkan misi.') } finally { setBusy(null) }
  }

  const steps = live?.steps ?? []
  const doneCount = steps.filter(s => s.status === 'done').length
  const current = steps.find(s => s.status === 'running') ?? null
  const failedStep = steps.find(s => s.status === 'failed') ?? null
  const configIssues = (registry.data?.items ?? []).filter(c => c.status.availability === 'needs_configuration' || c.status.availability === 'unavailable' || c.status.availability === 'disabled')

  return (
    <PageShell title="Pusat Eksekusi" subtitle="Misi yang sedang berjalan, lalu hal yang benar-benar butuh tindakan Anda." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}
      actions={<button type="button" className="btn-ghost" onClick={() => { void missions.reload(); void registry.reload(); if (selectedId) void refresh(selectedId) }} disabled={missions.loading}>
        <Icon name="retry" size={13} /> Muat ulang
      </button>}>

      <StateMsg loading={missions.loading && !missions.data} error={missions.error} onRetry={missions.reload} />
      {actionErr && <p className="state-msg error" role="alert">{actionErr}</p>}

      {/* ---------- Timeline eksekusi hidup ---------- */}
      <section className="panel" aria-labelledby="ec-live-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="ec-live-title">Eksekusi langsung</h2>
            <p className="panel-sub">Status di bawah dibaca ulang dari server (polling adaptif {POLL.min / 1000}–{POLL.max / 1000} detik, melambat saat koneksi sering gagal, berhenti saat tab tersembunyi) selama misi berjalan. Tidak ada persentase karangan — hanya langkah dan waktu sebenarnya.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{liveMissions.length} berjalan</span>
            {updatedAt && <span className={cx('pill', stale ? 'warn' : 'neutral')}>
              {stale ? 'terakhir pembaruan ' : 'diperbarui '}{clock(updatedAt)}
            </span>}
          </div>
        </div>

        {liveMissions.length > 0 && (
          <ul className="cards">
            {liveMissions.map(m => (
              <li key={m.id} className="card">
                <div className="card-text">
                  <strong>{m.title}</strong>
                  <span className="meta">{m.fileName} · dibuat {fmtDate(m.createdAt)}</span>
                </div>
                <div className="card-actions">
                  <span className={cx('pill', STATE_CLS[m.state])}>{STATE_LABEL[m.state]}</span>
                  <button type="button" className="btn-ghost" onClick={() => setSelectedId(m.id)}>Pantau</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {liveErr && (
          <p className="notice err" role="alert">
            <span className="notice-body">
              <strong className="notice-title">Koneksi ke server bermasalah</strong>
              Gagal memuat state terbaru: {liveErr}. Data di bawah bisa jadi basi — polling akan melambat dan mencoba lagi otomatis.
            </span>
          </p>
        )}
        {!liveErr && stale && (
          <p className="notice warn" role="status">
            <span className="notice-body">Data mungkin basi — pembaruan terakhir {updatedAt ? clock(updatedAt) : 'tidak diketahui'}. Polling dilanjutkan otomatis.</span>
          </p>
        )}

        {!live && (
          <div className="empty-state">
            <p>Tidak ada eksekusi yang dipantau. Mulai misi di Misi &amp; Tugas, atau pilih misi berjalan di atas.</p>
            {onNavigate && <button type="button" className="btn-ghost" onClick={() => onNavigate('missions')}>Buka Misi &amp; Tugas</button>}
          </div>
        )}

        {live && (
          <div className="timeline-wrap">
            <div className="panel-head">
              <div>
                <h3 className="panel-title" style={{ fontSize: 'var(--fs-md)' }}>{live.title}</h3>
                <p className="meta">{live.fileName} · {doneCount} dari {steps.length} langkah selesai{current ? ` · sedang: ${current.tool}` : ''}</p>
              </div>
              <div className="panel-actions">
                <span className={cx('pill', STATE_CLS[live.state])}>{STATE_LABEL[live.state]}</span>
                <button type="button" className="btn-ghost" onClick={() => void refresh(live.id)} disabled={busy === live.id}>Segarkan</button>
                {isLive(live.state) && (
                  <button type="button" className="btn-danger" onClick={() => void cancel(live)} disabled={busy === live.id}>Batalkan</button>
                )}
              </div>
            </div>

            <ol className="timeline" aria-label="Langkah eksekusi">
              {steps.map(s => {
                const last = s.attempts[s.attempts.length - 1]
                return (
                  <li key={s.id} className={cx('tl-item', s.status)}>
                    <span className="tl-dot" aria-hidden="true" />
                    <div className="tl-body">
                      <div className="tl-head">
                        <strong>{s.title}</strong>
                        <span className={cx('pill', s.status === 'done' ? 'ok' : s.status === 'failed' ? 'err' : s.status === 'running' ? 'warn' : 'neutral')}>
                          {STEP_LABEL[s.status]}
                        </span>
                      </div>
                      <span className="meta">
                        <code>{s.tool}</code>
                        {last?.startedAt ? ` · mulai ${clock(last.startedAt)}` : ''}
                        {last?.startedAt && last?.finishedAt ? ` · selesai ${clock(last.finishedAt)} (${dur(last.finishedAt - last.startedAt)})` : ''}
                        {s.attempts.length > 1 ? ` · ${s.attempts.length} percobaan` : ''}
                        {last?.execId ? ` · exec ${last.execId.slice(0, 8)}` : ''}
                      </span>
                      {last?.error && <span className="state-msg error">{last.class ? `[${last.class}] ` : ''}{last.error}</span>}
                    </div>
                  </li>
                )
              })}
            </ol>

            {failedStep && (
              <p className="notice err">
                <span className="notice-body">
                  <strong className="notice-title">Langkah gagal: {failedStep.title}</strong>
                  {live.failure ? `${live.failure.class} — ${live.failure.message}` : 'Detail belum tersedia.'}
                  {live.failure?.retryable ? ' Kegagalan ini bisa dicoba ulang.' : ' Mengulang tidak mengubah hasil deterministik — perlu tinjauan manusia.'}
                </span>
              </p>
            )}

            {live.acceptance.length > 0 && (
              <>
                <h4 className="section-title">Kriteria penerimaan</h4>
                <ul className="criteria">
                  {live.acceptance.map(c => (
                    <li key={c.id} className={c.status}>
                      <span className={cx('pill', c.status === 'passed' ? 'ok' : c.status === 'failed' ? 'err' : 'neutral')}>
                        {c.status === 'passed' ? 'lulus' : c.status === 'failed' ? 'GAGAL' : 'belum diperiksa'}
                      </span>
                      <div><span>{c.text}</span>{c.evidence && <span className="meta evidence">Bukti: {c.evidence}</span>}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {live.log.length > 0 && (
              <details className="log">
                <summary>Log eksekusi ({live.log.length})</summary>
                <ul>{live.log.slice(-12).map((l, i) => <li key={i} className={l.level}><time>{clock(l.at)}</time> {l.msg}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        {/* ---------- Jejak audit: misi terpilih, atau seluruh aktivitas bila belum ada ---------- */}
        <AuditTrail missionId={selectedId ?? undefined} missionTitle={selectedId ? live?.title : undefined} onActivity={onActivity} />
      </section>

      {/* ---------- Pusat butuh perhatian ---------- */}
      <section className="panel" aria-labelledby="ec-attention-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="ec-attention-title">Butuh perhatian</h2>
            <p className="panel-sub">Semua butir di bawah berasal dari state server — bukan daftar manual.</p>
          </div>
          <div className="panel-actions">
            <span className="pill warn">{attention.approval.length + attention.retryable.length + attention.review.length + configIssues.length} butir</span>
          </div>
        </div>

        {attention.approval.length === 0 && attention.retryable.length === 0 && attention.review.length === 0 && configIssues.length === 0 && (
          <div className="empty-state">
            <p>Tidak ada yang butuh perhatian. Semua misi beres dan integrasi yang dipakai sudah terkonfigurasi.</p>
          </div>
        )}

        {attention.approval.length > 0 && (
          <div className="attention-group">
            <h3 className="section-title">Menunggu persetujuan Anda</h3>
            <ul className="cards">
              {attention.approval.map(m => (
                <li key={m.id} className="card">
                  <div className="card-text"><strong>{m.title}</strong><span className="meta">{m.fileName} · dibuat {fmtDate(m.createdAt)}</span></div>
                  <div className="card-actions">
                    <button type="button" className="btn-primary" disabled={busy === m.id} onClick={() => void start(m)}>
                      {busy === m.id ? 'Menjalankan…' : 'Setujui & jalankan'}
                    </button>
                    {onNavigate && <button type="button" className="btn-ghost" onClick={() => onNavigate('missions')}>Buka misi</button>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {attention.retryable.length > 0 && (
          <div className="attention-group">
            <h3 className="section-title">Gagal — masih bisa dicoba ulang</h3>
            <ul className="cards">
              {attention.retryable.map(m => (
                <li key={m.id} className="card">
                  <div className="card-text">
                    <strong>{m.title}</strong>
                    <span className="meta">{m.failure?.class} — {m.failure?.message}</span>
                  </div>
                  <div className="card-actions">
                    <button type="button" className="btn-primary" disabled={busy === m.id} onClick={() => void retry(m)}>
                      {busy === m.id ? 'Mencoba ulang…' : 'Coba lagi'}
                    </button>
                    {onNavigate && <button type="button" className="btn-ghost" onClick={() => onNavigate('missions')}>Buka misi</button>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {attention.review.length > 0 && (
          <div className="attention-group">
            <h3 className="section-title">Perlu ditinjau manusia</h3>
            <ul className="cards">
              {attention.review.map(m => (
                <li key={m.id} className="card">
                  <div className="card-text">
                    <strong>{m.title}</strong>
                    <span className="meta">{m.failure?.class} — {m.failure?.message}</span>
                  </div>
                  <div className="card-actions">
                    {onNavigate && <button type="button" className="btn-ghost" onClick={() => onNavigate('missions')}>Buka misi</button>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {configIssues.length > 0 && (
          <div className="attention-group">
            <div className="panel-head">
              <h3 className="section-title">Integrasi belum siap</h3>
              {onNavigate && (
                <div className="panel-actions">
                  <button type="button" className="btn-ghost" onClick={() => onNavigate('tools')}>Buka Tools &amp; Integrations</button>
                </div>
              )}
            </div>
            <ul className="cards">
              {configIssues.slice(0, 8).map(c => (
                <li key={c.id} className="card">
                  <div className="card-text">
                    <strong>{c.name}</strong>
                    <span className="meta">{c.statusLabel} · {c.id}</span>
                  </div>
                </li>
              ))}
            </ul>
            {configIssues.length > 8 && <p className="meta">Menampilkan 8 dari {configIssues.length} butir. Lihat daftar lengkap di Tools &amp; Integrations.</p>}
          </div>
        )}
      </section>
    </PageShell>
  )
}
