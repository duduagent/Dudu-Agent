import { useEffect, useState, type FormEvent } from 'react'
import { api, type CapabilityEntry, type Mission, type MissionState } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { cx } from '../../lib/util'
import { fmtSize } from '../Attachments'
import { AuditTrail } from '../AuditTrail'
import { ReminderWorkspace } from '../ReminderWorkspace'
import { Icon } from '../ui'
import { PageShell, StateMsg, fmtDate } from './PageShell'

export const STATE_LABEL: Record<MissionState, string> = { draft: 'Draft', queued: 'Antre', running: 'Berjalan', needs_attention: 'Perlu Perhatian', completed: 'Selesai', failed: 'Gagal', cancelled: 'Dibatalkan' }
const STATE_CLS: Record<MissionState, string> = { draft: '', queued: 'warn', running: 'warn', needs_attention: 'warn', completed: 'ok', failed: 'err', cancelled: 'err' }
const STEP_LABEL = { pending: 'menunggu', running: 'berjalan', done: 'selesai', failed: 'gagal' } as const
const AC_LABEL = { pending: 'belum diperiksa', passed: 'lulus', failed: 'GAGAL' } as const
const TABULAR = new Set(['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx'])

/**
 * Menjalankan kapabilitas dari konteks misi (satu-satunya jalur: registry Unified Capability).
 * Hasil run yang sukses dilampirkan sebagai bukti ke misi ini; status misi tidak berubah diam-diam.
 */
function MissionCapabilityRunner({ m, caps, onChanged, onActivity }: { m: Mission; caps: CapabilityEntry[]; onChanged: (m: Mission) => void; onActivity: (s: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [argVals, setArgVals] = useState<Record<string, string>>({})
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const [last, setLast] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  // Persetujuan yang terikat tindakan: { capabilityId → { id, status } }
  const [approvals, setApprovals] = useState<Record<string, { id: string; status: string }>>({})
  const runnable = caps.filter(c => c.runnable)
  if (!runnable.length) return null

  const schemaOf = (cap: CapabilityEntry) => (cap.meta?.inputSchema ?? null) as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } | null

  const payloadOf = (cap: CapabilityEntry) => {
    const schema = schemaOf(cap)
    const required = Array.isArray(schema?.required) ? schema.required : []
    const payload: Record<string, unknown> = {}
    for (const key of required) {
      const raw = (argVals[`${cap.id}:${key}`] ?? '').trim()
      if (!raw) throw new Error(`Argumen "${key}" wajib diisi untuk ${cap.name}.`)
      const t = schema?.properties?.[key]?.type
      payload[key] = t === 'integer' || t === 'number' ? Number(raw) : raw
    }
    return payload
  }

  async function run(cap: CapabilityEntry) {
    setBusy(cap.id); setErr(null)
    try {
      const payload = payloadOf(cap)
      const r = await api.missionRunCapability(m.id, cap.id, payload, approved[cap.id] === true)
      onChanged(r.mission)
      setLast({ id: cap.id, ok: r.run.ok, text: r.run.ok ? `Berhasil dalam ${r.run.durationMs} ms — bukti dilampirkan: ${r.evidence.name}` : (r.run.error ?? 'Kapabilitas gagal dijalankan.') })
      onActivity(`Kapabilitas dijalankan pada misi "${m.title}": ${cap.name} — ${r.run.ok ? 'berhasil' : 'gagal'}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal menjalankan kapabilitas.'
      setErr(msg)
      // Persetujuan khusus tindakan dibutuhkan → tawarkan permintaan persetujuan.
      if (/belum disetujui|persetujuan|approval/i.test(msg)) {
        try {
          const rec = await api.missionRequestApproval(m.id, { capabilityId: cap.id, operation: 'run', args: payloadOf(cap) })
          setApprovals((a) => ({ ...a, [cap.id]: { id: rec.id, status: rec.status } }))
        } catch { /* pesan galat asli tetap tampil */ }
      }
    } finally {
      setBusy(null)
    }
  }

  async function decide(cap: CapabilityEntry, decision: 'approved' | 'rejected') {
    const rec = approvals[cap.id]
    if (!rec) return
    setBusy(cap.id); setErr(null)
    try {
      const out = await api.missionDecideApproval(m.id, rec.id, decision)
      setApprovals((a) => ({ ...a, [cap.id]: { id: out.id, status: out.status } }))
      onActivity(decision === 'approved' ? `Persetujuan tindakan diberikan: ${cap.name}` : `Persetujuan ditolak: ${cap.name}`)
      if (decision === 'approved') await run(cap)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal memproses persetujuan.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="cap-runner" aria-label="Kapabilitas yang bisa dijalankan dari misi ini">
      <h3>Jalankan kapabilitas (dalam konteks misi)</h3>
      <p className="meta">Hanya kapabilitas yang benar-benar runnable ditampilkan. Hasil sukses dilampirkan sebagai bukti; status misi tidak berubah dan kriteria penerimaan tidak disentuh.</p>
      <ul className="cards">
        {runnable.map(cap => {
          const schema = schemaOf(cap)
          const required = Array.isArray(schema?.required) ? schema.required : []
          const needsSideEffectApproval = cap.sideEffects !== 'none'
          return (
            <li key={cap.id} className="card">
              <div className="card-text">
                <strong>{cap.name}</strong>
                <span className="meta">{cap.id} · {cap.statusLabel} · risiko {cap.risk}{cap.sideEffects !== 'none' ? ` · efek samping: ${cap.sideEffects}` : ''}</span>
                {required.map(key => (
                  <label key={key} className="cap-arg">
                    <span>{key}{schema?.properties?.[key]?.description ? ` — ${schema.properties[key].description}` : ''}</span>
                    <input className="input" value={argVals[`${cap.id}:${key}`] ?? ''} onChange={e => setArgVals(v => ({ ...v, [`${cap.id}:${key}`]: e.target.value }))} placeholder={schema?.properties?.[key]?.type === 'integer' ? 'angka' : 'teks'} />
                  </label>
                ))}
                {needsSideEffectApproval && (
                  <label className="cap-arg cap-confirm">
                    <input type="checkbox" checked={approved[cap.id] === true} onChange={e => setApproved(v => ({ ...v, [cap.id]: e.target.checked }))} />
                    <span>Saya menyetujui efek samping ({cap.sideEffects}) untuk kapabilitas ini</span>
                  </label>
                )}
                {last?.id === cap.id && <span className={cx('meta', last.ok ? 'text-ok' : 'text-danger')}>{last.text}</span>}
                {approvals[cap.id]?.status === 'pending' && (
                  <div className="cap-approval" role="group" aria-label={`Persetujuan tindakan ${cap.name}`}>
                    <span className="meta">Tindakan ini menunggu persetujuan khusus (terikat pada kapabilitas &amp; parameter yang diklik).</span>
                    <div className="cap-approval-actions">
                      <button type="button" className="btn-primary" disabled={busy === cap.id} onClick={() => void decide(cap, 'approved')}>
                        {busy === cap.id ? 'Memproses…' : 'Setujui tindakan'}
                      </button>
                      <button type="button" className="btn-ghost" disabled={busy === cap.id} onClick={() => void decide(cap, 'rejected')}>Tolak</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="card-actions">
                <button type="button" className="btn-primary" disabled={busy === cap.id || (needsSideEffectApproval && approved[cap.id] !== true)} onClick={() => void run(cap)}>
                  {busy === cap.id ? 'Menjalankan…' : 'Jalankan'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {err && <p className="state-msg error" role="alert">{err}</p>}
    </section>
  )
}

function MissionDetail({ m, caps, onChanged, onActivity }: { m: Mission; caps: CapabilityEntry[]; onChanged: (m: Mission) => void; onActivity: (s: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run(kind: 'approve' | 'retry') {
    setBusy(true); setErr(null)
    try {
      const next = await (kind === 'approve' ? api.approveMission(m.id) : api.retryMission(m.id))
      onChanged(next); onActivity(`Misi "${m.title}": ${STATE_LABEL[next.state]}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menjalankan misi.') } finally { setBusy(false) }
  }

  async function cancelMission() {
    setBusy(true); setErr(null)
    try {
      const next = await api.cancelMission(m.id)
      onChanged(next); onActivity(`Misi "${m.title}": ${STATE_LABEL[next.state]}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membatalkan misi.') } finally { setBusy(false) }
  }

  return (
    <article className="mission-detail" aria-label={`Detail misi ${m.title}`}>
      <header>
        <h2>{m.title}</h2>
        <span className={cx('pill', STATE_CLS[m.state])} data-testid="mission-state">{STATE_LABEL[m.state]}</span>
      </header>
      <p className="meta">Sumber: {m.fileName} · dibuat {fmtDate(m.createdAt)} · perencana: {m.planner === 'rule-based' ? 'berbasis aturan (bukan model AI)' : m.planner}</p>

      {m.state === 'draft' && (
        <div className="approval" role="group" aria-label="Persetujuan">
          <p><strong>Menunggu persetujuan Anda.</strong> Eksekusi hanya menulis artefak misi ini ({m.policy.writeScope}); tanpa akses jaringan; tidak ada tindakan destruktif.</p>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run('approve')}>{busy ? 'Menjalankan…' : 'Setujui & jalankan'}</button>
        </div>
      )}
      {m.failure && (
        <div className="failure" role="alert">
          <strong>{m.state === 'failed' ? 'Misi gagal' : 'Perlu perhatian'} — {m.failure.class}</strong>
          <p>{m.failure.message}</p>
          {m.failure.retryable
            ? <button type="button" className="btn-primary" disabled={busy} onClick={() => void run('retry')}><Icon name="retry" size={13} /> {busy ? 'Mencoba ulang…' : 'Coba ulang'}</button>
            : <p className="meta">Kegagalan ini tidak dapat dicoba ulang secara otomatis{m.state === 'needs_attention' ? ' — tinjau bukti di bawah' : ''}.</p>}
        </div>
      )}
      {(m.state === 'running' || m.state === 'queued') && (
        <div className="approval" role="group" aria-label="Pembatalan">
          <p>Misi sedang berjalan. Pembatalan berhenti kooperatif di antara langkah (langkah yang sedang berjalan diselesaikan dulu).</p>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void cancelMission()}>{busy ? 'Membatalkan…' : 'Batalkan misi'}</button>
        </div>
      )}
      {m.state === 'cancelled' && (
        <p className="meta" role="status">Misi dibatalkan oleh pengguna sebelum seluruh langkah selesai; artefak yang sudah ditulis tidak dihapus.</p>
      )}
      {err && <p className="state-msg error" role="alert">{err}</p>}

      <h3>Kriteria penerimaan</h3>
      <ul className="criteria">
        {m.acceptance.map(c => (
          <li key={c.id} className={c.status}>
            <span className={cx('pill', c.status === 'passed' ? 'ok' : c.status === 'failed' ? 'err' : '')}>{AC_LABEL[c.status]}</span>
            <div><span>{c.text}</span>{c.evidence && <span className="meta evidence">Bukti: {c.evidence}</span>}</div>
          </li>
        ))}
      </ul>

      <h3>Langkah eksekusi</h3>
      <ol className="steps">
        {m.steps.map(s => {
          const last = s.attempts[s.attempts.length - 1]
          return (
            <li key={s.id} className={s.status}>
              <span className="step-tool">{s.tool}</span>
              <span>{s.title}</span>
              <span className="meta">{STEP_LABEL[s.status]}{s.attempts.length > 1 ? ` · ${s.attempts.length} percobaan` : ''}
                {last?.execId ? ` · exec ${last.execId.slice(0, 8)}` : ''}{last?.finishedAt ? ` · ${last.finishedAt - last.startedAt} ms` : ''}{last && last.ok === false ? ` · ${last.error}` : ''}</span>
            </li>
          )
        })}
      </ol>

      {m.artifacts.length > 0 && (<>
        <h3>Artefak</h3>
        <ul className="cards">{m.artifacts.map(a => (
          <li key={a.name} className="card"><div className="card-text"><strong>{a.name}</strong><span className="meta">{fmtSize(a.size)} · sha256 {a.sha256.slice(0, 16)}…</span></div>
            <div className="card-actions"><a className="chip-btn" href={api.artifactUrl(m.id, a.name)} download={a.name}><Icon name="download" size={12} /> Unduh</a></div></li>
        ))}</ul>
      </>)}

      {(m.evidence?.length ?? 0) > 0 && (<>
        <h3>Bukti kapabilitas</h3>
        <ul className="cards">{m.evidence!.map(ev => (
          <li key={ev.name} className="card"><div className="card-text">
            <strong>{ev.name}</strong>
            <span className="meta">{ev.capabilityId} · {fmtSize(ev.size)} · sha256 {ev.sha256.slice(0, 16)}… · {new Date(ev.at).toLocaleString('id-ID')}</span>
          </div>
          <div className="card-actions">
            {!ev.ok && <span className="pill err">gagal</span>}
            <a className="chip-btn" href={api.evidenceUrl(m.id, ev.name)} download={ev.name}><Icon name="download" size={12} /> Unduh</a>
          </div></li>
        ))}</ul>
      </>)}

      <MissionCapabilityRunner m={m} caps={caps} onChanged={onChanged} onActivity={onActivity} />

      <AuditTrail missionId={m.id} missionTitle={m.title} />

      <details className="log"><summary>Log eksekusi ({m.log.length})</summary>
        <ul>{m.log.map((l, i) => <li key={i} className={l.level}><time>{new Date(l.at).toLocaleTimeString('id-ID')}</time> {l.msg}</li>)}</ul>
      </details>
    </article>
  )
}

export function MissionsPage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity: (m: string) => void }) {
  const [tab, setTab] = useState<'misi' | 'pengingat'>('misi')
  const missions = useLoad(api.missions)
  const files = useLoad(api.listFiles)
  const caps = useLoad(() => api.capabilityRegistry())
  const [selected, setSelected] = useState<string | null>(null)
  const [goal, setGoal] = useState('')
  const [fileId, setFileId] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const list = missions.data ?? []
  const current = list.find(m => m.id === selected) ?? null
  const tabular = (files.data ?? []).filter(f => TABULAR.has(f.ext))
  useEffect(() => { if (!selected && list.length) setSelected(list[0].id) }, [list, selected])

  const replace = (m: Mission) => missions.setData(prev => (prev ? prev.map(x => (x.id === m.id ? m : x)) : [m]))

  async function create(e: FormEvent) {
    e.preventDefault()
    setCreating(true); setErr(null)
    try {
      const m = await api.createMission(goal.trim(), fileId)
      missions.setData(prev => [m, ...(prev ?? [])]); setSelected(m.id); setGoal(''); setFileId(''); onActivity(`Misi dibuat (Draft): ${m.title}`)
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Gagal membuat misi.') } finally { setCreating(false) }
  }
  async function del(m: Mission) {
    if (!window.confirm(`Hapus misi "${m.title}" beserta artefaknya?`)) return
    try { await api.deleteMission(m.id); missions.setData(prev => (prev ?? []).filter(x => x.id !== m.id)); setSelected(null); onActivity(`Misi dihapus: ${m.title}`) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menghapus misi.') }
  }

  return (
    <PageShell title="Misi & Tugas" subtitle="Tujuan → kriteria penerimaan → persetujuan → eksekusi tool nyata → verifikasi → artefak." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}
      actions={<div className="tabs" role="tablist" aria-label="Bagian">
        {(['misi', 'pengingat'] as const).map(t => (
          <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className={cx('tab', tab === t && 'on')} onClick={() => setTab(t)}>{t === 'misi' ? 'Misi' : 'Pengingat'}</button>
        ))}</div>}>
      {tab === 'pengingat' ? (
        <div role="tabpanel" id="panel-pengingat" aria-labelledby="tab-pengingat" className="embedded"><ReminderWorkspace onActivity={onActivity} /></div>
      ) : (
        <div role="tabpanel" id="panel-misi" aria-labelledby="tab-misi">
          <section className="panel" aria-labelledby="mission-new-title">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="mission-new-title">Misi baru</h2>
                <p className="panel-sub">Perencanaan berbasis aturan dan eksekusi oleh tool lokal deterministik — bukan agen AI otonom. Setiap kriteria diverifikasi ulang secara independen dari data mentah.</p>
              </div>
            </div>
            <form className="mission-form panel-body" onSubmit={e => void create(e)}>
              <label className="field" htmlFor="m-goal">
                <span className="field-label">Tujuan misi</span>
                <textarea id="m-goal" value={goal} onChange={e => setGoal(e.target.value)} rows={2} maxLength={500} placeholder="Mis. Analisis data penjualan dan laporkan kualitas datanya" />
                <span className="field-hint">Tujuan dipakai sebagai judul misi dan mengarahkan kriteria penerimaan.</span>
              </label>
              <div className="form-grid">
                <label className="field" htmlFor="m-file">
                  <span className="field-label">File sumber</span>
                  <select id="m-file" className="select" value={fileId} onChange={e => setFileId(e.target.value)}>
                    <option value="">{tabular.length ? 'Pilih file data…' : 'Belum ada file data (unggah di Files & Artifacts)'}</option>
                    {tabular.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <span className="field-hint">Satu template tersedia: analisis data tabular (CSV, TSV, JSON, JSONL, XLSX).</span>
                </label>
              </div>
              {err && <p className="state-msg error" role="alert">{err}</p>}
              <div className="panel-foot">
                <button type="submit" className="btn-primary" disabled={goal.trim().length < 5 || !fileId || creating}>{creating ? 'Membuat…' : 'Buat misi (Draft)'}</button>
              </div>
            </form>
          </section>

          <StateMsg loading={missions.loading && !missions.data} error={missions.error} onRetry={missions.reload} />
          {!missions.loading && list.length === 0 && !missions.error && (
            <section className="panel" aria-labelledby="mission-list-title">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" id="mission-list-title">Daftar misi</h2>
                  <p className="panel-sub">Semua misi yang pernah dibuat di perangkat ini, terbaru di atas.</p>
                </div>
                <div className="panel-actions"><span className="pill neutral">0 misi</span></div>
              </div>
              <div className="empty-state">
                <p>Belum ada misi. Buat misi pertama Anda di atas — planner dan kriteria penerimaan muncul setelah itu.</p>
              </div>
            </section>
          )}
          {list.length > 0 && (
            <div className="mission-layout">
              <ul className="mission-list" aria-label="Daftar misi">
                {list.map(m => (
                  <li key={m.id}><button type="button" className={cx('mission-item', selected === m.id && 'on')} aria-current={selected === m.id} onClick={() => setSelected(m.id)}>
                    <strong>{m.title}</strong><span className={cx('pill', STATE_CLS[m.state])}>{STATE_LABEL[m.state]}</span>
                  </button></li>
                ))}
              </ul>
              <div>
                {current && <MissionDetail key={current.id} m={current} caps={caps.data?.items ?? []} onChanged={replace} onActivity={onActivity} />}
                {current && current.state !== 'running' && <button type="button" className="chip-btn danger del-mission" onClick={() => void del(current)}><Icon name="trash" size={12} /> Hapus misi</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}
