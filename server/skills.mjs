// Skill Dudu: kemampuan bawaan (nyata, terdaftar apa adanya) + skill kustom buatan pengguna.
// Skill kustom = instruksi tambahan yang ditempelkan ke system prompt chat HANYA bila diaktifkan
// (maksimum 5 skill aktif, tiap instruksi dibatasi 800 karakter agar token tidak membengkak).
// Tidak ada skill "palsu": skill bawaan hanya menunjuk fitur yang benar-benar ada di aplikasi.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const SKILL_CATEGORIES = ['Pengetahuan', 'Dokumen', 'Data & Laporan', 'Integrasi', 'Suara & Gambar', 'Otomasi', 'Umum']
const MAX_ACTIVE = 5
const MAX_INSTRUCTION = 4000
const MAX_ENABLED_CHARS = 800

export const BUILTIN_SKILLS = [
  { id: 'kb-search', name: 'Pencarian Knowledge Base', category: 'Pengetahuan', kind: 'builtin', available: true,
    description: 'Chat mencari otomatis di Knowledge Base (BM25 leksikal) dan menyebut sumber [S1], [S2]. Data dari menu Input Data langsung terbaca.',
    where: 'Otomatis pada setiap chat dengan Knowledge Base aktif.' },
  { id: 'doc-extract', name: 'Ekstraksi Dokumen', category: 'Dokumen', kind: 'builtin', available: true,
    description: 'Membaca PDF teks, DOCX, XLSX, PPTX, ODF, RTF, HTML, CSV/JSON/teks dan mengirim isinya ke model. Tipe yang tak terbaca dinyatakan jujur.',
    where: 'Lampirkan file di composer chat.' },
  { id: 'data-profile', name: 'Profil Data', category: 'Data & Laporan', kind: 'builtin', available: true,
    description: 'Menghitung profil data dari file yang diunggah (kolom, tipe, statistik dasar) lewat tool server, bukan tebakan model.',
    where: 'Tools & Integrations → Status Tools.' },
  { id: 'report-writer', name: 'Penulis Laporan', category: 'Data & Laporan', kind: 'builtin', available: true,
    description: 'Menyusun laporan terstruktur dari hasil analisis dan menyimpannya sebagai artefak yang bisa diunduh.',
    where: 'Tools & Integrations → Status Tools.' },
  { id: 'mission-runner', name: 'Pelaksana Misi', category: 'Otomasi', kind: 'builtin', available: true,
    description: 'Memecah tujuan menjadi langkah misi, menjalankannya, dan mencatat status tiap langkah apa adanya (termasuk yang gagal).',
    where: 'Misi & Tugas.' },
  { id: 'provider-routing', name: 'Routing Multi-Provider', category: 'Integrasi', kind: 'builtin', available: true,
    description: 'Memilih provider/model sesuai tugas (gratis/lokal didahulukan), dengan fallback, anggaran, dan pencatatan token.',
    where: 'Pengaturan → Gateway AI.' },
  { id: 'mcp-tools', name: 'MCP Tools', category: 'Integrasi', kind: 'builtin', available: true,
    description: 'Menjalankan tool MCP lokal (kb_search, kb_stats, file_list) lewat JSON-RPC; server MCP eksternal bisa didaftarkan dan diuji handshake.',
    where: 'Tools & Integrations → MCP.' },
  { id: 'connector-webhook', name: 'Webhook Connector', category: 'Integrasi', kind: 'builtin', available: true,
    description: 'Mengirim event Dudu (JSON + header secret opsional) ke URL webhook milik pengguna. Connector lain masih kerangka, tidak diklaim live.',
    where: 'Tools & Integrations → Connector.' },
  { id: 'cli-access', name: 'CLI dudu', category: 'Otomasi', kind: 'builtin', available: true,
    description: 'Perintah dudu status|chat|kb|usage lewat HTTP ke server lokal, cocok untuk skrip dan otomasi.',
    where: 'Tools & Integrations → CLI.' },
  { id: 'image-vision', name: 'Analisis Gambar', category: 'Suara & Gambar', kind: 'builtin', available: false,
    description: 'Mengirim gambar ke model vision. Butuh provider vision yang dikonfigurasi — tanpa itu statusnya jujur "belum dikonfigurasi".',
    where: 'Pengaturan → Gateway AI (model dengan kemampuan vision).' },
  { id: 'audio-transcribe', name: 'Transkripsi Audio', category: 'Suara & Gambar', kind: 'builtin', available: false,
    description: 'Mentranskripsi audio lewat endpoint STT yang dikonfigurasi (DUDU_STT_*). Tidak ada transkripsi lokal yang dikarang.',
    where: 'Konfigurasi env server (DUDU_STT_*).' },
  { id: 'auth-account', name: 'Akun & OAuth', category: 'Umum', kind: 'builtin', available: true,
    description: 'Daftar/masuk email di perangkat ini, plus OAuth Google/GitHub dengan aplikasi milik Anda sendiri (BYO client ID/secret).',
    where: 'Pengaturan → Akun & Login.' },
]

export class SkillError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

export function createSkillStore({ dataDir }) {
  const file = path.join(dataDir, 'skills.json')
  let cache = null

  async function load() {
    if (cache) return cache
    try { cache = JSON.parse(await fs.readFile(file, 'utf8')) } catch { /* belum ada */ }
    cache = (cache && cache.version === 1 && Array.isArray(cache.skills)) ? cache : { version: 1, skills: [] }
    return cache
  }
  async function persist() {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    await fs.writeFile(tmp, JSON.stringify(cache, null, 1), 'utf8')
    await fs.rename(tmp, file)
  }

  const publicSkill = (s) => ({
    id: s.id, name: s.name, category: s.category, description: s.description,
    instruction: s.instruction, enabled: Boolean(s.enabled), kind: 'custom',
    available: true, createdAt: s.createdAt, updatedAt: s.updatedAt, where: 'Instruksi ditambahkan ke system prompt chat saat aktif.',
  })

  function clean({ name, category, description, instruction }) {
    const n = String(name ?? '').trim()
    if (n.length < 2 || n.length > 60) throw new SkillError(400, 'bad_name', 'Nama skill harus 2–60 karakter.')
    const ins = String(instruction ?? '').trim()
    if (!ins) throw new SkillError(400, 'bad_instruction', 'Instruksi skill tidak boleh kosong.')
    if (ins.length > MAX_INSTRUCTION) throw new SkillError(400, 'instruction_too_long', `Instruksi maksimum ${MAX_INSTRUCTION} karakter.`)
    const cat = SKILL_CATEGORIES.includes(category) ? category : 'Umum'
    return { name: n, category: cat, description: String(description ?? '').trim().slice(0, 300), instruction: ins }
  }

  async function list() {
    const st = await load()
    return { builtin: BUILTIN_SKILLS, custom: st.skills.map(publicSkill), categories: SKILL_CATEGORIES, limits: { maxActive: MAX_ACTIVE, maxInstruction: MAX_INSTRUCTION } }
  }

  async function create(input) {
    const st = await load()
    const base = clean(input ?? {})
    if (st.skills.some((s) => s.name.toLowerCase() === base.name.toLowerCase()))
      throw new SkillError(409, 'name_taken', 'Nama skill sudah dipakai — gunakan nama lain.')
    const now = Date.now()
    const skill = { id: crypto.randomUUID(), ...base, enabled: false, createdAt: now, updatedAt: now }
    st.skills.push(skill); await persist()
    return publicSkill(skill)
  }

  async function update(id, patch) {
    const st = await load()
    const skill = st.skills.find((s) => s.id === id)
    if (!skill) throw new SkillError(404, 'not_found', 'Skill tidak ditemukan.')
    if (patch && patch.enabled != null) skill.enabled = Boolean(patch.enabled)
    if (patch && (patch.name != null || patch.instruction != null || patch.description != null || patch.category != null)) {
      const merged = clean({ name: patch.name ?? skill.name, category: patch.category ?? skill.category, description: patch.description ?? skill.description, instruction: patch.instruction ?? skill.instruction })
      if (st.skills.some((s) => s.id !== id && s.name.toLowerCase() === merged.name.toLowerCase()))
        throw new SkillError(409, 'name_taken', 'Nama skill sudah dipakai — gunakan nama lain.')
      Object.assign(skill, merged)
    }
    if (skill.enabled) {
      const active = st.skills.filter((s) => s.enabled)
      if (active.length > MAX_ACTIVE) { skill.enabled = false; await persist(); throw new SkillError(409, 'too_many_active', `Maksimum ${MAX_ACTIVE} skill aktif agar token tetap hemat.`) }
    }
    skill.updatedAt = Date.now(); await persist()
    return publicSkill(skill)
  }

  async function remove(id) {
    const st = await load()
    const i = st.skills.findIndex((s) => s.id === id)
    if (i < 0) return false
    st.skills.splice(i, 1); await persist(); return true
  }

  /** Instruksi skill aktif untuk ditempelkan ke system prompt chat (dibatasi agar hemat token). */
  async function instructions() {
    const st = await load()
    return st.skills
      .filter((s) => s.enabled)
      .slice(0, MAX_ACTIVE)
      .map((s) => ({ name: s.name, instruction: s.instruction.slice(0, MAX_ENABLED_CHARS) }))
  }

  return { list, create, update, remove, instructions }
}
