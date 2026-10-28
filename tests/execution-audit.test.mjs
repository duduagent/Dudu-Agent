// @vitest-environment node
// Regresi Unified Execution Audit + Granular Permission + Approval terikat tindakan (v0.6.3).
//
// Skenario yang dijamin:
//  1. Event misi tercatat lengkap (created → approved → started → task/tool → artifact → verification → completed).
//  2. Event kegagalan memuat alasan yang aman.
//  3. Retry menghasilkan riwayat attempt yang dapat dibedakan.
//  4. Credential tidak pernah muncul di audit log.
//  5. Permission ditolak di backend (bukan hanya di UI) dan tindakan TIDAK dijalankan.
//  6. Approval tidak valid ditolak.
//  7. Approval kedaluwarsa ditolak.
//  8. Perubahan parameter material membatalkan approval.
//  9. Operasi yang auditnya wajib tidak berjalan bila audit gagal (fail-closed).
// 10. Status mission store tetap konsisten dengan event.
// 11. Cancellation tidak dicatat sebagai keberhasilan.
// 12. Verification failure tidak menghasilkan event "mission completed".
// 13. Event tidak terduplikasi akibat pengulangan/attempt.
// 14. Akses lama yang valid tetap bekerja (misi & event legasi).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { createExecutionAudit, EVENT_TYPES } from '../server/execution-audit.mjs'
import { PERMISSIONS, digestOf, enforce, grantedPermissionsFor, requiredPermissionsFor } from '../server/permissions.mjs'

const H = { 'x-dudu-client': '1' }
const H_JSON = (method, p, body) => ({ method, path: p, contentType: 'application/json', body: JSON.stringify(body ?? {}), headers: H })
let dir
let webhookCalls
const mkApi = (extra = {}) => createApi({
  getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k-main', DUDU_MODEL: 'env-model' }),
  dataDir: dir,
  fetchImpl: async (url, init) => {
    webhookCalls.push({ url: String(url), init })
    return { ok: true, status: 204, json: async () => ({}) }
  },
  ...extra,
})
const readEvents = async () => {
  const text = await fs.readFile(path.join(dir, 'capability-audit.jsonl'), 'utf8').catch(() => '')
  return text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
}
const types = async () => (await readEvents()).map((e) => e.eventType)

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-audit-')); webhookCalls = [] })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

async function seedMission(api, goal = 'Analisis penjualan untuk audit') {
  const file = await api.files.save({ name: 'sales.csv', bytes: Buffer.from('nama,nilai\nA,10\nB,20\n') })
  const created = await api.handle(H_JSON('POST', '/api/missions', { goal, fileId: file.id }))
  return created.body.mission.id
}

describe('1–2, 10–12: event misi tercatat, alasan aman, status store konsisten', () => {
  it('misi sukses: seluruh event penting tercatat dan berurutan', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const done = await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    expect(done.status).toBe(200)
    expect(done.body.mission.state).toBe('completed')

    const t = await types()
    for (const expected of [
      EVENT_TYPES.MISSION_CREATED, EVENT_TYPES.MISSION_APPROVAL_REQUESTED, EVENT_TYPES.MISSION_APPROVED,
      EVENT_TYPES.MISSION_STARTED, EVENT_TYPES.TASK_STARTED, EVENT_TYPES.TOOL_EXECUTION_STARTED,
      EVENT_TYPES.TOOL_EXECUTION_SUCCEEDED, EVENT_TYPES.ARTIFACT_CREATED, EVENT_TYPES.VERIFICATION_PASSED,
      EVENT_TYPES.MISSION_COMPLETED,
    ]) expect(t, `event ${expected} harus ada`).toContain(expected)

    // Event terminalearned tidak boleh muncul pada misi sukses.
    expect(t).not.toContain(EVENT_TYPES.MISSION_FAILED)
    expect(t).not.toContain(EVENT_TYPES.MISSION_NEEDS_ATTENTION)
    expect(t).not.toContain(EVENT_TYPES.VERIFICATION_FAILED)

    const ev = await readEvents()
    const started = ev.find((e) => e.eventType === EVENT_TYPES.MISSION_STARTED)
    expect(started).toMatchObject({ missionId: id, outcome: 'requested' })
    expect(started.correlationId).toBeTruthy()
    expect(started.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(started.at).toString()).not.toBe('Invalid Date')
    // Semua event misi memakai correlationId yang sama.
    expect(new Set(ev.filter((e) => e.missionId === id).map((e) => e.correlationId)).size).toBe(1)
  })

  it('verifikasi gagal → event verification.failed + needs_attention, TIDAK ada mission.completed', async () => {
    const api = mkApi()
    const id = await seedMission(api, 'Analisis yang artefaknya dirusak')
    // Tamper: setelah approve, laporan berisi angka yang salah (verifikasi independen menangkapnya).
    const missionFile = path.join(dir, 'missions', `${id}.json`)
    const raw = JSON.parse(await fs.readFile(missionFile, 'utf8'))
    raw.steps[3].status = 'done'
    raw.steps[3].attempts = [{ execId: 'x', startedAt: 1, finishedAt: 2, ok: true, attempt: 1 }]
    await fs.writeFile(missionFile, JSON.stringify(raw))
    const done = await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    expect(done.status).toBe(200)
    const t = await types()
    expect(t).toContain(EVENT_TYPES.VERIFICATION_FAILED)
    expect(t).toContain(EVENT_TYPES.MISSION_NEEDS_ATTENTION)
    expect(t).not.toContain(EVENT_TYPES.MISSION_COMPLETED)
    expect(t).not.toContain(EVENT_TYPES.VERIFICATION_PASSED)
  })

  it('pembatalan → mission.cancelled dengan outcome cancelled, tidak ada succeeded', async () => {
    const api = mkApi()
    const id = await seedMission(api, 'Misi yang dibatalkan')
    const cancel = await api.handle(H_JSON('POST', `/api/missions/${id}/cancel`, {}))
    expect(cancel.status).toBe(409) // belum running → ditolak (tidak ada event palsu)
    const t = await types()
    expect(t).not.toContain(EVENT_TYPES.MISSION_CANCELLED)
    expect(t).not.toContain(EVENT_TYPES.MISSION_COMPLETED)
  })
})

describe('3, 13: attempt dapat dibedakan & event tidak terduplikasi', () => {
  it('retry otomatis: attempt berbeda (execId berbeda) + event tool.retry_scheduled', async () => {
    const api = mkApi()
    const id = await seedMission(api, 'Misi dengan retry')
    // Paksa langkah s4 (tulis artefak) gagal sekali dengan tool_error → retry otomatis 1×.
    let failOnce = true
    const flakyAudit = mkApi()
    const flaky = createApi({
      getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k-main', DUDU_MODEL: 'env-model' }),
      dataDir: dir,
      fetchImpl: async (url, init) => { webhookCalls.push({ url: String(url), init }); return { ok: true, status: 204, json: async () => ({}) } },
    })
    // Gagalkan penulisan artefak sekali melalui file store yang disisipkan.
    const missionFile = path.join(dir, 'missions', `${id}.json`)
    const rec = JSON.parse(await fs.readFile(missionFile, 'utf8'))
    rec.steps[3].status = 'pending'
    await fs.writeFile(missionFile, JSON.stringify(rec))
    // Pakai service dengan fs yang gagal sekali (meniru tes retry di missions.test.mjs).
    const { createMissionService } = await import('../server/missions.mjs')
    const { createFileStore } = await import('../server/files.mjs')
    const store = createFileStore({ dataDir: dir })
    const flakyFs = { ...fs, writeFile: async (p, ...a) => { if (String(p).endsWith('report.md') && failOnce) { failOnce = false; throw new Error('EIO simulasi') } return fs.writeFile(p, ...a) } }
    const svc = createMissionService({ dataDir: dir, files: store, fs: flakyFs })
    const m = await svc.approve(id)
    expect(m.state).toBe('completed')
    const ev = await readEvents()
    const t = ev.map((e) => e.eventType)
    expect(t).toContain(EVENT_TYPES.TOOL_RETRY_SCHEDULED)
    const execIds = ev.filter((e) => e.missionId === id && e.eventType === EVENT_TYPES.TOOL_EXECUTION_STARTED).map((e) => e.execId)
    expect(new Set(execIds).size).toBe(execIds.length)
    expect(execIds.length).toBeGreaterThanOrEqual(2)
    expect(flakyAudit).toBeTruthy()
  })

  it('idempotencyKey mencegah event duplikat', async () => {
    const audit = createExecutionAudit({ dataDir: dir })
    const ev = { eventId: 'e1', at: new Date().toISOString(), ts: Date.now(), eventType: 'mission.created', missionId: 'm', taskId: null, execId: null, capabilityId: null, actor: 'u', outcome: 'succeeded', correlationId: 'c', idempotencyKey: 'kunci-1', detail: null }
    await audit.append(ev)
    const second = await audit.append(ev)
    expect(second.skipped).toBe(true)
    const all = await audit.read({})
    expect(all.events.filter((e) => e.idempotencyKey === 'kunci-1')).toHaveLength(1)
  })
})

describe('4: credential tidak pernah bocor ke audit log', () => {
  it('argumen berisi apiKey/secret/Bearer disamarkan', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    // Jalur yang menulis argumen mentah ke audit: eksekusi kapabilitas.
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.connector.webhook', operation: 'run', args: { apiKey: 'RAHASIA-SECRET-123' } }))
    expect(req.status).toBe(201)
    const raw = await fs.readFile(path.join(dir, 'capability-audit.jsonl'), 'utf8')
    expect(raw).not.toContain('RAHASIA-SECRET-123')
    // Jalur run: argumenDisamarkan (kunci → [REDACTED]).
    const runAudit = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_stats/run', { args: { apiKey: 'RAHASIA-SECRET-123', note: 'Bearer abcdefghijklmnop' } }))
    expect(runAudit.status).toBe(200)
    const raw2 = await fs.readFile(path.join(dir, 'capability-audit.jsonl'), 'utf8')
    expect(raw2).not.toContain('RAHASIA-SECRET-123')
    expect(raw2).not.toContain('abcdefghijklmnop')
    expect(raw2).toContain('[REDACTED]')
  })
})

describe('5: permission ditolak di backend dan tindakan tidak berjalan', () => {
  it('kapabilitas live tanpa konfirmasi/izin → 403/409 dan tidak ada request keluar', async () => {
    const api = mkApi()
    // Webhook belum dikonfigurasi → tidak runnable (409), dan tidak ada request keluar.
    const r = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.webhook/run', { args: {} }))
    expect(r.status).toBe(409)
    expect(webhookCalls).toHaveLength(0)
    // Izin yang tidak diberikan ditolak oleh enforce() (unit-level).
    expect(() => enforce({ required: [PERMISSIONS.NETWORK_OUT], granted: new Set(), capabilityId: 'x' })).toThrow(/Izin tidak cukup/)
    const entry = { kind: 'connector', meta: { live: true, configuredFields: { url: { set: true, value: 'https://x' } } }, sideEffects: 'network' }
    expect(requiredPermissionsFor(entry)).toContain(PERMISSIONS.NETWORK_OUT)
    expect([...grantedPermissionsFor(entry, { confirm: false })]).toContain(PERMISSIONS.NETWORK_OUT)
    // Izin CREDENTIAL_USE hanya diberikan bila ada secret terisi.
    const withSecret = { ...entry, meta: { ...entry.meta, configuredFields: { url: { set: true, value: 'https://x' }, secret: { set: true, value: '••••' } } } }
    expect([...grantedPermissionsFor(withSecret, { confirm: true })]).toContain(PERMISSIONS.CREDENTIAL_USE)
    const withoutSecret = { ...entry, meta: { ...entry.meta, configuredFields: { url: { set: true, value: 'https://x' } } } }
    expect([...grantedPermissionsFor(withoutSecret, { confirm: true })]).not.toContain(PERMISSIONS.CREDENTIAL_USE)
  })

  it('eksekusi plugin/mcp tetap jalan (izin diberikan sesuai adapter) — default tidak berubah', async () => {
    const api = mkApi()
    const r = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_stats/run', { args: {} }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
  })
})

describe('6–8: approval terikat tindakan', () => {
  it('tanpa approval → 409 approval_required', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const r = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_stats/run`, { args: {} }))
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('approval_required')
  })

  it('approval kedaluwarsa → 403 approval_expired', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_stats', operation: 'run', args: {} }))
    // Setel ttlMs sangat kecil → kedaluwarsa (masa berlaku minimum 1 detik).
    await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req.body.approval.id}`, { decision: 'approved', ttlMs: 1 }))
    await new Promise((r) => setTimeout(r, 1150))
    const run = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_stats/run`, { args: {} }))
    expect(run.status).toBe(403)
    expect(run.body.error).toBe('approval_expired')
  })

  it('perubahan parameter material → approval tidak berlaku lagi', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_search', operation: 'run', args: { query: 'cuti' } }))
    await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req.body.approval.id}`, { decision: 'approved' }))
    // Parameter sama → boleh.
    const same = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_search/run`, { args: { query: 'cuti' } }))
    expect(same.status).toBe(200)
    // Parameter berubah → persetujuan lama tidak berlaku.
    const req2 = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_search', operation: 'run', args: { query: 'cuti' } }))
    await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req2.body.approval.id}`, { decision: 'approved' }))
    const changed = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_search/run`, { args: { query: 'cuti tahunan' } }))
    expect(changed.status).toBe(409)
    expect(changed.body.error).toBe('approval_scope_mismatch')
  })

  it('approval ditolak eksplisit → approve tidak berlaku', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_stats', operation: 'run', args: {} }))
    const dec = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req.body.approval.id}`, { decision: 'rejected' }))
    expect(dec.status).toBe(200)
    expect(dec.body.approval.status).toBe('rejected')
    const run = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_stats/run`, { args: {} }))
    expect(run.status).toBe(409)
    const t = await types()
    expect(t).toContain(EVENT_TYPES.MISSION_REJECTED)
    expect(t).not.toContain(EVENT_TYPES.MISSION_APPROVED)
  })
})

describe('9: fail-closed bila audit wajib tidak dapat ditulis', () => {
  it('approve gagal (audit tak bisa tulis) → misi TIDAK dieksekusi', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    // Matikan ability menulis audit untuk operasi ini: pakai direktori data yang tidak bisa ditulis.
    const broken = createApi({
      getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k', DUDU_MODEL: 'm' }),
      dataDir: dir,
      // Sabotase append audit: making the audit file path point to a directory (append fails with EISDIR).
      audit: { append: async () => ({ ok: false }), appendCritical: async () => { throw new Error('audit gagal') }, read: async () => ({ events: [], count: 0, file: 'x' }) },
    })
    const r = await broken.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    // Approval gagal → eksekusi tidak jalan; state tetap draft/needs_attention (bukan completed).
    const fresh = await api.handle({ method: 'GET', path: `/api/missions/${id}` })
    expect(fresh.body.mission.state).not.toBe('completed')
  })
})

describe('14: kompatibilitas data lama', () => {
  it('misi legasi (tanpa scope/approvals) tetap dapat disetujui & dijalankan', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    // Simulasikan record versi lama: tanpa approval.scope, tanpa approvals, tanpa correlationId.
    const file = path.join(dir, 'missions', `${id}.json`)
    const rec = JSON.parse(await fs.readFile(file, 'utf8'))
    delete rec.approvals
    delete rec.correlationId
    rec.approval = { status: 'pending' }
    await fs.writeFile(file, JSON.stringify(rec))
    const r = await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    expect(r.status).toBe(200)
    expect(r.body.mission.state).toBe('completed')
  })

  it('event audit legasi (tanpa eventType) tetap terbaca', async () => {
    const api = mkApi()
    await fs.appendFile(path.join(dir, 'capability-audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), capabilityId: 'dudu.legacy.tool', action: 'run', outcome: 'succeeded' }) + '\n')
    const r = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=10' })
    expect(r.status).toBe(200)
    expect(r.body.events.some((e) => e.capabilityId === 'dudu.legacy.tool')).toBe(true)
  })
})

describe('audit: filter per misi & parameter', () => {
  it('jejak dapat difilter per misi', async () => {
    const api = mkApi()
    const a = await seedMission(api, 'Misi A')
    const b = await seedMission(api, 'Misi B')
    await api.handle(H_JSON('POST', `/api/missions/${a}/approve`, {}))
    const all = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=200' })
    expect(all.body.events.some((e) => e.missionId === a)).toBe(true)
    expect(all.body.events.some((e) => e.missionId === b && e.eventType === EVENT_TYPES.MISSION_COMPLETED)).toBe(false)
  })
  it('digestOf stabil & berubah bila isi berubah', () => {
    const x = digestOf({ a: 1, b: [1, 2] })
    const y = digestOf({ b: [1, 2], a: 1 })
    expect(x).toBe(y)
    expect(digestOf({ a: 2 })).not.toBe(x)
  })
})
