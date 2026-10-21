// Katalog model per provider, diambil dari sumber resmi provider dan di-cache ke disk.
// - Sumber metadata: endpoint katalog resmi masing-masing provider. Tidak ada tebakan harga.
// - Cache: <dataDir>/models-cache.json; TTL 6 jam; refresh eksplisit diperbolehkan.
// - Model yang tidak diketahui harganya tidak dikategorikan gratis/diberi jaminan:
//   tier 'unknown' diperlakukan BUKAN gratis dan TIDAK membawa jaminan kualitas.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getProviderDef, validateBaseUrl, asFetch } from './providers.mjs'

const FILE = 'models-cache.json'
const TTL_MS = 6 * 60 * 60 * 1000

export function createModelCatalog(dataDir, { fs = fsp, fetchImpl = globalThis.fetch, ttlMs = TTL_MS, now = Date.now } = {}) {
  const file = path.join(dataDir, FILE)
  let cache = null

  async function loadCache() {
    if (cache) return cache
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      if (raw && typeof raw === 'object' && typeof raw.providers === 'object' && raw.providers !== null) { cache = raw; return cache }
    } catch { /* belum ada */ }
    cache = { version: 1, providers: {} }
    return cache
  }

  async function persist() {
    if (!cache) return
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(cache), { mode: 0o600 })
    await fs.rename(tmp, file)
  }

  async function refresh(providerId, cred) {
    const def = getProviderDef(providerId)
    if (!def) return { ok: false, reason: 'Provider tidak dikenal.' }
    if (def.needsCustomBaseUrl && !cred.baseUrl) return { ok: false, reason: 'Endpoint custom belum memiliki baseUrl.' }
    if (def.requiresApiKey && !cred.apiKey) return { ok: false, reason: 'Kunci API belum diatur; katalog tidak dapat dimuat.' }
    if (cred.baseUrl || providerId !== 'custom') {
      const v = validateBaseUrl(cred.baseUrl || def.defaultBaseUrl)
      if (!v.ok) return { ok: false, reason: v.reason }
    }
    const effective = { apiKey: cred.apiKey, baseUrl: cred.baseUrl || def.defaultBaseUrl }
    const res = await def.adapter.listModels(effective, asFetch(fetchImpl))
    if (!res.ok) return { ok: false, reason: res.reason ?? 'Gagal memuat katalog.', status: res.status }
    // adapter.listModels sudah melakukan normalisasi (tier/pricing/modalitas) — jangan dinormalisasi dua kali.
    const models = (Array.isArray(res.models) ? res.models : [])
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({
        ...m,
        providerId,
        tier: ['free', 'paid', 'unknown', 'local'].includes(m.tier) ? m.tier : 'unknown',
        source: 'provider_catalog',
      }))
    const all = await loadCache()
    all.providers[providerId] = { fetchedAt: now(), models }
    await persist()
    return { ok: true, count: models.length }
  }

  async function getStaleAware(providerId, { allowStale = true } = {}) {
    const all = await loadCache()
    const rec = all.providers[providerId]
    if (!rec) return { fresh: false, stale: false, models: [] }
    const fresh = now() - rec.fetchedAt < ttlMs
    if (!fresh && !allowStale) return { fresh: false, stale: false, models: [] }
    return { fresh, stale: !fresh, models: rec.models ?? [] }
  }

  async function list(providerId, { refreshIfStale = false, cred } = {}) {
    const state = await getStaleAware(providerId, { allowStale: refreshIfStale })
    if (refreshIfStale && state.stale) {
      await refresh(providerId, cred)
      return { ...(await getStaleAware(providerId, { allowStale: false })), triggeredRefresh: true }
    }
    return { ...state, triggeredRefresh: false }
  }

  async function refreshAll(credentialsMap) {
    const results = {}
    for (const [id, cred] of Object.entries(credentialsMap)) {
      results[id] = await refresh(id, cred)
    }
    return results
  }

  async function find(providerId, modelId) {
    const { models } = await getStaleAware(providerId)
    return models.find((m) => m.id === modelId) ?? null
  }

  async function allProvidersSummary() {
    const all = await loadCache()
    const out = {}
    for (const [id, rec] of Object.entries(all.providers)) {
      out[id] = { fetchedAt: rec.fetchedAt, fresh: now() - rec.fetchedAt < ttlMs, count: (rec.models ?? []).length }
    }
    return out
  }

  return { refresh, refreshAll, list, find, allProvidersSummary, file }
}
