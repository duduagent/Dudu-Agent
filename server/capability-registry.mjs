// Unified Capability Registry — SATU katalog untuk skill, tool, plugin, connector, MCP,
// workflow, dan referensi eksternal (WorkBuddy / Hermes / OpenClaw).
//
// Prinsip:
// - Tidak ada registry kedua: entri Dudu diambil langsung dari store yang sudah dipakai
//   aplikasi (skills.mjs, plugins.mjs, connectors.mjs, mcp.mjs, misi).
// - Status dihitung dari kondisi nyata (file manifest, konfigurasi, probe terakhir, audit).
//   Tidak ada "connected"/"tested" tanpa bukti.
// - Referensi eksternal hanya metadata + dokumentasi resmi. Tidak ada kode/plugin asing
//   yang dijalankan otomatis. Kompatibilitas ditandai apa adanya.
// - Eksekusi hanya untuk adapter yang benar-benar ada (MCP tool lokal, plugin aktif,
//   webhook connector live). Operasi berisiko wajib konfirmasi eksplisit dan dicatat.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildEvent, createExecutionAudit, EVENT_TYPES, redact } from './execution-audit.mjs'
import { enforce, grantedPermissionsFor, requiredPermissionsFor } from './permissions.mjs'

// Re-export untuk kompatibilitas: redact kini hidup di modul audit terpadu.
export { redact }

export class CapabilityError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const CATEGORY_LABELS = {
  skill: 'Skill',
  tool: 'Tool',
  plugin: 'Plugin',
  connector: 'Connector',
  mcp_tool: 'MCP Tool',
  mcp_server: 'MCP Server',
  workflow: 'Workflow',
  agent: 'Agent',
  scheduler: 'Scheduler',
  channel: 'Channel',
  security: 'Keamanan',
}

const SOURCE_LABELS = {
  dudu: 'Dudu',
  workbuddy: 'WorkBuddy',
  hermes: 'Hermes Agent',
  openclaw: 'OpenClaw',
}

const STATUS_KEYS = ['implementation', 'configuration', 'connection', 'execution', 'availability', 'compatibility']
const MAX_RESULT_CHARS = 24_000
const MAX_ARGS_CHARS = 8_192
const REFERENCE_VERIFIED_AT = '2026-10-21'
const AUDIT_FILE = 'capability-audit.jsonl'
const STATE_FILE = 'capability-state.json'

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const nowIso = (t = Date.now()) => new Date(t).toISOString()

function truncate(value, max = 400) {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// Catatan: `redact` kini hidup di server/execution-audit.mjs (satu implementasi untuk audit
// terpadu). Fungsi lokal dihapus — deklarasi ganda membuat modul gagal dimuat di Node/Electron
// (vitest/esbuild menoleransinya → hasil hijau palsu).

function safeResult(value) {
  let text
  try { text = JSON.stringify(value) } catch { text = String(value) }
  if (text == null) return null
  if (text.length <= MAX_RESULT_CHARS) return value
  return { truncated: true, bytes: text.length, preview: text.slice(0, MAX_RESULT_CHARS) }
}

function safeJson(text, fallback) {
  try { return JSON.parse(text) } catch { return fallback }
}

function statusLabel(status) {
  if (status.implementation === 'reference_only') return 'Referensi eksternal'
  if (status.implementation === 'not_implemented') return 'Belum diimplementasikan'
  if (status.implementation === 'scaffold') return 'Kerangka konfigurasi'
  if (status.availability === 'needs_configuration') return 'Perlu konfigurasi'
  if (status.availability === 'disabled') return 'Nonaktif'
  if (status.availability === 'unavailable') return 'Tidak tersedia'
  if (status.availability === 'unverified') return 'Belum diverifikasi'
  if (status.connection === 'connected') return 'Terhubung'
  if (status.execution === 'succeeded') return 'Eksekusi terakhir berhasil'
  if (status.availability === 'available') return 'Tersedia'
  return 'Belum diverifikasi'
}

function baseEntry({ id, name, description, category, kind, sourceProject = 'dudu', sourceType = 'native', implementation, configuration = 'not_required', connection = 'not_applicable', availability, compatibility = 'native', runnable = false, sideEffects = 'none', permissions = [], risk = 'low', runtime = null, entryPoint = null, version = null, license: lic = null, sourceCode = null, docs = [], tags = [], priority = null, duduEquivalent = null, facts = [], meta = {} }) {
  return {
    id,
    name,
    description,
    category,
    categoryLabel: CATEGORY_LABELS[category] ?? category,
    kind,
    sourceProject,
    sourceLabel: SOURCE_LABELS[sourceProject] ?? sourceProject,
    sourceType,
    version,
    license: lic,
    sourceCode,
    compatibility,
    priority,
    duduEquivalent,
    facts,
    docs,
    tags,
    runtime,
    entryPoint,
    runnable,
    sideEffects,
    permissions,
    risk,
    status: {
      implementation,
      configuration,
      connection,
      execution: 'not_run',
      availability,
      compatibility,
    },
    lastValidatedAt: null,
    lastValidation: null,
    lastExecutionAt: null,
    lastExecution: null,
    lastError: null,
    meta,
  }
}

/* ------------------------------------------------------------------ *
 * Referensi eksternal (hasil audit dokumentasi resmi, bukan klaim).
 * Semua entri di bawah ini reference_only: tidak dieksekusi/dipasang.
 * ------------------------------------------------------------------ */

const EXTERNAL_REFERENCES = [
  // ---------------- WorkBuddy (Tencent) ----------------
  baseEntry({
    id: 'workbuddy.skill.marketplace',
    name: 'Skill Marketplace WorkBuddy',
    description: 'Marketplace skill WorkBuddy: pasang, aktif/nonaktifkan, perbarui, hapus, dan pemeriksaan keamanan sebelum dipakai. Format dan runtime milik WorkBuddy, bukan Dudu.',
    category: 'skill',
    kind: 'reference',
    sourceProject: 'workbuddy',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P2',
    license: 'Proprietary (Tencent WorkBuddy)',
    sourceCode: 'not_available',
    duduEquivalent: 'Skill kustom Dudu (instruksi system prompt, maks. 5 aktif)',
    facts: [
      'Marketplace menyediakan skill resmi/komunitas dengan aksi pasang, aktif/nonaktif, perbarui, dan hapus.',
      'Dokumentasi menyebut pemeriksaan keamanan skill sebelum dipakai.',
      'Dudu tidak memasang paket skill WorkBuddy; tidak ada kompatibilitas biner yang diklaim.',
    ],
    docs: [
      { label: 'Dokumentasi resmi Skill Market', url: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market' },
      { label: 'Panduan membuat skill', url: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Create-Skills' },
    ],
    tags: ['marketplace', 'skill', 'keamanan'],
    meta: { vendor: 'Tencent', verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'workbuddy.connector.oauth',
    name: 'Connector OAuth WorkBuddy',
    description: 'Connector pihak ketiga WorkBuddy (antara lain GitHub, GitLab, Jira, Confluence, Google Drive, Gmail, Notion, Slack) dengan otorisasi OAuth/API key. Dudu belum mengimpor connector ini.',
    category: 'connector',
    kind: 'reference',
    sourceProject: 'workbuddy',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P1',
    license: 'Proprietary (Tencent WorkBuddy)',
    sourceCode: 'not_available',
    duduEquivalent: 'Connector webhook Dudu (satu-satunya yang live); email/GitHub masih kerangka',
    facts: [
      'Pusat connector menyediakan layanan populer dengan otorisasi OAuth atau kredensial API.',
      'Dudu belum memiliki alur OAuth pihak ketiga untuk connector; connector webhook tetap jalur live satu-satunya.',
    ],
    docs: [
      { label: 'Dokumentasi resmi Connector', url: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector' },
    ],
    tags: ['oauth', 'connector', 'integrasi'],
    meta: { vendor: 'Tencent', verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'workbuddy.agent.expert-center',
    name: 'Expert Center (persona & tim)',
    description: 'Katalog expert/persona WorkBuddy dengan kategori, pencarian, "My Experts", dan tim expert. Dudu belum memiliki sistem persona/agent template yang dapat dipasang.',
    category: 'agent',
    kind: 'reference',
    sourceProject: 'workbuddy',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P2',
    license: 'Proprietary (Tencent WorkBuddy)',
    sourceCode: 'not_available',
    duduEquivalent: 'Belum ada agent template; misi Dudu memakai planner deterministik',
    facts: [
      'Expert Center menampilkan kartu expert, kategori, pencarian, koleksi pribadi, dan tim expert.',
      'Referensi UI dipakai untuk tata letak katalog; branding WorkBuddy tidak disalin.',
    ],
    docs: [
      { label: 'Dokumentasi resmi Expert Center', url: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center' },
    ],
    tags: ['persona', 'agent', 'katalog'],
    meta: { vendor: 'Tencent', verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'workbuddy.result.artifacts',
    name: 'Hasil & artefak tugas',
    description: 'WorkBuddy menyajikan hasil tugas sebagai artefak yang dapat ditinjau. Dudu sudah memiliki artefak misi + verifikasi independen; tidak ada impor yang diperlukan.',
    category: 'workflow',
    kind: 'reference',
    sourceProject: 'workbuddy',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'native',
    priority: 'P3',
    license: 'Proprietary (Tencent WorkBuddy)',
    sourceCode: 'not_available',
    duduEquivalent: 'Artefak misi Dudu (report.md/profile.json + bukti kapabilitas)',
    facts: [
      'WorkBuddy mendokumentasikan halaman hasil untuk meninjau keluaran tugas.',
      'Dudu sudah menulis artefak ke disk, menghitung SHA-256, dan memverifikasi ulang sebelum misi dinyatakan selesai.',
    ],
    docs: [
      { label: 'Dokumentasi resmi Results', url: 'https://www.workbuddy.ai/docs/workbuddy/Results' },
    ],
    tags: ['artefak', 'verifikasi'],
    meta: { vendor: 'Tencent', verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_required' },
  }),

  // ---------------- Hermes Agent (Nous Research, MIT) ----------------
  baseEntry({
    id: 'hermes.skill.skillmd',
    name: 'Skills SKILL.md (Hermes)',
    description: 'Sistem skill Hermes berbasis folder SKILL.md (standar agentskills.io) dengan instruksi prosedural dan pemuatan progresif. Dudu dapat memakai isi instruksinya, tetapi tidak menjalankan skrip/aset skill.',
    category: 'skill',
    kind: 'reference',
    sourceProject: 'hermes',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P1',
    license: 'MIT',
    sourceCode: 'https://github.com/NousResearch/hermes-agent',
    duduEquivalent: 'Skill kustom Dudu (teks instruksi, maks. 5 aktif, 800 karakter efektif)',
    facts: [
      'Skill berupa folder berisi SKILL.md dengan frontmatter dan instruksi prosedural.',
      'Pemuatan progresif: metadata dulu, isi penuh saat relevan.',
      'Dudu sengaja hanya mengadopsi instruksi teks; skrip/aset tidak dieksekusi otomatis.',
    ],
    docs: [
      { label: 'Skills System Hermes', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/skills' },
      { label: 'Repositori (MIT)', url: 'https://github.com/NousResearch/hermes-agent' },
    ],
    tags: ['skillmd', 'agentskills', 'mit'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'manual_text_only' },
  }),
  baseEntry({
    id: 'hermes.mcp.stdio_http',
    name: 'MCP stdio + HTTP',
    description: 'Hermes mendukung MCP melalui stdio dan HTTP, termasuk autentikasi/OAuth dan penyaringan tool. Dudu baru menguji handshake stdio; belum ada klien HTTP/OAuth atau pemanggilan tool server eksternal.',
    category: 'mcp_server',
    kind: 'reference',
    sourceProject: 'hermes',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P1',
    license: 'MIT',
    sourceCode: 'https://github.com/NousResearch/hermes-agent',
    duduEquivalent: 'MCP client stdio Dudu (initialize + tools/list, tanpa eksekusi tool eksternal)',
    facts: [
      'Dokumentasi MCP Hermes mencakup transport stdio dan HTTP serta autentikasi.',
      'Dudu hanya melakukan probe handshake stdio dengan timeout; eksekusi tool server eksternal belum didukung.',
    ],
    docs: [
      { label: 'MCP Hermes', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp' },
    ],
    tags: ['mcp', 'http', 'oauth'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'hermes.plugin.catalog',
    name: 'Plugin Catalog Hermes',
    description: 'Katalog plugin komunitas Hermes dengan label sumber Official/Verified/Community. Format plugin dan lifecycle-nya belum diaudit cukup dalam untuk diadopsi.',
    category: 'plugin',
    kind: 'reference',
    sourceProject: 'hermes',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'unverified',
    priority: 'P3',
    license: 'MIT',
    sourceCode: 'https://github.com/NousResearch/hermes-agent',
    duduEquivalent: 'Plugin lokal Dudu (manifest.json + entry .mjs, opt-in)',
    facts: [
      'Katalog plugin menampilkan filter sumber Official/Verified/Community dan kategori.',
      'Dudu belum mengadopsi format/lifecycle plugin Hermes; tidak ada kode yang disalin.',
    ],
    docs: [
      { label: 'Plugin Catalog Hermes', url: 'https://hermes-agent.nousresearch.com/docs/plugins' },
    ],
    tags: ['plugin', 'katalog', 'lisensi'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'hermes.scheduler.cron',
    name: 'Penjadwal / cron',
    description: 'Hermes menyediakan penjadwalan tugas otomatis. Dudu belum memiliki scheduler persisten; misi hanya berjalan saat disetujui pengguna.',
    category: 'scheduler',
    kind: 'reference',
    sourceProject: 'hermes',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'incompatible',
    priority: 'P2',
    license: 'MIT',
    sourceCode: 'https://github.com/NousResearch/hermes-agent',
    duduEquivalent: 'Belum ada scheduler; misi harus dipicu manual',
    facts: [
      'Dokumentasi fitur Hermes mencakup penjadwalan/cron.',
      'Dudu belum mengimplementasikan scheduler, antrean latar belakang, atau pengiriman hasil terjadwal.',
    ],
    docs: [
      { label: 'Dokumentasi fitur Hermes', url: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/overview' },
    ],
    tags: ['cron', 'otomasi'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),

  // ---------------- OpenClaw (MIT) ----------------
  baseEntry({
    id: 'openclaw.skill.skillmd',
    name: 'Skills SKILL.md + gating',
    description: 'OpenClaw memuat skill dari folder SKILL.md dengan frontmatter YAML, urutan prioritas, gating env/config/binary, dan allowlist per agent. Dudu mengadopsi konsep instruksi teks saja.',
    category: 'skill',
    kind: 'reference',
    sourceProject: 'openclaw',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P1',
    license: 'MIT',
    sourceCode: 'https://github.com/openclaw/openclaw',
    duduEquivalent: 'Skill kustom Dudu (instruksi teks, tanpa gating/allowlist)',
    facts: [
      'Setiap skill adalah direktori berisi SKILL.md dengan frontmatter YAML dan markdown.',
      'Skill dapat digating berdasarkan env/config/binary dan dibatasi lewat allowlist agent.',
      'Dudu belum memiliki gating/allowlist skill; hanya batas jumlah aktif dan panjang instruksi.',
    ],
    docs: [
      { label: 'Skills OpenClaw', url: 'https://docs.openclaw.ai/tools/skills' },
      { label: 'Membuat skill', url: 'https://docs.openclaw.ai/tools/creating-skills' },
    ],
    tags: ['skillmd', 'gating', 'allowlist', 'mit'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'manual_text_only' },
  }),
  baseEntry({
    id: 'openclaw.plugin.runtime',
    name: 'Plugin runtime OpenClaw',
    description: 'Plugin OpenClaw menambah channel, provider, harness, tool, skill, suara, dan media; dipasang dari ClawHub/npm/git. Dudu tidak memasang atau menjalankan plugin OpenClaw.',
    category: 'plugin',
    kind: 'reference',
    sourceProject: 'openclaw',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'incompatible',
    priority: 'P3',
    license: 'MIT',
    sourceCode: 'https://github.com/openclaw/openclaw',
    duduEquivalent: 'Plugin lokal Dudu (manifest sendiri; tanpa marketplace/otomatis install)',
    facts: [
      'Plugin memperluas runtime dengan channel, provider, harness, tool, skill, dan kemampuan media.',
      'Sumber pemasangan mencakup ClawHub, npm, atau git.',
      'Dudu tidak memiliki marketplace plugin dan tidak akan menjalankan installer otomatis.',
    ],
    docs: [
      { label: 'Plugins OpenClaw', url: 'https://docs.openclaw.ai/plugins' },
    ],
    tags: ['plugin', 'marketplace', 'risiko-tinggi'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'openclaw.tool.builtin',
    name: 'Built-in tools (exec/fs/browser/web)',
    description: 'OpenClaw menyediakan tool bawaan seperti eksekusi perintah, filesystem, browser, web, dan messaging dengan kebijakan tool. Dudu sengaja TIDAK memiliki shell/browser otomatis.',
    category: 'tool',
    kind: 'reference',
    sourceProject: 'openclaw',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'incompatible',
    priority: 'P3',
    license: 'MIT',
    sourceCode: 'https://github.com/openclaw/openclaw',
    duduEquivalent: 'Tool lokal Dudu: ekstraksi dokumen, profil data, Knowledge Base, file listing',
    facts: [
      'Tools adalah aksi yang dapat dipanggil agent; skill mengajari cara memakainya.',
      'Kebijakan tool membatasi tool yang terlihat oleh agent.',
      'Dudu tidak mengadopsi exec/browser; batas keamanan ini disengaja.',
    ],
    docs: [
      { label: 'Overview tools', url: 'https://docs.openclaw.ai/tools' },
    ],
    tags: ['tool', 'exec', 'browser', 'keamanan'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'openclaw.channel.gateway',
    name: 'Gateway & channel messaging',
    description: 'OpenClaw berjalan sebagai gateway yang menghubungkan agent ke channel chat. Dudu adalah aplikasi desktop/web lokal tanpa gateway channel.',
    category: 'channel',
    kind: 'reference',
    sourceProject: 'openclaw',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'incompatible',
    priority: 'P3',
    license: 'MIT',
    sourceCode: 'https://github.com/openclaw/openclaw',
    duduEquivalent: 'Chat desktop Dudu (lokal, tanpa channel eksternal)',
    facts: [
      'OpenClaw menyebut dirinya sebagai asisten yang berjalan di perangkat dan chat pengguna.',
      'Arsitekturnya memakai gateway untuk channel; Dudu tidak memiliki komponen ini.',
    ],
    docs: [
      { label: 'Repositori OpenClaw', url: 'https://github.com/openclaw/openclaw' },
    ],
    tags: ['gateway', 'channel'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'openclaw.registry.clawhub',
    name: 'ClawHub (registry skill)',
    description: 'ClawHub adalah registry skill OpenClaw. Dudu tidak terhubung ke ClawHub dan tidak mengunduh paket otomatis.',
    category: 'skill',
    kind: 'reference',
    sourceProject: 'openclaw',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P2',
    license: 'MIT',
    sourceCode: 'https://github.com/openclaw/openclaw',
    duduEquivalent: 'Belum ada registry; skill hanya dibuat lokal',
    facts: [
      'Dokumentasi skills menyebut ClawHub sebagai kanal distribusi skill.',
      'Dudu belum memiliki registry, verifikasi tanda tangan, atau pembaruan otomatis.',
    ],
    docs: [
      { label: 'Skills & ClawHub', url: 'https://docs.openclaw.ai/tools/skills' },
    ],
    tags: ['registry', 'clawhub', 'supply-chain'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
  baseEntry({
    id: 'openclaw.security.policy',
    name: 'Tool policy & sandboxing',
    description: 'OpenClaw mendokumentasikan kebijakan tool dan sandboxing. Dudu sudah memiliki gerbang konfirmasi untuk operasi berisiko, tetapi belum memiliki sandbox proses.',
    category: 'security',
    kind: 'reference',
    sourceProject: 'openclaw',
    sourceType: 'external-reference',
    implementation: 'reference_only',
    availability: 'unverified',
    compatibility: 'adapter_required',
    priority: 'P1',
    license: 'MIT',
    sourceCode: 'https://github.com/openclaw/openclaw',
    duduEquivalent: 'Gerbang konfirmasi + audit kapabilitas (tanpa sandbox)',
    facts: [
      'Dokumentasi menyediakan bagian kebijakan tool dan sandboxing.',
      'Dudu menerapkan least privilege deklaratif dan konfirmasi, tetapi tidak mengklaim isolasi sandbox.',
    ],
    docs: [
      { label: 'Security OpenClaw', url: 'https://docs.openclaw.ai/gateway/security' },
      { label: 'Sandboxing', url: 'https://docs.openclaw.ai/gateway/sandboxing' },
    ],
    tags: ['keamanan', 'sandbox', 'policy'],
    meta: { verifiedAt: REFERENCE_VERIFIED_AT, import: 'not_supported' },
  }),
]

/* ------------------------------------------------------------------ */

export function createCapabilityRegistry({ dataDir, skills, plugins, connectors, mcpClient, mcpTools = [], caps = {}, runTimeoutMs = 30_000, now = () => Date.now(), audit: auditInjected = null }) {
  const statePath = path.join(dataDir, STATE_FILE)
  let state = null
  let writeChain = Promise.resolve()

  async function loadState() {
    if (state) return state
    state = safeJson(await fs.readFile(statePath, 'utf8').catch(() => 'null'), null)
    if (!state || state.version !== 1 || typeof state.items !== 'object') state = { version: 1, items: {} }
    return state
  }

  function persistState() {
    const payload = JSON.stringify(state, null, 1)
    writeChain = writeChain.then(async () => {
      await fs.mkdir(dataDir, { recursive: true })
      const tmp = `${statePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
      await fs.writeFile(tmp, payload, { mode: 0o600 })
      await fs.rename(tmp, statePath)
    }).catch(() => {})
    return writeChain
  }

  // Audit terpadu: satu jejak append-only untuk aktivitas misi DAN eksekusi kapabilitas.
  // (appendAudit lama dihapus agar hanya ada SATU penulis berkas audit.)
  const audit = auditInjected ?? createExecutionAudit({ dataDir, now })

  function runtimeOf(id) {
    return state?.items?.[id] ?? null
  }

  function decorate(entry) {
    const rt = runtimeOf(entry.id)
    const out = { ...entry, status: { ...entry.status } }
    if (rt?.lastValidation) {
      out.lastValidatedAt = rt.lastValidation.at
      out.lastValidation = rt.lastValidation
      if (rt.lastValidation.verdict === 'failed') out.lastError = rt.lastValidation.error ?? 'Validasi terakhir gagal.'
    }
    if (rt?.lastExecution) {
      out.lastExecutionAt = rt.lastExecution.at
      out.lastExecution = rt.lastExecution
      out.status.execution = rt.lastExecution.ok ? 'succeeded' : 'failed'
      if (!rt.lastExecution.ok) out.lastError = rt.lastExecution.error ?? 'Eksekusi terakhir gagal.'
    }
    out.statusLabel = statusLabel(out.status)
    return out
  }

  /* ---------------- Dudu native / local entries ---------------- */

  async function skillEntries() {
    const all = await skills.list()
    const out = []
    for (const s of all.builtin) {
      const available = Boolean(s.available)
      out.push(decorate(baseEntry({
        id: `dudu.skill.${s.id}`,
        name: s.name,
        description: s.description,
        category: 'skill',
        kind: 'skill_instruction',
        implementation: 'implemented',
        configuration: available ? 'configured' : 'unconfigured',
        availability: available ? 'available' : 'needs_configuration',
        runtime: 'dudu-chat-system-prompt',
        entryPoint: s.where,
        runnable: false,
        sideEffects: 'none',
        permissions: ['chat:system-prompt'],
        tags: ['bawaan', s.category],
        duduEquivalent: null,
        meta: { builtin: true, skillId: s.id, category: s.category, where: s.where },
      })))
    }
    for (const s of all.custom) {
      out.push(decorate(baseEntry({
        id: `dudu.skill.custom.${s.id}`,
        name: s.name,
        description: s.description || 'Skill kustom (instruksi tambahan).',
        category: 'skill',
        kind: 'skill_instruction',
        sourceType: 'user',
        implementation: 'implemented',
        configuration: s.enabled ? 'configured' : 'unconfigured',
        availability: 'available',
        runtime: 'dudu-chat-system-prompt',
        entryPoint: s.enabled ? 'Aktif — ditempelkan ke system prompt chat.' : 'Nonaktif — aktifkan untuk dipakai.',
        runnable: false,
        sideEffects: 'none',
        permissions: ['chat:system-prompt'],
        tags: ['kustom', 'instruksi', s.category],
        docs: [],
        meta: { builtin: false, skillId: s.id, enabled: s.enabled, category: s.category, instructionChars: s.instruction.length, createdAt: s.createdAt, updatedAt: s.updatedAt },
      })))
    }
    return out
  }

  async function pluginEntries() {
    const list = await plugins.list()
    return list.map((p) => {
      const broken = Boolean(p.error)
      return decorate(baseEntry({
        id: `dudu.plugin.${p.id}`,
        name: p.displayName || p.name,
        description: p.description || 'Plugin lokal Dudu (manifest.json + entry .mjs).',
        category: 'plugin',
        kind: 'plugin',
        sourceType: 'local',
        implementation: 'implemented',
        configuration: p.enabled ? 'configured' : 'unconfigured',
        connection: 'not_applicable',
        availability: broken ? 'unavailable' : (p.enabled ? 'available' : 'disabled'),
        compatibility: 'native',
        version: p.version,
        runnable: Boolean(p.entry) && !broken && Boolean(p.enabled),
        sideEffects: 'local_code',
        permissions: ['filesystem:plugin-dir', 'code:local', 'process:in-process'],
        risk: 'high',
        runtime: 'node-esm',
        entryPoint: p.entry ? `plugins/${p.id}/${p.entry}` : null,
        docs: [],
        tags: ['lokal', p.enabled ? 'aktif' : 'nonaktif'],
        meta: { pluginId: p.id, enabled: p.enabled, entry: p.entry, error: p.error, path: `plugins/${p.id}` },
      }))
    })
  }

  async function connectorEntries() {
    const list = await connectors.list()
    return list.map((c) => {
      const live = Boolean(c.live)
      const last = c.lastTest
      const connection = !live ? 'not_applicable' : (last ? (last.ok ? 'connected' : 'disconnected') : 'not_tested')
      const availability = !live
        ? 'unavailable'
        : (c.configured ? 'available' : 'needs_configuration')
      return decorate(baseEntry({
        id: `dudu.connector.${c.id}`,
        name: c.label,
        description: c.description,
        category: 'connector',
        kind: 'connector',
        sourceType: 'local',
        implementation: live ? 'implemented' : 'scaffold',
        configuration: c.configured ? 'configured' : 'unconfigured',
        connection,
        availability,
        compatibility: 'native',
        runnable: live && c.configured,
        sideEffects: live ? 'network' : 'none',
        permissions: live ? ['network:outbound', 'secret:webhook'] : [],
        risk: live ? 'medium' : 'low',
        runtime: 'node-fetch',
        entryPoint: live ? 'POST URL webhook (header x-dudu-secret)' : 'Hanya konfigurasi — belum ada implementasi live',
        docs: [],
        tags: [live ? 'live' : 'kerangka', c.id],
        meta: {
          connectorId: c.id,
          live,
          requiredFields: c.requiredFields,
          configuredFields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, { set: v.set, value: v.value }])),
          lastTest: last,
        },
      }))
    })
  }

  async function mcpEntries() {
    const out = []
    const toolPerm = {
      kb_search: ['kb:read'],
      kb_stats: ['kb:read'],
      file_list: ['files:read'],
    }
    for (const t of mcpTools) {
      out.push(decorate(baseEntry({
        id: `dudu.mcp.tool.${t.name}`,
        name: t.name,
        description: t.description,
        category: 'mcp_tool',
        kind: 'mcp_tool',
        implementation: 'implemented',
        configuration: 'not_required',
        connection: 'not_applicable',
        availability: 'available',
        compatibility: 'native',
        runnable: true,
        sideEffects: 'none',
        permissions: toolPerm[t.name] ?? ['local:read'],
        risk: 'low',
        runtime: 'jsonrpc-in-process',
        entryPoint: 'POST /api/mcp/call (tools/call)',
        docs: [],
        tags: ['mcp', 'lokal', 'read-only'],
        meta: { tool: t.name, inputSchema: t.inputSchema ?? null },
      })))
    }
    const servers = await mcpClient.listServers()
    for (const s of servers) {
      const p = s.lastProbe
      out.push(decorate(baseEntry({
        id: `dudu.mcp.server.${s.id}`,
        name: s.label,
        description: `MCP server eksternal via stdio: ${s.command}${s.args?.length ? ` ${s.args.join(' ')}` : ''}`,
        category: 'mcp_server',
        kind: 'mcp_server',
        sourceType: 'local',
        implementation: 'implemented',
        configuration: 'configured',
        connection: p ? (p.ok ? 'connected' : 'disconnected') : 'not_tested',
        availability: p ? (p.ok ? 'available' : 'unavailable') : 'unverified',
        compatibility: 'native',
        runnable: false,
        sideEffects: 'local_process',
        permissions: ['process:spawn'],
        risk: 'high',
        runtime: 'mcp-stdio',
        entryPoint: 'Probe: initialize → notifications/initialized → tools/list',
        docs: [],
        tags: p?.ok ? ['mcp', 'teruji'] : ['mcp', 'belum teruji'],
        meta: {
          serverId: s.id,
          command: s.command,
          args: redact(s.args ?? []),
          lastProbe: p ? { at: p.at, ok: p.ok, tools: p.tools, serverInfo: p.serverInfo, error: p.error, ms: p.ms } : null,
        },
      })))
    }
    return out
  }

  function internalEntries() {
    const tools = [
      { id: 'input.validate', name: 'Validasi input', desc: 'Memeriksa keberadaan file, SHA-256, dan format tabular.', permissions: ['files:read'] },
      { id: 'data.load', name: 'Muat data', desc: 'Parse CSV/TSV/JSON/JSONL/XLSX secara deterministik.', permissions: ['files:read'] },
      { id: 'data.profile', name: 'Profil data', desc: 'Menghitung profil kolom, statistik, dan duplikat.', permissions: ['files:read'] },
      { id: 'report.write', name: 'Tulis laporan', desc: 'Menulis report.md + profile.json sebagai artefak misi.', permissions: ['artifacts:write'] },
      { id: 'verify.criteria', name: 'Verifikasi kriteria', desc: 'Menghitung ulang angka dari data mentah dan mencocokkan hash artefak.', permissions: ['files:read', 'artifacts:read'] },
    ]
    const out = tools.map((t) => decorate(baseEntry({
      id: `dudu.tool.${t.id}`,
      name: t.name,
      description: t.desc,
      category: 'tool',
      kind: 'internal_tool',
      implementation: 'implemented',
      configuration: 'not_required',
      connection: 'not_applicable',
      availability: 'available',
      compatibility: 'native',
      runnable: false,
      sideEffects: 'none',
      permissions: t.permissions,
      risk: 'low',
      runtime: 'mission-engine',
      entryPoint: `Langkah misi ${t.id}`,
      docs: [],
      tags: ['misi', 'internal', 'deterministik'],
      meta: { tool: t.id },
    })))
    out.push(decorate(baseEntry({
      id: 'dudu.workflow.data-analysis',
      name: 'Misi Analisis Data (5 langkah)',
      description: 'Workflow nyata Dudu: validasi → muat → profil → tulis laporan → verifikasi independen. Satu-satunya template misi yang tersedia.',
      category: 'workflow',
      kind: 'workflow',
      implementation: 'implemented',
      configuration: 'not_required',
      connection: 'not_applicable',
      availability: 'available',
      compatibility: 'native',
      runnable: false,
      sideEffects: 'none',
      permissions: ['files:read', 'artifacts:write'],
      risk: 'low',
      runtime: 'mission-engine',
      entryPoint: 'Misi & Tugas → setujui misi',
      docs: [],
      tags: ['misi', 'analisis-data', 'rule-based'],
      meta: { template: 'data-analysis', steps: 5 },
    })))
    return out
  }

  /* ---------------- aggregate / query ---------------- */

  async function list({ q = '', category = '', source = '', availability = '', implementation = '', kind = '' } = {}) {
    await loadState()
    const all = [
      ...(await skillEntries()),
      ...(await pluginEntries()),
      ...(await connectorEntries()),
      ...(await mcpEntries()),
      ...internalEntries(),
      ...EXTERNAL_REFERENCES.map(decorate),
    ]
    // Deteksi duplikat ID secara eksplisit; jangan diam-diam menimpa.
    const seen = new Map()
    for (const e of all) {
      if (seen.has(e.id)) throw new CapabilityError(500, 'duplicate_capability', `ID kapabilitas duplikat: ${e.id}`)
      seen.set(e.id, e)
    }
    const needle = String(q ?? '').trim().toLowerCase()
    const items = all.filter((e) => {
      if (category && e.category !== category) return false
      if (source && e.sourceProject !== source) return false
      if (availability && e.status.availability !== availability) return false
      if (implementation && e.status.implementation !== implementation) return false
      if (kind && e.kind !== kind) return false
      if (!needle) return true
      const hay = [e.id, e.name, e.description, e.sourceLabel, e.categoryLabel, ...(e.tags ?? []), ...(e.facts ?? [])].join(' ').toLowerCase()
      return hay.includes(needle)
    }).sort((a, b) => {
      const src = (a.sourceProject === 'dudu' ? 0 : 1) - (b.sourceProject === 'dudu' ? 0 : 1)
      return src || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    })
    const countBy = (key) => all.reduce((acc, e) => { const v = key(e); acc[v] = (acc[v] ?? 0) + 1; return acc }, {})
    return {
      generatedAt: nowIso(now()),
      sourceVerifiedAt: REFERENCE_VERIFIED_AT,
      total: all.length,
      shown: items.length,
      items,
      summary: {
        byCategory: countBy((e) => e.category),
        bySource: countBy((e) => e.sourceProject),
        byAvailability: countBy((e) => e.status.availability),
        byImplementation: countBy((e) => e.status.implementation),
        runnable: all.filter((e) => e.runnable).length,
        externalReferences: all.filter((e) => e.sourceType === 'external-reference').length,
      },
      filters: {
        categories: Object.keys(CATEGORY_LABELS),
        sources: Object.entries(SOURCE_LABELS).map(([id, label]) => ({ id, label })),
        statuses: STATUS_KEYS,
      },
      policy: {
        confirmation: 'Operasi dengan efek samping (jaringan, kode lokal, proses) wajib menyertakan confirm:true.',
        executableKinds: ['mcp_tool', 'plugin', 'connector'],
        referenceOnly: 'Entri sourceType=external-reference tidak dapat dijalankan atau dipasang dari Dudu.',
        audit: AUDIT_FILE,
      },
    }
  }

  async function get(id) {
    if (typeof id !== 'string' || !id.trim()) throw new CapabilityError(400, 'bad_id', 'ID kapabilitas wajib diisi.')
    const all = await list()
    const entry = all.items.find((e) => e.id === id)
    if (!entry) throw new CapabilityError(404, 'not_found', 'Kapabilitas tidak ditemukan.')
    return entry
  }

  /* ---------------- validasi ---------------- */

  async function validate(id, { actor = 'local' } = {}) {
    const entry = await get(id)
    const at = now()
    const checks = []
    const add = (checkId, ok, detail) => checks.push({ id: checkId, ok: Boolean(ok), detail: String(detail ?? '') })
    let error = null

    try {
      if (entry.sourceType === 'external-reference') {
        add('reference_only', false, 'Referensi eksternal hanya untuk pemetaan; tidak ada kode yang dipasang atau dijalankan.')
        return await finishValidation(entry, at, { verdict: 'not_applicable', checks, error: 'Referensi eksternal tidak dapat divalidasi sebagai kapabilitas lokal.' })
      }
      if (entry.kind === 'skill_instruction') {
        const all = await skills.list()
        if (entry.meta.builtin) {
          const s = all.builtin.find((x) => x.id === entry.meta.skillId)
          add('registered', Boolean(s), s ? 'Skill bawaan terdaftar.' : 'Skill bawaan tidak ditemukan.')
          add('available', Boolean(s?.available), s?.available ? 'Fitur tersedia.' : 'Fitur belum dikonfigurasi; lihat keterangan skill.')
        } else {
          const s = all.custom.find((x) => x.id === entry.meta.skillId)
          add('exists', Boolean(s), s ? 'Skill kustom ditemukan.' : 'Skill kustom sudah dihapus.')
          add('instruction', Boolean(s?.instruction?.trim()), s ? `${s.instruction.length} karakter instruksi.` : 'Tanpa instruksi.')
          add('active_limit', true, `${all.custom.filter((x) => x.enabled).length}/${all.limits.maxActive} skill aktif.`)
        }
      } else if (entry.kind === 'plugin') {
        const dir = path.join(dataDir, 'plugins', entry.meta.pluginId)
        const manifestPath = path.join(dir, 'manifest.json')
        let manifest = null
        try {
          manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
          add('manifest', true, 'manifest.json valid JSON.')
        } catch (e) {
          add('manifest', false, `manifest.json tidak dapat dibaca: ${e.message}`)
        }
        if (manifest) {
          add('name', typeof manifest.name === 'string' && manifest.name.trim().length > 0, 'Nama manifest diperiksa.')
          add('entry_field', typeof manifest.entry === 'string' && manifest.entry.endsWith('.mjs'), manifest.entry ? `Entry: ${manifest.entry}` : 'Tidak ada entry .mjs.')
          if (typeof manifest.entry === 'string') {
            const target = path.resolve(dir, manifest.entry)
            const inside = target === path.resolve(dir) || target.startsWith(`${path.resolve(dir)}${path.sep}`)
            add('entry_path', inside, inside ? 'Entry berada di dalam folder plugin.' : 'Entry keluar dari folder plugin — ditolak.')
            if (inside) {
              const st = await fs.stat(target).catch(() => null)
              add('entry_exists', Boolean(st?.isFile()), st?.isFile() ? 'Entry ditemukan.' : 'Entry tidak ditemukan.')
            }
          }
          add('enabled', true, entry.meta.enabled ? 'Plugin aktif.' : 'Plugin nonaktif; eksekusi akan ditolak sampai diaktifkan.')
        }
        add('code_not_executed', true, 'Validasi tidak mengimpor/menjalankan kode plugin.')
      } else if (entry.kind === 'connector') {
        const c = (await connectors.list()).find((x) => x.id === entry.meta.connectorId)
        add('registered', Boolean(c), c ? 'Connector terdaftar.' : 'Connector tidak ditemukan.')
        add('live_implementation', Boolean(c?.live), c?.live ? 'Implementasi live tersedia.' : 'Kerangka konfigurasi: belum ada implementasi live.')
        if (c?.live) {
          const url = c.fields?.url?.value
          let parsed = null
          try { parsed = url ? new URL(url) : null } catch { /* invalid */ }
          add('url', Boolean(parsed && ['http:', 'https:'].includes(parsed.protocol)), parsed ? `URL valid (${parsed.protocol}).` : 'URL belum diisi/tidak valid.')
          add('configured', c.configured, c.configured ? 'Semua field wajib terisi.' : 'Field wajib belum lengkap.')
        }
      } else if (entry.kind === 'mcp_tool') {
        const tool = mcpTools.find((t) => t.name === entry.meta.tool)
        add('registered', Boolean(tool), tool ? 'Tool lokal terdaftar.' : 'Tool tidak ditemukan.')
        if (tool) {
          const args = tool.name === 'kb_search' ? { query: 'validasi registry', limit: 1 } : {}
          const out = await tool.run(args)
          add('invoke', true, `Tool berhasil dipanggil (${truncate(out, 180)}).`)
        }
      } else if (entry.kind === 'mcp_server') {
        const probe = await mcpClient.probe(entry.meta.serverId)
        add('handshake', probe.ok, probe.ok ? `Handshake berhasil; ${probe.tools?.length ?? 0} tool ditemukan.` : probe.error)
        if (probe.serverInfo) add('server_info', true, `Server: ${probe.serverInfo.name ?? 'tanpa nama'} ${probe.serverInfo.version ?? ''}`.trim())
      } else if (entry.kind === 'internal_tool' || entry.kind === 'workflow') {
        add('pipeline', true, 'Kapabilitas internal dijalankan oleh Mission Execution Engine, bukan dipanggil langsung dari registry.')
      } else {
        add('adapter', false, 'Tidak ada adapter validasi untuk jenis ini.')
      }
    } catch (e) {
      error = String(e?.message ?? e).slice(0, 500)
      add('exception', false, error)
    }
    const failed = checks.some((c) => !c.ok && c.id !== 'enabled' && c.id !== 'available' && c.id !== 'live_implementation')
    const verdict = error ? 'failed' : (failed ? 'failed' : 'passed')
    return finishValidation(entry, at, { verdict, checks, error })
  }

  async function finishValidation(entry, at, { verdict, checks, error, actor = 'local' }) {
    await loadState()
    const prev = state.items[entry.id] ?? {}
    state.items[entry.id] = {
      ...prev,
      lastValidation: { at, verdict, checks: checks.map((c) => ({ id: c.id, ok: c.ok, detail: truncate(c.detail, 300) })), error: error ?? null },
    }
    await persistState()
    // Event unified + field legacy (action/outcome) agar konsumen lama tetap membaca.
    await audit.append({
      ...buildEvent({ eventType: EVENT_TYPES.CAPABILITY_VALIDATED, capabilityId: entry.id, actor, outcome: verdict, now: () => now(), uuid: () => crypto.randomUUID(), detail: { checks: checks.length, error: error ?? null } }),
      at: nowIso(at),
      action: 'validate',
      error: error ?? null,
      checks: checks.length,
    })
    return {
      capability: await get(entry.id),
      ok: verdict === 'passed',
      verdict,
      checks,
      error: error ?? null,
      at,
    }
  }

  /* ---------------- eksekusi ---------------- */

  async function run(id, { args = {}, confirm = false, actor = 'local', missionId = null, correlationId = null, taskId = null } = {}) {
    const entry = await get(id)
    if (entry.sourceType === 'external-reference') throw new CapabilityError(409, 'reference_only', 'Referensi eksternal tidak dapat dijalankan. Tidak ada kode pihak ketiga yang dijalankan Dudu.')
    if (!entry.runnable) throw new CapabilityError(409, 'not_runnable', 'Kapabilitas ini tidak dapat dijalankan langsung (hanya instruksi/internal/konfigurasi).')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new CapabilityError(400, 'bad_args', 'Argumen harus berupa objek JSON.')
    const argsText = JSON.stringify(args)
    if (argsText.length > MAX_ARGS_CHARS) throw new CapabilityError(400, 'args_too_large', `Argumen maksimum ${MAX_ARGS_CHARS} karakter.`)
    if (entry.sideEffects !== 'none' && confirm !== true) throw new CapabilityError(409, 'confirmation_required', `Operasi ini berefek samping (${entry.sideEffects}); kirim confirm:true untuk menyetujui.`)

    // ---- Pemeriksaan izin di batas eksekusi (bukan hanya di UI) ----
    const required = requiredPermissionsFor(entry)
    const granted = grantedPermissionsFor(entry, { confirm })
    try {
      enforce({ required, granted, capabilityId: entry.id, action: 'run' })
    } catch (e) {
      await audit.append({
        ...buildEvent({
          eventType: EVENT_TYPES.PERMISSION_DENIED, capabilityId: entry.id, missionId, taskId, actor,
          outcome: 'denied', correlationId, now: () => now(), uuid: () => crypto.randomUUID(),
          detail: { missing: e?.detail?.missing ?? [], required, action: 'run' },
        }),
        at: nowIso(now()), action: 'run', outcome: 'denied',
      })
      throw e
    }

    const started = now()
    const execId = crypto.randomUUID()
    // ---- Event WAJIB sebelum tindakan berisiko: gagal-tutup bila audit tak bisa ditulis ----
    await audit.appendCritical({
      ...buildEvent({
        eventType: EVENT_TYPES.TOOL_EXECUTION_STARTED, capabilityId: entry.id, missionId, taskId, execId, actor,
        outcome: 'requested', correlationId, now: () => now(), uuid: () => crypto.randomUUID(),
        detail: { sideEffects: entry.sideEffects, required, granted: [...granted], args: redact(args) },
      }),
      at: nowIso(started), action: 'run', outcome: 'requested', execId, durationMs: 0, sideEffects: entry.sideEffects, confirm: Boolean(confirm), args: redact(args),
    })

    let ok = false
    let result = null
    let error = null
    try {
      if (entry.kind === 'mcp_tool') {
        const tool = mcpTools.find((t) => t.name === entry.meta.tool)
        if (!tool) throw new CapabilityError(404, 'tool_missing', 'Tool MCP lokal tidak ditemukan.')
        if (tool.name === 'kb_search' && !String(args.query ?? '').trim()) throw new CapabilityError(400, 'missing_args', 'kb_search membutuhkan argumen query.')
        result = safeResult(await withTimeout(tool.run(args), runTimeoutMs, 'Tool MCP melewati batas waktu.'))
        ok = true
      } else if (entry.kind === 'plugin') {
        if (!entry.meta.enabled) throw new CapabilityError(409, 'plugin_disabled', 'Plugin belum diaktifkan.')
        result = safeResult(await withTimeout(plugins.runTool(entry.meta.pluginId, args), runTimeoutMs, 'Plugin melewati batas waktu.'))
        ok = true
      } else if (entry.kind === 'connector') {
        if (!entry.meta.live) throw new CapabilityError(409, 'not_implemented', 'Connector ini belum memiliki implementasi live.')
        const out = await withTimeout(connectors.test(entry.meta.connectorId), runTimeoutMs, 'Connector melewati batas waktu.')
        result = safeResult(out)
        ok = Boolean(out?.ok)
        if (!ok) error = out?.error ?? 'Tes connector gagal.'
      } else {
        throw new CapabilityError(409, 'not_runnable', 'Tidak ada adapter eksekusi untuk jenis ini.')
      }
    } catch (e) {
      error = String(e?.message ?? e).slice(0, 500)
      if (e instanceof CapabilityError && e.code !== 'timeout') throw e
      if (e?.status && e.status < 500) throw e
    }
    const at = now()
    await loadState()
    const prev = state.items[entry.id] ?? {}
    state.items[entry.id] = {
      ...prev,
      lastExecution: {
        at,
        ok,
        durationMs: at - started,
        action: entry.kind,
        error: error ?? null,
        args: redact(args),
        resultPreview: result == null ? null : truncate(redact(result), 300),
      },
    }
    await persistState()
    // Event unified + field legacy agar konsumen lama (UI & tes) tetap membaca.
    await audit.append({
      ...buildEvent({
        eventType: ok ? EVENT_TYPES.TOOL_EXECUTION_SUCCEEDED : EVENT_TYPES.TOOL_EXECUTION_FAILED,
        capabilityId: entry.id, missionId, taskId, execId, actor, outcome: ok ? 'succeeded' : 'failed',
        correlationId, now: () => now(), uuid: () => crypto.randomUUID(),
        detail: { durationMs: at - started, sideEffects: entry.sideEffects, confirm: Boolean(confirm), args: redact(args), error: error ?? null },
      }),
      at: nowIso(at),
      capabilityId: entry.id,
      action: 'run',
      outcome: ok ? 'succeeded' : 'failed',
      actor: truncate(String(actor), 80),
      durationMs: at - started,
      sideEffects: entry.sideEffects,
      confirm: Boolean(confirm),
      args: redact(args),
      error: error ?? null,
    })
    return {
      capability: await get(entry.id),
      ok,
      result,
      error,
      durationMs: at - started,
      at,
    }
  }

  async function auditTrail({ limit = 50, missionId = null, eventType = null, correlationId = null } = {}) {
    return audit.read({ limit, missionId, eventType, correlationId })
  }

  return { list, get, validate, run, audit: auditTrail, sourceLabels: SOURCE_LABELS, categoryLabels: CATEGORY_LABELS, externalReferences: EXTERNAL_REFERENCES }
}

function withTimeout(promise, ms, message) {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CapabilityError(504, 'timeout', message)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
