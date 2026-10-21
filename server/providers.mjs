// Registri provider AI + adapter. Semua pemanggilan LLM di Dudu melewati gateway
// (server/gateway.mjs) yang memakai module ini; modul lain tidak memanggil provider langsung.
//
// Kontrak adapter per provider:
//   testConnection(cred, fetchImpl)      → { ok, status?, latencyMs?, reason? }
//   listModels(cred, fetchImpl)          → { ok, models: Entry[], reason?, status? }
//   chat(cred, {model, messages, signal, maxTokens, usageInclude?}, fetchImpl) → { content, model, usage?, cost? } — lempar Error bila gagal
//
// Entry katalog model: { id, name, tier: 'free'|'paid'|'unknown'|'local', pricing|null,
//   contextWindow|null, capabilities: {vision, tools}, source: 'provider_catalog', fetchedFrom }
//
// Tidak ada data yang dikarang: bila provider tidak memberi info harga/kuota → tier 'unknown',
// pricing null. Ollama lokal → tier 'local' (tanpa biaya API, bukan kategori "gratis cloud").
import { ProviderConfigError, ProviderRequestError } from './errors.mjs'

export function asFetch(fetchImpl) { return typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch }

/**
 * Validasi URL dari konfigurasi provider (mitigasi miskonfigurasi/SSRF dasar):
 * - https untuk jaringan; http hanya untuk loopback (Ollama lokal).
 * - tanpa userinfo (user:pass@), tanpa fragment/query.
 * - full = origin + path prefix (baseUrl semacam https://api.groq.com/openai/v1 dipertahankan).
 */
export function validateBaseUrl(raw) {
  let u
  try { u = new URL(String(raw ?? '').trim()) } catch { return { ok: false, reason: 'URL tidak valid.' } }
  if (!u.hostname) return { ok: false, reason: 'URL tidak valid.' }
  if (u.protocol === 'https:') { /* lolos */ }
  else if (u.protocol === 'http:') {
    const host = u.hostname
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
    if (!loopback) return { ok: false, reason: 'http hanya untuk alamat lokal (mis. Ollama 127.0.0.1); gunakan https.' }
  } else return { ok: false, reason: `Skema ${u.protocol.replace(/:$/, '')} tidak didukung; pakai https (atau http lokal).` }
  if (u.username || u.password) return { ok: false, reason: 'URL dengan user:pass tidak didukung.' }
  if (u.hash || u.search) return { ok: false, reason: 'URL tidak boleh mengandung fragment (#) atau query (?).' }
  const full = u.toString().replace(/\/+$/, '')
  return { ok: true, origin: u.origin, full }
}

export function parseOpenAiUsage(data) {
  const u = data?.usage
  if (!u || typeof u !== 'object') return null
  const has = Number.isFinite(u.prompt_tokens) || Number.isFinite(u.completion_tokens)
  if (!has) return null
  const details = (u.prompt_tokens_details && typeof u.prompt_tokens_details === 'object') ? u.prompt_tokens_details : null
  return {
    usage: {
      input: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null,
      output: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null,
      total: Number.isFinite(u.total_tokens) ? u.total_tokens : null,
      cached: Number.isFinite(details?.cached_tokens) ? details.cached_tokens : null,
    },
    cost: Number.isFinite(u.cost) ? u.cost : null, // mis. OpenRouter melaporkan biaya USD aktual
  }
}

/* ------------------------------------------------------------------ */
/* Keluarga adapter "OpenAI-compatible"                                */
/* ------------------------------------------------------------------ */

function openaiCompatMethodFactory({ auth = true, extraHeaders } = {}) {
  const authHeaders = (cred) => ({
    ...(auth && cred.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {}),
    ...(typeof extraHeaders === 'function' ? extraHeaders() : (extraHeaders ?? {})),
  })

  const testConnection = async (cred, fetchImpl = globalThis.fetch) => {
    const v = validateBaseUrl(cred.baseUrl)
    if (!v.ok) return { ok: false, reason: v.reason }
    const started = Date.now()
    try {
      const res = await asFetch(fetchImpl)(`${v.full}/models`, { method: 'GET', headers: authHeaders(cred), signal: AbortSignal.timeout(15_000) })
      return {
        ok: res.ok, status: res.status, latencyMs: Date.now() - started,
        reason: res.ok ? null
          : `${v.full}/models → HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (kunci API ditolak)' : ''}${res.status === 429 ? ' (rate limit)' : ''}`,
      }
    } catch (e) {
      return { ok: false, status: 0, latencyMs: Date.now() - started, reason: timedOutOrNet(e) }
    }
  }

  const listModels = async (cred, fetchImpl = globalThis.fetch) => {
    const v = validateBaseUrl(cred.baseUrl)
    if (!v.ok) return { ok: false, models: [], reason: v.reason }
    if (auth && !cred.apiKey) return { ok: false, models: [], reason: 'Kunci API belum diatur; katalog tidak dapat dimuat.' }
    try {
      const res = await asFetch(fetchImpl)(`${v.full}/models`, { method: 'GET', headers: authHeaders(cred), signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return { ok: false, models: [], reason: `${v.full}/models → HTTP ${res.status}`, status: res.status }
      const raw = await res.json().catch(() => null)
      return { ok: true, models: normalizeOpenAiList(raw) }
    } catch (e) {
      return { ok: false, models: [], reason: timedOutOrNet(e) }
    }
  }

  const chat = async (cred, { model, messages, signal, maxTokens, usageInclude }, fetchImpl = globalThis.fetch) => {
    const v = validateBaseUrl(cred.baseUrl)
    if (!v.ok) throw new ProviderConfigError(v.reason)
    if (auth && !cred.apiKey) throw new ProviderConfigError('Kunci API provider ini belum diatur.')
    const body = { model, messages }
    if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = Math.floor(maxTokens)
    if (usageInclude) body.usage = { include: true } // OpenRouter: minta usage + cost aktual dilaporkan
    let res
    try {
      res = await asFetch(fetchImpl)(`${v.full}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(cred) },
        body: JSON.stringify(body), signal,
      })
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      throw new ProviderRequestError(`Koneksi ke provider gagal: ${trim(String(e?.message || e))}`, e?.name === 'TimeoutError' ? 504 : 502)
    }
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch {
      throw new ProviderRequestError(`Provider merespons bukan JSON (HTTP ${res.status}).`, res.ok ? 502 : res.status)
    }
    if (!res.ok) {
      const msg = data?.error?.message ?? data?.message ?? (typeof data?.error === 'string' ? data.error : null) ?? `HTTP ${res.status}`
      throw new ProviderRequestError(typeof msg === 'string' ? trim(msg) : `HTTP ${res.status}`, res.status)
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new ProviderRequestError('Respons provider tidak berisi teks konten.', 502)
    const parsedUsage = parseOpenAiUsage(data)
    return {
      content,
      model: typeof data.model === 'string' ? data.model : model,
      ...(parsedUsage ?? {}),
    }
  }

  return { testConnection, listModels, chat }
}

const trim = (s) => String(s).slice(0, 180)
const timedOutOrNet = (e) => (e?.name === 'TimeoutError' ? 'Waktu tunggu koneksi habis.' : `${e?.name || 'Error'}: ${trim(String(e?.message || e))}`)

/** Adapter untuk provider "env" legacy (konfigurasi DUDU_* di dudu.env / .env). */
const ENV_COMPAT = openaiCompatMethodFactory({ auth: true })
export const envAdapter = { chat: (cred, args, fetchImpl) => ENV_COMPAT.chat(cred, args, fetchImpl) }

/** Daftar model generik OpenAI tanpa metadata harga → tier unknown (JANGAN menebak gratis). */
export function normalizeOpenAiList(raw) {
  const out = []
  for (const m of Array.isArray(raw?.data) ? raw.data : []) {
    if (typeof m?.id !== 'string') continue
    out.push({
      id: m.id, name: (typeof m.name === 'string' && m.name) ? m.name : m.id,
      tier: 'unknown', pricing: null, contextWindow: null,
      capabilities: { vision: null, tools: null },
      source: 'provider_catalog', fetchedFrom: 'models_list',
    })
  }
  return out
}

/* OpenRouter: /api/v1/models memberi pricing + modalitas resmi. */
export function normalizeOpenRouterModel(m) {
  if (typeof m?.id !== 'string') return null
  const p = m.pricing ?? {}
  const num = (k) => Number(p[k])
  const known = Number.isFinite(num('prompt')) && Number.isFinite(num('completion'))
  const isFree = known && num('prompt') === 0 && num('completion') === 0
  return {
    id: m.id,
    name: (typeof m.name === 'string' && m.name) ? m.name : m.id,
    tier: known ? (isFree ? 'free' : 'paid') : 'unknown',
    pricing: known ? {
      inputPer1M: num('prompt') * 1e6,
      outputPer1M: num('completion') * 1e6,
      cachedInputPer1M: Number.isFinite(num('input_cache_read')) ? num('input_cache_read') * 1e6 : null,
      currency: 'USD',
    } : null,
    contextWindow: Number.isFinite(m.context_length) ? m.context_length : null,
    capabilities: {
      vision: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : null,
      tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
    },
    source: 'provider_catalog', fetchedFrom: 'openrouter:/api/v1/models',
  }
}
export function normalizeOpenRouterList(raw) {
  const items = Array.isArray(raw?.data) ? raw.data : []
  return items.map(normalizeOpenRouterModel).filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Gemini (generativelanguage.googleapis.com)                          */
/* ------------------------------------------------------------------ */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const geminiTest = async (cred, fetchImpl = globalThis.fetch) => {
  if (!cred.apiKey) return { ok: false, status: 0, latencyMs: 0, reason: 'Kunci API Gemini belum diatur.' }
  const started = Date.now()
  try {
    const res = await asFetch(fetchImpl)(`${GEMINI_BASE}/models`, { method: 'GET', headers: { 'x-goog-api-key': cred.apiKey }, signal: AbortSignal.timeout(15_000) })
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - started, reason: res.ok ? null : `HTTP ${res.status}${res.status === 400 || res.status === 401 || res.status === 403 ? ' (kunci API ditolak)' : ''}` }
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, reason: timedOutOrNet(e) }
  }
}

const geminiListModels = async (cred, fetchImpl = globalThis.fetch) => {
  if (!cred.apiKey) return { ok: false, models: [], reason: 'Kunci API Gemini belum diatur.' }
  try {
    const res = await asFetch(fetchImpl)(`${GEMINI_BASE}/models`, { method: 'GET', headers: { 'x-goog-api-key': cred.apiKey }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { ok: false, models: [], reason: `HTTP ${res.status}`, status: res.status }
    const raw = await res.json().catch(() => null)
    if (raw?.error) return { ok: false, models: [], reason: trim(String(raw.error.message || 'Gemini error')) }
    return { ok: true, models: normalizeGeminiList(raw) }
  } catch (e) {
    return { ok: false, models: [], reason: timedOutOrNet(e) }
  }
}

export function normalizeGeminiList(raw) {
  const out = []
  for (const m of Array.isArray(raw?.models) ? raw.models : []) {
    if (typeof m?.name !== 'string') continue
    const id = m.name.replace(/^models\//, '')
    if (Array.isArray(m.supportedGenerationMethods) && !m.supportedGenerationMethods.includes('generateContent')) continue // embedding dll. bukan model chat
    out.push({
      id, name: (typeof m.displayName === 'string' && m.displayName) ? m.displayName : id,
      tier: 'unknown', pricing: null,
      contextWindow: Number.isFinite(m.inputTokenLimit) ? m.inputTokenLimit : null,
      capabilities: { vision: null, tools: null },
      source: 'provider_catalog', fetchedFrom: 'gemini:/v1beta/models',
    })
  }
  return out
}

const geminiChat = async (cred, { model, messages, signal, maxTokens }, fetchImpl = globalThis.fetch) => {
  if (!cred.apiKey) throw new ProviderConfigError('Kunci API Gemini belum diatur.')
  const sys = messages.filter((m) => m.role === 'system').map((m) => String(m.content ?? ''))
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content ?? '') }],
  }))
  if (!contents.length) throw new ProviderConfigError('Tidak ada pesan user/assistant untuk dikirim ke Gemini.')
  const body = { contents, ...(sys.length ? { systemInstruction: { parts: [{ text: sys.join('\n\n') }] } } : {}) }
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.generationConfig = { maxOutputTokens: Math.floor(maxTokens) }
  let res
  try {
    res = await asFetch(fetchImpl)(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cred.apiKey },
      body: JSON.stringify(body), signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new ProviderRequestError(`Koneksi ke Gemini gagal: ${trim(String(e?.message || e))}`, e?.name === 'TimeoutError' ? 504 : 502)
  }
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { throw new ProviderRequestError(`Gemini merespons bukan JSON (HTTP ${res.status}).`, 502) }
  if (!res.ok) throw new ProviderRequestError(trim(String(data?.error?.message ?? `Gemini HTTP ${res.status}`)), res.status)
  const parts = data?.candidates?.[0]?.content?.parts
  const content = Array.isArray(parts) ? parts.filter((p) => typeof p?.text === 'string').map((p) => p.text).join('') : null
  if (typeof content !== 'string' || !content) throw new ProviderRequestError('Respons Gemini tidak berisi teks konten.', 502)
  const um = data?.usageMetadata
  const usage = (um && (Number.isFinite(um.promptTokenCount) || Number.isFinite(um.candidatesTokenCount)))
    ? { input: Number.isFinite(um.promptTokenCount) ? um.promptTokenCount : null, output: Number.isFinite(um.candidatesTokenCount) ? um.candidatesTokenCount : null, total: Number.isFinite(um.totalTokenCount) ? um.totalTokenCount : null, cached: null }
    : null
  return { content, model, providerModelId: typeof data?.modelVersion === 'string' ? data.modelVersion : null, ...(usage ? { usage, cost: null } : {}) }
}

/* ------------------------------------------------------------------ */
/* Ollama (lokal): deteksi via /api/tags; chat via OpenAI-compatible    */
/* ------------------------------------------------------------------ */

const ollamaTest = async (cred, fetchImpl = globalThis.fetch) => {
  const v = validateBaseUrl(cred.baseUrl)
  if (!v.ok) return { ok: false, status: 0, latencyMs: 0, reason: v.reason }
  const started = Date.now()
  try {
    const res = await asFetch(fetchImpl)(`${v.full}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(6_000) })
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - started, reason: res.ok ? null : `HTTP ${res.status} dari /api/tags — apakah Ollama berjalan di ${v.origin}?` }
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, reason: `Ollama tidak terjangkau di ${v.origin} (${trim(String(e?.message || e).slice(0, 80))})` }
  }
}

const ollamaListModels = async (cred, fetchImpl = globalThis.fetch) => {
  const v = validateBaseUrl(cred.baseUrl)
  if (!v.ok) return { ok: false, models: [], reason: v.reason }
  try {
    const res = await asFetch(fetchImpl)(`${v.full}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return { ok: false, models: [], reason: `HTTP ${res.status}`, status: res.status }
    const raw = await res.json().catch(() => null)
    const models = (Array.isArray(raw?.models) ? raw.models : [])
      .filter((m) => typeof m?.name === 'string')
      .map((m) => ({
        id: m.name, name: m.name, tier: 'local', pricing: null,
        contextWindow: null, capabilities: { vision: null, tools: null },
        source: 'provider_catalog', fetchedFrom: 'ollama:/api/tags',
      }))
    return { ok: true, models }
  } catch (e) {
    return { ok: false, models: [], reason: timedOutOrNet(e) }
  }
}

/* ------------------------------------------------------------------ */
/* Definisi provider — TIDAK ADA endpoint yang dikarang.               */
/* ------------------------------------------------------------------ */

const compat = ({ auth = true, extraHeaders } = {}) => openaiCompatMethodFactory({ auth, extraHeaders })
const openRouterHeaders = { 'HTTP-Referer': 'https://dudu.local/', 'X-Title': 'Dudu AI' }
const openRouterCompat = compat({ auth: true, extraHeaders: openRouterHeaders })
/** OpenRouter /api/v1/models memuat metadata harga & modalitas resmi → tier free/paid dari pricing asli, bukan tebakan. */
const openRouterListModels = async (cred, fetchImpl = globalThis.fetch) => {
  const v = validateBaseUrl(cred.baseUrl)
  if (!v.ok) return { ok: false, models: [], reason: v.reason }
  if (!cred.apiKey) return { ok: false, models: [], reason: 'Kunci API belum diatur; katalog tidak dapat dimuat.' }
  try {
    const res = await asFetch(fetchImpl)(`${v.full}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cred.apiKey}`, ...openRouterHeaders },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, models: [], reason: `${v.full}/models → HTTP ${res.status}`, status: res.status }
    const raw = await res.json().catch(() => null)
    return { ok: true, models: normalizeOpenRouterList(raw) }
  } catch (e) {
    return { ok: false, models: [], reason: timedOutOrNet(e) }
  }
}
openRouterCompat.listModels = openRouterListModels
const ollamaCompat = compat({ auth: false })

export const PROVIDER_REGISTRY = {
  openrouter: {
    label: 'OpenRouter', kind: 'openai_compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    description: 'Katalog model dinamis; tier gratis/berbayar diambil dari metadata resmi (pricing 0 = gratis, bukan asumsi).',
    docs: 'https://openrouter.ai/docs',
    adapter: openRouterCompat,
  },
  groq: {
    label: 'Groq', kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    description: 'Daftar model dari endpoint resmi. Katalog Groq tidak memuat harga per token → tier UNKNOWN; cek akun Anda.',
    docs: 'https://console.groq.com/docs',
    adapter: compat(),
  },
  nvidia: {
    label: 'NVIDIA NIM', kind: 'openai_compatible',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    requiresApiKey: true,
    description: 'Endpoint kompatibel OpenAI. Tidak semua model gratis — tidak diasumsikan gratis; harga UNKNOWN dari katalog.',
    docs: 'https://docs.api.nvidia.com/nim',
    adapter: compat(),
  },
  gemini: {
    label: 'Google Gemini', kind: 'gemini',
    defaultBaseUrl: GEMINI_BASE,
    requiresApiKey: true,
    description: 'Endpoint resmi generateContent. Harga/tier sesuai model dan akun Google Anda; katalog memberi batas input token, bukan harga.',
    docs: 'https://ai.google.dev/gemini-api/docs',
    adapter: { testConnection: geminiTest, listModels: geminiListModels, chat: geminiChat },
  },
  ollama: {
    label: 'Ollama (lokal)', kind: 'openai_compatible',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    requiresApiKey: false,
    description: 'Model lokal di perangkat ini (deteksi via /api/tags). Inferensi lokal tanpa biaya API; data tidak keluar dari perangkat.',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    adapter: { testConnection: ollamaTest, listModels: ollamaListModels, chat: ollamaCompat.chat },
  },
  custom: {
    label: 'Endpoint custom (OpenAI-compatible)', kind: 'openai_compatible',
    defaultBaseUrl: '',
    requiresApiKey: false,
    needsCustomBaseUrl: true,
    description: 'Endpoint milik Anda yang kompatibel OpenAI Chat Completions (self-hosted, gateway internal, atau 9Router BILA protokolnya memang sama). Wajib https (atau http lokal). Harga/kuota tidak diketahui secara default.',
    docs: null,
    adapter: compat({
      auth: true, // kunci opsional: hanya dikirim bila diatur
    }),
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDER_REGISTRY)
export const getProviderDef = (id) => PROVIDER_REGISTRY[id] ?? null
export const GEMINI_DEFAULT_BASE = GEMINI_BASE
