// @vitest-environment node
// Uji Unified Capability Registry v0.5.0: agregasi store nyata, status jujur, validasi,
// permission gate, audit tanpa rahasia, serta integrasi bukti ke Mission Execution Engine.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'

const H = { 'x-dudu-client': '1' }
const H_JSON = (method, p, body) => ({ method, path: p, contentType: 'application/json', body: JSON.stringify(body ?? {}), headers: H })
let dir
let webhookCalls
const mkApi = () => createApi({
  getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k-main', DUDU_MODEL: 'env-model' }),
  dataDir: dir,
  fetchImpl: async (url, init) => {
    webhookCalls.push({ url: String(url), init })
    return { ok: true, status: 204, json: async () => ({}) }
  },
})

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-cap-'))
  webhookCalls = []
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('Registry: agregasi store nyata + referensi eksternal (tanpa duplikat)', () => {
  it('memuat skill, MCP tool, workflow, dan referensi WorkBuddy/Hermes/OpenClaw; ID unik', async () => {
    const api = mkApi()
    const r = await api.handle({ method: 'GET', path: '/api/capability-registry' })
    expect(r.status).toBe(200)
    const ids = r.body.items.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('dudu.skill.kb-search')
    expect(ids).toContain('dudu.mcp.tool.kb_stats')
    expect(ids).toContain('dudu.workflow.data-analysis')
    expect(ids).toContain('workbuddy.skill.marketplace')
    expect(ids).toContain('hermes.skill.skillmd')
    expect(ids).toContain('openclaw.skill.skillmd')
    expect(r.body.summary.externalReferences).toBeGreaterThanOrEqual(10)
    const ext = r.body.items.find((x) => x.id === 'hermes.skill.skillmd')
    expect(ext).toMatchObject({ sourceProject: 'hermes', sourceType: 'external-reference' })
    expect(ext.status.implementation).toBe('reference_only')
    expect(ext.runnable).toBe(false)
    expect(ext.compatibility).toBe('adapter_required')
    expect(ext.docs[0].url).toMatch(/^https:\/\/hermes-agent\.nousresearch\.com\//)
    expect(r.body.items.find((x) => x.id === 'dudu.skill.image-vision').status.availability).toBe('needs_configuration')
  })

  it('filter sumber/kategori/status dan pencarian bekerja di server', async () => {
    const api = mkApi()
    const ext = await api.handle({ method: 'GET', path: '/api/capability-registry?source=workbuddy' })
    expect(ext.body.items.every((x) => x.sourceProject === 'workbuddy')).toBe(true)
    const skills = await api.handle({ method: 'GET', path: '/api/capability-registry?category=skill' })
    expect(skills.body.items.every((x) => x.category === 'skill')).toBe(true)
    const hit = await api.handle({ method: 'GET', path: '/api/capability-registry?q=SKILL.md' })
    expect(hit.body.items.length).toBeGreaterThan(0)
    expect(hit.body.items.every((x) => JSON.stringify(x).toLowerCase().includes('skill.md'))).toBe(true)
    const runnable = await api.handle({ method: 'GET', path: '/api/capability-registry?availability=available' })
    expect(runnable.body.items.some((x) => x.id === 'dudu.mcp.tool.kb_stats')).toBe(true)
  })
})

describe('Status & validasi: berasal dari kondisi nyata, bukan karangan', () => {
  it('validasi MCP tool lokal benar-benar memanggil tool dan lulus', async () => {
    const api = mkApi()
    const v = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_stats/validate'))
    expect(v.status).toBe(200)
    expect(v.body.verdict).toBe('passed')
    expect(v.body.checks.find((c) => c.id === 'invoke')?.ok).toBe(true)
    const after = await api.handle({ method: 'GET', path: '/api/capability-registry/dudu.mcp.tool.kb_stats' })
    expect(after.body.capability.lastValidation.verdict).toBe('passed')
    expect(after.body.capability.status.execution).toBe('not_run') // validasi bukan eksekusi
  })

  it('plugin divalidasi tanpa mengimpor kode; manifest rusak gagal jujur', async () => {
    const api = mkApi()
    const pdir = path.join(dir, 'plugins', 'jam')
    await fs.mkdir(pdir, { recursive: true })
    await fs.writeFile(path.join(pdir, 'manifest.json'), JSON.stringify({ name: 'jam', version: '1.0.0', entry: 'plugin.mjs' }))
    await fs.writeFile(path.join(pdir, 'plugin.mjs'), `export default { run: () => { throw new Error('JANGAN_DIINVOKASI_SAAT_VALIDASI') } }`)
    const v = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.plugin.jam/validate'))
    expect(v.body.verdict).toBe('passed')
    expect(v.body.checks.some((c) => c.id === 'code_not_executed' && c.ok)).toBe(true)
    expect(v.body.checks.some((c) => c.id === 'entry_exists' && c.ok)).toBe(true)

    const bad = path.join(dir, 'plugins', 'rusak')
    await fs.mkdir(bad, { recursive: true })
    await fs.writeFile(path.join(bad, 'manifest.json'), '{ bukan json }')
    const badList = await api.handle({ method: 'GET', path: '/api/capability-registry?q=rusak' })
    expect(badList.body.items[0].status.availability).toBe('unavailable')
    expect((await api.handle(H_JSON('POST', '/api/capability-registry/dudu.plugin.rusak/validate'))).body.verdict).toBe('failed')
  })

  it('referensi eksternal tidak dapat divalidasi/dijalankan sebagai kapabilitas lokal', async () => {
    const api = mkApi()
    const v = await api.handle(H_JSON('POST', '/api/capability-registry/workbuddy.skill.marketplace/validate'))
    expect(v.body.verdict).toBe('not_applicable')
    expect(v.body.checks.some((c) => c.id === 'reference_only')).toBe(true)
    const run = await api.handle(H_JSON('POST', '/api/capability-registry/workbuddy.skill.marketplace/run', { args: {} }))
    expect(run.status).toBe(409)
    expect(run.body.error).toBe('reference_only')
  })
})

describe('Eksekusi: permission gate, konfirmasi, hasil nyata, error apa adanya', () => {
  it('plugin: butuh confirm; setelah aktif+confirm benar-benar dieksekusi; argumen rahasia disamarkan', async () => {
    const api = mkApi()
    const pdir = path.join(dir, 'plugins', 'echo')
    await fs.mkdir(pdir, { recursive: true })
    await fs.writeFile(path.join(pdir, 'manifest.json'), JSON.stringify({ name: 'echo', version: '1.0.0', entry: 'plugin.mjs' }))
    await fs.writeFile(path.join(pdir, 'plugin.mjs'), `export default { run: (a) => ({ ok: true, q: a.q, token: a.token }) }`)
    await api.handle(H_JSON('POST', '/api/plugins', { id: 'echo', enabled: true }))

    const denied = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.plugin.echo/run', { args: { q: 'halo' } }))
    expect(denied.status).toBe(409)
    expect(denied.body.error).toBe('confirmation_required')

    const ok = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.plugin.echo/run', { args: { q: 'halo', token: 'RAHASIA-SEKALI' }, confirm: true }))
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
    expect(ok.body.result).toMatchObject({ ok: true, q: 'halo' })
    expect(JSON.stringify(ok.body.capability.lastExecution)).not.toContain('RAHASIA-SEKALI')

    const audit = await api.handle({ method: 'GET', path: '/api/capability-registry/audit?limit=20' })
    expect(audit.body.events.some((e) => e.capabilityId === 'dudu.plugin.echo' && e.action === 'run' && e.outcome === 'succeeded')).toBe(true)
    expect(JSON.stringify(audit.body)).not.toContain('RAHASIA-SEKALI')
  })

  it('plugin gagal → ok:false + error, tidak dibungkus sukses; plugin nonaktif tidak runnable', async () => {
    const api = mkApi()
    const pdir = path.join(dir, 'plugins', 'boom')
    await fs.mkdir(pdir, { recursive: true })
    await fs.writeFile(path.join(pdir, 'manifest.json'), JSON.stringify({ name: 'boom', version: '1.0.0', entry: 'plugin.mjs' }))
    await fs.writeFile(path.join(pdir, 'plugin.mjs'), `export default { run: () => { throw new Error('meledak jujur') } }`)
    await api.handle(H_JSON('POST', '/api/plugins', { id: 'boom', enabled: true }))
    const run = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.plugin.boom/run', { args: {}, confirm: true }))
    expect(run.status).toBe(200)
    expect(run.body.ok).toBe(false)
    expect(run.body.error).toContain('meledak jujur')

    await api.handle(H_JSON('POST', '/api/plugins', { id: 'boom', enabled: false }))
    const off = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.plugin.boom/run', { args: {}, confirm: true }))
    expect(off.status).toBe(409)
    expect(off.body.error).toBe('not_runnable')
  })

  it('webhook: confirm wajib, request nyata membawa secret, hasil tes tercatat', async () => {
    const api = mkApi()
    await api.handle(H_JSON('PUT', '/api/connectors', { id: 'webhook', fields: { url: 'https://hooks.contoh.test/abc', secret: 'R4hasia-panjang' } }))
    const denied = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.webhook/run', { args: {} }))
    expect(denied.status).toBe(409)
    const ok = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.webhook/run', { args: {}, confirm: true }))
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
    expect(webhookCalls).toHaveLength(1)
    expect(webhookCalls[0].init.headers['x-dudu-secret']).toBe('R4hasia-panjang')
    expect(JSON.stringify(ok.body).includes('R4hasia-panjang')).toBe(false)
  })

  it('email_smtp tetap tidak dapat dijalankan (belum ada implementasi live)', async () => {
    const api = mkApi()
    const run = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.connector.email_smtp/run', { args: {}, confirm: true }))
    expect(run.status).toBe(409)
    expect(run.body.error).toBe('not_runnable')
  })

  it('skill hanya instruksi: tidak dapat dijalankan langsung; MCP tool tanpa query ditolak jelas', async () => {
    const api = mkApi()
    const skill = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.skill.kb-search/run', { args: {} }))
    expect(skill.status).toBe(409)
    expect(skill.body.error).toBe('not_runnable')
    const mcp = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_search/run', { args: {} }))
    expect(mcp.status).toBe(400)
    expect(mcp.body.error).toBe('missing_args')
    const ok = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.kb_search/run', { args: { query: 'cuti' } }))
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
  })
})

describe('Integrasi misi: bukti kapabilitas dilampirkan tanpa merusak acceptance', () => {
  it('run dari konteks misi menulis evidence + log; file bukti bisa diunduh', async () => {
    const api = mkApi()
    const file = await api.files.save({ name: 'sales.csv', bytes: Buffer.from('nama,nilai\nA,10\nB,20\n') })
    const created = await api.handle(H_JSON('POST', '/api/missions', { goal: 'Analisis penjualan', fileId: file.id }))
    expect(created.status).toBe(201)
    const missionId = created.body.mission.id
    const capId = encodeURIComponent('dudu.mcp.tool.kb_stats')
    const run = await api.handle(H_JSON('POST', `/api/missions/${missionId}/capabilities/${capId}/run`, { args: {} }))
    expect(run.status).toBe(200)
    expect(run.body.run.ok).toBe(true)
    expect(run.body.evidence).toMatchObject({ capabilityId: 'dudu.mcp.tool.kb_stats', ok: true })
    expect(run.body.mission.evidence).toHaveLength(1)
    expect(run.body.mission.log.some((l) => l.msg.includes('Bukti kapabilitas'))).toBe(true)
    expect(run.body.mission.acceptance.every((a) => a.status === 'pending')).toBe(true)
    expect(run.body.mission.artifacts).toHaveLength(0)

    const dl = await api.handle({ method: 'GET', path: `/api/missions/${missionId}/evidence/${encodeURIComponent(run.body.evidence.name)}` })
    expect(dl.status).toBe(200)
    const body = JSON.parse(dl.raw.toString('utf8'))
    expect(body).toMatchObject({ missionId, capabilityId: 'dudu.mcp.tool.kb_stats', ok: true })

    const fresh = await api.handle({ method: 'GET', path: `/api/missions/${missionId}` })
    expect(fresh.body.mission.evidence[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('Persistensi audit/status lintas instance', () => {
  it('status eksekusi terakhir dan audit tetap ada setelah API dibuat ulang', async () => {
    const api = mkApi()
    const run = await api.handle(H_JSON('POST', '/api/capability-registry/dudu.mcp.tool.file_list/run', { args: {} }))
    expect(run.body.ok).toBe(true)
    const api2 = mkApi()
    const got = await api2.handle({ method: 'GET', path: '/api/capability-registry/dudu.mcp.tool.file_list' })
    expect(got.body.capability.status.execution).toBe('succeeded')
    expect(got.body.capability.lastExecutionAt).toBeGreaterThan(0)
    const audit = await api2.handle({ method: 'GET', path: '/api/capability-registry/audit' })
    expect(audit.body.events.some((e) => e.action === 'run')).toBe(true)
  })
})
