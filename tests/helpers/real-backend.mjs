// Menghubungkan UI (jsdom) ke server NYATA (createApi) lewat fetch/XMLHttpRequest palsu.
// Yang dipalsukan hanya provider model eksternal; perekamannya memungkinkan pemeriksaan payload sebenarnya.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../../server/api.mjs'
import { resolveConfig } from '../../server/config.mjs'

const toBuffer = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader(); fr.onload = () => resolve(Buffer.from(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(file)
})

// jsdom menimpa AbortSignal global dengan versi tanpa any(); produksi (Node ≥20.3 / Electron) memilikinya.
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any !== 'function') {
  AbortSignal.any = (signals) => {
    const ac = new AbortController()
    for (const sig of signals) { if (sig.aborted) { ac.abort(); break } sig.addEventListener('abort', () => ac.abort(), { once: true }) }
    return ac.signal
  }
}

export async function installBackend({ env = {}, reply = () => 'balasan model' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-ui-'))
  const upstream = []
  const state = { silentProgress: false, down: false, hold: false, pending: [], xhrs: [], fetchCalls: [], rawFetch: null }
  const api = createApi({
    getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k', ...env }), dataDir: dir,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body); upstream.push({ url, body })
      return { ok: true, status: 200, text: async () => JSON.stringify({ model: body.model, choices: [{ message: { content: reply(body) } }] }) }
    },
  })

  const call = async (path, init = {}) => {
    state.fetchCalls.push({ path, method: init.method ?? 'GET', headers: init.headers ?? {} })
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    // jsdom punya AbortSignal sendiri yang ditolak AbortSignal.any() milik Node: jembatani lewat AbortController Node.
    const ac = new AbortController()
    if (init.signal) { if (init.signal.aborted) ac.abort(); else init.signal.addEventListener('abort', () => ac.abort(), { once: true }) }
    const r = await api.handle({ method: init.method ?? 'GET', path, headers, contentType: headers['content-type'], body: init.body ?? '', signal: ac.signal })
    if (r.raw) return new Response(r.raw, { status: r.status, headers: r.headers })
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }
  const origFetch = globalThis.fetch, origXhr = globalThis.XMLHttpRequest
  globalThis.fetch = (input, init) => { if (state.down) return Promise.reject(new TypeError('Failed to fetch')); if (state.rawFetch) return state.rawFetch(input, init); return call(String(input), init) }

  globalThis.XMLHttpRequest = class FakeXhr {
    constructor() { this.upload = {}; this.headers = {}; this.status = 0; this.responseText = ''; this.aborted = false; state.xhrs.push(this) }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(k, v) { this.headers[k] = v }
    abort() { this.aborted = true; this.onabort?.() }
    send(file) {
      const finish = async () => {
        if (this.aborted) return
        const bytes = await toBuffer(file)
        const r = await api.handle({ method: this.method, path: this.url, headers: Object.fromEntries(Object.entries(this.headers).map(([k, v]) => [k.toLowerCase(), v])), bytes })
        if (this.aborted) return
        if (!state.silentProgress) this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size })
        this.status = r.status; this.responseText = JSON.stringify(r.body); this.onload?.()
      }
      if (state.hold) { if (!state.silentProgress) this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); state.pending.push(finish) } else void finish()
    }
  }
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:fake'
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}

  return {
    api, dir, upstream, state,
    releaseUploads: async () => { state.hold = false; const p = state.pending.splice(0); await Promise.all(p.map((f) => f())) },
    async seedFile(name, bytes) { return (await api.files.save({ name, bytes })) },
    async cleanup() { globalThis.fetch = origFetch; globalThis.XMLHttpRequest = origXhr; await new Promise((r) => setTimeout(r, 30)); await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) },
  }
}
