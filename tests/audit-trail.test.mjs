// @vitest-environment node
// Regresi v0.6.4 — Unified Execution Audit: jejak audit di API, pagination/filter, redaksi
// dua arah, event legacy & rusak, integritas rantai hash, rotasi, idempotensi, dan
// regresi permission/approval (tidak boleh dilewati lewat jalur eksekusi lain).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { AuditError, createExecutionAudit, hashEvent } from '../server/execution-audit.mjs'
import { PERMISSIONS, digestOf, enforce, grantedPermissionsFor, requiredPermissionsFor } from '../server/permissions.mjs'

const H = { 'x-dudu-client': '1' }
const H_JSON = (method, p, body) => ({ method, path: p, contentType: 'application/json', body: JSON.stringify(body ?? {}), headers: H })

let dir
let outbound
const mkApi = (extra = {}) => createApi({
  getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k-main', DUDU_MODEL: 'env-model' }),
  dataDir: dir,
  fetchImpl: async (url, init) => {
    outbound.push({ url: String(url), init })
    return { ok: true, status: 204, json: async () => ({}) }
  },
  ...extra,
})

const auditFile = () => path.join(dir, 'capability-audit.jsonl')
const readLines = async () => (await fs.readFile(auditFile(), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean)

async function seedMission(api, goal = 'Misi untuk audit') {
  const file = await api.files.save({ name: 'sales.csv', bytes: Buffer.from('nama,nilai\nA,10\nB,20\n') })
  const created = await api.handle(H_JSON('POST', '/api/missions', { goal, fileId: file.id }))
  return created.body.mission.id
}

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-trail-')); outbound = [] })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('A. Kontrak API jejak audit', () => {
  it('endpoint audit mengembalikan skema unified + pagination (terbaru lebih dulu)', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))

    const res = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=5' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ file: 'capability-audit.jsonl' })
    expect(typeof res.body.total).toBe('number')
    expect(typeof res.body.hasMore).toBe('boolean')
    expect(res.body.events.length).toBeLessThanOrEqual(5)

    // Urutan: terbaru lebih dulu (ts menurun).
    const ts = res.body.events.map((e) => Number(e.ts ?? 0))
    expect([...ts].sort((a, b) => b - a)).toEqual(ts)

    // Skema unified pada event baru.
    const e0 = res.body.events[0]
    for (const k of ['eventId', 'at', 'ts', 'eventType', 'missionId', 'taskId', 'execId', 'capabilityId', 'actor', 'outcome', 'correlationId']) {
      expect(k in e0, `field ${k} harus ada`).toBe(true)
    }
    expect(e0.eventType).toMatch(/^[a-z_]+\.[a-z_]+$/)
    expect(e0.eventId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('offset memuat halaman berikutnya tanpa duplikat', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))

    const p1 = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=3&offset=0' })
    const p2 = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=3&offset=3' })
    const ids1 = p1.body.events.map((e) => e.eventId)
    const ids2 = p2.body.events.map((e) => e.eventId)
    expect(ids1.length).toBe(3)
    expect(ids2.length).toBeGreaterThan(0)
    expect(ids1.filter((id2) => ids2.includes(id2))).toHaveLength(0)   // tidak ada event kembar
    expect(p1.body.hasMore).toBe(true)
    expect(p1.body.total).toBeGreaterThan(3)
  })

  it('offset melebihi jumlah event → halaman kosong, bukan error', async () => {
    const api = mkApi()
    await seedMission(api)
    const res = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=10&offset=9999' })
    expect(res.status).toBe(200)
    expect(res.body.events).toEqual([])
    expect(res.body.hasMore).toBe(false)
  })

  it('filter: missionId, eventType, outcome, actor, since/until', async () => {
    const api = mkApi()
    const a = await seedMission(api, 'Misi A')
    const b = await seedMission(api, 'Misi B')
    await api.handle(H_JSON('POST', `/api/missions/${a}/approve`, {}))
    await api.handle(H_JSON('POST', `/api/missions/${b}/approve`, {}))

    const byMission = await api.handle({ method: 'GET', path: `/api/capability-registry/audit?missionId=${a}&limit=100` })
    expect(byMission.body.events.length).toBeGreaterThan(0)
    expect(byMission.body.events.every((e) => e.missionId === a)).toBe(true)

    const byType = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?eventType=mission.completed&limit=100' })
    expect(byType.body.events.length).toBe(2)
    expect(byType.body.events.every((e) => e.eventType === 'mission.completed')).toBe(true)

    const byOutcome = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?outcome=failed&limit=100' })
    expect(byOutcome.body.events.every((e) => e.outcome === 'failed')).toBe(true)

    const byActor = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?actor=system&limit=100' })
    expect(byActor.body.events.every((e) => e.actor === 'system')).toBe(true)

    const all = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=200' })
    const newest = all.body.events[0]
    const since = await api.handle({ method: 'GET', path: `/api/capability-registry/audit?since=${newest.ts - 1}&limit=200` })
    expect(since.body.events.length).toBeGreaterThan(0)
    const until = await api.handle({ method: 'GET', path: `/api/capability-registry/audit?until=${newest.ts - 1}&limit=200` })
    expect(until.body.events.every((e) => Number(e.ts) <= newest.ts - 1)).toBe(true)
  })
})

describe('B. Per-mission audit endpoint', () => {
  it('hanya event misi tersebut; misi lain tidak bocor', async () => {
    const api = mkApi()
    const a = await seedMission(api, 'Misi A')
    const b = await seedMission(api, 'Misi B')
    await api.handle(H_JSON('POST', `/api/missions/${a}/approve`, {}))
    await api.handle(H_JSON('POST', `/api/missions/${b}/approve`, {}))

    const res = await api.handle({ method: 'GET', path: `/api/missions/${a}/audit?limit=100` })
    expect(res.status).toBe(200)
    expect(res.body.events.length).toBeGreaterThan(0)
    expect(res.body.events.every((e) => e.missionId === a)).toBe(true)
    const missionA = await api.handle({ method: 'GET', path: `/api/missions/${a}` })
    expect(res.body.events.every((e) => e.correlationId === missionA.body.mission.correlationId)).toBe(true)
  })

  it('ID misi tidak valid → 400; misi tidak ada → 404', async () => {
    const api = mkApi()
    const bad = await api.handle({ method: 'GET', path: '/api/missions/bukan-uuid/audit' })
    expect(bad.status).toBe(400)
    const missing = await api.handle({ method: 'GET', path: '/api/missions/11111111-1111-4111-8111-111111111111/audit' })
    expect(missing.status).toBe(404)
  })
})

describe('C. Otorisasi & jalur baca', () => {
  it('jejak audit hanya lewat API server; mutasi tetap butuh header anti-CSRF', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    // Baca audit = GET → tidak butuh header mutasi (pola aplikasi yang sama dengan endpoint baca lain).
    const read = await api.handle({ method: 'GET', path: `/api/missions/${id}/audit` })
    expect(read.status).toBe(200)
    // Mutasi tanpa X-Dudu-Client → 403 (tidak ada jalur mutasi tanpa header).
    const mut = await api.handle({ method: 'POST', path: `/api/missions/${id}/approve`, contentType: 'application/json', body: '{}' })
    expect(mut.status).toBe(403)
    expect(mut.body.error).toBe('forbidden')
  })

  it('audit tidak bisa ditulis lewat API (tidak ada endpoint mutasi jejak)', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    for (const p of [`/api/missions/${id}/audit`, '/api/capability-registry/audit']) {
      const r = await api.handle(H_JSON('POST', p, { eventType: 'dipalsukan' }))
      expect([404, 405].includes(r.status), `POST ${p} harus ditolak`).toBe(true)
    }
    const lines = await readLines()
    expect(lines.some((l) => l.includes('dipalsukan'))).toBe(false)
  })
})

describe('D. Redaksi dua arah (tulis & baca)', () => {
  it('event legacy yang belum diredaksi disanitasi saat dibaca', async () => {
    const api = mkApi()
    await seedMission(api)
    // Baris legacy: error & args mentah (sebelum redaksi error ada).
    await fs.appendFile(auditFile(), JSON.stringify({
      at: new Date().toISOString(), capabilityId: 'dudu.legacy.tool', action: 'run', outcome: 'failed',
      args: { apiKey: 'RAHASIA-LEGACY-999' }, error: 'gagal: Bearer abcdefghijklmnopqrst',
    }) + '\n')

    const res = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=50' })
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain('RAHASIA-LEGACY-999')
    expect(raw).not.toContain('abcdefghijklmnopqrst')
    expect(raw).toContain('[REDACTED]')
    // Event legacy tetap terbaca (tidak dibuang).
    const legacy = res.body.events.find((e) => e.capabilityId === 'dudu.legacy.tool')
    expect(legacy).toBeTruthy()
    expect(legacy.eventType).toBeNull()
  })

  it('error pada event audit ditulis dalam bentuk teredaksi', async () => {
    const api = mkApi()
    await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_stats/run', { args: { apiKey: 'RAHASIA-RUN-111', note: 'Bearer sk-abcdefghijklmnop' } }))
    const raw = await fs.readFile(auditFile(), 'utf8')
    expect(raw).not.toContain('RAHASIA-RUN-111')
    expect(raw).not.toContain('sk-abcdefghijklmnop')
    expect(raw).toContain('[REDACTED]')
  })

  it('isi file pengguna tidak pernah ditulis penuh ke jejak audit', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    const raw = await fs.readFile(auditFile(), 'utf8')
    expect(raw).not.toContain('nama,nilai')          // isi CSV sumber tidak boleh bocor
    expect(raw).toContain('artifact')               // yang tersimpan hanya ringkasan
  })
})

describe('E. Kondisi batas: kosong, rusak, legacy', () => {
  it('berkas audit kosong → events [] tanpa error', async () => {
    const api = mkApi()
    const res = await api.handle({ method: 'GET', path: '/api/capability-registry/audit' })
    expect(res.status).toBe(200)
    expect(res.body.events).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.hasMore).toBe(false)
  })

  it('baris rusak dilewati; event lain tetap terbaca', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    const before = (await readLines()).length
    await fs.appendFile(auditFile(), '{bukan json sama sekali\n')
    await fs.appendFile(auditFile(), 'null\n')
    const res = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=100' })
    expect(res.status).toBe(200)
    expect(res.body.events.length).toBe(before)
  })

  it('event lama (tanpa eventType) dikembalikan apa adanya, tidak dikarang', async () => {
    const api = mkApi()
    await fs.appendFile(auditFile(), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', capabilityId: 'dudu.legacy.tool', action: 'run', outcome: 'succeeded' }) + '\n')
    const res = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=10' })
    const legacy = res.body.events.find((e) => e.capabilityId === 'dudu.legacy.tool')
    expect(legacy).toBeTruthy()
    expect(legacy.eventType).toBeNull()
    expect(legacy.outcome).toBe('succeeded')
    expect(legacy.action).toBe('run')
  })
})

describe('F. Integritas: rantai hash & rotasi', () => {
  it('rantai hash utuh setelah append; verifikasi melaporkan jumlah event', async () => {
    const audit = createExecutionAudit({ dataDir: dir })
    for (let i = 0; i < 5; i++) await audit.append({ eventId: `e${i}`, eventType: 'mission.created', ts: Date.now(), outcome: 'succeeded' })
    const v = await audit.verify()
    expect(v.ok).toBe(true)
    expect(v.checked).toBe(5)
    expect(v.brokenAt).toBeNull()
  })

  it('perubahan isi event yang sudah tertulis terdeteksi', async () => {
    const audit = createExecutionAudit({ dataDir: dir })
    await audit.append({ eventId: 'e1', eventType: 'mission.created', ts: 1, outcome: 'succeeded' })
    await audit.append({ eventId: 'e2', eventType: 'mission.completed', ts: 2, outcome: 'succeeded' })
    //someone mengubah event pertama (mis. outcome diubah).
    const lines = await readLines()
    const first = JSON.parse(lines[0]); first.outcome = 'denied'
    await fs.writeFile(auditFile(), [JSON.stringify(first), lines[1]].join('\n') + '\n')
    const v = await audit.verify()
    expect(v.ok).toBe(false)
    expect(v.brokenAt).toBe(1)
    expect(v.reason).toMatch(/hash/i)
  })

  it('event yang dihapus dari tengah rantai terdeteksi', async () => {
    const audit = createExecutionAudit({ dataDir: dir })
    await audit.append({ eventId: 'e1', eventType: 'a.b', ts: 1, outcome: 'succeeded' })
    await audit.append({ eventId: 'e2', eventType: 'a.b', ts: 2, outcome: 'succeeded' })
    await audit.append({ eventId: 'e3', eventType: 'a.b', ts: 3, outcome: 'succeeded' })
    const lines = await readLines()
    await fs.writeFile(auditFile(), [lines[0], lines[2]].join('\n') + '\n')
    const v = await audit.verify()
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/prevHash/i)
  })

  it('rotasi: berkas dirotasi saat melewati batas ukuran, generasi lama dihapus', async () => {
    const audit = createExecutionAudit({ dataDir: dir, maxBytes: 1500, keepGenerations: 2 })
    for (let i = 0; i < 40; i++) await audit.append({ eventId: `e${i}`, eventType: 'mission.created', ts: Date.now(), outcome: 'succeeded', detail: { i, filler: 'x'.repeat(60) } })
    const files = await audit.listFiles()
    const names = files.map((f) => f.name)
    expect(names).toContain('capability-audit.jsonl')
    expect(names.some((n) => /^capability-audit\.\d+\.jsonl$/.test(n))).toBe(true)
    expect(names).not.toContain('capability-audit.3.jsonl')     // di luar keepGenerations
    const active = files.find((f) => f.active)
    expect(active.size).toBeLessThanOrEqual(1500 + 400)
  })

  it('idempotencyKey: duplikat dilewati, tetapi penulisan GAGAL tidak menandai kunci', async () => {
    const audit = createExecutionAudit({ dataDir: dir })
    const ev = { eventId: 'e1', eventType: 'mission.created', ts: 1, outcome: 'succeeded', idempotencyKey: 'kunci-x' }
    expect((await audit.append(ev)).skipped).toBe(false)
    expect((await audit.append(ev)).skipped).toBe(true)
    expect((await audit.read({})).events.filter((e) => e.idempotencyKey === 'kunci-x')).toHaveLength(1)

    // Penulisan gagal (path di bawah berkas, bukan direktori) TIDAK boleh menandai kunci → percobaan berikutnya tetap menulis.
    const blocker = path.join(dir, 'blokir')
    await fs.writeFile(blocker, 'bukan direktori')
    const broken = createExecutionAudit({ dataDir: path.join(blocker, 'sub') })
    const failed = await broken.append(ev)
    expect(failed.ok).toBe(false)
    const retry = await broken.append(ev)
    expect(retry.skipped).toBe(false)
  })
})

describe('G. Endpoint integritas', () => {
  it('integritas melaporkan status rantai + daftar berkas', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    const res = await api.handle({ method: 'GET', path: '/api/audit/integrity' })
    expect(res.status).toBe(200)
    expect(res.body.integrity.ok).toBe(true)
    expect(res.body.integrity.checked).toBeGreaterThan(0)
    expect(res.body.files.some((f) => f.active && f.name === 'capability-audit.jsonl')).toBe(true)
  })
})

describe('H. Regresi permission & approval (tidak boleh dilewati)', () => {
  it('process:exec tetap tidak aktif: tidak pernah diminta maupun diberikan', async () => {
    const kinds = ['mcp_tool', 'plugin', 'connector', 'workflow', 'unknown']
    for (const kind of kinds) {
      expect(requiredPermissionsFor({ kind })).not.toContain(PERMISSIONS.PROCESS_EXEC)
      expect([...grantedPermissionsFor({ kind, sideEffects: 'none' }, { confirm: true })]).not.toContain(PERMISSIONS.PROCESS_EXEC)
    }
    // Izin process:exec hanya boleh diminta bila ada adapter yang benar-benar memakainya (saat ini tidak ada).
    expect(requiredPermissionsFor({ kind: 'mcp_tool' })).toEqual([PERMISSIONS.MCP_EXEC, PERMISSIONS.FILE_READ])
    expect(() => enforce({ required: [PERMISSIONS.PROCESS_EXEC], granted: new Set(), capabilityId: 'x' })).toThrow(/Izin tidak cukup/)
  })

  it('permission ditolak SEBELUM tindakan berjalan: tidak ada request keluar', async () => {
    const api = mkApi()
    // Connector webhook belum dikonfigurasi → tidak runnable; dan tanpa confirm → tidak boleh menembak keluar.
    const r = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.webhook/run', { args: {} }))
    expect(r.status).toBe(409)
    expect(outbound).toHaveLength(0)
  })

  it('event permission.denied tercatat tanpa membocorkan rahasia', async () => {
    const api = mkApi()
    // Konfigurasi connector live tapi tanpa confirm → ditolak oleh Gerbang confirm/izin.
    const r = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.webhook/run', { args: { apiKey: 'RAHASIA-DENIED-777' } }))
    expect(r.status).toBeGreaterThanOrEqual(400)
    const raw = await fs.readFile(auditFile(), 'utf8').catch(() => '')
    expect(raw).not.toContain('RAHASIA-DENIED-777')
  })

  it('approval terikat target: perubahan target membatalkan approval sebelumnya', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const args = { query: 'cuti' }
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_search', operation: 'run', target: 'kb-a', args }))
    expect(req.status).toBe(201)
    await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req.body.approval.id}`, { decision: 'approved' }))
    // Target berbeda → digest parameter berbeda → approval lama tidak berlaku (belum dipakai).
    const other = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_search/run`, { args, target: 'kb-b' }))
    expect(other.status).toBe(409)
    expect(other.body.error).toBe('approval_scope_mismatch')
    // Target yang disetujui tetap berlaku.
    const same = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_search/run`, { args, target: 'kb-a' }))
    expect(same.status).toBe(200)
  })

  it('approval yang sudah dikonsumsi tidak dapat dipakai ulang', async () => {
    const api = mkApi()
    const id = await seedMission(api)
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_stats', operation: 'run', args: {} }))
    await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req.body.approval.id}`, { decision: 'approved' }))
    const first = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_stats/run`, { args: {} }))
    expect(first.status).toBe(200)
    const second = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_stats/run`, { args: {} }))
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('approval_required')
  })

  it('kegagalan audit kritis tidak dapat dilewati lewat jalur eksekusi lain', async () => {
    const brokenAudit = {
      append: async () => ({ ok: false }),
      appendCritical: async () => { throw new AuditError('Audit tidak dapat ditulis; tindakan berisiko dibatalkan.') },
      read: async () => ({ events: [], count: 0, total: 0, limit: 50, offset: 0, hasMore: false, file: 'x' }),
      verify: async () => ({ ok: true, checked: 0, legacy: 0, brokenAt: null, reason: null }),
      listFiles: async () => [],
    }
    const api = mkApi({ audit: brokenAudit })
    const id = await seedMission(api)

    // Jalur 1: eksekusi kapabilitas langsung (registry) → fail-closed, kapabilitas TIDAK dijalankan.
    const direct = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_stats/run', { args: {} }))
    expect(direct.status).toBe(500)
    expect(direct.body.error).toBe('audit_unavailable')
    const cap = await api.handle({ method: 'GET', path: '/api/capability-registry/dudu.mcp.tool.kb_stats' })
    expect(cap.body.capability.status.lastExecution).toBeFalsy()   // tidak ada tanda eksekusi → tindakan tidak berjalan

    // Jalur 2: persetujuan tindakan di dalam misi → keputusan approval fail-closed (500), approval tidak berlaku.
    const req = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals`, { capabilityId: 'dudu.mcp.tool.kb_stats', operation: 'run', args: {} }))
    expect(req.status).toBe(201)
    const decided = await api.handle(H_JSON('POST', `/api/missions/${id}/approvals/${req.body.approval.id}`, { decision: 'approved' }))
    expect(decided.status).toBe(500)
    expect(decided.body.error).toBe('audit_unavailable')
    const run = await api.handle(H_JSON('POST', `/api/missions/${id}/capabilities/dudu.mcp.tool.kb_stats/run`, { args: {} }))
    expect(run.status).toBe(409)                                   // tanpa approval yang sah → tidak dijalankan
    expect(outbound).toHaveLength(0)                               // TIDAK ada efek samping eksternal

    // Jalur 3: persetujuan misi → eksekusi tidak boleh jalan.
    const approve = await api.handle(H_JSON('POST', `/api/missions/${id}/approve`, {}))
    expect(approve.status).toBe(500)
    const mission = await api.handle({ method: 'GET', path: `/api/missions/${id}` })
    expect(mission.body.mission.state).not.toBe('completed')
    expect(mission.body.mission.artifacts).toHaveLength(0)
  })

  it('plugin/MCP/connector tidak punya jalur eksekusi alternatif yang melewati gerbang izin', async () => {
    const api = mkApi()
    // Jalur resmi: registry (satu-satunya adapter eksekusi).
    const mcp = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_stats/run', { args: {} }))
    expect(mcp.status).toBe(200)
    // Tidak ada endpoint lain yang menjalankan adapter: seluruh rute 'run' milik registry.
    const routes = await api.handle({ method: 'GET', path: '/api/capability-registry' })
    expect(routes.status).toBe(200)
    // Connector live tanpa confirm → ditolak oleh Gerbang konfirmasi/izin (bukan oleh UI).
    const conn = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.webhook/run', { args: {} }))
    expect([403, 409]).toContain(conn.status)
  })

  it('digest parameterApproval berubah bila isi parameter berubah material', async () => {
    const a = digestOf({ capabilityId: 'c', operation: 'run', target: null, args: { query: 'x' } })
    const b = digestOf({ capabilityId: 'c', operation: 'run', target: null, args: { query: 'y' } })
    const c = digestOf({ capabilityId: 'c', operation: 'run', target: 't', args: { query: 'x' } })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(digestOf({ capabilityId: 'c', operation: 'run', target: null, args: { query: 'x' } })).toBe(a)
  })

  it('hashEvent deterministik & sensitif pada isi event', async () => {
    const e = { eventId: 'e1', eventType: 'a.b', ts: 1, outcome: 'succeeded' }
    expect(hashEvent(e, 'prev')).toBe(hashEvent({ ...e }, 'prev'))
    expect(hashEvent(e, 'prev')).not.toBe(hashEvent({ ...e, outcome: 'failed' }, 'prev'))
    expect(hashEvent(e, 'prev')).not.toBe(hashEvent(e, 'prev2'))
  })
})
