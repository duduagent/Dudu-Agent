// Waiting list — storage lokal untuk pendaftaran minat (landing page publik).
//
// Prinsip:
//  - Data disimpan DI MESIN yang menerima pendaftaran (folder data aplikasi),
//    mode 0600 (POSIX), tulis atomik. Tidak ada service pihak ketiga, tidak ada analytics.
//  - Tidak ada endpoint pembacaan daftar: alamat email tidak pernah dibocorkan lewat API.
//  - Validasi ketat di server (email, platform, role) — validasi di frontend bukan keamanan.
//  - Idempoten per alamat email: pendaftaran ulang tidak menduplikasi entri.
//
// v0.6.4 audit (hardening):
//  - Penulisan diserialisasi (satu operasi baca-ubah-tulis pada satu waktu) → tidak ada
//    balapan berkas tmp/rename dan tidak ada entri yang hilang saat permintaan paralel.
//  - Batas laju global per instance (spam/banjir) + batas jumlah entri.
//  - Berkas rusak diprahkan (bukan dihapus diam-diam) agar data masih bisa dipulihkan.
//  - Penyimpanan & hapus entri (operator) tersedia tanpa menambah endpoint publik.
//
// Tidak menyentuh audit/misi/permission/approval — modul ini berdiri sendiri.
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const FILE = 'waiting-list.json'
const MAX_EMAIL = 254
const MAX_NOTE = 500
/** Batas default: pendaftaran per instance per menit. */
export const DEFAULT_MAX_PER_MINUTE = 60
/** Batas default jumlah entri (proteksi pertumbuhan berkas tak terbatas). */
export const DEFAULT_MAX_ENTRIES = 10_000

/** Platform yang boleh dipilih (harus sama dengan <select> di landing page). */
export const WAITING_LIST_PLATFORMS = Object.freeze(['web', 'windows', 'linux', 'macos', 'android', 'ios'])
/** Peran pengguna (opsional). */
export const WAITING_LIST_ROLES = Object.freeze(['developer', 'startup', 'umkm', 'creator', 'knowledge'])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export class WaitingListError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

/**
 * Buang karakter kontrol; batas panjang ditegakkan server.
 * Diimplementasikan per-kode-char (bukan regex dengan escape) supaya tidak ada
 * jebakan penulisan escape ganda yang bisa merusak teks biasa.
 */
function cleanText(v, max) {
  if (v == null) return ''
  let out = ''
  for (const ch of String(v)) {
    const code = ch.codePointAt(0)
    out += (code < 32 || code === 127) ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function createWaitingListStore({
  dataDir,
  fs = fsp,
  now = () => Date.now(),
  uuid = () => crypto.randomUUID(),
  maxPerMinute = DEFAULT_MAX_PER_MINUTE,
  maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
  const file = path.join(dataDir, FILE)
  let cache = null
  let loaded = false
  let chain = Promise.resolve()   // seluruh operasi baca-ubah-tulis diserialisasi
  let tmpSeq = 0
  const hits = []                // stempel waktu permintaan (untuk batas laju)
  let lastRecovery = null        // info pemulihan berkas rusak (untuk operator)

  /** Jalankan satu operasi setelah operasi sebelumnya selesai (antrian). */
  function serialize(fn) {
    const run = chain.then(fn, fn)  // jalan meski operasi sebelumnya gagal
    chain = run.then(() => {}, () => {})
    return run
  }

  async function readAll() {
    if (loaded) return cache
    let raw = null
    try {
      const text = await fs.readFile(file, 'utf8')
      try {
        raw = JSON.parse(text)
      } catch {
        // Berkas rusak: JAGA (jangan dihapus diam-diam) agar operator bisa memulihkan,
        // lalu mulai daftar baru.
        const keep = path.join(path.dirname(file), `${FILE}.corrupt-${now()}.json`)
        try { await fs.rename(file, keep); lastRecovery = { kept: keep, at: now() } } catch { /* gagal */ }
        raw = null
      }
      if (raw && typeof raw === 'object' && Array.isArray(raw.entries)) { cache = raw; loaded = true; return cache }
    } catch { /* belum ada: wajar */ }
    cache = { version: 1, entries: [] }
    loaded = true
    return cache
  }

  async function persist() {
    if (!cache) return
    try {
      await fs.mkdir(dataDir, { recursive: true })
      // Nama tmp unik per operasi → tidak ada balapan rename antar permintaan paralel.
      const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`
      await fs.writeFile(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 })
      await fs.rename(tmp, file)
      // `writeFile` hanya memakai `mode` saat membuat berkas; berkas yang sudah ada
      // mempertahankan mode lamanya. Chmod eksplisit menjamin 0600 di POSIX.
      // Di Windows mode POSIX tidak berlaku (ACL per-user yang mengatur) — chmod diabaikan.
      try { await fs.chmod(file, 0o600) } catch { /* tidak didukung/ditolak → biarkan */ }
    } catch (e) {
      // Jangan bocorkan path internal/pesan OS ke klien atau log. Pesan untuk operator
      // dibuat eksplisit (izin folder data, ruang disk).
      throw new WaitingListError(503, 'storage_unavailable',
        'Penyimpanan daftar tunggu tidak dapat ditulis. Periksa izin folder data dan ruang disk instance ini.')
    }
  }

  /** Batas laju global per instance (mengickname spam & banjir; per-IP diserahkan ke reverse proxy). */
  function rateExceeded() {
    const cutoff = now() - 60_000
    while (hits.length && hits[0] < cutoff) hits.shift()
    if (hits.length >= maxPerMinute) return true
    hits.push(now())
    return false
  }

  async function addInternal({ email, platform = 'web', role = '', note = '' } = {}) {
    if (rateExceeded()) {
      throw new WaitingListError(429, 'rate_limited', 'Terlalu banyak pendaftaran. Coba lagi sebentar lagi.')
    }
    const mail = cleanText(email, MAX_EMAIL).toLowerCase()
    if (!mail || !EMAIL_RE.test(mail)) {
      throw new WaitingListError(400, 'bad_email', 'Alamat email tidak valid.')
    }
    const plat = cleanText(platform, 20).toLowerCase() || 'web'
    if (!WAITING_LIST_PLATFORMS.includes(plat)) {
      throw new WaitingListError(400, 'bad_platform', 'Platform tidak dikenal.')
    }
    const rol = cleanText(role, 20).toLowerCase()
    if (rol && !WAITING_LIST_ROLES.includes(rol)) {
      throw new WaitingListError(400, 'bad_role', 'Peran tidak dikenal.')
    }
    const noteText = cleanText(note, MAX_NOTE)

    const all = await readAll()
    if (all.entries.length >= maxEntries) {
      throw new WaitingListError(429, 'list_full', 'Daftar tunggu sudah penuh. Silakan hubungi kami lewat kanal lain.')
    }
    const existing = all.entries.find((e) => e.email === mail)
    if (existing) {
      // Pendaftaran ulang: perbarui platform/role/catatan terbaru tanpa menggandakan entri.
      existing.platform = plat
      if (rol) existing.role = rol
      if (noteText) existing.note = noteText
      existing.updatedAt = now()
      await persist()
      return { entry: publicView(existing), created: false }
    }

    const entry = {
      id: uuid(),
      email: mail,
      platform: plat,
      role: rol || null,
      note: noteText || null,
      createdAt: now(),
      updatedAt: now(),
    }
    all.entries.push(entry)
    await persist()
    return { entry: publicView(entry), created: true }
  }

  /**
   * Daftarkan satu minat. Semua operasi diserialisasi → aman untuk permintaan paralel.
   * Mengembalikan { entry, created } — `created: false` bila alamat sudah terdaftar.
   */
  async function add(input) { return serialize(() => addInternal(input)) }

  /** Hapus satu entri (operator; tidak ada endpoint publik untuk ini). */
  async function remove(email) {
    return serialize(async () => {
      const mail = String(email ?? '').trim().toLowerCase()
      if (!mail) return { removed: false }
      const all = await readAll()
      const i = all.entries.findIndex((e) => e.email === mail)
      if (i < 0) return { removed: false }
      all.entries.splice(i, 1)
      await persist()
      return { removed: true }
    })
  }

  /** Bentuk yang aman dikembalikan ke klien (tanpa field internal lain). */
  function publicView(entry) {
    return { id: entry.id, email: entry.email, platform: entry.platform, role: entry.role, createdAt: entry.createdAt }
  }

  /** Ringkasan operator (tidak lewat API publik). */
  async function summary() {
    const all = await readAll()
    return { count: all.entries.length, file, lastRecovery }
  }

  /** Hanya untuk operator lokal (bukan endpoint API publik). */
  async function count() { return (await readAll()).entries.length }

  return { add, remove, count, summary, file }
}
