// Konfigurasi provider: dibaca dari environment dan (opsional) file bergaya .env.
// Tidak ada kredensial yang ditanam di kode. Nilai environment menang atas isi file.

export const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const DEFAULT_MODEL = 'glm-4-flash'

/** Parser .env minimal: KEY=VALUE, komentar #, kutip tunggal/ganda, tanpa ekspansi variabel. */
export function parseEnvFile(text) {
  const out = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]
    if (quoted) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    out[key] = value
  }
  return out
}

/** Gabungkan file (prioritas rendah) dengan env (prioritas tinggi) menjadi konfigurasi final. */
export function resolveConfig(env = {}, fileValues = {}) {
  const get = (k) => {
    const fromEnv = env[k]
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
    const fromFile = fileValues[k]
    return typeof fromFile === 'string' && fromFile.trim() !== '' ? fromFile.trim() : undefined
  }

  /** Baca env per-provider: DUDU_PROVIDER_<ID>_BASE_URL, DUDU_PROVIDER_<ID>_API_KEY, DUDU_PROVIDER_<ID>_MODEL */
  const providerConfigs = {}
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^DUDU_PROVIDER_([A-Z0-9_]+)_(BASE_URL|API_KEY|MODEL)$/)
    if (m && typeof v === 'string' && v.trim() !== '') {
      const id = m[1].toLowerCase().replace(/_/g, '-')
      if (!providerConfigs[id]) providerConfigs[id] = {}
      const field = m[2] === 'BASE_URL' ? 'baseUrl' : m[2] === 'API_KEY' ? 'apiKey' : 'model'
      providerConfigs[id][field] = v.trim()
    }
  }
  // Baca juga dari fileValues
  for (const [k, v] of Object.entries(fileValues)) {
    const m = k.match(/^DUDU_PROVIDER_([A-Z0-9_]+)_(BASE_URL|API_KEY|MODEL)$/)
    if (m && typeof v === 'string' && v.trim() !== '') {
      const id = m[1].toLowerCase().replace(/_/g, '-')
      if (!providerConfigs[id]) providerConfigs[id] = {}
      const field = m[2] === 'BASE_URL' ? 'baseUrl' : m[2] === 'API_KEY' ? 'apiKey' : 'model'
      providerConfigs[id][field] = v.trim()
    }
  }

  const timeout = Number(get('DUDU_TIMEOUT_MS'))
  return {
    // Legacy global (untuk kompatibilitas): hanya dipakai bila TIDAK ADA provider terdaftar yang aktif.
    apiKey: get('DUDU_PROVIDER_API_KEY'),
    baseUrl: (get('DUDU_PROVIDER_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: get('DUDU_MODEL') || DEFAULT_MODEL,
    // Per-provider overrides (lebih spesifik): { providerId: { apiKey, baseUrl, model } }
    providerConfigs,
    port: Number(get('PORT')) || 8787,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : 30_000,
    // Vision / transkripsi: aktif HANYA bila model dikonfigurasi eksplisit (tidak ada tebakan model).
    visionModel: get('DUDU_VISION_MODEL'),
    visionBaseUrl: (get('DUDU_VISION_BASE_URL') || get('DUDU_PROVIDER_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    visionApiKey: get('DUDU_VISION_API_KEY') || get('DUDU_PROVIDER_API_KEY'),
    sttModel: get('DUDU_STT_MODEL'),
    sttBaseUrl: (get('DUDU_STT_BASE_URL') || get('DUDU_PROVIDER_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    sttApiKey: get('DUDU_STT_API_KEY') || get('DUDU_PROVIDER_API_KEY'),
    maxUploadBytes: Math.min(Math.max(Number(get('DUDU_MAX_UPLOAD_MB')) || 25, 1), 200) * 1024 * 1024,
  }
}

/** Laporan kapabilitas yang jujur: 'configured' berarti kredensial+model diatur, BUKAN bahwa layanan sudah terbukti bekerja. */
export function capabilitiesOf(config) {
  return {
    chat: { configured: Boolean(config.apiKey), model: config.model },
    vision: { configured: Boolean(config.visionApiKey && config.visionModel), model: config.visionModel ?? null,
      reason: config.visionModel ? (config.visionApiKey ? null : 'Kunci API belum diatur.') : 'DUDU_VISION_MODEL belum diatur.' },
    stt: { configured: Boolean(config.sttApiKey && config.sttModel), model: config.sttModel ?? null,
      reason: config.sttModel ? (config.sttApiKey ? null : 'Kunci API belum diatur.') : 'DUDU_STT_MODEL belum diatur.' },
    ocr: { available: false, reason: 'OCR belum diimplementasikan.' },
    video: { supported: false, reason: 'Ekstraksi frame/transkripsi video belum diimplementasikan.' },
    embeddings: { configured: false, retrieval: 'bm25-lexical', reason: 'Embedding belum diimplementasikan; retrieval memakai kecocokan kata (BM25).' },
    limits: { maxUploadBytes: config.maxUploadBytes, maxAttachments: 8 },
  }
}

export const ENV_TEMPLATE = `# Konfigurasi provider Dudu AI.
# Isi DUDU_PROVIDER_API_KEY dengan kunci milik Anda sendiri. Jangan bagikan file ini.
# Nilai yang diatur lewat environment variable sistem menimpa nilai di file ini.
# Perubahan berlaku pada permintaan chat berikutnya (tidak perlu memasang ulang aplikasi).

DUDU_PROVIDER_API_KEY=
DUDU_PROVIDER_BASE_URL=${DEFAULT_BASE_URL}
DUDU_MODEL=${DEFAULT_MODEL}

# Opsional — aktifkan HANYA bila provider Anda mendukungnya (tidak ada tebakan otomatis):
# DUDU_VISION_MODEL=            # model yang menerima gambar (format OpenAI image_url)
# DUDU_STT_MODEL=               # model transkripsi audio (endpoint /audio/transcriptions)
`
