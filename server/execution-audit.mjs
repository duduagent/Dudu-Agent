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
//
// v0.6.4 — integritas & skala:
//  - Redaksi berlaku DI SELURUH jalur: saat menulis (args/error/detail) DAN saat membaca
//    (termasuk event legacy yang mungkin ditulis sebelum redaksi error ada).
//  - Hash chaining: tiap event memuat prevHash + hash. Rantai terputus bila isi event
//    yang sudah tertulis diubah. Batasnya jujur: penyerang yang bisa menulis ulang SELURUH
//    berkas tetap dapat membangun rantai baru — ini deteksi perubahan lokal, bukan
//    tamper-proof, dan bukan tanda tangan (tidak ada pengelolaan kunci).
//  - Rotasi berbasis ukuran dengan batas retensi; saat disk penuh penulisan gagal →
//    append() melaporkan gagalnya, appendCritical() melempar (fail-closed tetap berlaku).
//  - Pembacaan memakai halaman (limit/offset) + filter, tidak memuat seluruh berkas ke memori.
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const AUDIT_FILE = 'capability-audit.jsonl'
/** Batas ukuran berkas audit aktif sebelum dirotasi (8 MiB). */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
/** Berapa generasi rotasi yang disimpan (aktif + 3 arsip). */
export const DEFAULT_KEEP_GENERATIONS = 3
const MAX_LIMIT = 500
const MAX_OFFSET = 5000

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

/** Outcome yang boleh muncul di event (kosong = belum diketahui). */
export const AUDIT_OUTCOMES = Object.freeze([
  'requested', 'succeeded', 'failed', 'denied', 'cancelled', 'rejected', 'unverified',
])

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

/** Serialisasi kanonik (kunci terurut) agar hash stabil lintas mesin & urutan kunci. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

/** Hash event: sha256(prevHash + isi kanonik event tanpa field `hash`). */
export function hashEvent(event, prevHash) {
  const { hash: _ignored, ...rest } = event
  return crypto.createHash('sha256').update(`${prevHash ?? 'genesis'}\n${canonicalJson(rest)}`).digest('hex')
}

/**
 * Sanitasi event saat PEMBACAAN (pertahanan lapis kedua).
 * Menjamin: nilai yang berpotensi rahasia disamarkan, string dipotong, dan event
 * legacy (tanpa eventType) tetap terbaca apa adanya tanpa tambahan field karangan.
 */
export function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return null
  const out = { ...event }
  // Field yang boleh membawa isi bebas → wajib melewati redaksi.
  for (const key of ['detail', 'args', 'error', 'result', 'output']) {
    if (key in out) out[key] = redact(out[key])
  }
  if (typeof out.actor === 'string') out.actor = out.actor.slice(0, 80)
  if (typeof out.eventType === 'string') out.eventType = out.eventType.slice(0, 80)
  if (typeof out.capabilityId === 'string') out.capabilityId = out.capabilityId.slice(0, 200)
  return out
}

/**
 * Bentuk stabil untuk konsumen API: field unified SELALU ada (null bila tidak tercatat),
 * event lama (tanpa eventType) ditandai `legacy: true` dan field legasinya tetap dipertahankan.
 * Men-add `null` BUKAN mengarang nilai — null berarti "tidak tercatat".
 */
export function normalizeEvent(event) {
  const s = sanitizeEvent(event)
  if (!s) return null
  const legacy = !s.eventType
  return {
    ...s,
    eventId: s.eventId ?? null,
    at: s.at ?? null,
    ts: s.ts ?? null,
    eventType: s.eventType ?? null,
    missionId: s.missionId ?? null,
    taskId: s.taskId ?? null,
    execId: s.execId ?? null,
    capabilityId: s.capabilityId ?? null,
    actor: s.actor ?? null,
    outcome: s.outcome ?? null,
    correlationId: s.correlationId ?? null,
    legacy,
  }
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

export function createExecutionAudit({
  dataDir,
  now = () => Date.now(),
  uuid = () => crypto.randomUUID(),
  dedupeWindowMs = 60_000,
  maxBytes = DEFAULT_MAX_BYTES,
  keepGenerations = DEFAULT_KEEP_GENERATIONS,
  chain = true,
} = {}) {
  const auditPath = path.join(dataDir, AUDIT_FILE)
  const seen = new Map() // idempotencyKey → waktu tulis TERAKHIR BERHASIL (mencegah event duplikat)
  let lastHash = null       // hash event terakhir yang ditulis (untuk chaining)
  let lastHashLoaded = false

  /** Nama berkas rotasi: capability-audit.jsonl → .1 → .2 → .3 */
  const rotatedPath = (n) => path.join(dataDir, `${AUDIT_FILE.replace(/\.jsonl$/, '')}.${n}.jsonl`)

  async function write(event) {
    await fsp.mkdir(dataDir, { recursive: true })
    await fsp.appendFile(auditPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
  }

  /** Rotasi berbasis ukuran: arsip aktif digeser, yang paling lama dihapus. */
  async function rotateIfNeeded(incomingBytes) {
    let size = 0
    try { size = (await fsp.stat(auditPath)).size } catch { return false }
    if (size === 0 || size + incomingBytes <= maxBytes) return false
    // Geser generasi: .2 ← .1, .3 ← .2, lalu aktif → .1
    for (let g = keepGenerations - 1; g >= 1; g--) {
      const from = rotatedPath(g)
      const to = rotatedPath(g + 1)
      try { await fsp.rename(from, to) } catch { /* berkas tidak ada → lewati */ }
    }
    try { await fsp.rename(auditPath, rotatedPath(1)) } catch { return false }
    lastHash = null // rantai dimulai ulang pada berkas baru
    lastHashLoaded = true
    return true
  }

  /** Baca hash terakhir pada berkas aktif (dipakai saat start, agar rantai menyambung). */
  async function loadLastHash() {
    if (lastHashLoaded) return lastHash
    lastHashLoaded = true
    let text = ''
    try { text = await fsp.readFile(auditPath, 'utf8') } catch { return null }
    const lines = text.split(/\r?\n/).filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i])
        if (e && typeof e.hash === 'string') { lastHash = e.hash; return lastHash }
      } catch { /* baris rusak → lanjut ke baris sebelumnya */ }
    }
    return null
  }

  async function appendOne(event) {
    const payload = sanitizeEvent(event)
    if (chain) {
      const prev = await loadLastHash()
      payload.prevHash = prev
      payload.hash = hashEvent(payload, prev)
    }
    const line = `${JSON.stringify(payload)}\n`
    await rotateIfNeeded(Buffer.byteLength(line))
    await write(payload)
    if (chain) { lastHash = payload.hash; lastHashLoaded = true }
    return payload
  }

  /** Kunci idempotensi baru dianggap terpakai SESUDAH penulisan berhasil. */
  function isDuplicate(key) {
    const last = seen.get(key)
    return last != null && now() - last < dedupeWindowMs
  }
  function markSeen(key) { seen.set(key, now()) }

  /**
   * Tulis event. Tidak melempar error (best-effort) — untuk event informatif.
   * Mengembalikan { ok, skipped, error }.
   */
  async function append(event) {
    try {
      const key = event?.idempotencyKey
      if (key && isDuplicate(key)) return { ok: true, skipped: true }
      const written = await appendOne(event)
      if (key) markSeen(key)
      return { ok: true, skipped: false, event: written }
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
    try {
      const key = event?.idempotencyKey
      if (key && isDuplicate(key)) return { ok: true, skipped: true }
      const written = await appendOne(event)
      if (key) markSeen(key)
      return { ok: true, skipped: false, event: written }
    } catch (e) {
      throw new AuditError('Audit tidak dapat ditulis; tindakan berisiko dibatalkan.', e)
    }
  }

  /**
   * Baca jejak audit dengan filter + halaman.
   * Urutan: terbaru lebih dulu. Event legacy (tanpa eventType) tetap dikembalikan apa adanya.
   */
  async function read({
    limit = 50, offset = 0, missionId = null, eventType = null, outcome = null,
    actor = null, correlationId = null, since = null, until = null,
  } = {}) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), MAX_LIMIT)
    const off = Math.min(Math.max(Number(offset) || 0, 0), MAX_OFFSET)
    const sinceTs = since == null ? null : Number(since)
    const untilTs = until == null ? null : Number(until)
    const keep = off + n
    let matched = 0
    let ring = []
    let total = 0

    let text = ''
    try { text = await fsp.readFile(auditPath, 'utf8') } catch { text = '' }
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      let e
      try { e = JSON.parse(line) } catch { continue } // baris rusak: lewati, jangan gagalkan pembacaan
      if (!e || typeof e !== 'object') continue
      if (missionId && e.missionId !== missionId) continue
      if (eventType && e.eventType !== eventType) continue
      if (outcome && e.outcome !== outcome) continue
      if (actor && e.actor !== actor) continue
      if (correlationId && e.correlationId !== correlationId) continue
      const ts = Number(e.ts ?? (Number.isFinite(Date.parse(e.at ?? '')) ? Date.parse(e.at) : 0))
      if (sinceTs != null && Number.isFinite(sinceTs) && ts < sinceTs) continue
      if (untilTs != null && Number.isFinite(untilTs) && ts > untilTs) continue
      matched++
      ring.push(e)
      if (ring.length > keep) ring.shift()
    }
    total = matched
    // ring berisi (off+n) event terakhir yang cocok (urutan kronologis).
    // Halaman yang diminta = n event terbaru setelah melompati `off` event terbaru.
    const ringLen = ring.length
    const end = ringLen - 1 - off          // indeks terakhir halaman (negatif → halaman kosong)
    const start = Math.max(0, end - n + 1)
    const window = end < 0 ? [] : ring.slice(start, end + 1)
    const events = window.reverse().map(normalizeEvent).filter(Boolean)
    return {
      events,
      count: total,
      total,
      limit: n,
      offset: off,
      hasMore: off + events.length < total,
      file: AUDIT_FILE,
    }
  }

  /**
   * Verifikasi rantai hash pada berkas aktif.
   * Mengembalikan { ok, checked, legacy, brokenAt, reason }.
   * Event lama tanpa `hash` dihitung sebagai legacy (tidak bisa diverifikasi) — jujur.
   */
  async function verify({ file = auditPath } = {}) {
    let text = ''
    try { text = await fsp.readFile(file, 'utf8') } catch { return { ok: true, checked: 0, legacy: 0, brokenAt: null, reason: 'berkas tidak ada' } }
    let prev = null
    let checked = 0
    let legacy = 0
    let lineNo = 0
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      lineNo++
      let e
      try { e = JSON.parse(line) } catch { return { ok: false, checked, legacy, brokenAt: lineNo, reason: 'baris rusak (bukan JSON)' } }
      if (!e || typeof e !== 'object' || typeof e.hash !== 'string') { legacy++; continue }
      if ((e.prevHash ?? null) !== prev) {
        return { ok: false, checked, legacy, brokenAt: lineNo, reason: 'prevHash tidak cocok dengan event sebelumnya' }
      }
      const expect = hashEvent(e, e.prevHash ?? null)
      if (expect !== e.hash) {
        return { ok: false, checked, legacy, brokenAt: lineNo, reason: 'hash event tidak cocok (isi event diubah)' }
      }
      prev = e.hash
      checked++
    }
    return { ok: true, checked, legacy, brokenAt: null, reason: null }
  }

  /** Daftar berkas audit (aktif + arsip rotasi), terbaru lebih dulu. */
  async function listFiles() {
    let names = []
    try { names = await fsp.readdir(dataDir) } catch { return [] }
    const out = []
    for (const n of names) {
      if (n !== AUDIT_FILE && !/^capability-audit\.\d+\.jsonl$/.test(n)) continue
      let size = 0
      try { size = (await fsp.stat(path.join(dataDir, n))).size } catch { /* lewati */ }
      out.push({ name: n, size, active: n === AUDIT_FILE })
    }
    return out.sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1))
  }

  return { append, appendCritical, read, verify, listFiles, path: auditPath, file: AUDIT_FILE }
}
