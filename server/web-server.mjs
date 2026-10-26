// DUDU AI GATEWAY — satu-satunya jalur pemanggilan LLM dari semua modul Dudu.
// Chat, misi, dan workforce mengarah ke sini (bukan memanggil provider langsung).
//
// Tanggung jawab:
//  1. Kebijakan routing (mode default + budget) tersimpan di <dataDir>/routing-settings.json.
//  2. Klasifikasi task heuristik (tanpa panggilan LLM — hemat token).
//  3. Kandidat dari katalog model provider aktif (metadata resmi provider; tier free/paid/unknown/local).
//  4. Guard budget: habis → model berbayar diblokir; kandidat free/local tetap boleh.
//  5. Pemanggilan adapter provider dengan fallback terkendali (dibatasi maxFallbacks).
//  6. Usage dicatat ke ledger dengan provenance jujur (PROVIDER_REPORTED vs ESTIMATED).
//  7. Tidak mengarang data kuota/harga; yang tidak diketahui tetap UNKNOWN/NONE.
//  8. Provider "env" = konfigurasi legacy DUDU_* (dudu.env), diperlakukan HONEST sebagai tier 'unknown'.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getProviderDef, validateBaseUrl, asFetch, envAdapter } from './providers.mjs'
import { ProviderConfigError, ProviderRequestError, PolicyError, DuduError } from './errors.mjs'
import { classifyTask, selectModel, nextFallback, ROUTING_MODES, defaultMaxTokens } from './routing.mjs'
import { USAGE_PROVENANCE, COST_PROVENANCE, estimateTokensFromChars } from './usage.mjs'

export const SETTINGS_FILE = 'routing-settings.json'
const ROTATION_FILE = 'rotation-state.json'

export const DEFAULT_SETTINGS = {
  version: 1,
  defaultMode: 'FREE_FIRST',
  maxFallbacks: 2,
  privacyLocalPreferred: true,
  budget: { paidUsdMonthly: 0 }, // 0 = anggaran belum diset → belum membatasi apa pun (dilaporkan 'unset', bukan 'ok')
  manualSelection: null, // { providerId, modelId } — dipakai bila defaultMode === 'MANUAL'
}

export function normalizeSettings(raw) {
  const mode = ROUTING_MODES.includes(raw?.defaultMode) ? raw.defaultMode : DEFAULT_SETTINGS.defaultMode
  const maxFallbacks = Number.isFinite(raw?.maxFallbacks) && raw.maxFallbacks >= 0 ? Math.min(Math.floor(raw.maxFallbacks), 4) : 2
  const paidUsdMonthly = Number.isFinite(Number(raw?.budget?.paidUsdMonthly)) && Number(raw.budget.paidUsdMonthly) >= 0 ? Number(raw.budget.paidUsdMonthly) : 0
  const manualSelection = (raw?.manualSelection && typeof raw.manualSelection.providerId === 'string' && typeof raw.manualSelection.modelId === 'string')
    ? { providerId: raw.manualSelection.providerId, modelId: raw.manualSelection.modelId } : null
  return { version: 1, defaultMode: mode, maxFallbacks, privacyLocalPreferred: raw?.privacyLocalPreferred !== false, budget: { paidUsdMonthly }, manualSelection }
}

export function createGateway({ dataDir, credentials, catalog, usage, getConfig = () => ({ apiKey: null, model: null, baseUrl: null, visionModel: null }), fs = fsp, fetchImpl = globalThis.fetch, now = Date.now, log = (...a) => console.error(...a) }) {
  const settingsFile = path.join(dataDir, SETTINGS_FILE)
  let settingsCache = null

  async function readSettings() {
    if (settingsCache) return settingsCache
    try {
      const raw = JSON.parse(await fs.readFile(settingsFile, 'utf8'))
      if (raw && raw.version === 1) { settingsCache = normalizeSettings(raw); return settingsCache }
    } catch { /* belum ada */ }
    settingsCache = normalizeSettings(DEFAULT_SETTINGS)
    return settingsCache
  }

  async function updateSettings(patch) {
    const cur = await readSettings()
    const next = normalizeSettings({
      ...cur,
      ...patch,
      budget: { ...cur.budget, ...(patch?.budget ?? {}) },
      ...(patch?.manualSelection !== undefined ? { manualSelection: patch.manualSelection } : {}),
    })
    settingsCache = next
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${settingsFile}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 })
    await fs.rename(tmp, settingsFile)
    return next
  }

  /** Katalog gabungan + provider aktif. Katalog yang belum dimuat tidak dihakimi: tidak diarang.
   *  Sebelum membaca, katalog provider aktif yang masih kosong di-"warm" (maks 1× per 60 detik per provider)
   *  agar chat langsung jalan setelah kunci disimpan — tanpa tebakan model. */
  const warmTriedAt = new Map()
  async function warmCatalogs() {
    const summary = await catalog.allProvidersSummary()
    const snap = await credentials.snapshot()
    for (const [id, st] of Object.entries(snap)) {
      if (!st.enabled) continue
      const rec = summary[id]
      if (rec && rec.count > 0) continue
      const last = warmTriedAt.get(id) ?? 0
      if (now() - last < 60_000) continue
      warmTriedAt.set(id, now())
      try {
        const def = getProviderDef(id)
        if (!def) continue
        await catalog.refresh(id, await credentials.credentialFor(id, def.defaultBaseUrl))
      } catch { /* provider tidak terjangkau: status nyata tetap di kartu provider (Uji koneksi / Muat katalog) */ }
    }
  }

  async function effectiveCatalogEntries() {
    await warmCatalogs()
    const snap = await credentials.snapshot()
    const entries = []
    const providerStates = {}
    for (const [id, st] of Object.entries(snap)) {
      providerStates[id] = st
      if (!st.enabled) continue
      const { models } = await catalog.list(id, { allowStale: true })
      entries.push(...(models ?? []).map((m) => ({ ...m, providerId: id })))
    }
    const cfg = getConfig()
    // Provider env legacy: satu model dari dudu.env / .env. Tier 'unknown' — tidak diklaim gratis.
    if (cfg.apiKey && cfg.model) {
      entries.push({
        id: cfg.model, name: cfg.model, providerId: 'env', tier: 'unknown',
        pricing: null, contextWindow: null,
        capabilities: { vision: cfg.visionModel ? true : null, tools: null },
        source: 'environment_config', fetchedFrom: 'DUDU_MODEL (env/dudu.env)',
      })
    }
    // Blokir model tertentu dari kandidat routing (mis. model pensiun yang masih terdaftar di katalog).
    // Variabel Railway: DUDU_MODEL_BLOCKLIST=gemini-2.5,gemini-2.0,gemini-1.5,preview,exp
    const BLOCKLIST = String(process.env.DUDU_MODEL_BLOCKLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const filtered = BLOCKLIST.length ? entries.filter((e) => !BLOCKLIST.some((b) => String(e.id).toLowerCase().includes(b))) : entries
    return { entries: filtered, providerStates }
  }

  async function budgetStatus() {
    const s = await readSettings()
    const snap = await usage.summary({ budget: { paidUsdMonthly: s.budget.paidUsdMonthly }, now })
    return snap.budget
  }

  /* ---------- kursor perputaran (ROTATE): { [kategori task]: jumlah pemilihan } ---------- */
  let rotationCache = null
  async function readRotationCursor(category) {
    try {
      if (!rotationCache) {
        const raw = JSON.parse(await fs.readFile(path.join(dataDir, ROTATION_FILE), 'utf8'))
        rotationCache = (raw && typeof raw === 'object' && raw.version === 1 && typeof raw.counts === 'object') ? raw : { version: 1, counts: {} }
      }
      return Number(rotationCache.counts[category]) || 0
    } catch { return 0 }
  }
  async function bumpRotation(category, next) {
    try {
      rotationCache ??= { version: 1, counts: {} }
      rotationCache.counts[category] = next
      const file = path.join(dataDir, ROTATION_FILE)
      await fs.mkdir(dataDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify(rotationCache), 'utf8')
      await fs.rename(tmp, file)
    } catch { /* kursor gagal disimpan: rotasi tetap berjalan dari cache memori */ }
  }

  async function callProvider(providerId, cred, { modelId, messages, signal, maxTokens }) {
    if (providerId === 'env') {
      // Provider env legacy: konfigurasi datang dari dudu.env / .env (bukan registry).
      return envAdapter.chat(cred, { model: modelId, messages, signal, maxTokens }, asFetch(fetchImpl))
    }
    const def = getProviderDef(providerId)
    if (!def) throw new DuduError(400, 'provider_unknown', `Provider ${providerId} tidak terdaftar.`)
    const effective = { apiKey: cred.apiKey, baseUrl: cred.baseUrl || def.defaultBaseUrl }
    if (def.needsCustomBaseUrl && !effective.baseUrl) throw new ProviderConfigError('Endpoint custom belum memiliki baseUrl.')
    const v = validateBaseUrl(effective.baseUrl)
    if (!v.ok) throw new ProviderConfigError(`BaseUrl tidak valid: ${v.reason}`)
    return def.adapter.chat(effective, {
      model: modelId, messages, signal, maxTokens,
      usageInclude: providerId === 'openrouter', // OpenRouter: minta usage+cost aktual dilaporkan
    }, asFetch(fetchImpl))
  }

  /** Estimasi token lokal (dilabeli ESTIMATED — bukan angka provider). */
  function estimatedUsage(messages, content) {
    const inputChars = messages.reduce((a, m) => a + Math.ceil(String(m.content ?? '').length / 4), 0)
    return {
      usage: { input: estimateTokensFromChars(inputChars), output: estimateTokensFromChars(String(content ?? '').length), total: null, cached: null },
      usageProvenance: USAGE_PROVENANCE.ESTIMATED,
    }
  }

  /** Biaya dengan provenance: PROVIDER_REPORTED_COST > COMPUTED_FROM_CATALOG_PRICING > NONE. */
  function computeCost(providerId, providerResult, catalogEntry) {
    if (providerResult && Number.isFinite(providerResult.cost)) return { amount: providerResult.cost, currency: 'USD', provenance: COST_PROVENANCE.PROVIDER_REPORTED_COST }
    const p = catalogEntry?.pricing
    if (catalogEntry?.tier === 'local') return { amount: 0, currency: 'USD', provenance: COST_PROVENANCE.PROVIDER_REPORTED_COST } // inferensi lokal memang tanpa biaya API
    if (p && providerResult && (Number.isFinite(providerResult.usage?.input) || Number.isFinite(providerResult.usage?.output))) {
      const amount = ((providerResult.usage.input ?? 0) / 1e6) * p.inputPer1M + ((providerResult.usage.output ?? 0) / 1e6) * p.outputPer1M
      return { amount, currency: p.currency ?? 'USD', provenance: COST_PROVENANCE.COMPUTED_FROM_CATALOG_PRICING }
    }
    return { amount: null, currency: 'USD', provenance: COST_PROVENANCE.NONE }
  }

  /**
   * Permintaan LLM utama lewat routing + guard budget + fallback terkendali + pencatatan.
   * @param {{ messages: Array<{role: 'system'|'user'|'assistant', content: string}>, purpose?: 'chat'|'mission',
   *   conversationId?: string, missionId?: string, mode?: string, manualSelection?: {providerId, modelId}|null,
   *   requiresVision?: boolean, maxTokens?: number, signal?: AbortSignal }} req
   */
  async function complete(req) {
    const s = await readSettings()
    const mode = ROUTING_MODES.includes(req.mode) ? req.mode : s.defaultMode
    const manual = mode === 'MANUAL' ? (req.manualSelection ?? s.manualSelection) : null
    const { entries, providerStates } = await effectiveCatalogEntries()
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    const task = classifyTask(String(lastUser?.content ?? ''), { hasImages: req.requiresVision === true })
    const budget = await budgetStatus()

    const state = selectModel({
      mode, manualSelection: manual, task,
      catalogEntries: entries, budgetStatus: budget,
      maxFallbacks: s.maxFallbacks,
      rotationCursor: mode === 'ROTATE' ? await readRotationCursor(task.category) : 0,
    })
    if (state.error) {
      const err = new PolicyError(state.error, `${state.error}. ${state.detail ?? ''}`.trim(), state.error === 'budget_exceeded' ? 402 : 409)
      err.route = { mode, task, budget: { state: budget.state, cap: budget.cap, spent: budget.spent }, reason: state.detail }
      throw err
    }
    // Perputaran: kursor maju per kategori task agar pemakaian menyebar ke semua kandidat yang cocok.
    if (mode === 'ROTATE' && Number.isFinite(state.nextRotation)) void bumpRotation(task.category, state.nextRotation)
    const maxTokens = Number.isFinite(req.maxTokens) && req.maxTokens > 0 ? req.maxTokens : defaultMaxTokens(task)

    const failures = []
    const fallbackChain = []
    let result = null
    let chosenState = { ...state, fallbackCount:
