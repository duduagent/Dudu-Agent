import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { BLOCKED_EXTS, classify, extOf, extractContent, imageSize, magicOk, sanitizeName } from './extract.mjs'

export const DEFAULT_MAX_UPLOAD = 25 * 1024 * 1024
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class FileError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

export const isFileId = (id) => typeof id === 'string' && ID_RE.test(id)

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, data, { mode: 0o600 })
  await fs.rename(tmp, file)
}

/**
 * Struktur disk: <dataDir>/files/<uuid>/{content.bin, meta.json, text.txt}.
 * Nama dari pengguna hanya disimpan di meta.json (untuk tampilan), tidak pernah menjadi path.
 */
export function createFileStore({ dataDir, maxUploadBytes = DEFAULT_MAX_UPLOAD }) {
  const root = path.join(dataDir, 'files')
  const dirOf = (id) => { if (!isFileId(id)) throw new FileError(400, 'bad_id', 'ID file tidak valid.'); return path.join(root, id) }

  async function readMeta(id) {
    try {
      const m = JSON.parse(await fs.readFile(path.join(dirOf(id), 'meta.json'), 'utf8'))
      return m && m.id === id ? m : null
    } catch (e) { if (e instanceof FileError) throw e; return null }
  }

  async function save({ name, bytes }) {
    const buf = Buffer.from(bytes)
    if (buf.length === 0) throw new FileError(400, 'empty_file', 'File kosong.')
    if (buf.length > maxUploadBytes) throw new FileError(413, 'file_too_large', `File melebihi batas ${Math.round(maxUploadBytes / 1048576)} MB.`)
    const safeName = sanitizeName(name)
    const ext = extOf(safeName)
    if (BLOCKED_EXTS.has(ext)) throw new FileError(415, 'blocked_type', `Tipe file .${ext} diblokir karena dapat dieksekusi.`)
    if (magicOk(ext, buf) === false) throw new FileError(415, 'content_mismatch', `Isi file tidak cocok dengan ekstensi .${ext}.`)

    const cls = classify(safeName, buf)
    const id = crypto.randomUUID()
    const dir = dirOf(id)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      const ex = await extractContent(cls, buf)
      const meta = {
        id, name: safeName, ext: cls.ext, mime: cls.mime, category: cls.category, kind: cls.kind, size: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'), createdAt: Date.now(),
        extraction: { state: ex.state, method: ex.method, pages: ex.pages, chars: ex.text?.length ?? 0, truncated: !!ex.truncated, note: ex.note, warnings: ex.warnings },
      }
      if (cls.category === 'image') { const s = imageSize(buf, cls.ext); if (s) meta.image = s }
      await writeAtomic(path.join(dir, 'content.bin'), buf)
      if (ex.text) await writeAtomic(path.join(dir, 'text.txt'), ex.text)
      await writeAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta))
      return meta
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true }) // jangan tinggalkan setengah-tersimpan
      throw e instanceof FileError ? e : new FileError(500, 'store_failed', 'Gagal menyimpan file.')
    }
  }

  async function list() {
    let ids = []
    try { ids = await fs.readdir(root) } catch { return [] }
    const metas = await Promise.all(ids.filter(isFileId).map(readMeta))
    return metas.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
  }

  const get = (id) => readMeta(id)
  async function readBytes(id) { const m = await readMeta(id); if (!m) return null; return fs.readFile(path.join(dirOf(id), 'content.bin')) }
  async function readText(id) { try { return await fs.readFile(path.join(dirOf(id), 'text.txt'), 'utf8') } catch (e) { if (e instanceof FileError) throw e; return null } }

  /** Simpan hasil transkripsi (audio) sebagai teks ter-ekstrak. */
  async function setExtractedText(id, text, method, note) {
    const m = await readMeta(id)
    if (!m) throw new FileError(404, 'not_found', 'File tidak ditemukan.')
    await writeAtomic(path.join(dirOf(id), 'text.txt'), text)
    m.extraction = { state: 'extracted', method, chars: text.length, truncated: false, note }
    await writeAtomic(path.join(dirOf(id), 'meta.json'), JSON.stringify(m))
    return m
  }

  async function remove(id) {
    const dir = dirOf(id)
    if (!(await readMeta(id))) return false
    await fs.rm(dir, { recursive: true, force: true })
    return true
  }

  return { save, list, get, readBytes, readText, setExtractedText, remove, root }
}

/** Kesiapan untuk dianalisis AI, bergantung pada kapabilitas yang benar-benar terkonfigurasi. */
export function readiness(meta, caps) {
  const st = meta.extraction?.state
  if (meta.category === 'image') {
    if (meta.kind === 'svg') return { ready: false, reason: 'SVG tidak dikirim ke model gambar.' }
    return caps.vision.configured ? { ready: true } : { ready: false, reason: 'Model vision belum dikonfigurasi (DUDU_VISION_MODEL).' }
  }
  if (meta.category === 'audio') return caps.stt.configured || st === 'extracted' ? { ready: true } : { ready: false, reason: 'Layanan transkripsi belum dikonfigurasi (DUDU_STT_MODEL).' }
  if (st === 'extracted') return { ready: true }
  return { ready: false, reason: meta.extraction?.note || 'Isi file tidak dapat dibaca.' }
}
