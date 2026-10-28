// Penyimpanan kredensial provider APlikasi (server-side saja).
// - File: <dataDir>/providers.json (mode 0600, penulisan atomik).
// - Snapshot publik TIDAK PERNAH mengandung apiKey; hanya metadata aman (suffix 4 karakter, status, baseUrl).
// - BaseUrl juga tidak boleh mengandung rahasia; disimpan apa adanya (URL endpoint publik).
// - Secret tidak pernah ditulis ke log atau error.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PROVIDER_IDS } from './providers.mjs'

const FILE = 'providers.json'
const suffixOf = (k) => (typeof k === 'string' && k.length >= 4) ? k.slice(-4) : null

export function createCredentialStore(dataDir, { fs = fsp } = {}) {
  const file = path.join(dataDir, FILE)
  let cache = null

  async function readAll() {
    if (cache) return cache
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      if (raw && typeof raw === 'object' && typeof raw.providers === 'object' && raw.providers !== null) { cache = raw; return cache }
    } catch { /* belum ada: wajar */ }
    cache = { version: 1, providers: {} }
    return cache
  }

  async function persist() {
    if (!cache) return
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 })
    await fs.rename(tmp, file)
  }

  function blank(id) {
    return {
      id,
      enabled: false,
      configured: false,
      apiKey: null,
      baseUrl: null,
      keyUpdatedAt: null,
      status: { lastTest: null, lastOk: null, lastError: null },
    }
  }

  async function getFull(id) {
    const all = await readAll()
    return all.providers[id] ?? null
  }

  /** Metadata aman untuk frontend. TANPA apiKey. */
  async function snapshot() {
    const all = await readAll()
    const out = {}
    for (const id of PROVIDER_IDS) {
      const rec = all.providers[id] ?? blank(id)
      out[id] = {
        id,
        enabled: Boolean(rec.enabled && rec.configured),
        configured: Boolean(rec.configured),
        hasKey: Boolean(rec.apiKey),
        keySuffix: rec.apiKey ? suffixOf(rec.apiKey) : null,
        keyUpdatedAt: rec.keyUpdatedAt ?? null,
        baseUrl: rec.baseUrl ?? null, // URL endpoint; bukan rahasia
        lastTest: rec.status?.lastTest ?? null,
        lastOk: rec.status?.lastOk ?? null,
        lastError: (typeof rec.status?.lastError === 'string' ? rec.status.lastError : null) ?? null,
      }
    }
    return out
  }

  async function listEnabled() {
    const snap = await snapshot()
    return Object.values(snap).filter((p) => p.enabled)
  }

  async function enabledAndConfiguredIds() {
    const all = await readAll()
    return PROVIDER_IDS.filter((id) => {
      const rec = all.providers[id]
      return Boolean(rec?.enabled && rec.configured)
    })
  }

  async function setApiKey(id, apiKey, now = Date.now()) {
    const all = await readAll()
    const rec = all.providers[id] ?? blank(id)
    const key = String(apiKey ?? '').trim()
    if (!/^[A-Za-z0-9_\-\.~:+=\/]+$/.test(key) || key.length < 8) throw new Error('Kunci API tidak valid minimal 8 karakter.')
    rec.apiKey = key
    rec.keyUpdatedAt = now
    rec.configured = true
    rec.enabled = true // kunci baru otomatis diaktifkan; pengguna bisa menonaktifkan sesudahnya
    rec.status = { lastTest: null, lastOk: null, lastError: null }
    all.providers[id] = rec
    await persist()
  }

  async function removeApiKey(id, now = Date.now()) {
    const all = await readAll()
    const rec = all.providers[id] ?? blank(id)
    rec.apiKey = null
    rec.configured = false
    rec.enabled = false
    rec.status = { lastTest: now, lastOk: false, lastError: 'Kunci dihapus.' }
    all.providers[id] = rec
    await persist()
  }

  async function setEnabled(id, enabled) {
    const all = await readAll()
    const rec = all.providers[id] ?? blank(id)
    rec.enabled = Boolean(enabled && rec.configured)
    all.providers[id] = rec
    await persist()
  }

  async function setBaseUrl(id, baseUrl) {
    const all = await readAll()
    const rec = all.providers[id] ?? blank(id)
    rec.baseUrl = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : null
    all.providers[id] = rec
    await persist()
  }

  async function recordTest(id, { ok, status, reason }, now = Date.now()) {
    const all = await readAll()
    const rec = all.providers[id] ?? blank(id)
    rec.status = { lastTest: now, lastOk: Boolean(ok), lastError: ok ? null : String(reason ?? 'unknown').slice(0, 200) }
    all.providers[id] = rec
    await persist()
  }

  async function credentialFor(id, registryDefault) {
    const rec = await getFull(id)
    const apiKey = rec?.apiKey ?? null
    const baseUrl = rec?.baseUrl || registryDefault
    return { apiKey, baseUrl }
  }

  return {
    snapshot, listEnabled, enabledAndConfiguredIds,
    setApiKey, removeApiKey, setEnabled, setBaseUrl,
    recordTest, credentialFor, getFull,
    file,
  }
}
