// @vitest-environment node
// Uji gateway: routing, budget, fallback, credential safety, katalog, provenance usage.
// Semua provider DIPALSUKAN lewat fetchImpl (mock) — tanpa jaringan sungguhan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { createCredentialStore } from '../server/credentials.mjs'
import { createModelCatalog } from '../server/models-catalog.mjs'
import { createUsageLedger, USAGE_PROVENANCE, COST_PROVENANCE } from '../server/usage.mjs'
import { createGateway } from '../server/gateway.mjs'
import { classifyTask, selectModel, nextFallback } from '../server/routing.mjs'
import { validateBaseUrl, PROVIDER_IDS, normalizeOpenRouterModel } from '../server/providers.mjs'

const H = { 'x-dudu-client': '1' }
let dir

const model = (over = {}) => ({
  id: 'm', name: 'm', tier: 'free', pricing: null, contextWindow: 16000,
  capabilities: { vision: null, tools: null }, source: 'provider_catalog', fetchedFrom: 'test', ...over,
})

describe('routing.mjs', () => {
  it('classifyTask: kategori + vision + tanpa LLM', () => {
    expect(classifyTask('tolong debug kode ini: stack trace TypeError', {}).category).toBe('coding')
    expect(classifyTask('analisis data penjualan dari csv', {}).category).toBe('data-analysis')
    expect(classifyTask('ringkas artikel ini', {}).category).toBe('writing')
    expect(classifyTask('halo', {}).category).toBe('general_chat')
    expect(classifyTask('apa isi gambar ini', { hasImages: true })).toMatchObject({ category: 'vision', requiresVision: true })
  })

  it('MANUAL: tidak pernah akhirnya diganti (fallback=null)', () => {
    const st = selectModel({ mode: 'MANUAL', manualSelection: { providerId: 'openrouter', modelId: 'm1' }, task: classifyTask('hai'), catalogEntries: [model({ id: 'm1', providerId: 'openrouter' })], maxFallbacks: 2 })
    expect(st.chosen).toMatchObject({ id: 'm1', providerId: 'openrouter' })
    expect(st.fallbackAllowed).toBe(false)
    expect(nextFallback(st, st.chosen)).toBeNull()
  })

  it('FREE_ONLY: model berbayar tidak pernah dipilih/difallback', () => {
    const entries = [
      model({ id: 'paid', providerId: 'openrouter', tier: 'paid' }),
      model({ id: 'gratis', providerId: 'openrouter', tier: 'free' }),
    ]
    const st = selectModel({ mode: 'FREE_ONLY', task: classifyTask('hai'), catalogEntries: entries, maxFallbacks: 2 })
    expect(st.tier).toBe('free')
    expect(st.candidates.every((c) => c.tier === 'free')).toBe(true)
    const stNoFree = selectModel({ mode: 'FREE_ONLY', task: classifyTask('hai'), catalogEntries: [model({ id: 'paid', tier: 'paid', providerId: 'openrouter' })] })
    expect(stNoFree.error).toBe('no_free_model')
  })

  it('FREE_FIRST: eskalasi berbayar hanya bila tidak ada kandidat free yang memenuhi; alasan tercatat', () => {
    const entries = [
      model({ id: 'free', providerId: 'openrouter', tier: 'free', capabilities: { vision: false, tools: null } }),
      model({ id: 'paid-vision', providerId: 'openrouter', tier: 'paid', capabilities: { vision: true, tools: null } }),
    ]
    const st = selectModel({ mode: 'FREE_FIRST', task: classifyTask('ringkas'), catalogEntries: entries })
    expect(st.tier).toBe('free')
    expect(st.escalationReason).toBeUndefined()
    const stV = selectModel({ mode: 'FREE_FIRST', task: classifyTask('x', { hasImages: true }), catalogEntries: entries })
    expect(stV.tier).toBe('paid')
    expect(stV.escalationReason).toMatch(/idak ada model gratis/)
  })

  it('budget habis: paid diblokir, free tetap dipilih', () => {
    const entries = [model({ id: 'a', providerId: 'x', tier: 'paid' }), model({ id: 'b', providerId: 'y', tier: 'free' })]
    const st = selectModel({ mode: 'FREE_FIRST', task: classifyTask('hai'), catalogEntries: entries, budgetStatus: { state: 'exceeded' } })
    expect(st.tier).toBe('free')
    const stPaid = selectModel({ mode: 'MANUAL', manualSelection: { providerId: 'x', modelId: 'a' }, task: classifyTask('hai'), catalogEntries: entries, budgetStatus: { state: 'exceeded' } })
    expect(stPaid.error).toBe('budget_exceeded')
  })

  it('fallback terkendali: dibatasi maxFallbacks dan tidak memunculkan paid saat budget habis', () => {
    const cands = [
      model({ id: 'f1', providerId: 'p1', tier: 'free' }),
      model({ id: 'f2', providerId: 'p1', tier: 'free' }),
      model({ id: 'paid', providerId: 'p2', tier: 'paid' }), // tidak masuk daftar free-mode
    ]
    const st = selectModel({ mode: 'FREE_ONLY', task: classifyTask('hai'), catalogEntries: cands, budgetStatus: { state: 'ok' }, maxFallbacks: 1 })
    let cur = { ...st, fallbackCount: 0, budgetStatus: { state: 'ok' }, usedSet: new Set() }
    cur = nextFallback(cur, cur.chosen)
    expect(cur.chosen.id).toBe('f2')
    cur = nextFallback(cur, cur.chosen) // maxFallbacks=1 habis
    expect(cur).toBeNull()
  })

  it('vision: model tanpa metadata vision tidak dipilih untuk task vision (bukan ditebak)', () => {
    const entries = [model({ id: 'a', providerId: 'x', tier: 'free', capabilities: { vision: null, tools: null } })]
    const st = selectModel({ mode: 'FREE_FIRST', task: classifyTask('x', { hasImages: true }), catalogEntries: entries })
    expect(st.error).toBe('no_available_model')
  })
})

describe('validateBaseUrl (anti-miskonfigurasi/SSRF dimiliterisasi)', () => {
  it('https jaringan OK; http hanya loopback; skema file ditolak', () => {
    expect(validateBaseUrl('https://api.example.com/v1').ok).toBe(true)
    expect(validateBaseUrl('http://127.0.0.1:11434').ok).toBe(true)
    expect(validateBaseUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false)
    expect(validateBaseUrl('file:///etc/passwd').ok).toBe(false)
    expect(validateBaseUrl('https://user:pass@x.test').ok).toBe(false)
    expect(validateBaseUrl('https://x.test/v1#frag').ok).toBe(false)
  })
})

describe('credentials', () => {
  it('snapshot TIDAK PERNAH mengandung kunci; hanya suffix', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-cred-'))
    const cred = createCredentialStore(dir)
    await cred.setApiKey('openrouter', 'sk-or-v1-ABCDEFGH')
    const snap = await cred.snapshot()
    expect(JSON.stringify(snap)).not.toContain('sk-or-v1-ABCDEFGH')
    expect(snap.openrouter).toMatchObject({ configured: true, enabled: true, hasKey: true, keySuffix: 'EFGH' })
    await cred.setEnabled('openrouter', false)
    expect((await cred.snapshot()).openrouter.enabled).toBe(false)
    await fs.rm(dir, { recursive: true, force: true })
  })
  it('kunci terlalu pendek ditolak', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-cred2-'))
    const cred = createCredentialStore(dir)
    await expect(cred.setApiKey('openrouter', 'sk')).rejects.toThrow()
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('katalog (OpenRouter) — tier dari metadata resmi, bukan tebakan', () => {
  it('normalisasi OpenRouter: free/paid/unknown; pricing dalam USD per 1M token', () => {
    expect(normalizeOpenRouterModel({ id: 'a', name: 'A', pricing: { prompt: '0', completion: '0' }, context_length: 8192 }))
      .toMatchObject({ tier: 'free', pricing: { inputPer1M: 0, outputPer1M: 0, currency: 'USD' }, contextWindow: 8192 })
    expect(normalizeOpenRouterModel({ id: 'b', name: 'B', pricing: { prompt: '0.0000015', completion: '0.000002' } }))
      .toMatchObject({ tier: 'paid', pricing: { inputPer1M: 1.5, outputPer1M: 2 } })
    expect(normalizeOpenRouterModel({ id: 'c', name: 'C' }).tier).toBe('unknown')
    expect(normalizeOpenRouterModel({ x: 1 })).toBeNull()
  })

  it('refresh model katalog via mock fetch dan tersimpan di cache disk', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-cat-'))
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/models')
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'free-model', pricing: { prompt: '0', completion: '0' } }, { id: 'paid-model', pricing: { prompt: '0.001', completion: '0.002' } }] }) }
    })
    const catalog = createModelCatalog(dir, { fetchImpl })
    const r = await catalog.refresh('openrouter', { apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1' })
    expect(r).toMatchObject({ ok: true, count: 2 })
    const list = await catalog.list('openrouter')
    expect(list.fresh).toBe(true)
    expect(list.models.map((m) => m.id)).toEqual(['free-model', 'paid-model'])
    expect(list.models[0].tier).toBe('free')
    expect(list.models[1].tier).toBe('paid')
    await fs.rm(dir, { recursive: true, force: true })
  })
})

/* ---------------- end-to-end API dengan gateway ---------------- */

const defaultUpstreamFetch = async (url, init) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ model: JSON.parse(init.body).model, choices: [{ message: { content: 'balasan' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
})
const ENV_BASE = 'https://openrouter.ai/api/v1' // env legacy via adapter, bukan katalog openrouter

const mkApi = (env = {}, fetchImpl = defaultUpstreamFetch) =>
  createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k-main', DUDU_PROVIDER_BASE_URL: ENV_BASE, DUDU_MODEL: 'env-model', ...env }), dataDir: dir, fetchImpl })

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-gw-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const H_JSON = (method, path, body, headers = {}) => ({ method, path, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { ...H, ...headers } })

describe('API gateway endpoints', () => {
  it('daftar provider: tanpa kunci; POST kunci: respons tanpa kunci', async () => {
    const api = mkApi()
    const list = await api.handle({ method: 'GET', path: '/api/gateway/providers' })
    expect(list.status).toBe(200)
    expect(list.body.providers.map((p) => p.id)).toEqual(PROVIDER_IDS)
    for (const p of list.body.providers) expect(p.apiKey).toBeUndefined()

    const set = await api.handle(H_JSON('POST', '/api/gateway/providers/openrouter/key', { apiKey: 'sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ', baseUrl: 'https://openrouter.ai/api/v1' }))
    expect(set.status).toBe(200)
    expect(JSON.stringify(set.body)).not.toContain('sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    expect(set.body.provider).toMatchObject({ configured: true, enabled: true, keySuffix: 'WXYZ' })

    const after = await api.handle({ method: 'GET', path: '/api/gateway/providers' })
    expect(JSON.stringify(after.body)).not.toContain('sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  it('test connection 401 → ok=false; status test tersimpan; tanpa kunci di respons', async () => {
    const failing = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Invalid' } }) })
    const api = mkApi({}, failing)
    expect((await api.handle(H_JSON('POST', '/api/gateway/providers/groq/key', { apiKey: 'gsk-1234567890' }))).status).toBe(200)
    const r = await api.handle({ method: 'POST', path: '/api/gateway/providers/groq/test', headers: H, contentType: 'application/json', body: '' })
    expect(r.status).toBe(502)
    expect(r.body).toMatchObject({ ok: false })
    expect(JSON.stringify(r.body)).not.toContain('gsk-1234567890')
    const snap = (await api.handle({ method: 'GET', path: '/api/gateway/providers' })).body.providers.find((p) => p.id === 'groq')
    expect(snap.lastOk).toBe(false)
    expect(snap.lastError).toMatch(/401/)
  })

  it('katalog via endpoint /api/gateway/providers/:id/models memakai mock provider', async () => {
    const api = mkApi({}, async (url) => {
      if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'free-m', pricing: { prompt: '0', completion: '0' } }] }) }
      throw new Error('unexpected ' + url)
    })
    expect((await api.handle(H_JSON('POST', '/api/gateway/providers/openrouter/key', { apiKey: 'sk-or-v1-ZZZZZZZZZZZZ', baseUrl: 'https://openrouter.ai/api/v1' }))).status).toBe(200)
    const r = await api.handle({ method: 'GET', path: '/api/gateway/providers/openrouter/models?refresh=1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ fresh: true, count: 1 })
    expect(r.body.models[0]).toMatchObject({ id: 'free-m', tier: 'free' })
  })

  it('kebijakan routing: PUT mode tidak dikenal → 400; PUT budget → tersimpan', async () => {
    const api = mkApi()
    const bad = await api.handle(H_JSON('PUT', '/api/gateway/settings', { defaultMode: 'YEEET' }))
    expect(bad.status).toBe(400)
    const good = await api.handle(H_JSON('PUT', '/api/gateway/settings', { defaultMode: 'FREE_ONLY', budget: { paidUsdMonthly: 3.5 }, maxFallbacks: 1 }))
    expect(good.status).toBe(200)
    expect(good.body.settings).toMatchObject({ defaultMode: 'FREE_ONLY', budget: { paidUsdMonthly: 3.5 }, maxFallbacks: 1 })
  })

  it('usage summary: provenance + budget + alerts', async () => {
    const ledger = createUsageLedger(dir)
    await ledger.record({
      providerId: 'openrouter', modelId: 'free/x', tier: 'free', status: 'success',
      usage: { input: 12, output: 4 }, usageProvenance: USAGE_PROVENANCE.PROVIDER_REPORTED,
      cost: { amount: null, provenance: COST_PROVENANCE.NONE },
      mode: 'FREE_ONLY', kind: 'chat',
    })
    await ledger.record({
      providerId: 'openrouter', modelId: 'paid/y', tier: 'paid', status: 'success',
      usage: { input: 100, output: 200 }, usageProvenance: USAGE_PROVENANCE.PROVIDER_REPORTED,
      cost: { amount: 0.0021, provenance: COST_PROVENANCE.COMPUTED_FROM_CATALOG_PRICING },
      mode: 'FREE_FIRST', escalationReason: 'tidak ada gratis', kind: 'chat',
    })
    const s = await ledger.summary({ budget: { paidUsdMonthly: 0.001 } })
    expect(s.byModel['openrouter:free/x'].tokens.inputActual).toBe(12)
    expect(s.byModel['openrouter:paid/y'].tokens.inputActual).toBe(100)
    expect(s.byModel['openrouter:free/x'].cost).toBe(0)
    expect(s.totals.costApprox).toBe(true)
    expect(s.budget.state).toBe('exceeded')
    expect(s.alerts.map((a) => a.kind)).toContain('budget_exceeded')
    expect(s.alerts.map((a) => a.kind)).toContain('paid_escalation')
  })

  it('/api/chat jalur gateway: route + usage + cost terbawa, kontrak lama (content/model) utuh', async () => {
    const api = mkApi()
    const r = await api.handle(H_JSON('POST', '/api/chat', { messages: [{ role: 'user', content: 'halo' }] }))
    expect(r.status).toBe(200)
    expect(r.body.content).toBe('balasan')
    expect(r.body.model).toBe('env-model')
    expect(r.body.route).toMatchObject({ providerId: 'env', modelId: 'env-model', tier: 'unknown' })
    expect(r.body.route.estimated).toBe(false)
    expect(r.body.usage.usageProvenance).toBe('PROVIDER_REPORTED')
    expect(r.body.cost.provenance).toBe('NONE')
    expect(JSON.stringify(r.body)).not.toContain('k-main')
  })
})

describe('gateway.complete end-to-end (provider palsu)', () => {
  /** Gateway mandiri dengan katalog in-memory (proxy) + fetch mock; tanpa jaringan. */
  function mkGatewayEnv({ catalogModels = [], mode = 'FREE_FIRST', fetchImpl = defaultUpstreamFetch, envKey = null } = {}) {
    const fakeFetch = vi.fn(fetchImpl)
    const credentials = createCredentialStore(dir)
    const realCatalog = createModelCatalog(dir, {
      fetchImpl: async () => { throw new Error('katalog tidak boleh diambil lewat jaringan pada uji ini') },
    })
    const catalog = {
      list: async (pid) => ({ fresh: true, stale: false, models: catalogModels.filter((m) => m.providerId === pid) }),
      refresh: realCatalog.refresh.bind(realCatalog),
      find: realCatalog.find.bind(realCatalog),
      allProvidersSummary: realCatalog.allProvidersSummary.bind(realCatalog),
    }
    const usage = createUsageLedger(dir)
    const gateway = createGateway({
      dataDir: dir, credentials, catalog, usage,
      getConfig: () => ({ apiKey: envKey, model: envKey ? 'env-model' : null, baseUrl: 'https://legacy.test/v1', visionModel: null }),
      fetchImpl: fakeFetch,
    })
    return { fakeFetch, credentials, usage, gateway }
  }
  async function writeSettings(settings) {
    await fs.writeFile(path.join(dir, 'routing-settings.json'), JSON.stringify(settings), 'utf8')
  }

  it('free-first: kandidat gratis menang; usage PROVIDER_REPORTED bila provider melaporkan token', async () => {
    await writeSettings({ version: 1, defaultMode: 'FREE_FIRST', budget: { paidUsdMonthly: 0 } })
    const gEnv = mkGatewayEnv({
      catalogModels: [model({ id: 'free/alpha', providerId: 'openrouter', tier: 'free', pricing: { inputPer1M: 0, outputPer1M: 0, currency: 'USD' } })],
    })
    await gEnv.credentials.setApiKey('openrouter', 'sk-or-test-1234567890')
    const reply = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'halo' }], purpose: 'chat' })
    expect(reply.content).toBe('balasan')
    expect(reply.route).toMatchObject({ providerId: 'openrouter', modelId: 'free/alpha', tier: 'free' })
    expect(reply.usage.usageProvenance).toBe(USAGE_PROVENANCE.PROVIDER_REPORTED)
    const body = JSON.parse(gEnv.fakeFetch.mock.calls[0][1].body)
    expect(body.model).toBe('free/alpha')
    expect(body.max_tokens).toBeGreaterThan(0)
    const s = await gEnv.usage.summary({ budget: { paidUsdMonthly: 0 } })
    expect(s.byProvider.openrouter.tokens.inputActual).toBe(10)
    expect(s.byProvider.openrouter.tokens.outputActual).toBe(5)
    expect(s.byProvider.openrouter.cost).toBe(0) // pricing 0 pada katalog → biaya 0 USD, tercatat
  })

  it('token yang tidak dilaporkan provider → estimasi terslabel ESTIMATED, bukan angka palsu', async () => {
    await writeSettings({ version: 1, defaultMode: 'FREE_FIRST', budget: { paidUsdMonthly: 0 } })
    const noUsageFetch = async (url, init) => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ model: JSON.parse(init.body).model, choices: [{ message: { content: 'jawaban panjang' } }] }),
    })
    const gEnv = mkGatewayEnv({
      catalogModels: [model({ id: 'free/alpha', providerId: 'openrouter', tier: 'free' })],
      fetchImpl: noUsageFetch,
    })
    await gEnv.credentials.setApiKey('openrouter', 'sk-or-test-1234567890')
    const reply = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'hai' }] })
    expect(reply.usage.usageProvenance).toBe(USAGE_PROVENANCE.ESTIMATED)
    expect(reply.usage.usage.input).toBeGreaterThan(0)
    expect(reply.route.estimated).toBe(true)
  })

  it('FREE_ONLY: kandidat paid tidak pernah dipanggil; jika hanya paid → error 409 no_free_model', async () => {
    await writeSettings({ version: 1, defaultMode: 'FREE_ONLY', budget: { paidUsdMonthly: 0 } })
    const gEnv = mkGatewayEnv({ catalogModels: [model({ id: 'paid/x', providerId: 'openrouter', tier: 'paid' })], mode: 'FREE_ONLY' })
    await gEnv.credentials.setApiKey('openrouter', 'sk-or-test-1234567890')
    await expect(gEnv.gateway.complete({ messages: [{ role: 'user', content: 'hai' }] }))
      .rejects.toMatchObject({ code: 'no_free_model' })
    expect(gEnv.fakeFetch).not.toHaveBeenCalled()
  })

  it('budget habis: permintaan paid manual diblokir 402; kandidat free tetap dipakai', async () => {
    const usage = createUsageLedger(dir)
    await usage.record({ providerId: 'openrouter', modelId: 'paid/y', tier: 'paid', status: 'success', usage: { input: 0, output: 0 }, usageProvenance: USAGE_PROVENANCE.PROVIDER_REPORTED, cost: { amount: 5, provenance: COST_PROVENANCE.COMPUTED_FROM_CATALOG_PRICING }, mode: 'FREE_FIRST', kind: 'chat' })
    await writeSettings({ version: 1, defaultMode: 'FREE_FIRST', budget: { paidUsdMonthly: 1 } })
    const gEnv = mkGatewayEnv({
      catalogModels: [model({ id: 'paid/x', providerId: 'openrouter', tier: 'paid' }), model({ id: 'free/z', providerId: 'openrouter', tier: 'free' })],
      mode: 'FREE_FIRST',
    })
    await gEnv.credentials.setApiKey('openrouter', 'sk-or-test-1234567890')
    const r = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'hai' }] })
    expect(r.route.tier).toBe('free')
    const budgetBlocked = await gEnv.gateway.complete({
      messages: [{ role: 'user', content: 'hai' }], mode: 'MANUAL',
      manualSelection: { providerId: 'openrouter', modelId: 'paid/x' },
    }).catch((e) => e)
    expect(budgetBlocked.code).toBe('budget_exceeded')
    expect(budgetBlocked.status).toBe(402)
  })

  it('fallback: provider pertama gagal 500 → second free dipakai; chain tercatat di route.fallback', async () => {
    await writeSettings({ version: 1, defaultMode: 'FREE_FIRST', budget: { paidUsdMonthly: 0 } })
    const failing = async (url, init) => {
      if (JSON.parse(init.body).model === 'free/alpha') return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'boom' } }) }
      return defaultUpstreamFetch(url, init)
    }
    const gEnv = mkGatewayEnv({
      catalogModels: [model({ id: 'free/alpha', providerId: 'openrouter', tier: 'free' }), model({ id: 'free/beta', providerId: 'groq', tier: 'free' })],
      mode: 'FREE_FIRST', fetchImpl: failing,
    })
    await gEnv.credentials.setApiKey('openrouter', 'sk-or-test-1234567890')
    await gEnv.credentials.setApiKey('groq', 'gsk-1234567890')
    const r = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'hai' }] })
    expect(r.route.modelId).toBe('free/beta')
    expect(r.route.fallback?.length ?? 0).toBeGreaterThan(0)
    expect(r.route.fallback[0]).toMatch(/free\/alpha/)
    const s = await gEnv.usage.summary({})
    expect(s.byModel['groq:free/beta'].requests).toBe(1)
  })

  it('ROTATE: pemilihan bergilir antar kandidat yang cocok; gratis/lokal didahulukan sebelum berbayar', async () => {
    await writeSettings({ version: 1, defaultMode: 'ROTATE', budget: { paidUsdMonthly: 5 } })
    const gEnv = mkGatewayEnv({
      catalogModels: [
        model({ id: 'free/alpha', providerId: 'openrouter', tier: 'free' }),
        model({ id: 'free/beta', providerId: 'groq', tier: 'free' }),
        model({ id: 'free/gamma', providerId: 'openrouter', tier: 'free' }),
        model({ id: 'paid/x', providerId: 'openrouter', tier: 'paid' }),
      ],
      mode: 'ROTATE',
    })
    await gEnv.credentials.setApiKey('openrouter', 'sk-or-test-1234567890')
    await gEnv.credentials.setApiKey('groq', 'gsk-1234567890')
    const r1 = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'halo' }] })
    const r2 = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'halo' }] })
    const r3 = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'halo' }] })
    const r4 = await gEnv.gateway.complete({ messages: [{ role: 'user', content: 'halo' }] })
    // Empat permintaan dengan task sama memutar SEMUA kandidat gratis (urutan pool mengikuti penyusunan kandidat
    // per provider), lalu kembali melingkar ke kandidat pertama:
    expect([r1, r2, r3].map(x => x.route.modelId).sort()).toEqual(['free/alpha', 'free/beta', 'free/gamma'])
    expect(r4.route.modelId).toBe(r1.route.modelId) // melingkar kembali
    expect(r1.route.mode).toBe('ROTATE')
    // kandidat berbayar tidak pernah dirotasi selama ada kandidat gratis (hemat token)
    for (const r of [r1, r2, r3, r4]) expect(r.route.tier).toBe('free')
  })

  it('chat 200 via gateway meski DUDU_PROVIDER_API_KEY kosong — cukup kunci gateway aktif (auto-warm katalog)', async () => {
    const aware = async (url, init) => String(url).endsWith('/models')
      ? { ok: true, status: 200, json: async () => ({ data: [{ id: 'free/m', pricing: { prompt: '0', completion: '0' } }] }) }
      : defaultUpstreamFetch(url, init)
    const api = mkApi({ DUDU_PROVIDER_API_KEY: '', DUDU_MODEL: '' }, aware) // env legacy TIDAK dikonfigurasi
    const set = await api.handle(H_JSON('POST', '/api/gateway/providers/openrouter/key', { apiKey: 'sk-or-v1-QQQQQQQQQQQQ', baseUrl: 'https://openrouter.ai/api/v1' }))
    expect(set.status).toBe(200)
    const chat = await api.handle(H_JSON('POST', '/api/chat', { messages: [{ role: 'user', content: 'halo' }] }))
    expect(chat.status).toBe(200)
    expect(chat.body.content).toBe('balasan')
    expect(chat.body.route.providerId).toBe('openrouter')
  })

  it('chat tetap 501 dengan pesan arahan Gateway AI bila tidak ada provider aktif sama sekali', async () => {
    const api = mkApi({ DUDU_PROVIDER_API_KEY: '', DUDU_MODEL: '', DUDU_PROVIDER_BASE_URL: '' })
    const r = await api.handle(H_JSON('POST', '/api/chat', { messages: [{ role: 'user', content: 'halo' }] }))
    expect(r.status).toBe(501)
    expect(r.body.error).toBe('provider_not_configured')
    expect(r.body.message).toMatch(/Gateway AI/)
  })

  it('MANUAL: model env tidak ditukar diam-diam; error diteruskan apa adanya', async () => {
    await writeSettings({ version: 1, defaultMode: 'MANUAL', manualSelection: { providerId: 'env', modelId: 'env-model' }, budget: { paidUsdMonthly: 0 } })
    const envFailing = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'rate limited' } }) })
    const gEnv = mkGatewayEnv({ envKey: 'env-key-1234567890', mode: 'MANUAL', fetchImpl: envFailing })
    await expect(gEnv.gateway.complete({ messages: [{ role: 'user', content: 'hai' }] }))
      .rejects.toMatchObject({ code: 'provider_request_error' })
    expect(gEnv.fakeFetch.mock.calls[0][0]).toBe('https://legacy.test/v1/chat/completions')
  })
})
