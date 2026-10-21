// Unified Execution Audit — satu jejak append-only untuk aktivitas misi DAN eksekusi kapabilitas.
//
// Prinsip:
//  - Skema event seragam: eventId, timestamp, eventType, missionId, taskId, execId,
//    capabilityId, actor, outcome, correlationId. Field yang tidak diketahui bernilai null
//    (TIDAK dikarang).
//  - Isi event disamarkan (rahasia/credential/Bearer → [REDACTED]); isi file pengguna
//    tidak pernah ditulis penuh — hanya ringkasan/ukuran/hash.
//  - append-only; file yang sama dipakai event lama (capability) dan event baru (unified),
//    sehingga tidak perlu migrasi dan riwayat lama tetap terbaca.
//  - appendCritical() gagal-tertutup: operasi berisiko yang auditnya wajib tidak berjalan
//    bila event tidak bisa dicatat.
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const AUDIT_FILE = 'capability-audit.jsonl'

/** Jenis event yang dipakai seluruh aplikasi (nama konsisten: '<objek>.<aksi>'). */
export const EVENT_TYPES = Object.freeze({
  MISSION_CREATED: 'mission.created',
  MISSION_APPROVAL_REQUESTED: 'mission.approval_requested',
  MISSION_APPROVED: 'mission.approved',
  MISSION_REJECTED: 'mission.rejected',
  MISSION_STARTED: 'mission.started',
  MISSION_CANCEL_REQUESTED: 'mission.cancel_requested',
  MISSION_CANCELLED: 'mission.cancelled',
  TASK_STARTED: 'task.started',
  TOOL_EXECUTION_STARTED: 'tool.execution_started',
  TOOL_EXECUTION_SUCCEEDED: 'tool.execution_succeeded',
  TOOL_EXECUTION_FAILED: 'tool.execution_failed',
  TOOL_RETRY_SCHEDULED: 'tool.retry_scheduled',
  ARTIFACT_CREATED: 'artifact.created',
  VERIFICATION_PASSED: 'verification.passed',
  VERIFICATION_FAILED: 'verification.failed',
  MISSION_COMPLETED: 'mission.completed',
  MISSION_FAILED: 'mission.failed',
  MISSION_NEEDS_ATTENTION: 'mission.needs_attention',
  CAPABILITY_VALIDATED: 'capability.validated',
  PERMISSION_DENIED: 'permission.denied',
  APPROVAL_EXPIRED: 'approval.expired',
})

export class AuditError extends Error {
  constructor(message, cause) { super(message); this.code = 'audit_unavailable'; this.status = 500; this.cause = cause }
}

/** Argumen/rahasia tidak boleh masuk audit/log. Kunci sensitif disamarkan, nilai panjang dipotong. */
export function redact(value, depth = 0) {
  if (depth > 6) return '[kedalaman dibatasi]'
  if (value == null) return value
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/\b(sk-[A-Za-z0-9]{12,})/g, '[REDACTED]')
      .slice(0, 2000)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      out[k] = /secret|token|password|passwd|api[_-]?key|authorization|cookie|credential/i.test(k) ? '[REDACTED]' : redact(v, depth + 1)
    }
    return out
  }
  return String(value).slice(0, 200)
}

/** Ringkasan aman untuk data pengguna: hanya nama/ukuran/hash, bukan isi berkas. */
export function fileSummary({ name, size, sha256, mime } = {}) {
  return { name: name ? String(name).slice(0, 160) : null, size: Number.isFinite(size) ? size : null, sha256: sha256 ?? null, mime: mime ?? null }
}

/**
 * Pembuat event unified. `now`/`uuid` dapat di-override untuk tes deterministik.
 * Field yang tidak diketahui diisi null, bukan ditebak.
 */
export function buildEvent({
  eventType, missionId = null, taskId = null, execId = null, capabilityId = null,
  actor = 'system', outcome = null, correlationId = null, detail = null,
  idempotencyKey = null, now = () => Date.now(), uuid = () => crypto.randomUUID(),
} = {}) {
  if (!eventType) throw new AuditError('eventType wajib diisi.')
  const ts = now()
  return {
    eventId: uuid(),
    at: new Date(ts).toISOString(),
    ts,
    eventType,
    missionId: missionId ?? null,
    taskId: taskId ?? null,
    execId: execId ?? null,
    capabilityId: capabilityId ?? null,
    actor: actor ? String(actor).slice(0, 80) : 'system',
    outcome: outcome ?? null,
    correlationId: correlationId ?? null,
    idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 200) : null,
    detail: detail == null ? null : redact(detail),
  }
}

export function createExecutionAudit({ dataDir, now = () => Date.now(), uuid = () => crypto.randomUUID(), dedupeWindowMs = 60_000 } = {}) {
  const auditPath = path.join(dataDir, AUDIT_FILE)
  const seen = new Map() // idempotencyKey → waktu tulis terakhir (mencegah event duplikat)

  async function write(event) {
    await fsp.mkdir(dataDir, { recursive: true })
    await fsp.appendFile(auditPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
  }

  /**
   * Tulis event. Tidak melempar error (best-effort) — untuk event informatif.
   * Mengembalikan { ok, skipped }.
   */
  async function append(event) {
    try {
      if (event?.idempotencyKey) {
        const last = seen.get(event.idempotencyKey)
        if (last != null && now() - last < dedupeWindowMs) return { ok: true, skipped: true }
        seen.set(event.idempotencyKey, now())
      }
      await write(event)
      return { ok: true, skipped: false }
    } catch (e) {
      return { ok: false, skipped: false, error: String(e?.message ?? e).slice(0, 200) }
    }
  }

  /**
   * Tulis event yang WAJIB tercatat sebelum tindakan berisiko dijalankan.
   * Melempar AuditError bila penyimpanan gagal → tindakan berisiko TIDAK dijalankan
   * (fail-closed untuk kontrol keamanan).
   */
  async function appendCritical(event) {
    if (event?.idempotencyKey) {
      const last = seen.get(event.idempotencyKey)
      if (last != null && now() - last < dedupeWindowMs) return { ok: true, skipped: true }
      seen.set(event.idempotencyKey, now())
    }
    try {
      await write(event)
      return { ok: true, skipped: false }
    } catch (e) {
      throw new AuditError('Audit tidak dapat ditulis; tindakan berisiko dibatalkan.', e)
    }
  }

  /** Baca jejak audit (terakhir ke pertama). Event lama tanpa eventType tetap dikembalikan apa adanya. */
  async function read({ limit = 100, missionId = null, eventType = null, correlationId = null } = {}) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 1000)
    const text = await fsp.readFile(auditPath, 'utf8').catch(() => '')
    const all = []
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if (!e || typeof e !== 'object') continue
        if (missionId && e.missionId !== missionId) continue
        if (eventType && e.eventType !== eventType) continue
        if (correlationId && e.correlationId !== correlationId) continue
        all.push(e)
      } catch { /* baris rusak: lewati, jangan gagalkan seluruh pembacaan */ }
    }
    return { events: all.slice(-n), count: all.length, file: AUDIT_FILE }
  }

  return { append, appendCritical, read, path: auditPath, file: AUDIT_FILE }
}
