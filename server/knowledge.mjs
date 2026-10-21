// Knowledge Base: ingest → chunk → indeks persisten → retrieval leksikal BM25 dengan sumber.
// BATASAN JUJUR: ini retrieval leksikal (kecocokan kata), BUKAN semantik/embedding.
import fs from 'node:fs/promises'
import path from 'node:path'
import { isFileId } from './files.mjs'

export const CHUNK_SIZE = 1000
export const CHUNK_OVERLAP = 150
const STOP = new Set(('yang dan di ke dari untuk dengan pada adalah itu ini atau juga akan sudah saya kamu kami dia mereka ada tidak bisa apa siapa bagaimana ' +
  'the a an and or of to in on for with is are was were be this that it as at by from not what who how').split(' '))

export function tokenize(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 && !STOP.has(t))
}

/** Pecah teks menjadi chunk ≤ CHUNK_SIZE dengan overlap; menjaga label lokasi (halaman/slide/sheet). */
export function chunkText(text) {
  const chunks = []
  let loc = null
  let carry = '' // ekor chunk sebelumnya (overlap), hanya di dalam lokasi yang sama
  let buf = ''   // konten baru
  const flush = () => {
    if (!buf.trim()) { buf = ''; return }
    const full = (carry ? carry + '\n' : '') + buf.trim()
    chunks.push({ loc, text: full })
    carry = full.length > CHUNK_OVERLAP ? full.slice(-CHUNK_OVERLAP) : ''
    buf = ''
  }
  const room = () => CHUNK_SIZE - (carry ? carry.length + 1 : 0)
  const push = (piece) => {
    while (piece.length > room()) {
      const take = Math.max(room() - buf.length, 200)
      buf += (buf ? '\n' : '') + piece.slice(0, take); piece = piece.slice(take); flush()
    }
    if (buf.length + piece.length + 1 > room()) flush()
    buf += (buf ? '\n' : '') + piece
  }
  for (const para of String(text).split(/\n{2,}|\n(?=\[(?:Halaman|Slide) \d+\]|## (?:Sheet|Tabel): )/)) {
    const p = para.trim()
    if (!p) continue
    const marker = /^\[(Halaman|Slide) (\d+)\]\s*/.exec(p)
    const sheet = /^## (Sheet|Tabel): (.+)\n?/.exec(p)
    if (marker || sheet) {
      flush(); carry = ''
      loc = marker ? `${marker[1] === 'Halaman' ? 'hal.' : 'slide'} ${marker[2]}` : `${sheet[1].toLowerCase()} ${sheet[2].trim()}`
      const rest = p.slice((marker || sheet)[0].length).trim()
      if (rest) push(rest)
    } else push(p)
  }
  flush()
  return chunks
}

export function createKnowledgeBase({ dataDir, files }) {
  const file = path.join(dataDir, 'kb', 'index.json')
  let state = null // { docs: {fileId: {name, indexedAt, chunks}}, chunks: [{id,fileId,ord,loc,text}] }
  let tokens = new Map() // chunk.id -> string[]
  let queue = Promise.resolve()

  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run }

  async function load() {
    if (state) return state
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      const chunks = Array.isArray(raw?.chunks) ? raw.chunks.filter((c) => c && isFileId(c.fileId) && typeof c.text === 'string' && typeof c.id === 'string') : []
      const docs = {}
      for (const [id, d] of Object.entries(raw?.docs && typeof raw.docs === 'object' ? raw.docs : {})) if (isFileId(id) && d && typeof d.name === 'string') docs[id] = d
      state = { docs, chunks: chunks.filter((c) => docs[c.fileId]) }
    } catch { state = { docs: {}, chunks: [] } } // indeks hilang/rusak → mulai kosong (dapat dibangun ulang)
    tokens = new Map(state.chunks.map((c) => [c.id, tokenize(c.text)]))
    return state
  }
  async function persist() {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 })
    await fs.rename(tmp, file)
  }

  const dropFile = (fileId) => {
    for (const c of state.chunks) if (c.fileId === fileId) tokens.delete(c.id)
    state.chunks = state.chunks.filter((c) => c.fileId !== fileId)
    delete state.docs[fileId]
  }

  const indexFile = (fileId) => serial(async () => {
    await load()
    const meta = await files.get(fileId)
    if (!meta) throw Object.assign(new Error('File tidak ditemukan.'), { status: 404, code: 'not_found' })
    if (meta.extraction?.state !== 'extracted') throw Object.assign(new Error(meta.extraction?.note || 'File ini tidak memiliki teks yang dapat diindeks.'), { status: 422, code: 'not_indexable' })
    const text = await files.readText(fileId)
    if (!text || !text.trim()) throw Object.assign(new Error('Teks hasil ekstraksi kosong.'), { status: 422, code: 'not_indexable' })
    const pieces = chunkText(text)
    if (!pieces.length) throw Object.assign(new Error('Tidak ada konten yang dapat diindeks.'), { status: 422, code: 'not_indexable' })
    dropFile(fileId) // reindeks idempoten
    pieces.forEach((p, i) => {
      const c = { id: `${fileId}:${i}`, fileId, ord: i, loc: p.loc, text: p.text }
      state.chunks.push(c); tokens.set(c.id, tokenize(c.text))
    })
    state.docs[fileId] = { name: meta.name, indexedAt: Date.now(), chunks: pieces.length, sha256: meta.sha256 }
    await persist()
    return { fileId, name: meta.name, chunks: pieces.length }
  })

  const removeFile = (fileId) => serial(async () => {
    await load()
    if (!state.docs[fileId]) return false
    dropFile(fileId); await persist(); return true
  })

  async function stats() {
    await load()
    // sinkronisasi: dokumen yang file-nya sudah hilang dilaporkan sebagai stale
    const docs = await Promise.all(Object.entries(state.docs).map(async ([fileId, d]) => ({ fileId, ...d, missing: !(await files.get(fileId)) })))
    return { docs: docs.sort((a, b) => b.indexedAt - a.indexedAt), chunks: state.chunks.length, retrieval: 'bm25-lexical', embeddings: false }
  }

  async function search(query, { limit = 5, fileIds } = {}) {
    await load()
    const q = [...new Set(tokenize(query))]
    if (!q.length || !state.chunks.length) return []
    const pool = fileIds ? state.chunks.filter((c) => fileIds.includes(c.fileId)) : state.chunks
    const N = pool.length
    const avg = pool.reduce((n, c) => n + tokens.get(c.id).length, 0) / Math.max(N, 1) || 1
    const df = new Map(q.map((t) => [t, 0]))
    for (const c of pool) { const set = new Set(tokens.get(c.id)); for (const t of q) if (set.has(t)) df.set(t, df.get(t) + 1) }
    const k1 = 1.2, b = 0.75
    const scored = []
    for (const c of pool) {
      const toks = tokens.get(c.id)
      const tf = new Map()
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
      let score = 0
      for (const t of q) {
        const f = tf.get(t); if (!f) continue
        const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5))
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (toks.length / avg))))
      }
      if (score > 0) scored.push({ chunk: c, score })
    }
    scored.sort((a, b2) => b2.score - a.score)
    return scored.slice(0, limit).map(({ chunk, score }) => ({
      fileId: chunk.fileId, name: state.docs[chunk.fileId]?.name ?? '(tidak diketahui)', loc: chunk.loc, score: Math.round(score * 1000) / 1000, text: chunk.text, chunkId: chunk.id,
    }))
  }

  return { indexFile, removeFile, stats, search }
}
