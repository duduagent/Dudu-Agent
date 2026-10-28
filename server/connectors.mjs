// Connector Dudu — integrasi pihak ketiga, dengan kejujuran penuh:
// - webhook: SATU-SATUNYA connector yang benar-benar dieksekusi (POST JSON ke URL milik pengguna,
//   header X-Dudu-Secret bila diisi). Diuji langsung saat tombol "Uji" ditekan.
// - lainnya (email, kalender, repo): hanya kerangka konfigurasi; status "belum ada integrasi live"
//   sampai implementasinya benar-benar ditulis — tidak ada tombol yang berpura-pura berhasil.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const CONFIGURABLE = [
  { id: 'webhook', label: 'Webhook', category: 'Otomasi', description: 'Kirim kejadian Dudu (mis. ringkasan chat, selesainya misi) ke URL apa pun — n8n, Make, server sendiri.', fields: ['url', 'secret'], live: true, access: 'write', docs: null },
  { id: 'email_smtp', label: 'Email (SMTP kirim saja)', category: 'Komunikasi', description: 'Kerangka konfigurasi (host, port, pengirim). Belum ada implementasi kirim live.', fields: ['host', 'port', 'user', 'from'], live: false, access: 'write', docs: null },
  { id: 'github_repo', label: 'Repo GitHub (baca saja)', category: 'Pengembangan', description: 'Kerangka konfigurasi (owner/repo, token PAT). Belum ada implementasi ambil live.', fields: ['owner', 'repo', 'token'], live: false, access: 'read', docs: null },
]

export class ConnectorError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

function mask(s) { return typeof s === 'string' && s.length > 8 ? `${s.slice(0, 4)}…` : (s ? '…' : null) }

export function createConnectorStore({ dataDir, fetchImpl = globalThis.fetch }) {
  const file = path.join(dataDir, 'connectors.json')
  let cache = null
  async function load() {
    if (cache) return cache
    try { cache = JSON.parse(await fs.readFile(file, 'utf8')) } catch {}
    cache = (cache && cache.version === 1 && typeof cache.configs === 'object') ? cache : { version: 1, configs: {} }
    return cache
  }
  const persist = () => {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    return fs.writeFile(tmp, JSON.stringify(cache, null, 1), 'utf8').then(() => fs.rename(tmp, file))
  }

  async function list() {
    const st = await load()
    return CONFIGURABLE.map((c) => {
      const cfg = st.configs[c.id]
      const fields = Object.fromEntries(Object.entries(cfg?.fields ?? {}).map(([k, v]) => {
        const secret = /secret|token|pass/i.test(k)
        return [k, { set: Boolean(v), value: secret ? mask(v) : (secret ? null : String(v ?? '').slice(0, 120) || null) }]
      }))
      const filled = c.fields.every((f) => Boolean(cfg?.fields?.[f]))
      return { id: c.id, label: c.label, category: c.category ?? 'Umum', access: c.access ?? 'write', description: c.description, live: c.live, requiredFields: c.fields, fields, configured: filled, lastTest: cfg?.lastTest ?? null, docs: c.docs ?? null }
    })
  }

  async function save(id, fields) {
    const def = CONFIGURABLE.find((c) => c.id === id)
    if (!def) throw new ConnectorError(400, 'bad_connector', `Connector tidak dikenal: ${id}.`)
    const st = await load()
    const clean = {}
    for (const f of def.fields) {
      const v = fields?.[f]
      if (v == null || v === '') continue
      if (typeof v !== 'string') throw new ConnectorError(400, 'bad_field', `Nilai ${f} harus berupa teks.`)
      clean[f] = v.slice(0, 2000)
    }
    st.configs[id] = { fields: clean, lastTest: st.configs[id]?.lastTest ?? null }
    await persist()
    return { id, configured: def.fields.every((f) => Boolean(clean[f])) }
  }

  async function remove(id) {
    const st = await load()
    if (!st.configs[id]) return false
    delete st.configs[id]; await persist(); return true
  }

  /** Eksekusi NYATA, hanya untuk connector bertanda live=true. */
  async function test(id) {
    const def = CONFIGURABLE.find((c) => c.id === id)
    if (!def) throw new ConnectorError(400, 'bad_connector', `Connector tidak dikenal: ${id}.`)
    if (!def.live) throw new ConnectorError(409, 'not_implemented', `Connector ${def.label} belum memiliki implementasi live — kejujuran dulu: tidak ada yang diuji, tidak ada yang dikarang.`)
    const st = await load()
    const cfg = st.configs[id]
    const url = cfg?.fields?.url
    if (!url) throw new ConnectorError(409, 'not_configured', 'URL webhook belum diisi.')
    let parsed
    try { parsed = new URL(url) } catch { throw new ConnectorError(400, 'bad_url', 'URL tidak valid.') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new ConnectorError(400, 'bad_url', 'URL harus http/https.')
    const payload = { event: 'dudu.connector.test', connector: 'webhook', at: new Date().toISOString(), note: 'Tes koneksi dari Dudu AI' }
    const headers = { 'content-type': 'application/json', 'user-agent': 'DuduAI/0.4' }
    if (cfg.fields.secret) headers['x-dudu-secret'] = cfg.fields.secret
    const started = Date.now()
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(payload) })
      const out = { at: Date.now(), ok: res.ok, status: res.status, ms: Date.now() - started, error: res.ok ? null : `HTTP ${res.status} dari tujuan.` }
      cfg.lastTest = out; await persist(); return out
    } catch (e) {
      const out = { at: Date.now(), ok: false, status: null, ms: Date.now() - started, error: e.message }
      cfg.lastTest = out; await persist(); return out
    }
  }

  /** Kirim event nyata (dipakai modul lain bila webhook terpasang). */
  async function emit(event, data = {}) {
    const st = await load()
    const url = st.configs.webhook?.fields?.url
    if (!url) return { delivered: false, reason: 'not_configured' }
    try {
      const headers = { 'content-type': 'application/json', 'user-agent': 'DuduAI/0.4' }
      if (st.configs.webhook?.fields?.secret) headers['x-dudu-secret'] = st.configs.webhook.fields.secret
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ event, data, at: new Date().toISOString() }) })
      return { delivered: res.ok, status: res.status }
    } catch (e) { return { delivered: false, reason: e.message } }
  }

  return { list, save, remove, test, emit }
}
