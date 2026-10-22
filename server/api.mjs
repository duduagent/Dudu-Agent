// Router API terpadu (tanpa transport). Dipakai oleh server HTTP dev dan proses utama Electron.
import { createChatApi } from './chat-api.mjs'
import { capabilitiesOf } from './config.mjs'
import { FileError, createFileStore, isFileId, readiness } from './files.mjs'
import { createKnowledgeBase } from './knowledge.mjs'
import { MissionError, createMissionService, isMissionId } from './missions.mjs'
import { createCredentialStore } from './credentials.mjs'
import { createModelCatalog } from './models-catalog.mjs'
import { createUsageLedger } from './usage.mjs'
import { createGateway, SETTINGS_FILE } from './gateway.mjs'
import { PROVIDER_IDS, PROVIDER_REGISTRY, validateBaseUrl } from './providers.mjs'
import { ROUTING_MODES } from './routing.mjs'
import { createAuthStore, AuthError, OAUTH_PROVIDERS } from './auth.mjs'
import { createMcpGateway, McpError, createMcpClientStore } from './mcp.mjs'
import { createPluginStore, PluginError } from './plugins.mjs'
import { createConnectorStore, ConnectorError } from './connectors.mjs'
import { createSkillStore, SkillError } from './skills.mjs'
import { CapabilityError, createCapabilityRegistry } from './capability-registry.mjs'
import { DuduError } from './errors.mjs'
import { AuditError, createExecutionAudit } from './execution-audit.mjs'
import { PermissionError } from './permissions.mjs'

const json = (status, body) => ({ status, body })
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function download({ bytes, name, mime, inline }) {
  const safeInline = inline && INLINE_IMAGE.has(mime)
  const encoded = encodeURIComponent(name).replace(/['()]/g, escape)
  return {
    status: 200,
    raw: bytes,
    headers: {
      'Content-Type': safeInline ? mime : 'application/octet-stream',
      'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'", // konten unggahan tidak boleh menjalankan skrip
      'Cache-Control': 'no-store',
    },
  }
}

/**
 * @param {{ getConfig: () => ReturnType<import('./config.mjs').resolveConfig>, dataDir: string, fetchImpl?: typeof fetch }} opts
 */
export function createApi({ getConfig, dataDir, fetchImpl = globalThis.fetch, audit: auditInjected = null }) {
  const files = createFileStore({ dataDir, maxUploadBytes: getConfig().maxUploadBytes })
  const kb = createKnowledgeBase({ dataDir, files })
  // SATU instance audit untuk seluruh proses: misi + registry menulis ke berkas yang sama.
  // Dua instance terpisah akan memecah rantai hash dan membuat dedupe tidak konsisten.
  const audit = auditInjected ?? createExecutionAudit({ dataDir, now: () => Date.now() })
  const missions = createMissionService({ dataDir, files, audit })

  /* ---------- gateway (satu-satunya jalur LLMSec untuk seluruh modul) ---------- */
  const credentials = createCredentialStore(dataDir)
  const catalog = createModelCatalog(dataDir, { fetchImpl })
  const usage = createUsageLedger(dataDir)
  const gateway = createGateway({ dataDir, credentials, catalog, usage, getConfig, fetchImpl })
  const skills = createSkillStore({ dataDir })
  const chatApi = createChatApi(getConfig(), fetchImpl, { files, kb, gateway, skills })
  const withReadiness = (m, caps) => ({ ...m, readiness: readiness(m, caps) })

  /* ---------- akun, MCP, plugin, connector ---------- */
  const auth = createAuthStore({ dataDir, fetchImpl })
  const mcpClient = createMcpClientStore({ dataDir })
  const plugins = createPluginStore({ dataDir })
  const connectors = createConnectorStore({ dataDir, fetchImpl })
  // Tool MCP lokal = kemampuan nyata server (KB + file). Tidak ada tool palsu.
  const mcpTools = [
    { name: 'kb_search', description: 'Cari potongan dokumen di Knowledge Base Dudu (BM25 leksikal, dengan sumber).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] },
      run: async (a) => ({ results: await kb.search(String(a.query ?? '').slice(0, 500), { limit: Math.min(Math.max(Number(a.limit) || 5, 1), 10) }) }) },
    { name: 'kb_stats', description: 'Statistik Knowledge Base: jumlah dokumen, potongan, metode retrieval.', inputSchema: { type: 'object', properties: {} }, run: async () => kb.stats() },
    { name: 'file_list', description: 'Daftar file/artefak yang tersimpan di Dudu.', inputSchema: { type: 'object', properties: {} }, run: async () => ({ files: (await files.list()).map((f) => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.size ?? null })) }) },
  ]
  const mcpGateway = createMcpGateway({ tools: mcpTools })
  const registry = createCapabilityRegistry({
    dataDir,
    skills,
    plugins,
    connectors,
    mcpClient,
    mcpTools,
    now: () => Date.now(),
    audit,
  })
  /** token → pengguna (bila header/cookie sesi dikirim); tanpa sesi = null (mode lokal tetap berfungsi penuh). */
  async function currentUser(req) {
    const h = req.headers?.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : null
    if (!token) return null
    return (await auth.verifySession(token))?.user ?? null
  }

  async function route(req) {
    const config = getConfig()
    const caps = capabilitiesOf(config)
    const method = String(req.method || 'GET').toUpperCase()
    const path = String(req.path || '').split('?')[0]
    const query = new URLSearchParams(String(req.path || '').split('?')[1] ?? '')

    if (path === '/api/chat' || path === '/api/health') return chatApi.handle(req)

    // Anti-CSRF untuk semua request yang mengubah data: header kustom memaksa preflight CORS pada situs lain.
    if (method !== 'GET' && !req.headers?.['x-dudu-client']) return json(403, { error: 'forbidden', message: 'Header X-Dudu-Client wajib untuk request yang mengubah data.' })

    const readJson = () => { try { return JSON.parse(req.body || '{}') } catch { throw new FileError(400, 'bad_json', 'JSON tidak valid.') } }
    let m

    if (method === 'GET' && path === '/api/capabilities') return json(200, caps)

    /* ---------- Unified Capability Registry (agregasi store nyata, bukan registry kedua) ---------- */
    if (path === '/api/capability-registry' && method === 'GET') {
      return json(200, await registry.list({
        q: query.get('q') ?? '',
        category: query.get('category') ?? '',
        source: query.get('source') ?? '',
        availability: query.get('availability') ?? '',
        implementation: query.get('implementation') ?? '',
        kind: query.get('kind') ?? '',
      }))
    }
    if (path === '/api/capability-registry/audit' && method === 'GET') {
      return json(200, await registry.audit({
        limit: query.get('limit') ?? 50,
        offset: query.get('offset') ?? 0,
        missionId: query.get('missionId') ?? null,
        eventType: query.get('eventType') ?? null,
        outcome: query.get('outcome') ?? null,
        actor: query.get('actor') ?? null,
        correlationId: query.get('correlationId') ?? null,
        since: query.get('since') ?? null,
        until: query.get('until') ?? null,
      }))
    }
    // Integritas jejak audit: verifikasi rantai hash + daftar berkas (aktif + rotasi).
    if (path === '/api/audit/integrity' && method === 'GET') {
      const [integrity, files] = await Promise.all([registry.auditIntegrity(), registry.auditFiles()])
      return json(200, { integrity, files })
    }
    const capRoute = /^\/api\/capability-registry\/([^/]+)(?:\/(validate|run))?$/.exec(path)
    if (capRoute) {
      const capId = decodeURIComponent(capRoute[1])
      const action = capRoute[2] ?? null
      if (!action && method === 'GET') return json(200, { capability: await registry.get(capId) })
      if (action === 'validate' && method === 'POST') return json(200, await registry.validate(capId))
      if (action === 'run' && method === 'POST') {
        const b = readJson()
        const user = await currentUser(req)
        return json(200, await registry.run(capId, { args: b.args ?? {}, confirm: b.confirm === true, actor: user?.email ?? 'local' }))
      }
    }

    /* ---------- gateway: provider & kredensial ---------- */
    const gwProv = /^\/api\/gateway\/providers\/([a-zA-Z0-9_-]+)(\/.*)?$/.exec(path)
    if (path === '/api/gateway/providers') {
      const capsGw = await gateway.effectiveCatalogEntries()
      const snap = await credentials.snapshot()
      const list = PROVIDER_IDS.map((id) => ({
        ...snap[id],
        label: PROVIDER_REGISTRY[id].label,
        kind: PROVIDER_REGISTRY[id].kind,
        requiresApiKey: PROVIDER_REGISTRY[id].requiresApiKey,
        needsCustomBaseUrl: Boolean(PROVIDER_REGISTRY[id].needsCustomBaseUrl),
        defaultBaseUrl: PROVIDER_REGISTRY[id].defaultBaseUrl,
        description: PROVIDER_REGISTRY[id].description,
        docs: PROVIDER_REGISTRY[id].docs,
        inRouting: capsGw.entries.some((e) => e.providerId === id),
      }))
      return json(200, { providers: list, env: { configured: Boolean(config.apiKey), model: config.model, baseUrl: config.baseUrl } })
    }
    if (gwProv) {
      const [, id, tail = ''] = gwProv
      if (!PROVIDER_IDS.includes(id)) return json(404, { error: 'provider_not_found', message: 'Provider tidak dikenal.' })
      if ((tail === '' || tail === '/') && method === 'PUT') {
        const b = readJson()
        const def = PROVIDER_REGISTRY[id]
        if (b.baseUrl !== undefined) {
          const raw = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : null
          const v = raw ? validateBaseUrl(raw) : { ok: true }
          if (!v.ok) throw new DuduError(400, 'bad_base_url', v.reason)
          await credentials.setBaseUrl(id, raw)
        }
        if (b.enabled !== undefined) {
          if (typeof b.enabled !== 'boolean') throw new DuduError(400, 'bad_request', 'enabled harus boolean.')
          if (b.enabled) {
            if (def.requiresApiKey && !(await credentials.getFull(id))?.apiKey) throw new DuduError(400, 'missing_api_key', 'Kunci API wajib diatur sebelum provider diaktifkan.')
            if (def.needsCustomBaseUrl) {
              const stored = (await credentials.getFull(id))?.baseUrl
              const nowProvided = typeof b.baseUrl === 'string' && b.baseUrl.trim() ? b.baseUrl.trim() : null
              const effective = nowProvided ?? stored
              if (!effective) throw new DuduError(400, 'missing_base_url', 'Endpoint custom wajib memiliki baseUrl sebelum diaktifkan.')
            }
          }
          await credentials.setEnabled(id, b.enabled)
        }
        const snap2 = await credentials.snapshot()
        return json(200, { provider: snap2[id] })
      }
      if ((tail === '' || tail === '/') && method === 'DELETE') {
        await credentials.removeApiKey(id)
        if (PROVIDER_REGISTRY[id]?.needsCustomBaseUrl) await credentials.setBaseUrl(id, null)
        const snap3 = await credentials.snapshot()
        return json(200, { provider: snap3[id] })
      }
      if (tail === '/key' && method === 'POST') {
        const b = readJson()
        const def = PROVIDER_REGISTRY[id]
        const rawKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : ''
        if (def.needsCustomBaseUrl) {
          // Endpoint custom: baseUrl wajib, kunci opsional (tergantung endpoint milik pengguna).
          const effectiveBase = (typeof b.baseUrl === 'string' && b.baseUrl.trim()) ? b.baseUrl.trim() : (await credentials.getFull(id))?.baseUrl
          const v = effectiveBase ? validateBaseUrl(effectiveBase) : { ok: false, reason: 'baseUrl wajib untuk endpoint custom.' }
          if (!v.ok) throw new DuduError(400, 'bad_base_url', v.reason)
          await credentials.setBaseUrl(id, effectiveBase)
          if (rawKey) {
            try { await credentials.setApiKey(id, rawKey) } catch (e) { throw new DuduError(400, 'bad_api_key', String(e?.message || e)) }
          }
          await credentials.setEnabled(id, true)
        } else if (rawKey) {
          try {
            await credentials.setApiKey(id, rawKey)
            if (typeof b.baseUrl === 'string' && b.baseUrl.trim()) await credentials.setBaseUrl(id, b.baseUrl.trim())
          } catch (e) {
            throw new DuduError(400, 'bad_api_key', String(e?.message || e))
          }
        } else {
          throw new DuduError(400, 'bad_api_key', 'apiKey wajib berupa string minimal 8 karakter.')
        }
        const snap4 = await credentials.snapshot()
        // Kunci baru → coba muat katalog sekarang agar routing langsung punya kandidat (gagal = jujur, tombol "Muat katalog" tersedia).
        try { await catalog.refresh(id, await credentials.credentialFor(id, def.defaultBaseUrl)) } catch { /* jaringan provider gagal: tidak menggagalkan simpan kunci */ }
        return json(200, { provider: snap4[id] }) // snapshot tidak pernah mengandung kunci
      }
      if (tail === '/key' && method === 'DELETE') {
        await credentials.removeApiKey(id)
        const snap5 = await credentials.snapshot()
        return json(200, { provider: snap5[id] })
      }
      if (tail === '/test' && method === 'POST') {
        // uji memakai konfigurasi yang tersimpan (kunci + baseUrl), tanpa mengekspor rahasia.
        const r = await gateway.testProvider(id)
        return json(r.ok ? 200 : r.reason?.includes('Kunci API belum diatur') ? 400 : 502, r)
      }
      if (tail === '/models' && method === 'GET') {
        const refresh = query.get('refresh') === '1'
        const def = PROVIDER_REGISTRY[id]
        const cred = await credentials.credentialFor(id, def.defaultBaseUrl)
        if (refresh) {
          const r = await catalog.refresh(id, cred)
          if (!r.ok) return json(502, { error: 'catalog_failed', message: r.reason })
        }
        const st = await catalog.list(id, { refreshIfStale: refresh, cred })
        return json(200, {
          providerId: id, fresh: st.fresh, stale: st.stale, count: (st.models ?? []).length,
          models: (st.models ?? []).slice(0, 500).map((x) => ({ id: x.id, name: x.name, tier: x.tier, pricing: x.pricing, contextWindow: x.contextWindow, capabilities: x.capabilities, source: x.source })),
        })
      }
      return json(404, { error: 'not_found' })
    }

    /* ---------- gateway: katalog gabungan & kebijakan routing ---------- */
    if (method === 'GET' && path === '/api/gateway/models') {
      const { entries } = await gateway.effectiveCatalogEntries()
      return json(200, {
        models: entries.slice(0, 800).map((e) => ({ providerId: e.providerId, id: e.id, name: e.name, tier: e.tier, pricing: e.pricing, contextWindow: e.contextWindow, capabilities: e.capabilities, source: e.source })),
        cache: await catalog.allProvidersSummary(),
      })
    }
    if (path === '/api/gateway/settings') {
      if (method === 'GET') {
        const s = await gateway.readSettings()
        const snap = await credentials.snapshot()
        const manualAvailable = s.defaultMode === 'MANUAL' && s.manualSelection
          ? (snap[s.manualSelection.providerId]?.enabled ?? false)
          : null
        return json(200, { settings: s, modes: ROUTING_MODES, manualAvailable })
      }
      if (method === 'PUT') {
        const b = readJson()
        const cur = await gateway.readSettings()
        const patch = {}
        if (b.defaultMode !== undefined) {
          if (!ROUTING_MODES.includes(b.defaultMode)) throw new DuduError(400, 'bad_mode', `Mode tidak dikenal; salah satu dari: ${ROUTING_MODES.join(', ')}.`)
          patch.defaultMode = b.defaultMode
        }
        if (b.maxFallbacks !== undefined) {
          const n = Number(b.maxFallbacks)
          if (!Number.isFinite(n) || n < 0 || n > 4) throw new DuduError(400, 'bad_request', 'maxFallbacks harus angka 0–4.')
          patch.maxFallbacks = Math.floor(n)
        }
        if (b.budget !== undefined) {
          if (typeof b.budget !== 'object' || b.budget === null || !Number.isFinite(Number(b.budget.paidUsdMonthly)) || Number(b.budget.paidUsdMonthly) < 0) throw new DuduError(400, 'bad_budget', 'budget.paidUsdMonthly harus angka ≥ 0.')
          patch.budget = { paidUsdMonthly: Number(b.budget.paidUsdMonthly) }
        }
        if (b.manualSelection !== undefined) {
          patch.manualSelection = b.manualSelection === null ? null : { providerId: String(b.manualSelection.providerId ?? ''), modelId: String(b.manualSelection.modelId ?? '') }
        }
        const s = await gateway.updateSettings(patch)
        return json(200, { settings: s })
      }
    }

    /* ---------- usage & alerts ---------- */
    if (method === 'GET' && path === '/api/usage') {
      const s = await gateway.readSettings()
      const sum = await usage.summary({ budget: { paidUsdMonthly: s.budget.paidUsdMonthly } })
      return json(200, { summary: sum, settings: s })
    }

    /* ---------- file ---------- */
    if (path === '/api/files') {
      if (method === 'GET') return json(200, { files: (await files.list()).map((f) => withReadiness(f, caps)) })
      if (method === 'POST') {
        let name
        try { name = decodeURIComponent(req.headers?.['x-file-name'] ?? '') } catch { throw new FileError(400, 'bad_name', 'Nama file tidak valid.') }
        if (!name) throw new FileError(400, 'missing_name', 'Header X-File-Name wajib.')
        if (!req.bytes) throw new FileError(400, 'empty_file', 'Badan permintaan kosong.')
        return json(201, { file: withReadiness(await files.save({ name, bytes: req.bytes }), caps) })
      }
    }
    if ((m = /^\/api\/files\/([^/]+)$/.exec(path))) {
      const id = m[1]
      if (!isFileId(id)) throw new FileError(400, 'bad_id', 'ID file tidak valid.')
      if (method === 'GET') { const f = await files.get(id); return f ? json(200, { file: withReadiness(f, caps) }) : json(404, { error: 'not_found' }) }
      if (method === 'DELETE') {
        const ok = await files.remove(id)
        if (ok) await kb.removeFile(id) // sinkronisasi indeks
        return ok ? json(200, { deleted: true }) : json(404, { error: 'not_found' })
      }
    }
    if ((m = /^\/api\/files\/([^/]+)\/(content|text)$/.exec(path)) && method === 'GET') {
      const id = m[1]
      if (!isFileId(id)) throw new FileError(400, 'bad_id', 'ID file tidak valid.')
      const f = await files.get(id)
      if (!f) return json(404, { error: 'not_found' })
      if (m[2] === 'text') { const t = await files.readText(id); return json(200, { text: t == null ? null : t.slice(0, 20000), totalChars: t?.length ?? 0, truncated: (t?.length ?? 0) > 20000 }) }
      return download({ bytes: await files.readBytes(id), name: f.name, mime: f.mime, inline: query.get('inline') === '1' })
    }

    /* ---------- input data → Knowledge Base (teks langsung, langsung terbaca chat) ---------- */
    if (method === 'POST' && path === '/api/kb/text') {
      const { title, text } = readJson()
      if (typeof text !== 'string' || !text.trim()) throw new FileError(400, 'bad_text', 'Teks yang dimasukkan kosong.')
      if (text.length > 200_000) throw new FileError(413, 'too_large', 'Teks melebihi 200.000 karakter — bagi menjadi beberapa dokumen.')
      const name = `${String(title ?? '').trim().slice(0, 60) || 'Catatan'}.txt`
      const meta = await files.save({ name, bytes: Buffer.from(text, 'utf8') })
      const indexed = await kb.indexFile(meta.id)
      return json(201, { file: { id: meta.id, name: meta.name }, indexed })
    }

    /* ---------- knowledge base ---------- */
    if (method === 'GET' && path === '/api/kb') return json(200, await kb.stats())
    if (method === 'POST' && path === '/api/kb/docs') {
      const { fileId } = readJson()
      if (!isFileId(fileId)) throw new FileError(400, 'bad_id', 'fileId tidak valid.')
      try { return json(201, await kb.indexFile(fileId)) } catch (e) { if (e.status) throw new FileError(e.status, e.code, e.message); throw e }
    }
    if ((m = /^\/api\/kb\/docs\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      if (!isFileId(m[1])) throw new FileError(400, 'bad_id', 'ID tidak valid.')
      return (await kb.removeFile(m[1])) ? json(200, { deleted: true }) : json(404, { error: 'not_found' })
    }
    if (method === 'POST' && path === '/api/kb/search') {
      const { query: q, limit } = readJson()
      if (typeof q !== 'string' || !q.trim()) throw new FileError(400, 'bad_query', 'Query kosong.')
      return json(200, { results: await kb.search(q.slice(0, 500), { limit: Math.min(Math.max(Number(limit) || 5, 1), 10) }) })
    }

    /* ---------- misi ---------- */
    if (path === '/api/missions') {
      if (method === 'GET') return json(200, { missions: await missions.list() })
      if (method === 'POST') { const b = readJson(); return json(201, { mission: await missions.create({ goal: b.goal, fileId: b.fileId }) }) }
    }
    if ((m = /^\/api\/missions\/([^/]+)$/.exec(path))) {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      if (method === 'GET') { const x = await missions.get(m[1]); return x ? json(200, { mission: x }) : json(404, { error: 'not_found' }) }
      if (method === 'DELETE') return (await missions.remove(m[1])) ? json(200, { deleted: true }) : json(404, { error: 'not_found' })
    }
    // Jejak audit per misi (halaman + filter). Data diambil dari API server — frontend
    // TIDAK pernah membaca berkas audit langsung. Payload sudah disanitasi (redaksi).
    if ((m = /^\/api\/missions\/([^/]+)\/audit$/.exec(path)) && method === 'GET') {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      const mission = await missions.get(m[1])
      if (!mission) return json(404, { error: 'not_found', message: 'Misi tidak ditemukan.' })
      const res = await registry.audit({
        limit: query.get('limit') ?? 50,
        offset: query.get('offset') ?? 0,
        missionId: m[1],
        eventType: query.get('eventType') ?? null,
        outcome: query.get('outcome') ?? null,
        actor: query.get('actor') ?? null,
        // correlationId TIDAK difilter secara default: event yang tidak membawa korelasi
        // (mis. event capability lama) tetap milik misi ini dan harus terlihat.
        correlationId: query.get('correlationId') ?? null,
        since: query.get('since') ?? null,
        until: query.get('until') ?? null,
      })
      return json(200, res)
    }
    if ((m = /^\/api\/missions\/([^/]+)\/(approve|retry|cancel)$/.exec(path)) && method === 'POST') {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      if (m[2] === 'cancel') return json(200, { mission: await missions.cancel(m[1]) })
      return json(200, { mission: await (m[2] === 'approve' ? missions.approve(m[1]) : missions.retry(m[1])) })
    }
    if ((m = /^\/api\/missions\/([^/]+)\/artifacts\/([^/]+)$/.exec(path)) && method === 'GET') {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      const name = decodeURIComponent(m[2])
      const a = await missions.artifactPath(m[1], name)
      if (!a) return json(404, { error: 'not_found' })
      const { readFile } = await import('node:fs/promises')
      return download({ bytes: await readFile(a.path), name: a.artifact.name, mime: a.artifact.mime, inline: false })
    }
    if ((m = /^\/api\/missions\/([^/]+)\/evidence\/([^/]+)$/.exec(path)) && method === 'GET') {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      const name = decodeURIComponent(m[2])
      const e = await missions.evidencePath(m[1], name)
      if (!e) return json(404, { error: 'not_found' })
      const { readFile } = await import('node:fs/promises')
      return download({ bytes: await readFile(e.path), name: e.evidence.name, mime: e.evidence.mime, inline: false })
    }
    if ((m = /^\/api\/missions\/([^/]+)\/approvals$/.exec(path)) && method === 'POST') {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      const b = readJson()
      const user = await currentUser(req)
      const rec = await missions.requestApproval(m[1], {
        capabilityId: b.capabilityId, operation: b.operation ?? 'run', target: b.target ?? null,
        args: b.args ?? {}, actor: user?.email ?? 'local', ttlMs: b.ttlMs,
      })
      return json(201, { approval: rec })
    }
    if ((m = /^\/api\/missions\/([^/]+)\/approvals\/([^/]+)$/.exec(path))) {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      if (method === 'GET') return json(200, { approvals: await missions.listApprovals(m[1]) })
      if (method === 'POST') {
        const b = readJson()
        const user = await currentUser(req)
        const rec = await missions.decideApproval(m[1], m[2], { decision: b.decision ?? 'approved', actor: user?.email ?? 'local', ttlMs: b.ttlMs })
        return json(200, { approval: rec })
      }
    }
    if ((m = /^\/api\/missions\/([^/]+)\/capabilities\/([^/]+)\/run$/.exec(path)) && method === 'POST') {
      if (!isMissionId(m[1])) throw new MissionError(400, 'bad_id', 'ID misi tidak valid.')
      const mission = await missions.get(m[1])
      if (!mission) return json(404, { error: 'not_found', message: 'Misi tidak ditemukan.' })
      const b = readJson()
      const user = await currentUser(req)
      const capId = decodeURIComponent(m[2])
      const args = b.args ?? {}
      // Approval WAJIB terikat pada tindakan (kapabilitas + operasi + parameter) — persetujuan
      // umum atas misi bukan izin tanpa batas. Persetujuan yang kedaluwarsa / tidak cocok ditolak.
      const found = missions.findValidApproval(mission, { capabilityId: capId, operation: 'run', target: b.target ?? null, args })
      if (!found.rec) throw new MissionError(409, 'approval_required', 'Tindakan ini belum disetujui. Minta persetujuan khusus untuk tindakan ini terlebih dahulu.')
      if (found.expired) throw new MissionError(403, 'approval_expired', 'Persetujuan tindakan ini sudah kedaluwarsa; minta persetujuan baru.')
      if (found.mismatch) throw new MissionError(409, 'approval_scope_mismatch', 'Parameter tindakan berubah setelah persetujuan; minta persetujuan baru.')
      const run = await registry.run(capId, { args, confirm: b.confirm === true, actor: user?.email ?? 'local', missionId: mission.id, correlationId: mission.correlationId })
      // Persetujuan dipakai satu kali saja → tindakan berikutnya perlu persetujuan baru.
      await missions.consumeApproval(m[1], found.rec.id)
      const evidence = await missions.attachEvidence(m[1], { capabilityId: run.capability.id, ok: run.ok, result: { ok: run.ok, result: run.result, error: run.error, at: run.at, durationMs: run.durationMs }, actor: user?.email ?? 'local' })
      return json(200, { run, evidence, mission: await missions.get(m[1]) })
    }

    /* ---------- akun & sesi (opsional: mode lokal tetap berfungsi tanpa login) ---------- */
    if (path === '/api/auth/me') {
      const user = await currentUser(req)
      if (!user) return json(200, { user: null })
      const h = String(req.headers?.authorization ?? ''); const token = h.startsWith('Bearer ') ? h.slice(7) : ''
      const exp = (await auth.verifySession(token))?.expiresAt ?? null
      return json(200, { user, expiresAt: exp })
    }
    if (path === '/api/auth/register' && method === 'POST') {
      const { email, password, name } = readJson()
      const user = await auth.register({ email, password, name })
      const session = await auth.createSession(user.id)
      return json(201, { user, session })
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const { email, password } = readJson()
      const user = await auth.login({ email, password })
      const session = await auth.createSession(user.id)
      return json(200, { user, session })
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      const h = String(req.headers?.authorization ?? ''); const token = h.startsWith('Bearer ') ? h.slice(7) : ''
      return json(200, { loggedOut: await auth.logout(token) })
    }

    /* ---------- OAuth (Google/GitHub) — aplikasi milik pengguna sendiri (BYO) ---------- */
    if ((m = /^\/api\/auth\/oauth\/([^/]+)\/(status|url|exchange|app)$/.exec(path))) {
      const [, provider, action] = m
      if (!OAUTH_PROVIDERS.includes(provider)) throw new AuthError(400, 'bad_provider', `Provider OAuth tidak dikenal; salah satu dari: ${OAUTH_PROVIDERS.join(', ')}.`)
      if (action === 'status') return json(200, await auth.oauthStatus(provider))
      if (action === 'app' && method === 'PUT') {
        const { clientId, clientSecret } = readJson()
        await auth.setOauthApp(provider, { clientId, clientSecret })
        return json(200, await auth.oauthStatus(provider))
      }
      if (action === 'url' && method === 'POST') {
        const { redirectUri, state } = readJson()
        return json(200, await auth.authorizeUrl(provider, { redirectUri, state }))
      }
      if (action === 'exchange' && method === 'POST') {
        const { code, redirectUri } = readJson()
        const out = await auth.exchangeCode(provider, { code, redirectUri })
        return json(200, out) // { user, session }
      }
    }

    /* ---------- MCP ---------- */
    if (path === '/api/mcp/call' && method === 'POST') return mcpGateway.handle(readJson())
    if (path === '/api/mcp/tools' && method === 'GET') return json(200, { tools: mcpTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
    if (path === '/api/mcp/servers') {
      if (method === 'GET') return json(200, { servers: await mcpClient.listServers() })
      if (method === 'POST') { const b = readJson(); const server = await mcpClient.addServer(b); return json(201, { server }) }
    }
    if ((m = /^\/api\/mcp\/servers\/([^/]+)\/(probe|remove)$/.exec(path)) && method === 'POST') {
      const out = m[2] === 'probe' ? await mcpClient.probe(m[1]) : { removed: await mcpClient.removeServer(m[1]) }
      return json(200, out)
    }

    /* ---------- skill ---------- */
    if (path === '/api/skills') {
      if (method === 'GET') return json(200, await skills.list())
      if (method === 'POST') { const b = readJson(); return json(201, { skill: await skills.create(b) }) }
    }
    if ((m = /^\/api\/skills\/([^/]+)$/.exec(path))) {
      if (method === 'PUT') { const b = readJson(); return json(200, { skill: await skills.update(m[1], b) }) }
      if (method === 'DELETE') return (await skills.remove(m[1])) ? json(200, { deleted: true }) : json(404, { error: 'not_found' })
    }

    /* ---------- plugin ---------- */
    if (path === '/api/plugins') {
      if (method === 'GET') return json(200, { plugins: await plugins.list() })
      if (method === 'POST') { const b = readJson(); return json(200, await plugins.setEnabled(String(b.id ?? ''), Boolean(b.enabled))) }
    }
    if ((m = /^\/api\/plugins\/([^/]+)\/run$/.exec(path)) && method === 'POST') return json(200, { result: await plugins.runTool(m[1], readJson()) })

    /* ---------- connector ---------- */
    if (path === '/api/connectors') {
      if (method === 'GET') return json(200, { connectors: await connectors.list() })
      if (method === 'PUT') { const b = readJson(); return json(200, await connectors.save(String(b.id ?? ''), b.fields ?? {})) }
      if (method === 'POST') { const b = readJson(); return json(200, await connectors.test(String(b.id ?? ''))) }
    }
    if ((m = /^\/api\/connectors\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      return (await connectors.remove(m[1])) ? json(200, { deleted: true }) : json(404, { error: 'not_found' })
    }

    return json(404, { error: 'not_found' })
  }

  async function handle(req) {
    try {
      return await route(req)
    } catch (e) {
      if (e instanceof FileError || e instanceof MissionError || e instanceof AuthError) return json(e.status, { error: e.code, message: e.message })
      if (e instanceof McpError) return json(400, { error: 'mcp_error', message: e.message })
      if (e instanceof PluginError) return json(e.status, { error: e.code, message: e.message })
      if (e instanceof ConnectorError) return json(e.status, { error: e.code, message: e.message })
      if (e instanceof SkillError) return json(e.status, { error: e.code, message: e.message })
      if (e instanceof CapabilityError) return json(e.status, { error: e.code, message: e.message })
      if (e instanceof PermissionError) return json(e.status, { error: e.code, message: e.message, ...(e.detail ? { detail: e.detail } : {}) })
      if (e instanceof AuditError) return json(e.status, { error: e.code, message: e.message })
      if (e instanceof DuduError) {
        console.error(`[api] ${req.method} ${String(req.path).split('?')[0]}: ${e.code}: ${String(e?.message || '').slice(0, 200)}`) // tanpa kunci/isi file
        return json(e.status, { error: e.code, message: e.message })
      }
      console.error(`[api] ${req.method} ${String(req.path).split('?')[0]} gagal: ${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 200)}`) // tanpa isi file
      return json(500, { error: 'internal_error', message: 'Terjadi kesalahan internal.' })
    }
  }

  return { handle, files, kb, missions, gateway, credentials, catalog, usage, auth, mcpGateway, mcpClient, plugins, connectors, skills, registry }
}
