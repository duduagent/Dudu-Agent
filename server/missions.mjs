// Misi: tujuan bahasa natural → kriteria penerimaan eksplisit → rencana → persetujuan manusia →
// eksekusi tool lokal → verifikasi independen → artefak + bukti.
// PERENCANA berbasis aturan (BUKAN LLM). Satu-satunya template saat ini: "data-analysis".
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { isFileId } from './files.mjs'
import { TABULAR_EXTS, ToolError, independentRowCount, loadTable, profileTable, recomputeNumericStats, renderReport } from './data-tools.mjs'
import { buildEvent, createExecutionAudit, EVENT_TYPES, fileSummary } from './execution-audit.mjs'
import { digestOf, PERMISSIONS } from './permissions.mjs'

export class MissionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isMissionId = (id) => typeof id === 'string' && ID_RE.test(id)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

const STEPS = [
  { id: 's1', tool: 'input.validate', title: 'Validasi file sumber (ada, integritas SHA-256, format tabular)' },
  { id: 's2', tool: 'data.load', title: 'Muat dan parse data tabular' },
  { id: 's3', tool: 'data.profile', title: 'Hitung profil kolom dan statistik' },
  { id: 's4', tool: 'report.write', title: 'Tulis artefak report.md dan profile.json' },
  { id: 's5', tool: 'verify.criteria', title: 'Verifikasi kriteria penerimaan secara independen' },
]

const CRITERIA = [
  { id: 'ac1', text: 'Artefak report.md dan profile.json ada di disk, tidak kosong, dan hash-nya cocok dengan yang tercatat.' },
  { id: 'ac2', text: 'Jumlah baris di laporan sama dengan jumlah baris sumber yang dihitung ulang dengan implementasi terpisah.' },
  { id: 'ac3', text: 'Setiap kolom sumber muncul di laporan.' },
  { id: 'ac4', text: 'Min/maks/total tiap kolom numerik di profile.json sama dengan hitung ulang dari data mentah.' },
  { id: 'ac5', text: 'Setiap langkah tercatat dengan ID eksekusi dan stempel waktu.' },
]

export function createMissionService({ dataDir, files, fs = fsp, now = () => Date.now(), uuid = () => crypto.randomUUID(), maxAutoRetries = 1, audit: auditInjected = null }) {
  const dir = path.join(dataDir, 'missions')
  const artDir = (id) => path.join(dataDir, 'artifacts', id)
  const running = new Set()
  const cancelRequested = new Set()
  // Unified Execution Audit: jejak append-only untuk aktivitas misi (juga ditulis registry).
  const audit = auditInjected ?? createExecutionAudit({ dataDir, now, uuid })
  const emit = (eventType, payload = {}) => audit.append({
    ...buildEvent({ eventType, now, uuid, ...payload }),
    action: eventType,
  })
  const emitCritical = (eventType, payload = {}) => audit.appendCritical({
    ...buildEvent({ eventType, now, uuid, ...payload }),
    action: eventType,
  })
  class MissionCancelled extends Error {
    constructor() { super('Eksekusi misi dibatalkan oleh pengguna.'); this.code = 'cancelled' }
  }
  let recovered = false

  const file = (id) => { if (!isMissionId(id)) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.'); return path.join(dir, `${id}.json`) }

  async function persist(m) {
    m.updatedAt = now()
    await fs.mkdir(dir, { recursive: true })
    const f = file(m.id)
    const tmp = `${f}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(m), { mode: 0o600 })
    await fs.rename(tmp, f)
  }
  const log = (m, level, msg) => m.log.push({ at: now(), level, msg })

  /**
   * Digest rencana misi. Approval terikat pada digest ini: bila rencana (langkah/alat/target)
   * berubah secara material, approval lama tidak berlaku lagi.
   */
  function planDigest(m) {
    return digestOf({
      template: m.template,
      fileId: m.fileId,
      steps: (m.steps ?? []).map((s) => ({ id: s.id, tool: s.tool })),
    })
  }

  async function read(id) {
    try { const m = JSON.parse(await fs.readFile(file(id), 'utf8')); return m && m.id === id ? m : null } catch (e) { if (e instanceof MissionError) throw e; return null }
  }

  /** Misi yang tertinggal 'queued/running' (aplikasi ditutup di tengah jalan) tidak boleh terlihat berjalan selamanya. */
  async function recoverStale() {
    if (recovered) return
    recovered = true
    let names = []
    try { names = await fs.readdir(dir) } catch { return }
    for (const n of names) {
      const id = n.replace(/\.json$/, '')
      if (!isMissionId(id)) continue
      const m = await read(id)
      if (m && (m.state === 'running' || m.state === 'queued') && !running.has(id)) {
        m.state = 'needs_attention'
        m.failure = { class: 'tool_error', message: 'Eksekusi terputus (aplikasi ditutup saat misi berjalan). Misi dapat dilanjutkan.', retryable: true }
        for (const s of m.steps) if (s.status === 'running') s.status = 'pending'
        log(m, 'warn', 'Terdeteksi misi terputus saat aplikasi dimulai ulang.')
        await persist(m)
      }
    }
  }

  async function create({ goal, fileId }) {
    await recoverStale()
    const g = String(goal ?? '').trim()
    if (g.length < 5) throw new MissionError(400, 'bad_goal', 'Tujuan misi minimal 5 karakter.')
    if (g.length > 500) throw new MissionError(400, 'bad_goal', 'Tujuan misi maksimal 500 karakter.')
    if (!isFileId(fileId)) throw new MissionError(400, 'bad_file', 'Pilih file sumber.')
    const meta = await files.get(fileId)
    if (!meta) throw new MissionError(404, 'file_not_found', 'File sumber tidak ditemukan.')
    if (!TABULAR_EXTS.has(meta.ext)) throw new MissionError(422, 'input_invalid', `Template misi "analisis data" hanya mendukung csv, tsv, json, jsonl, xlsx — bukan .${meta.ext}.`)
    const t = now()
    const m = {
      id: uuid(), title: g.length > 60 ? g.slice(0, 57) + '…' : g, goal: g, template: 'data-analysis', planner: 'rule-based',
      fileId, fileName: meta.name, state: 'draft', createdAt: t, updatedAt: t,
      policy: { requiresApproval: true, writeScope: 'artefak misi ini saja', network: false, destructive: false, maxAutoRetries },
      approval: { status: 'pending' },
      approvals: [],
      correlationId: uuid(),
      acceptance: CRITERIA.map((c) => ({ ...c, status: 'pending' })),
      steps: STEPS.map((s) => ({ ...s, status: 'pending', attempts: [] })),
      artifacts: [], failure: null, log: [],
    }
    log(m, 'info', 'Misi dibuat sebagai Draft; menunggu persetujuan pengguna sebelum dieksekusi.')
    await persist(m)
    await emit(EVENT_TYPES.MISSION_CREATED, {
      missionId: m.id, actor: 'user', outcome: 'succeeded', correlationId: m.correlationId,
      detail: { template: m.template, file: fileSummary({ name: meta.name, size: meta.size, sha256: meta.sha256, mime: meta.mime }), criteria: m.acceptance.length },
    })
    await emit(EVENT_TYPES.MISSION_APPROVAL_REQUESTED, {
      missionId: m.id, actor: 'user', outcome: 'requested', correlationId: m.correlationId,
      detail: { scope: 'mission-plan', digest: planDigest(m) },
    })
    return m
  }

  async function list() { await recoverStale(); let names = []; try { names = await fs.readdir(dir) } catch { return [] } const ms = await Promise.all(names.filter((n) => n.endsWith('.json') && isMissionId(n.slice(0, -5))).map((n) => read(n.slice(0, -5)))); return ms.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt) }
  async function get(id) { await recoverStale(); return read(id) }

  async function remove(id) {
    const m = await read(id)
    if (!m) return false
    if (running.has(id) || m.state === 'running') throw new MissionError(409, 'running', 'Misi sedang berjalan; tidak dapat dihapus.')
    await fs.rm(artDir(id), { recursive: true, force: true })
    await fs.rm(file(id), { force: true })
    return true
  }

  async function artifactPath(id, name) {
    const m = await read(id)
    if (!m) return null
    const a = m.artifacts.find((x) => x.name === name)
    return a ? { path: path.join(artDir(id), a.name), artifact: a } : null
  }

  async function evidencePath(id, name) {
    const m = await read(id)
    if (!m) return null
    const e = (m.evidence ?? []).find((x) => x.name === name)
    return e ? { path: path.join(artDir(id), 'evidence', e.name), evidence: e } : null
  }

  /**
   * Lampirkan bukti eksekusi kapabilitas ke misi. Aditif: TIDAK mengubah acceptance criteria
   * atau artefak utama, sehingga integritas verifikasi misi tetap utuh.
   */
  async function attachEvidence(id, { capabilityId, ok, result, actor = 'local' } = {}) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    if (running.has(id) || m.state === 'running') throw new MissionError(409, 'running', 'Misi sedang berjalan; tunggu hingga selesai sebelum melampirkan bukti.')
    const cap = String(capabilityId ?? '').trim()
    if (!cap || cap.length > 160) throw new MissionError(400, 'bad_capability', 'ID kapabilitas tidak valid.')
    let payloadText
    try { payloadText = JSON.stringify({ missionId: id, capabilityId: cap, at: now(), actor, ok: Boolean(ok), result: result ?? null }, null, 2) } catch { throw new MissionError(400, 'bad_result', 'Hasil kapabilitas tidak dapat diserialisasi.') }
    if (payloadText.length > 500_000) throw new MissionError(413, 'result_too_large', 'Hasil kapabilitas terlalu besar untuk dijadikan bukti misi.')
    const slug = cap.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60)
    const name = `evidence-${now()}-${slug}.json`
    const buf = Buffer.from(payloadText, 'utf8')
    const folder = path.join(artDir(id), 'evidence')
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, name), buf)
    if (!Array.isArray(m.evidence)) m.evidence = []
    const rec = { name, size: buf.length, sha256: sha(buf), mime: 'application/json', capabilityId: cap, at: now(), ok: Boolean(ok) }
    m.evidence.push(rec)
    log(m, 'info', `Bukti kapabilitas ${cap} dilampirkan (${ok ? 'berhasil' : 'gagal'}, ${buf.length} B).`)
    await persist(m)
    return rec
  }

  /* ---------- approval terikat tindakan ---------- */

  /**
   * Approval untuk SATU tindakan (mis. menjalankan kapabilitas tertentu dengan parameter
   * tertentu). Terikat pada capability + operasi + target + digest parameter, punya masa
   * berlaku, dan hanya bisa dipakai SATU KALI (consumed) — persetujuan umum atas misi
   * bukan izin tanpa batas.
   */
  async function requestApproval(id, { capabilityId, operation = 'run', target = null, args = {}, actor = 'user', ttlMs = 15 * 60_000 } = {}) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    const cap = String(capabilityId ?? '').trim()
    if (!cap || cap.length > 160) throw new MissionError(400, 'bad_capability', 'ID kapabilitas tidak valid.')
    if (!Array.isArray(m.approvals)) m.approvals = []
    const digest = digestOf({ capabilityId: cap, operation, target, args }) ?? null
    const rec = {
      id: uuid(), kind: 'capability', capabilityId: cap, operation, target: target ?? null, paramsDigest: digest,
      status: 'pending', actor, createdAt: now(), expiresAt: now() + Math.max(1000, Number(ttlMs) || 0), decidedAt: null,
    }
    m.approvals.push(rec)
    log(m, 'info', `Persetujuan tindakan diminta: ${cap} (${operation}).`)
    await persist(m)
    await emit(EVENT_TYPES.MISSION_APPROVAL_REQUESTED, {
      missionId: m.id, capabilityId: cap, actor, outcome: 'requested', correlationId: m.correlationId,
      detail: { approvalId: rec.id, operation, target: rec.target, paramsDigest: digest, expiresAt: rec.expiresAt },
    })
    return rec
  }

  async function decideApproval(id, approvalId, { decision = 'approved', actor = 'user', ttlMs = 15 * 60_000 } = {}) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    const rec = (m.approvals ?? []).find((a) => a.id === approvalId)
    if (!rec) throw new MissionError(404, 'approval_not_found', 'Persetujuan tidak ditemukan.')
    if (rec.status !== 'pending') throw new MissionError(409, 'approval_not_pending', `Persetujuan sudah berstatus ${rec.status}.`)
    if (decision === 'rejected') {
      rec.status = 'rejected'; rec.decidedAt = now(); rec.actor = actor
      log(m, 'warn', `Persetujuan ditolak: ${rec.capabilityId}.`)
      await persist(m)
      await emit(EVENT_TYPES.MISSION_REJECTED, {
        missionId: m.id, capabilityId: rec.capabilityId, actor, outcome: 'rejected', correlationId: m.correlationId,
        detail: { approvalId: rec.id, operation: rec.operation },
      })
      return rec
    }
    // Audit WAJIB DULU:permission tidak boleh diberikan bila jejak audit tak dapat ditulis
    // (fail-closed). Kalau audit gagal, approval TIDAK berubah status dan tidak disimpan.
    const expiresAt = now() + Math.max(1000, Number(ttlMs) || 0)
    await emitCritical(EVENT_TYPES.MISSION_APPROVED, {
      missionId: m.id, capabilityId: rec.capabilityId, actor, outcome: 'succeeded', correlationId: m.correlationId,
      detail: { approvalId: rec.id, operation: rec.operation, paramsDigest: rec.paramsDigest, expiresAt },
    })
    rec.status = 'approved'; rec.decidedAt = now(); rec.actor = actor
    rec.expiresAt = expiresAt
    log(m, 'info', `Persetujuan diberikan: ${rec.capabilityId} (${rec.operation}).`)
    await persist(m)
    return rec
  }

  /**
   * Cari approval yang SAH untuk tindakan tertentu: disetujui, belum kedaluwarsa,
   * dan digest parameter masih cocok. Mengembalikan { rec } atau { expired: true } / { mismatch: true }.
   */
  function findValidApproval(m, { capabilityId, operation = 'run', target = null, args = {} }) {
    const digest = digestOf({ capabilityId, operation, target, args }) ?? null
    const list = (m.approvals ?? []).filter((a) => a.capabilityId === capabilityId && a.operation === operation)
    for (const rec of list) {
      if (rec.status === 'approved' && rec.paramsDigest !== digest) return { rec, mismatch: true }
    }
    const usable = list.filter((a) => a.status === 'approved' && a.paramsDigest === digest)
    const fresh = usable.find((a) => Number(a.expiresAt ?? 0) > now())
    if (fresh) return { rec: fresh }
    if (usable.length) return { rec: usable[0], expired: true }
    return { rec: null }
  }

  async function listApprovals(id) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    return m.approvals ?? []
  }

  /** Tandai approval sudah dipakai (satu kali pakai) dan simpan ke store. */
  async function consumeApproval(id, approvalId) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    const rec = (m.approvals ?? []).find((a) => a.id === approvalId)
    if (!rec) return null
    rec.status = 'consumed'; rec.decidedAt = now()
    await persist(m)
    return rec
  }

  /* ---------- eksekusi ---------- */

  async function approve(id, { actor = 'user' } = {}) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    if (m.state !== 'draft') throw new MissionError(409, 'bad_state', `Misi berstatus ${m.state}; hanya Draft yang dapat disetujui.`)
    // Approval terikat pada rencana: digest menggabungkan langkah, alat, dan file sumber.
    const digest = planDigest(m)
    // Audit WAJIB DULU: approval adalah kontrol keamanan. Bila audit tidak dapat ditulis,
    // permission TIDAK diberikan sama sekali (fail-closed) — bukan "disetujui tapi tak tercatat".
    await emitCritical(EVENT_TYPES.MISSION_APPROVED, {
      missionId: m.id, actor, outcome: 'succeeded', correlationId: m.correlationId,
      detail: { scope: 'mission-plan', digest },
    })
    m.approval = { status: 'approved', at: now(), scope: { kind: 'mission-plan', digest, expiresAt: null } }
    m.actor = actor
    log(m, 'info', 'Pengguna menyetujui eksekusi.')
    await persist(m)
    return execute(m)
  }

  async function retry(id) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    if (m.state !== 'needs_attention' || !m.failure?.retryable) throw new MissionError(409, 'not_retryable', 'Misi ini tidak dapat dicoba ulang.')
    if (m.approval.status !== 'approved') throw new MissionError(409, 'not_approved', 'Misi belum disetujui.')
    log(m, 'info', 'Pengguna meminta percobaan ulang manual.')
    return execute(m)
  }

  /**
   * Pembatalan kooperatif. Dilakukan di antara langkah eksekusi, bukan mematikan langkah yang sedang
   * berjalan secara paksa. Hasil akhirnya adalah state 'cancelled' dengan tanpa `failure`.
   */
  async function cancel(id) {
    const m = await get(id)
    if (!m) throw new MissionError(404, 'not_found', 'Misi tidak ditemukan.')
    if (m.state !== 'running' && m.state !== 'queued') throw new MissionError(409, 'not_cancellable', `Misi berstatus ${m.state}; hanya misi berjalan/antre yang dapat dibatalkan.`)
    if (cancelRequested.has(id)) throw new MissionError(409, 'already_cancelling', 'Pembatalan sudah diminta.')
    cancelRequested.add(id)
    log(m, 'warn', 'Permintaan pembatalan diterima; eksekusi berhenti di antara langkah.')
    await emit(EVENT_TYPES.MISSION_CANCEL_REQUESTED, {
      missionId: m.id, actor: 'user', outcome: 'requested', correlationId: m.correlationId,
      detail: { state: m.state },
    })
    await persist(m).catch(() => {})
    return m
  }

  async function execute(m) {
    if (running.has(m.id)) throw new MissionError(409, 'running', 'Misi sudah berjalan.')
    // Approval WAJIB berlaku dan masih mencakup rencana saat ini (scope terikat).
    // Misi lama (v0.5.0/v0.6.2) tidak punya scope → approval lamanya tetap dihormati.
    if (m.approval?.status !== 'approved') throw new MissionError(409, 'approval_required', 'Misi belum disetujui.')
    const scope = m.approval?.scope
    if (scope?.digest && scope.digest !== planDigest(m)) {
      throw new MissionError(409, 'approval_scope_mismatch', 'Rencana misi berubah setelah persetujuan; persetujuan ulang diperlukan.')
    }
    running.add(m.id)
    cancelRequested.delete(m.id)
    const ctx = {}
    try {
      // Event WAJIB: eksekusi tidak boleh berjalan bila audit tidak bisa dicatat.
      await emitCritical(EVENT_TYPES.MISSION_STARTED, {
        missionId: m.id, actor: m.actor ?? 'user', outcome: 'requested', correlationId: m.correlationId,
        detail: { template: m.template, steps: m.steps.length },
      })
      m.state = 'queued'; m.failure = null; await persist(m)
      m.state = 'running'; log(m, 'info', 'Eksekusi dimulai.'); await persist(m)
      const handlers = {
        's1': () => stepValidate(m, ctx), 's2': () => stepLoad(ctx), 's3': () => stepProfile(ctx),
        's4': () => stepWrite(m, ctx), 's5': () => stepVerify(m, ctx),
      }
      for (const step of m.steps) {
        // s1–s3 membangun konteks di memori sehingga selalu dijalankan ulang (murah); s4–s5 dilewati bila sudah selesai (retry parsial).
        if (step.status === 'done' && (step.id === 's4' || step.id === 's5')) continue
        // Cek pembatalan hanya di antara langkah; langkah yang sudah berjalan tidak dipaksa dimatikan.
        if (cancelRequested.has(m.id)) throw new MissionCancelled()
        await runStep(m, step, handlers[step.id])
      }
      m.state = 'completed'; log(m, 'info', 'Semua langkah selesai dan seluruh kriteria penerimaan lulus.')
      await emit(EVENT_TYPES.MISSION_COMPLETED, {
        missionId: m.id, actor: m.actor ?? 'user', outcome: 'succeeded', correlationId: m.correlationId,
        detail: { steps: m.steps.length, artifacts: m.artifacts.length, criteriaPassed: m.acceptance.filter((c) => c.status === 'passed').length },
      })
    } catch (e) {
      if (e instanceof MissionCancelled || e?.code === 'cancelled') {
        m.state = 'cancelled'; m.failure = null
        log(m, 'info', 'Eksekusi dibatalkan oleh pengguna sebelum langkah berikutnya selesai.')
        await emit(EVENT_TYPES.MISSION_CANCELLED, {
          missionId: m.id, actor: m.actor ?? 'user', outcome: 'cancelled', correlationId: m.correlationId,
          detail: { reason: 'dibatalkan_pengguna' },
        })
      } else {
        const cls = e?.class || 'tool_error'
        const msg = String(e?.message || e).slice(0, 400)
        if (cls === 'input_invalid' || cls === 'parse_error') {
          m.state = 'failed'; m.failure = { class: cls, message: msg, retryable: false }
        } else if (cls === 'verification_failed') {
          m.state = 'needs_attention'; m.failure = { class: cls, message: msg, retryable: false } // butuh tinjauan manusia; mengulang tidak mengubah hasil deterministik
        } else {
          m.state = 'needs_attention'; m.failure = { class: 'tool_error', message: msg, retryable: true }
        }
        log(m, 'error', `Misi berhenti: [${m.failure.class}] ${msg}`)
        // Status TERMINAL dicatat apa adanya: failed / needs_attention — BUKAN completed.
        await emit(m.state === 'failed' ? EVENT_TYPES.MISSION_FAILED : EVENT_TYPES.MISSION_NEEDS_ATTENTION, {
          missionId: m.id, actor: m.actor ?? 'user', outcome: 'failed', correlationId: m.correlationId,
          detail: { class: m.failure.class, error: msg, retryable: m.failure.retryable },
        })
      }
    } finally {
      running.delete(m.id)
      cancelRequested.delete(m.id)
      await persist(m).catch(() => {})
    }
    return m
  }

  async function runStep(m, step, fn) {
    for (let attempt = 1; attempt <= 1 + maxAutoRetries; attempt++) {
      const rec = { execId: uuid(), startedAt: now(), attempt }
      step.attempts.push(rec); step.status = 'running'; await persist(m)
      // Event WAJIB sebelum langkah dijalankan: bila audit tak bisa ditulis, langkah TIDAK dijalankan.
      await emitCritical(EVENT_TYPES.TOOL_EXECUTION_STARTED, {
        missionId: m.id, taskId: step.id, execId: rec.execId, actor: m.actor ?? 'user',
        outcome: 'requested', correlationId: m.correlationId,
        detail: { tool: step.tool, attempt, required: [PERMISSIONS.FILE_READ] },
      })
      await emit(EVENT_TYPES.TASK_STARTED, {
        missionId: m.id, taskId: step.id, execId: rec.execId, actor: m.actor ?? 'user',
        outcome: 'requested', correlationId: m.correlationId, detail: { tool: step.tool, attempt },
      })
      try {
        step.output = await fn()
        rec.finishedAt = now(); rec.ok = true; step.status = 'done'
        log(m, 'info', `${step.tool} selesai (exec ${rec.execId.slice(0, 8)}).`); await persist(m)
        await emit(EVENT_TYPES.TOOL_EXECUTION_SUCCEEDED, {
          missionId: m.id, taskId: step.id, execId: rec.execId, actor: m.actor ?? 'user',
          outcome: 'succeeded', correlationId: m.correlationId,
          detail: { tool: step.tool, attempt, durationMs: rec.finishedAt - rec.startedAt },
        })
        return
      } catch (e) {
        rec.finishedAt = now(); rec.ok = false; rec.error = String(e?.message || e).slice(0, 300); rec.class = e?.class || 'tool_error'
        step.status = 'failed'
        await emit(EVENT_TYPES.TOOL_EXECUTION_FAILED, {
          missionId: m.id, taskId: step.id, execId: rec.execId, actor: m.actor ?? 'user',
          outcome: 'failed', correlationId: m.correlationId,
          detail: { tool: step.tool, attempt, class: rec.class, error: rec.error },
        })
        // Retry otomatis HANYA untuk kegagalan tool sementara, dan dibatasi maxAutoRetries.
        if (rec.class === 'tool_error' && attempt <= maxAutoRetries) {
          log(m, 'warn', `${step.tool} gagal (${rec.error}); mencoba ulang otomatis (${attempt}/${maxAutoRetries}).`)
          await emit(EVENT_TYPES.TOOL_RETRY_SCHEDULED, {
            missionId: m.id, taskId: step.id, execId: rec.execId, actor: 'system',
            outcome: 'requested', correlationId: m.correlationId,
            detail: { tool: step.tool, attempt, nextAttempt: attempt + 1, maxAutoRetries },
          })
          continue
        }
        throw e
      }
    }
  }

  async function sourceOf(m) {
    const meta = await files.get(m.fileId)
    if (!meta) throw new ToolError('input_invalid', 'File sumber sudah dihapus.')
    const bytes = await files.readBytes(m.fileId)
    if (!bytes) throw new ToolError('input_invalid', 'Isi file sumber tidak dapat dibaca.')
    return { meta, bytes }
  }

  async function stepValidate(m, ctx) {
    const { meta, bytes } = await sourceOf(m)
    if (sha(bytes) !== meta.sha256) throw new ToolError('input_invalid', 'Integritas file gagal: SHA-256 tidak cocok dengan metadata (file berubah/rusak).')
    if (!TABULAR_EXTS.has(meta.ext)) throw new ToolError('input_invalid', `Format .${meta.ext} tidak didukung.`)
    ctx.meta = meta; ctx.bytes = bytes
    return { file: meta.name, bytes: bytes.length, sha256: meta.sha256 }
  }
  async function stepLoad(ctx) {
    if (!ctx.bytes) throw new ToolError('tool_error', 'Konteks sumber hilang.')
    ctx.table = loadTable({ ext: ctx.meta.ext, bytes: ctx.bytes })
    return { rows: ctx.table.rows.length, columns: ctx.table.columns.length, sheet: ctx.table.sheet ?? null }
  }
  async function stepProfile(ctx) {
    ctx.profile = profileTable(ctx.table)
    return { rowCount: ctx.profile.rowCount, columnCount: ctx.profile.columnCount }
  }
  async function stepWrite(m, ctx) {
    const gen = now()
    const report = renderReport({ goal: m.goal, file: ctx.meta, profile: ctx.profile, generatedAt: gen })
    const profileJson = JSON.stringify({ goal: m.goal, source: { name: ctx.meta.name, sha256: ctx.meta.sha256 }, generatedAt: gen, profile: ctx.profile }, null, 2)
    try {
      await fs.mkdir(artDir(m.id), { recursive: true })
      const out = []
      for (const [name, content, mime] of [['report.md', report, 'text/markdown'], ['profile.json', profileJson, 'application/json']]) {
        const buf = Buffer.from(content, 'utf8')
        await fs.writeFile(path.join(artDir(m.id), name), buf)
        out.push({ name, size: buf.length, sha256: sha(buf), mime })
        await emit(EVENT_TYPES.ARTIFACT_CREATED, {
          missionId: m.id, taskId: 's4', execId: m.steps.find((s) => s.id === 's4')?.attempts?.at(-1)?.execId ?? null,
          actor: m.actor ?? 'user', outcome: 'succeeded', correlationId: m.correlationId,
          detail: { artifact: fileSummary({ name, size: buf.length, sha256: sha(buf), mime }) },
        })
      }
      m.artifacts = out
    } catch (e) { throw new ToolError('tool_error', `Gagal menulis artefak: ${e.message}`) }
    return { artifacts: m.artifacts.map((a) => a.name) }
  }

  async function stepVerify(m, ctx) {
    const results = []
    const mark = (id, ok, evidence) => results.push({ id, ok, evidence })
    // AC1: baca ULANG dari disk dan bandingkan hash
    let reportText = '', profileDisk = null
    try {
      let ok = m.artifacts.length === 2
      const ev = []
      for (const a of m.artifacts) {
        const buf = await fs.readFile(path.join(artDir(m.id), a.name))
        const good = buf.length > 0 && sha(buf) === a.sha256
        ev.push(`${a.name}: ${buf.length} B, sha256 ${good ? 'cocok' : 'TIDAK cocok'}`)
        ok = ok && good
        if (a.name === 'report.md') reportText = buf.toString('utf8')
        if (a.name === 'profile.json') profileDisk = JSON.parse(buf.toString('utf8'))
      }
      mark('ac1', ok, ev.join('; '))
    } catch (e) { mark('ac1', false, `Gagal membaca artefak: ${e.message}`) }
    // AC2: hitung ulang jumlah baris dengan implementasi terpisah dari bytes yang dibaca ulang dari penyimpanan
    try {
      const fresh = await files.readBytes(m.fileId)
      const independent = independentRowCount(ctx.meta.ext, fresh)
      const claimed = Number(/Jumlah baris data: (\d+)/.exec(reportText)?.[1])
      const inJson = profileDisk?.profile?.rowCount
      mark('ac2', independent === claimed && independent === inJson, `hitung-ulang=${independent}, laporan=${claimed}, profile.json=${inJson}`)
    } catch (e) { mark('ac2', false, `Hitung ulang gagal: ${e.message}`) }
    // AC3: semua kolom ada di laporan
    const missing = ctx.table.columns.filter((c) => !reportText.includes(c.replace(/\|/g, '\\|')))
    mark('ac3', missing.length === 0 && ctx.table.columns.length > 0, missing.length ? `Kolom hilang dari laporan: ${missing.join(', ')}` : `${ctx.table.columns.length} kolom ditemukan di laporan`)
    // AC4: statistik numerik dihitung ulang dari data mentah yang di-parse ulang
    try {
      const fresh = loadTable({ ext: ctx.meta.ext, bytes: await files.readBytes(m.fileId) })
      const re = recomputeNumericStats(fresh)
      const bad = []
      for (const [name, st] of Object.entries(re)) {
        const p = profileDisk?.profile?.columns?.find((c) => c.name === name)
        const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
        if (!p || !near(p.min, st.min) || !near(p.max, st.max) || !near(p.sum, st.sum)) bad.push(name)
      }
      const pNum = (profileDisk?.profile?.columns ?? []).filter((c) => c.type === 'integer' || c.type === 'number').map((c) => c.name).sort().join(',')
      if (pNum !== Object.keys(re).sort().join(',')) bad.push('(himpunan kolom numerik berbeda)')
      mark('ac4', bad.length === 0, bad.length ? `Tidak cocok: ${bad.join(', ')}` : `${Object.keys(re).length} kolom numerik cocok`)
    } catch (e) { mark('ac4', false, `Hitung ulang gagal: ${e.message}`) }
    // AC5: setiap langkah sebelumnya punya execId + stempel waktu
    const prior = m.steps.filter((s) => s.id !== 's5')
    const ok5 = prior.every((s) => s.status === 'done' && s.attempts.some((a) => a.ok && a.execId && a.startedAt && a.finishedAt))
    mark('ac5', ok5, `${prior.filter((s) => s.status === 'done').length}/${prior.length} langkah berstatus selesai dengan ID eksekusi`)

    for (const r of results) { const c = m.acceptance.find((x) => x.id === r.id); c.status = r.ok ? 'passed' : 'failed'; c.evidence = r.evidence; c.checkedAt = now() }
    const failed = results.filter((r) => !r.ok)
    // Event verifikasi: lulus/gagal — BUKAN "mission completed".
    await emit(failed.length ? EVENT_TYPES.VERIFICATION_FAILED : EVENT_TYPES.VERIFICATION_PASSED, {
      missionId: m.id, taskId: 's5', execId: m.steps.find((s) => s.id === 's5')?.attempts?.at(-1)?.execId ?? null,
      actor: 'system', outcome: failed.length ? 'failed' : 'succeeded', correlationId: m.correlationId,
      detail: { passed: results.length - failed.length, failed: failed.map((f) => f.id), criteria: results.map((r) => ({ id: r.id, ok: r.ok, evidence: r.evidence })) },
    })
    if (failed.length) throw new ToolError('verification_failed', `Kriteria gagal: ${failed.map((f) => f.id).join(', ')}. ${failed.map((f) => f.evidence).join(' | ')}`)
    return { passed: results.length }
  }

  return { create, list, get, remove, approve, retry, cancel, artifactPath, evidencePath, attachEvidence, requestApproval, decideApproval, findValidApproval, listApprovals, consumeApproval, planDigest }
}
