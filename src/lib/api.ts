// Klien API tipis untuk backend lokal (file, Knowledge Base, misi, kapabilitas).
import { unreachableMessage } from './provider'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export interface Readiness { ready: boolean; reason?: string }
export interface FileMeta {
  id: string; name: string; ext: string; mime: string; category: 'document' | 'image' | 'audio' | 'video' | 'data' | 'archive' | 'code' | 'other'
  kind: string; size: number; sha256: string; createdAt: number
  extraction: { state: 'extracted' | 'unsupported' | 'failed' | 'not_applicable'; method?: string; pages?: number; chars: number; truncated: boolean; note?: string; warnings?: string[] }
  image?: { width: number; height: number }
  readiness: Readiness
}
export interface Capabilities {
  chat: { configured: boolean; model: string }
  vision: { configured: boolean; model: string | null; reason: string | null }
  stt: { configured: boolean; model: string | null; reason: string | null }
  ocr: { available: boolean; reason: string }
  video: { supported: boolean; reason: string }
  embeddings: { configured: boolean; retrieval: string; reason: string }
  limits: { maxUploadBytes: number; maxAttachments: number }
}
export interface KbDoc { fileId: string; name: string; indexedAt: number; chunks: number; missing: boolean }
export interface KbStats { docs: KbDoc[]; chunks: number; retrieval: string; embeddings: boolean }
export interface KbHit { fileId: string; name: string; loc: string | null; score: number; text: string }

/* ---------- Gateway AI (multi-provider) ---------- */
export type ProviderTier = 'free' | 'paid' | 'unknown' | 'local'
export interface GatewayProvider {
  id: string
  label: string
  kind: string
  enabled: boolean
  configured: boolean
  hasKey: boolean
  keySuffix: string | null
  keyUpdatedAt: number | null
  baseUrl: string | null
  lastTest: number | null
  lastOk: boolean | null
  lastError: string | null
  requiresApiKey: boolean
  needsCustomBaseUrl: boolean
  defaultBaseUrl: string
  description: string
  docs: string | null
  inRouting: boolean
}
export interface CatalogModel {
  providerId?: string
  id: string
  name: string
  tier: ProviderTier
  pricing: { inputPer1M: number; outputPer1M: number; cachedInputPer1M?: number | null; currency: string } | null
  contextWindow: number | null
  capabilities: { vision: boolean | null; tools: boolean | null }
  source: string
}
export interface SkillInfo {
  id: string
  name: string
  category: string
  description: string
  instruction?: string
  enabled?: boolean
  kind: 'builtin' | 'custom'
  available: boolean
  where: string
  createdAt?: number
  updatedAt?: number
}
export type RoutingMode = 'FREE_ONLY' | 'FREE_FIRST' | 'BEST_VALUE' | 'BEST_QUALITY' | 'MANUAL' | 'ROTATE'
export type CapabilitySource = 'dudu' | 'workbuddy' | 'hermes' | 'openclaw'
export type CapabilityAvailability = 'available' | 'needs_configuration' | 'disabled' | 'unavailable' | 'unverified'
export interface CapabilityStatus {
  implementation: 'implemented' | 'scaffold' | 'not_implemented' | 'reference_only'
  configuration: 'configured' | 'unconfigured' | 'not_required'
  connection: 'connected' | 'disconnected' | 'not_tested' | 'not_applicable'
  execution: 'succeeded' | 'failed' | 'not_run'
  availability: CapabilityAvailability
  compatibility: 'native' | 'adapter_required' | 'unverified' | 'incompatible'
}
export interface CapabilityValidationCheck { id: string; ok: boolean; detail: string }
export interface CapabilityValidation {
  at: number
  verdict: 'passed' | 'failed' | 'not_applicable'
  checks: CapabilityValidationCheck[]
  error: string | null
}
export interface CapabilityExecution {
  at: number
  ok: boolean
  durationMs: number
  action: string
  error: string | null
  args: unknown
  resultPreview: string | null
}
export interface CapabilityDocs { label: string; url: string }
export interface CapabilityEntry {
  id: string
  name: string
  description: string
  category: string
  categoryLabel: string
  kind: string
  sourceProject: CapabilitySource
  sourceLabel: string
  sourceType: 'native' | 'user' | 'local' | 'external-reference'
  version: string | null
  license: string | null
  sourceCode: string | null
  compatibility: CapabilityStatus['compatibility']
  priority: string | null
  duduEquivalent: string | null
  facts: string[]
  docs: CapabilityDocs[]
  tags: string[]
  runtime: string | null
  entryPoint: string | null
  runnable: boolean
  sideEffects: 'none' | 'network' | 'local_process' | 'local_code'
  permissions: string[]
  risk: 'low' | 'medium' | 'high'
  status: CapabilityStatus
  statusLabel: string
  lastValidatedAt: number | null
  lastValidation: CapabilityValidation | null
  lastExecutionAt: number | null
  lastExecution: CapabilityExecution | null
  lastError: string | null
  meta: Record<string, unknown>
}
export interface CapabilityRegistry {
  generatedAt: string
  sourceVerifiedAt: string
  total: number
  shown: number
  items: CapabilityEntry[]
  summary: {
    byCategory: Record<string, number>
    bySource: Record<string, number>
    byAvailability: Record<string, number>
    byImplementation: Record<string, number>
    runnable: number
    externalReferences: number
  }
  filters: {
    categories: string[]
    sources: Array<{ id: CapabilitySource; label: string }>
    statuses: string[]
  }
  policy: { confirmation: string; executableKinds: string[]; referenceOnly: string; audit: string }
}
export interface CapabilityRunResult {
  capability: CapabilityEntry
  ok: boolean
  result: unknown
  error: string | null
  durationMs: number
  at: number
}
export interface RoutingSettings {
  version: number
  defaultMode: RoutingMode
  maxFallbacks: number
  privacyLocalPreferred: boolean
  budget: { paidUsdMonthly: number }
  manualSelection: { providerId: string; modelId: string } | null
}
export interface UsageSummary {
  generatedAt: number
  periodStart: number
  recordCount: number
  totals: {
    requests: number; success: number; failed: number
    tokens: { input: number; output: number; total: number; estimatedOnly: boolean; inputActual: number; inputEstimated: number; outputActual: number; outputEstimated: number }
    cost: number; costApprox: boolean; costUnknown: number
  }
  byProvider: Record<string, UsageSummaryRow>
  byModel: Record<string, UsageSummaryRow>
  budget: { cap: number; spent: number; pct: number | null; state: 'unset' | 'ok' | 'warn' | 'critical' | 'exceeded' }
  alerts: Array<{ kind: string; message: string }>
}
export interface UsageSummaryRow {
  requests: number; success: number; failed: number
  tokens: { input: number; output: number; total: number; estimatedOnly: boolean; inputActual: number; inputEstimated: number; outputActual: number; outputEstimated: number }
  cost: number; costApprox: boolean; costUnknown: number
}

export type MissionState = 'draft' | 'queued' | 'running' | 'needs_attention' | 'completed' | 'failed' | 'cancelled'
export interface MissionStep { id: string; tool: string; title: string; status: 'pending' | 'running' | 'done' | 'failed'; attempts: Array<{ execId: string; startedAt: number; finishedAt?: number; ok?: boolean; error?: string; class?: string; attempt: number }>; output?: unknown }
export interface Mission {
  id: string; title: string; goal: string; template: string; planner: string; fileId: string; fileName: string; state: MissionState; createdAt: number; updatedAt: number
  policy: { requiresApproval: boolean; writeScope: string; network: boolean; destructive: boolean; maxAutoRetries: number }
  approval: { status: 'pending' | 'approved'; at?: number }
  acceptance: Array<{ id: string; text: string; status: 'pending' | 'passed' | 'failed'; evidence?: string; checkedAt?: number }>
  steps: MissionStep[]
  artifacts: Array<{ name: string; size: number; sha256: string; mime: string }>
  evidence?: Array<{ name: string; size: number; sha256: string; mime: string; capabilityId: string; at: number; ok: boolean }>
  failure: { class: string; message: string; retryable: boolean } | null
  log: Array<{ at: number; level: string; msg: string }>
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'http_error', message = `Permintaan gagal (${res.status}).`
  try { const b = (await res.json()) as { error?: string; message?: string; details?: string }; code = b.error ?? code; message = b.message ?? b.details ?? message } catch { /* bukan JSON */ }
  return new ApiError(res.status, code, message)
}

export async function apiJson<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method, signal,
      headers: { ...(method !== 'GET' ? { 'X-Dudu-Client': '1' } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'unreachable', unreachableMessage())
  }
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

/* ---------- sesi akun lokal di frontend (token server-side; layar hanya menyimpan token itu) ---------- */
const TOKEN_KEY = 'dudu.authToken'
export type SessionUser = { id: string; email: string; name: string; provider: string }
export type Session = { user: SessionUser; token: string; expiresAt: number | null }
type Listener = (u: SessionUser | null) => void
const listeners = new Set<Listener>()
let currentUser: SessionUser | null = null
function readToken(): string | null { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const authState = {
  get token() { return readToken() },
  set(s: Session | null): SessionUser | null {
    try { if (s) localStorage.setItem(TOKEN_KEY, s.token); else localStorage.removeItem(TOKEN_KEY) } catch { /* storage tidak tersedia */ }
    currentUser = s?.user ?? null
    listeners.forEach((fn) => fn(currentUser))
    return currentUser
  },
  /** Fungsi berhenti dikembalikan; callback dipanggil segera dengan nilai kini. */
  subscribe(fn: Listener) { listeners.add(fn); fn(currentUser); return () => { listeners.delete(fn) } },
  get user() { return currentUser },
}
export function authSession(r: unknown): Session {
  if (!isObj(r) || !isObj(r.user) || !isObj(r.session) || typeof r.session.token !== 'string') throw bad('sesi akun')
  const s = { user: r.user as unknown as SessionUser, token: r.session.token, expiresAt: (r.session.expiresAt as number | null) ?? null }
  authState.set(s)
  return s
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const bad = (what: string) => new ApiError(502, 'bad_response', `Respons ${what} dari server tidak valid.`)

export const api = {
  capabilities: async () => {
    const c = await apiJson<unknown>('GET', '/api/capabilities')
    if (!isObj(c) || !isObj(c.limits) || typeof c.limits.maxAttachments !== 'number' || typeof c.limits.maxUploadBytes !== 'number'
      || !isObj(c.vision) || !isObj(c.stt) || !isObj(c.chat)) throw bad('kapabilitas')
    return c as unknown as Capabilities
  },
  listFiles: async () => {
    const r = await apiJson<unknown>('GET', '/api/files')
    if (!isObj(r) || !Array.isArray(r.files)) throw bad('daftar file')
    return r.files as FileMeta[]
  },
  deleteFile: (id: string) => apiJson<{ deleted: boolean }>('DELETE', `/api/files/${id}`),
  fileText: (id: string) => apiJson<{ text: string | null; totalChars: number; truncated: boolean }>('GET', `/api/files/${id}/text`),
  fileUrl: (id: string, inline = false) => `/api/files/${id}/content${inline ? '?inline=1' : ''}`,
  kb: async () => {
    const k = await apiJson<unknown>('GET', '/api/kb')
    if (!isObj(k) || !Array.isArray(k.docs)) throw bad('Knowledge Base')
    return k as unknown as KbStats
  },
  kbIndex: (fileId: string) => apiJson<{ fileId: string; name: string; chunks: number }>('POST', '/api/kb/docs', { fileId }),
  kbRemove: (fileId: string) => apiJson<{ deleted: boolean }>('DELETE', `/api/kb/docs/${fileId}`),
  kbSearch: async (query: string) => (await apiJson<{ results: KbHit[] }>('POST', '/api/kb/search', { query, limit: 5 })).results,
  missions: async () => {
    const r = await apiJson<unknown>('GET', '/api/missions')
    if (!isObj(r) || !Array.isArray(r.missions)) throw bad('daftar misi')
    return r.missions as Mission[]
  },
  createMission: async (goal: string, fileId: string) => (await apiJson<{ mission: Mission }>('POST', '/api/missions', { goal, fileId })).mission,
  getMission: async (id: string, signal?: AbortSignal) => (await apiJson<{ mission: Mission }>('GET', `/api/missions/${id}`, undefined, signal)).mission,
  approveMission: async (id: string) => (await apiJson<{ mission: Mission }>('POST', `/api/missions/${id}/approve`)).mission,
  retryMission: async (id: string) => (await apiJson<{ mission: Mission }>('POST', `/api/missions/${id}/retry`)).mission,
  cancelMission: async (id: string) => (await apiJson<{ mission: Mission }>('POST', `/api/missions/${id}/cancel`)).mission,
  deleteMission: (id: string) => apiJson<{ deleted: boolean }>('DELETE', `/api/missions/${id}`),
  artifactUrl: (id: string, name: string) => `/api/missions/${id}/artifacts/${encodeURIComponent(name)}`,
  evidenceUrl: (id: string, name: string) => `/api/missions/${id}/evidence/${encodeURIComponent(name)}`,
  missionRunCapability: async (missionId: string, capabilityId: string, args: Record<string, unknown> = {}, confirm = false) => {
    const r = await apiJson<{ run: CapabilityRunResult; evidence: { name: string }; mission: Mission }>('POST', `/api/missions/${missionId}/capabilities/${encodeURIComponent(capabilityId)}/run`, { args, confirm })
    return r
  },
  /* ---------- gateway ---------- */
  gatewayProviders: async () => {
    const r = await apiJson<unknown>('GET', '/api/gateway/providers')
    if (!isObj(r) || !Array.isArray(r.providers)) throw bad('daftar provider')
    return { providers: r.providers as unknown as GatewayProvider[], env: r.env as { configured: boolean; model: string | null; baseUrl: string | null } }
  },
  gatewaySetKey: async (id: string, apiKey: string, baseUrl?: string) => {
    void apiKey // kunci hanya lewat badan POST; responsnya tidak pernah memuatnya
    return (await apiJson<{ provider: GatewayProvider }>('POST', `/api/gateway/providers/${id}/key`, { apiKey, ...(baseUrl !== undefined ? { baseUrl } : {}) })).provider
  },
  gatewayRemoveKey: async (id: string) => (await apiJson<{ provider: GatewayProvider }>('DELETE', `/api/gateway/providers/${id}/key`)).provider,
  gatewayUpdateProvider: async (id: string, patch: { enabled?: boolean; baseUrl?: string | null }) => {
    return (await apiJson<{ provider: GatewayProvider }>('PUT', `/api/gateway/providers/${id}`, patch)).provider
  },
  gatewayTestProvider: async (id: string) => {
    // Endpoint /test sengaja merespons non-200 bila gagal; badan tetap dimuat karena informasinya jujur & berguna.
    let res: Response
    try {
      res = await fetch(`/api/gateway/providers/${id}/test`, { method: 'POST', headers: { 'X-Dudu-Client': '1' } })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new ApiError(0, 'unreachable', unreachableMessage())
    }
    const body = await res.json().catch(() => ({})) as { ok?: unknown; status?: unknown; latencyMs?: unknown; reason?: unknown; testedAt?: unknown }
    return {
      ok: Boolean(body.ok),
      status: typeof body.status === 'number' ? body.status : undefined,
      latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
      reason: typeof body.reason === 'string' ? body.reason : null,
      testedAt: typeof body.testedAt === 'number' ? body.testedAt : undefined,
    }
  },
  gatewayProviderModels: async (id: string, refresh = false) => {
    const r = await apiJson<unknown>('GET', `/api/gateway/providers/${id}/models${refresh ? '?refresh=1' : ''}`)
    if (!isObj(r) || !Array.isArray(r.models)) throw bad('katalog provider')
    return { fresh: Boolean(r.fresh), stale: Boolean(r.stale), count: Number(r.count ?? 0), models: r.models as unknown as CatalogModel[] }
  },
  gatewayModels: async () => {
    const r = await apiJson<unknown>('GET', '/api/gateway/models')
    if (!isObj(r) || !Array.isArray(r.models)) throw bad('katalog model')
    return r.models as unknown as CatalogModel[]
  },
  gatewaySettings: async () => {
    const r = await apiJson<unknown>('GET', '/api/gateway/settings')
    if (!isObj(r) || !isObj(r.settings)) throw bad('kebijakan routing')
    return { settings: r.settings as unknown as RoutingSettings, modes: Array.isArray(r.modes) ? r.modes as RoutingMode[] : [], manualAvailable: (r.manualAvailable ?? null) as boolean | null }
  },
  gatewaySaveSettings: async (patch: Partial<RoutingSettings>) => {
    return (await apiJson<{ settings: RoutingSettings }>('PUT', '/api/gateway/settings', patch)).settings
  },
  usage: async () => {
    const r = await apiJson<unknown>('GET', '/api/usage')
    if (!isObj(r) || !isObj(r.summary)) throw bad('ringkasan pemakaian')
    return { summary: r.summary as unknown as UsageSummary, settings: r.settings as unknown as RoutingSettings }
  },

  /* ---------- akun & sesi (v0.4.0) ---------- */
  authMe: async () => {
    const headers: Record<string, string> = {}
    const token = authState.token
    if (token) headers.authorization = `Bearer ${token}`
    const r = await apiJson<unknown>('GET', '/api/auth/me', undefined, undefined, headers)
    if (!isObj(r)) throw bad('status akun')
    return { user: (r.user ?? null) as SessionUser | null, expiresAt: (r.expiresAt ?? null) as number | null }
  },
  authRegister: async (email: string, password: string, name: string) => authSession(await apiJson<unknown>('POST', '/api/auth/register', { email, password, name })),
  authLogin: async (email: string, password: string) => authSession(await apiJson<unknown>('POST', '/api/auth/login', { email, password })),
  authLogout: async () => {
    await apiJson('POST', '/api/auth/logout', {})
    authState.set(null)
  },

  oauthStatus: async (provider: string) =>
    (await apiJson<{ provider: string; configured: boolean; clientId: string | null }>('GET', `/api/auth/oauth/${provider}/status`)),
  oauthSaveApp: async (provider: string, clientId: string, clientSecret: string) =>
    apiJson<{ provider: string; configured: boolean }>('PUT', `/api/auth/oauth/${provider}/app`, { clientId, clientSecret }),
  oauthAuthorizeUrl: async (provider: string, redirectUri: string) =>
    (await apiJson<{ url: string }>('POST', `/api/auth/oauth/${provider}/url`, { redirectUri })).url,
  oauthExchange: async (provider: string, code: string, redirectUri: string) => authSession(await apiJson<unknown>('POST', `/api/auth/oauth/${provider}/exchange`, { code, redirectUri })),

  /* ---------- MCP (v0.4.0) ---------- */
  mcpTools: async () => {
    const r = await apiJson<unknown>('GET', '/api/mcp/tools')
    if (!isObj(r) || !Array.isArray(r.tools)) throw bad('tool MCP')
    return r.tools as Array<{ name: string; description: string; inputSchema: unknown }>
  },
  mcpServers: async () => {
    const r = await apiJson<unknown>('GET', '/api/mcp/servers')
    if (!isObj(r) || !Array.isArray(r.servers)) throw bad('daftar server MCP')
    return r.servers as Array<{ id: string; label: string; command: string; args: string[]; lastProbe: null | { at: number; ok: boolean; tools: string[] | null; error: string | null; ms: number | null } }>
  },
  mcpAddServer: async (label: string, command: string, args: string[]) =>
    (await apiJson<{ server: { id: string; label: string } }>('POST', '/api/mcp/servers', { label, command, args })).server,
  mcpProbe: async (id: string) => apiJson<unknown>('POST', `/api/mcp/servers/${id}/probe`, {}),
  mcpRemoveServer: async (id: string) => apiJson<unknown>('POST', `/api/mcp/servers/${id}/remove`, {}),

  /* ---------- plugin & connector (v0.4.0) ---------- */
  plugins: async () => {
    const r = await apiJson<unknown>('GET', '/api/plugins')
    if (!isObj(r) || !Array.isArray(r.plugins)) throw bad('daftar plugin')
    return r.plugins as Array<{ id: string; name: string; displayName: string; version: string | null; description: string | null; entry?: string | null; enabled: boolean; error: string | null }>
  },
  pluginSetEnabled: async (id: string, enabled: boolean) => apiJson<unknown>('POST', '/api/plugins', { id, enabled }),
  pluginRun: async (id: string) => apiJson<unknown>('POST', `/api/plugins/${id}/run`, {}),
  connectors: async () => {
    const r = await apiJson<unknown>('GET', '/api/connectors')
    if (!isObj(r) || !Array.isArray(r.connectors)) throw bad('daftar connector')
    return r.connectors as Array<{ id: string; label: string; category?: string; access?: string; description: string; live: boolean; requiredFields: string[]; fields: Record<string, { set: boolean; value: string | null }>; configured: boolean; lastTest: null | { at: number; ok: boolean; status: number | null; error: string | null } }>
  },
  connectorSave: async (id: string, fields: Record<string, string>) => apiJson<unknown>('PUT', '/api/connectors', { id, fields }),
  connectorTest: async (id: string) => apiJson<unknown>('POST', '/api/connectors', { id }),

  /* ---------- skill (v0.4.1) ---------- */
  skills: async () => {
    const r = await apiJson<unknown>('GET', '/api/skills')
    if (!isObj(r) || !Array.isArray(r.builtin) || !Array.isArray(r.custom) || !Array.isArray(r.categories)) throw bad('daftar skill')
    return {
      builtin: r.builtin as unknown as SkillInfo[],
      custom: r.custom as unknown as SkillInfo[],
      categories: r.categories as string[],
      limits: (r.limits ?? { maxActive: 5, maxInstruction: 4000 }) as { maxActive: number; maxInstruction: number },
    }
  },
  skillCreate: async (input: { name: string; category: string; description: string; instruction: string }) =>
    (await apiJson<{ skill: SkillInfo }>('POST', '/api/skills', input)).skill,
  skillUpdate: async (id: string, patch: { enabled?: boolean; name?: string; category?: string; description?: string; instruction?: string }) =>
    (await apiJson<{ skill: SkillInfo }>('PUT', `/api/skills/${id}`, patch)).skill,
  skillRemove: async (id: string) => apiJson<unknown>('DELETE', `/api/skills/${id}`),

  /* ---------- Unified Capability Registry (v0.5.0) ---------- */
  capabilityRegistry: async (filters: { q?: string; category?: string; source?: string; availability?: string; implementation?: string } = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v)
    const r = await apiJson<unknown>('GET', `/api/capability-registry${qs.toString() ? `?${qs}` : ''}`)
    if (!isObj(r) || !Array.isArray(r.items)) throw bad('katalog kapabilitas')
    return r as unknown as CapabilityRegistry
  },
  capabilityGet: async (id: string) => (await apiJson<{ capability: CapabilityEntry }>('GET', `/api/capability-registry/${encodeURIComponent(id)}`)).capability,
  capabilityValidate: async (id: string) => apiJson<{ capability: CapabilityEntry; ok: boolean; verdict: string; checks: CapabilityValidationCheck[]; error: string | null; at: number }>('POST', `/api/capability-registry/${encodeURIComponent(id)}/validate`, {}),
  capabilityRun: async (id: string, args: Record<string, unknown> = {}, confirm = false) => apiJson<CapabilityRunResult>('POST', `/api/capability-registry/${encodeURIComponent(id)}/run`, { args, confirm }),
  capabilityAudit: async (limit = 50) => apiJson<{ events: Array<Record<string, unknown>>; count: number; file: string }>('GET', `/api/capability-registry/audit?limit=${limit}`),

  /* ---------- input data → Knowledge Base (v0.4.0) ---------- */
  kbAddText: async (title: string, text: string) =>
    apiJson<{ file: { id: string; name: string }; indexed: { chunks: number } }>('POST', '/api/kb/text', { title, text }),
}

/** Upload dengan progress nyata (XHR) dan pembatalan. Badan = byte mentah; nama dikirim lewat header. */
export function uploadFile(file: File, opts: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {}): Promise<FileMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files')
    xhr.setRequestHeader('X-Dudu-Client', '1')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100)) }
    xhr.onerror = () => reject(new ApiError(0, 'unreachable', unreachableMessage()))
    xhr.onabort = () => reject(Object.assign(new Error('Upload dibatalkan'), { name: 'AbortError' }))
    xhr.onload = () => {
      let body: { file?: FileMeta; error?: string; message?: string } = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* bukan JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.file) resolve(body.file)
      else reject(new ApiError(xhr.status, body.error ?? 'upload_failed', body.message ?? `Upload gagal (${xhr.status}).`))
    }
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    if (opts.signal?.aborted) { xhr.abort(); return }
    xhr.send(file)
  })
}
