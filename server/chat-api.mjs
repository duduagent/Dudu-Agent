import { capabilitiesOf } from './config.mjs'
import { isFileId } from './files.mjs'
import { DuduError } from './errors.mjs'
// Logika API chat yang tidak bergantung pada transport.
// Dipakai oleh server HTTP development (chat-server.mjs) dan oleh proses utama Electron.
//
// Dua jalur LLM (satu gateway, dua konfigurasi):
//  - Jalur GATEWAY (utama): semua routing/kebijakan/budget/pencatatan di server/gateway.mjs.
//    Dipakai bila services.gateway diberikan — termasuk provider "env" (dudu.env).
//  - Jalur legacy langsung (DUDU_*) hanya untuk kasus visi yang diset eksplisit lewat env,
//    agar perilaku visi yang sudah teruji tetap identik. TANPA routing menimpa itu.

export const MAX_BODY_BYTES = 256_000
const ROLES = ['system', 'user', 'assistant']

const reply = (status, body) => ({ status, body })

/**
 * @param {ReturnType<import('./config.mjs').resolveConfig>} config
 * @param {typeof fetch} [fetchImpl]
 */
const PER_FILE_CHARS = 15_000
const TOTAL_ATTACH_CHARS = 40_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function createChatApi(config, fetchImpl = globalThis.fetch, services = {}) {
  const log = (...a) => console.error(...a)
  const { files, kb, gateway, skills } = services
  const caps = capabilitiesOf(config)
  /** Vision lewat gateway dihitung per-request (katalog bisa berubah). */
  let thisVisionViaGateway = false

  async function transcribe(meta, bytes, signal) {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: meta.mime }), meta.name)
    form.append('model', config.sttModel)
    const res = await fetchImpl(`${config.sttBaseUrl}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${config.sttApiKey}` }, body: form, signal })
    const data = JSON.parse(await res.text())
    if (!res.ok) throw new Error(data?.error?.message || `STT HTTP ${res.status}`)
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Transkripsi kosong.')
    return data.text
  }

  /** Bangun blok teks / bagian gambar dari lampiran. Setiap lampiran menghasilkan laporan jujur used/reason. */
  async function resolveAttachments(ids, budget, signal, visionConfigured) {
    const reports = [], blocks = [], images = []
    for (const id of ids) {
      const meta = isFileId(id) && files ? await files.get(id) : null
      if (!meta) { reports.push({ id, name: '(tidak ditemukan)', used: false, reason: 'File tidak ditemukan (mungkin sudah dihapus).' }); blocks.push(`[Lampiran tidak ditemukan; jangan berpura-pura mengetahui isinya.]`); continue }
      const rep = { id, name: meta.name, category: meta.category, used: false }
      try {
        if (meta.category === 'image') {
          if (meta.kind === 'svg') rep.reason = 'SVG tidak dikirim ke model gambar.'
          else if (!visionConfigured) rep.reason = 'Model vision belum dikonfigurasi (DUDU_VISION_MODEL atau model berkemampuan gambar di gateway).'
          else if (meta.size > MAX_IMAGE_BYTES) rep.reason = 'Gambar lebih dari 8 MB.'
          else { const b = await files.readBytes(id); images.push(`data:${meta.mime};base64,${b.toString('base64')}`); rep.used = true; rep.via = 'vision' }
        } else {
          let text = await files.readText(id)
          if (text == null && meta.category === 'audio' && caps.stt.configured) {
            text = await transcribe(meta, await files.readBytes(id), signal)
            await files.setExtractedText(id, text, `stt:${config.sttModel}`, 'Transkripsi otomatis.')
            rep.via = 'stt'
          }
          if (text == null) rep.reason = meta.extraction?.note || 'Isi file tidak dapat dibaca.' // teks hanya ada bila ekstraksi/transkripsi benar-benar berhasil
          else {
            const room = Math.max(0, Math.min(PER_FILE_CHARS, budget.left))
            const piece = text.slice(0, room)
            budget.left -= piece.length
            rep.used = piece.length > 0; rep.chars = piece.length; rep.truncated = piece.length < text.length
            if (!rep.used) rep.reason = 'Batas konteks lampiran habis.'
            else blocks.push(`[Lampiran: ${meta.name}${rep.truncated ? ` — dipotong ${piece.length}/${text.length} karakter` : ''}]\n${piece}\n[Akhir lampiran: ${meta.name}]`)
          }
        }
      } catch (e) { rep.used = false; rep.reason = `Gagal memproses lampiran: ${String(e?.message || e).slice(0, 160)}` }
      if (!rep.used) blocks.push(`[Lampiran "${meta.name}" TIDAK dapat dibaca: ${rep.reason} Jangan berpura-pura mengetahui isinya.]`)
      reports.push(rep)
    }
    return { reports, blocks, images }
  }

  /**
   * @param {{ method: string, path: string, contentType?: string|null, body?: string, signal?: AbortSignal }} req
   * @returns {Promise<{status:number, body:object}>}
   */
  async function handle(req) {
    const path = String(req.path || '').split('?')[0]
    const method = String(req.method || 'GET').toUpperCase()

    if (method === 'GET' && path === '/api/health') {
      let configured = Boolean(config.apiKey), model = config.model
      if (gateway) {
        // Gateway: cukup satu provider aktif (env dihitung di atas) agar chat dapat dijalankan.
        try {
          const { entries } = await gateway.effectiveCatalogEntries()
          if (entries.length > 0) configured = true
          const autoVision = entries.some((e) => e.capabilities?.vision === true)
          if (autoVision) model = `${model} (auto-routing aktif)`
        } catch { /* katalog tidak tersedukt: biarkan env-only */ }
      }
      return reply(200, { configured, model })
    }
    if (method !== 'POST' || path !== '/api/chat') return reply(404, { error: 'not_found' })

    // Wajib application/json: memaksa preflight CORS pada halaman web lain sehingga
    // situs pihak ketiga tidak dapat memakai kunci API pengguna lewat request "sederhana".
    if (!/^application\/json\b/i.test(req.contentType || '')) {
      return reply(415, { error: 'unsupported_media_type' })
    }
    const raw = req.body ?? ''
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return reply(413, { error: 'request_too_large' })

    if (!config.apiKey) {
      // Gateway: provider gateway yang aktif cukup untuk menjalankan chat — env DUDU_* bukan syarat mutlak lagi.
      // Tanpa gateway (atau tanpa satu pun provider aktif): tetap 501 dengan pesan yang benar.
      let gatewayReady = false
      if (gateway) {
        try { gatewayReady = (await gateway.effectiveCatalogEntries()).entries.length > 0 } catch { /* katalog gagal: jangan anggap siap */ }
      }
      if (!gatewayReady) {
        return reply(501, {
          error: 'provider_not_configured',
          message: 'Belum ada provider AI aktif. Isi kunci provider di Pengaturan → Gateway AI, atau set DUDU_PROVIDER_API_KEY.',
        })
      }
    }

    let messages, useKnowledge = false, conversationId = null, mode, modelRef = null
    try {
      ({ messages, useKnowledge = false, conversationId = null, mode = undefined, modelRef = null } = JSON.parse(raw))
      if (conversationId != null && typeof conversationId !== 'string') conversationId = null
      if (mode != null && typeof mode !== 'string') mode = undefined
      if (modelRef !== null && (typeof modelRef !== 'object' || modelRef === null)) modelRef = null
      if (modelRef !== null && (modelRef.providerId == null || modelRef.modelId == null)) modelRef = null
    } catch {
      return reply(400, { error: 'bad_json' })
    }
    if (
      !Array.isArray(messages) || messages.length === 0 ||
      !messages.every((m) => m && typeof m.role === 'string' && ROLES.includes(m.role) &&
        (m.fileIds === undefined || (Array.isArray(m.fileIds) && m.fileIds.length <= 8 && m.fileIds.every((x) => typeof x === 'string'))))
    ) {
      return reply(400, { error: 'bad_request' })
    }
    // Vision lewat gateway: aktif hanya bila ada model metadata-vision=true di katalog provider aktif.
    thisVisionViaGateway = false
    if (gateway) {
      try {
        const { entries } = await gateway.effectiveCatalogEntries()
        thisVisionViaGateway = entries.some((e) => e?.capabilities?.vision === true && e.providerId !== 'env')
      } catch { /* katalog gagal: jangan anggap vision tersedia */ }
    }

    const timeoutSignal = AbortSignal.timeout(config.timeoutMs)
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal

    // 1) Lampiran: isi file benar-benar dimasukkan ke permintaan (atau dilaporkan jujur bila tidak bisa).
    // Anggaran dialokasikan dari pesan TERBARU ke yang lama: lampiran giliran ini harus selalu mendapat jatah.
    const budget = { left: TOTAL_ATTACH_CHARS }
    let anyImage = false
    const built = new Array(messages.length)
    const reportsByMsg = new Array(messages.length).fill(null)
    const visionConfigured = caps.vision.configured || thisVisionViaGateway
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      let content = String(m.content ?? '').slice(0, 32_000)
      if (m.role === 'user' && m.fileIds?.length) {
        const r = await resolveAttachments(m.fileIds, budget, signal, visionConfigured)
        reportsByMsg[i] = r.reports
        if (r.blocks.length) content += `\n\n${r.blocks.join('\n\n')}`
        if (r.images.length) { anyImage = true; built[i] = { role: m.role, content: [{ type: 'text', text: content }, ...r.images.map((url) => ({ type: 'image_url', image_url: { url } }))] }; continue }
      }
      built[i] = { role: m.role, content }
    }
    const upstreamMessages = built
    const attachmentReports = reportsByMsg.flatMap((r) => r ?? [])

    // 2) Knowledge Base: retrieval nyata; sumber dikembalikan ke UI hanya bila benar-benar disertakan.
    let sources
    if (useKnowledge === true && kb) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      const hits = lastUser ? await kb.search(String(lastUser.content ?? ''), { limit: 4 }) : []
      sources = hits.map((h, i) => ({ n: i + 1, fileId: h.fileId, name: h.name, loc: h.loc, score: h.score }))
      const ctx = hits.length
        ? 'Konteks dari Knowledge Base pengguna (retrieval kata-kunci, bukan semantik). Gunakan hanya bila relevan dan sebutkan sumbernya dengan [S1], [S2], dst. Jika konteks tidak menjawab pertanyaan, katakan demikian.\n\n' +
          hits.map((h, i) => `[S${i + 1}] ${h.name}${h.loc ? ` (${h.loc})` : ''}:\n${h.text}`).join('\n\n')
        : 'Knowledge Base dicari tetapi tidak ada bagian yang cocok dengan pertanyaan. Jangan mengarang sumber atau mengaku mengutip dokumen pengguna.'
      const at = upstreamMessages.findIndex((x) => x.role !== 'system')
      upstreamMessages.splice(at < 0 ? upstreamMessages.length : at, 0, { role: 'system', content: ctx })
    }

    // 2b) Skill kustom yang diaktifkan pengguna: instruksi tambahan (maks 5, hemat token).
    if (skills) {
      try {
        const active = await skills.instructions()
        if (active.length) {
          const ctx = 'Skill kustom yang diaktifkan pengguna. Patuhi bila relevan; jangan mengaku mampu di luar kemampuannya.\n\n' +
            active.map((s) => `[${s.name}]\n${s.instruction}`).join('\n\n')
          const at = upstreamMessages.findIndex((x) => x.role !== 'system')
          upstreamMessages.splice(at < 0 ? upstreamMessages.length : at, 0, { role: 'system', content: ctx })
        }
      } catch { /* skill gagal dimuat: chat tetap berjalan tanpa instruksi tambahan */ }
    }

    const useVision = anyImage && caps.vision.configured
    const requestModel = useVision ? config.visionModel : config.model
    const baseUrl = useVision ? config.visionBaseUrl : config.baseUrl
    const apiKey = useVision ? config.visionApiKey : config.apiKey
    const payload = JSON.stringify({ model: requestModel, messages: upstreamMessages })

    // 3) JALUR GATEWAY (utama) — routing, kebijakan, budget, fallback, pencatatan usage.
    // Visi lewat env eksplisit memakai jalur legacy di bawah agar perilaku yang sudah teruji tetap identik.
    if (gateway && !(anyImage && caps.vision.configured)) {
      try {
        const gw = await gateway.complete({
          messages: upstreamMessages,
          requiresVision: anyImage,
          purpose: 'chat',
          conversationId,
          mode,
          manualSelection: mode === 'MANUAL' && modelRef ? { providerId: modelRef.providerId, modelId: modelRef.modelId } : null,
          signal,
          // maxTokens di-biarkan undefined: gateway menetapkan batas default per kategori tugas (Token Economy batas output).
        })
        return reply(200, {
          content: gw.content,
          model: gw.model,
          ...(attachmentReports.length ? { attachments: attachmentReports } : {}),
          ...(sources ? { sources } : {}),
          route: gw.route,
          usage: gw.usage,
          cost: gw.cost,
        })
      } catch (error) {
        if (req.signal?.aborted) return reply(499, { error: 'client_closed_request' })
        if (error instanceof DuduError) {
          log(`[chat] gateway: ${error.code}: ${String(error.message).slice(0, 200)}`)
          return reply(error.status, { error: error.code, message: error.message, ...(error.route ? { route: error.route } : {}) })
        }
        log(`[chat] gateway gagal: ${error?.name || 'Error'}: ${String(error?.message || error).slice(0, 200)}`)
        return reply(502, { error: 'upstream_error', message: 'Gateway routing gagal.' })
      }
    }

    // 4) JALUR LEGACY (env vision eksplisit) — tanpa routing.
    try {
      const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: payload,
        signal,
      })
      const text = await upstream.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        log(`[chat] invalid JSON from provider; status=${upstream.status}`)
        return reply(502, { error: 'bad_upstream_response', status: upstream.status, details: 'Provider returned a non-JSON response.' })
      }
      if (!upstream.ok) {
        const details = data?.error?.message || data?.message || 'Provider request failed.'
        log(`[chat] upstream error status=${upstream.status}: ${details}`)
        return reply(502, { error: 'upstream_error', status: upstream.status, details })
      }
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        log('[chat] provider response missing choices[0].message.content')
        return reply(502, { error: 'bad_upstream_response', status: upstream.status, details: 'The provider response did not contain text content.' })
      }
      return reply(200, {
        content,
        model: typeof data.model === 'string' ? data.model : requestModel,
        ...(attachmentReports.length ? { attachments: attachmentReports } : {}),
        ...(sources ? { sources } : {}),
      })
    } catch (error) {
      if (req.signal?.aborted) return reply(499, { error: 'client_closed_request' })
      const timedOut = error?.name === 'TimeoutError'
      log(`[chat] request failed: ${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`)
      return reply(timedOut ? 504 : 502, {
        error: timedOut ? 'provider_timeout' : 'provider_connection_failed',
        message: timedOut ? 'The provider took too long to respond.' : 'Could not get a valid response from the provider.',
      })
    }
  }

  return { handle }
}
