// Validasi landing page publik: tautan, aset, struktur, klaim, kontras, dan blocker publikasi.
//
// Pakai: node scripts/check-landing.mjs [--strict]
//   tanpa --strict : exit 0 bila pemeriksaan wajib lulus (blocker publikasi tetap DILAPORKAN)
//   dengan --strict : exit 1 bila ada blocker publikasi (mis. domain placeholder)
//
// Script ini tidak mengarang: bila ada tautan/berkas yang hilang, ia melaporkannya.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const siteDir = path.join(root, 'landing')
const strict = process.argv.includes('--strict')

const problems = []   // wajib diperbaiki
const blockers = []   // belum boleh dipublikasikan (mis. domain placeholder)

const read = (rel) => fs.readFileSync(path.join(siteDir, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(siteDir, rel))

/* ---------------- 1. Berkas inti ---------------- */
const REQUIRED_FILES = ['index.html', 'robots.txt', 'sitemap.xml', 'assets/landing.css', 'assets/landing.js']
for (const f of REQUIRED_FILES) {
  if (!exists(f)) problems.push(`berkas hilang: landing/${f}`)
}
if (problems.length) {
  console.error('Berkas landing tidak lengkap. Stop.')
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}

const html = read('index.html')
const css = read('assets/landing.css')
// Komentar HTML bukan bagian dari halaman yang dirender — abaikan saat memeriksa
// struktur & klaim (mis. catatan "canonical sengaja tidak ada").
const htmlBody = html.replace(/<!--[\s\S]*?-->/g, '')

/* ---------------- 2. SEO & metadata ---------------- */
if (!/<html[^>]+lang="[a-z]{2}"/i.test(html)) problems.push('tag <html> tanpa atribut lang')
if (!/<title>[^<]{10,}<\/title>/i.test(html)) problems.push('tag <title> hilang atau terlalu pendek')
if (!/<meta name="description" content=".{50,}"\s*\/?>/i.test(html)) problems.push('meta description hilang/terlalu pendek')
if (!/<meta property="og:title"/.test(html)) problems.push('meta og:title hilang')
if (!/<meta property="og:description"/.test(html)) problems.push('meta og:description hilang')
if (!/<meta property="og:image"/.test(html)) problems.push('meta og:image hilang')
if (!/<meta name="twitter:card"/.test(html)) problems.push('meta twitter:card hilang')
if (/<link[^>]+rel="canonical"/i.test(htmlBody)) blockers.push('canonical URL ada sementara domain resmi belum ditetapkan')
if (!/<link[^>]+rel="icon"/i.test(html)) problems.push('favicon tidak direferensikan')

/* ---------------- 3. Struktur semantik ---------------- */
const h1s = html.match(/<h1\b/gi) || []
if (h1s.length !== 1) problems.push(`harus ada tepat 1 <h1>, ditemukan ${h1s.length}`)
for (const tag of ['header', 'main', 'footer', 'nav']) {
  if (!new RegExp(`<${tag}\\b`, 'i').test(html)) problems.push(`landmark <${tag}> hilang`)
}
for (const id of ['top', 'channels', 'how-it-works', 'use-cases', 'security', 'downloads', 'faq', 'wait']) {
  if (!new RegExp(`id="${id}"`, 'i').test(html)) problems.push(`section #${id} hilang`)
}
if (!/<h1[^>]*>[\s\S]{0,200}Your AI Workforce\. One Platform\. Every Device\./i.test(html)) {
  problems.push('headline wajib tidak ditemukan pada <h1>')
}

/* ---------------- 4. Aset & tautan lokal ---------------- */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
for (const a of anchors) {
  if (!ids.has(a)) problems.push(`tautan anchor "#${a}" tidak memiliki target`)
}
const localRefs = [...html.matchAll(/(?:src|href)="((?!https?:|mailto:|tel:|#|data:)[^"]+)"/g)].map((m) => m[1])
for (const ref of localRefs) {
  if (!exists(ref)) problems.push(`berkas lokal dirujuk tapi tidak ada: ${ref}`)
}

/* ---------------- 5. Tidak ada tautan/klaim palsu ---------------- */
const DOWNLOAD_EXT = /\.(exe|dmg|apk|ipa|msi|appimage|deb)(\?|#|$)/i
for (const m of html.matchAll(/href="([^"]+)"/g)) {
  const href = m[1]
  if (DOWNLOAD_EXT.test(href)) problems.push(`tautan unduhan langsung menunjuk berkas rilis: ${href}`)
  if (/^https?:\/\//i.test(href)) problems.push(`tautan eksternal di halaman publik (domain belum disahkan): ${href}`)
}
const FORBIDDEN_CLAIMS = [
  [/tamper-?proof/gi, 'klaim tamper-proof'],
  [/security[- ]certified|tercertifikasi|bersertifikat/gi, 'klaim tersertifikasi'],
  [/\b\d[\d.,]*\+?\s*(users|customers|pengguna aktif|companies)/gi, 'klaim jumlah pengguna'],
  [/trusted by\s+\d/gi, 'klaim "trusted by"'],
  [/\bROI\b|return on investment/gi, 'klaim ROI'],
  [/\bpricing\b|per bulan|\$\d|€\d/gi, 'klaim harga'],
  [/testimonial|testimoni/gi, 'klaim testimoni'],
]
/**
 * Cek klaim harus membedakan "klaim" dari "penyangkal klaim".
 * Kata di dalam kalimat penyangkal ("not tamper-proof", "no pricing published")
 * BUKAN klaim — hanya kemunculan tanpa penyangkal yang dihitung sebagai klaim.
 */
const NEGATION = /\b(not|no|none|never|cannot|can't|isn't|is not|without|does not|do not|bukan|tidak)\b/i
function unnegated(text, re) {
  const hits = []
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 90), m.index)
    const after = text.slice(m.index, m.index + m[0].length + 40)
    if (!NEGATION.test(before) && !NEGATION.test(after)) hits.push(m[0])
  }
  return hits
}
for (const [re, label] of FORBIDDEN_CLAIMS) {
  const hits = unnegated(htmlBody, re)
  if (hits.length) problems.push(`${label} ditemukan tanpa penyangkal: "${hits[0]}"`)
}

/* ---------------- 6. Status kanal harus jujur ---------------- */
const REQUIRED_STATUS = [
  [/status available[^>]*>\s*Available — self-hosted/i, 'status Web App (self-hosted)'],
  [/status available[^>]*>\s*Available — Windows/i, 'status Desktop Windows'],
  [/status partial[^>]*>\s*Partial/i, 'status Linux partial'],
  [/status dev[^>]*>\s*Not built here/i, 'status artefak yang tidak dibangun di sini'],
  [/status planned[^>]*>\s*Planned — not released/i, 'status mobile (planned)'],
]
for (const [re, label] of REQUIRED_STATUS) {
  if (!re.test(html)) problems.push(`kurang: ${label}`)
}
if (!/No mobile build today|no mobile package|mobile build/i.test(html)) {
  problems.push('penjelasan transparansi aplikasi mobile tidak ditemukan')
}
if (!/not tamper-proof|does not stop someone|No, and we do not claim/i.test(html)) {
  problems.push('penegasan bahwa audit trail bukan tamper-proof tidak ditemukan')
}
if (!/not been audited or certified by a third party|No security certification/i.test(html)) {
  problems.push('penegasan bahwa keamanan belum tersertifikasi tidak ditemukan')
}

/* ---------------- 7. Gambar: alt, dimensi, lazy loading ---------------- */
const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
if (!imgs.length) problems.push('tidak ada gambar di halaman')
for (const tag of imgs) {
  if (!/\salt="[^"]*"/.test(tag) && !/alt=""/.test(tag)) problems.push(`gambar tanpa alt: ${tag.slice(0, 70)}`)
  if (!/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag)) problems.push(`gambar tanpa width/height (layout shift): ${tag.slice(0, 70)}`)
}
const ogImage = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1]
if (ogImage) {
  // Untuk URL absolut, hanya bagian path-nya yang dicek lokal (host-nya akan diisi domain resmi).
  const localPath = ogImage.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '')
  if (localPath && !exists(localPath)) problems.push(`og:image menunjuk berkas yang tidak ada: ${localPath}`)
}

/* ---------------- 8. Kontras token yang dipakai ---------------- */
const CONTRAST = [
  ['#171717', '#FFFFFF', 4.5, 'teks utama'],
  ['#4F4F4F', '#FFFFFF', 4.5, 'teks sekunder'],
  ['#6E6E6E', '#FFFFFF', 4.5, 'teks meta'],
  ['#8A6212', '#FFFFFF', 4.5, 'aksen emas (teks)'],
  ['#FFFFFF', '#8A6212', 4.5, 'tombol utama'],
  ['#2E7D4F', '#FFFFFF', 4.5, 'status tersedia'],
  ['#8A5A12', '#FFFFFF', 4.5, 'status parsial'],
  ['#1F4E79', '#FFFFFF', 4.5, 'status informasi'],
  ['#B3402F', '#FFFFFF', 4.5, 'status galat'],
]
const lum = (hex) => {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
for (const [fg, bg, min, label] of CONTRAST) {
  const r = ratio(fg, bg)
  if (r < min) problems.push(`kontras ${label} ${fg} di ${bg} = ${r.toFixed(2)}:1 (< ${min})`)
}

/* ---------------- 9. Placeholder domain (blocker publikasi) ---------------- */
const placeholderRe = /REPLACE-WITH-OFFICIAL-DOMAIN/
for (const f of ['sitemap.xml', 'robots.txt']) {
  if (placeholderRe.test(read(f))) {
    blockers.push(`${f} masih memakai placeholder REPLACE-WITH-OFFICIAL-DOMAIN - ganti dengan domain resmi sebelum publikasi`)
  }
}
// OG/Twitter image harus memakai domain yang SAMA dengan sitemap & robots, agar satu
// penggantian token cukup dan tidak ada meta yang menunjuk host lain.
const htmlNoComments = htmlBody
const ogImageRef = (htmlNoComments.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || ''
const twImageRef = (htmlNoComments.match(/<meta name="twitter:image" content="([^"]+)"/) || [])[1] || ''
if (ogImageRef && !placeholderRe.test(ogImageRef) && /^https?:\/\//.test(ogImageRef)) {
  problems.push('og:image memakai domain absolut — harus memakai placeholder yang sama dengan sitemap/robots')
}
if (twImageRef && ogImageRef && twImageRef !== ogImageRef) {
  problems.push('twitter:image harus memakai URL yang sama persis dengan og:image')
}
const sitemapHost = (read('sitemap.xml').match(/https:\/\/([^/]+)\//) || [])[1] || ''
const robotsHost = (read('robots.txt').match(/https:\/\/([^/]+)\//) || [])[1] || ''
if (sitemapHost && robotsHost && sitemapHost !== robotsHost) {
  problems.push(`sitemap host (${sitemapHost}) dan robots host (${robotsHost}) berbeda`)
}
if (ogImageRef && sitemapHost && !ogImageRef.includes(sitemapHost) && placeholderRe.test(ogImageRef)) {
  problems.push('og:image dan sitemap harus memakai token placeholder yang sama')
}

/* ---------------- Laporan ---------------- */
console.log('Pemeriksaan landing page (Dudu Public Landing Page v1)')
console.log(`- berkas diperiksa: ${REQUIRED_FILES.length} inti + ${localRefs.length} rujukan aset`)
console.log(`- tautan anchor diperiksa: ${anchors.length}`)
console.log(`- gambar diperiksa: ${imgs.length}`)
console.log(`- pasangan kontras diperiksa: ${CONTRAST.length}`)

if (problems.length) {
  console.error('\nPERMASALAH (harus diperbaiki):')
  for (const p of problems) console.error(' - ' + p)
} else {
  console.log('\nSemua pemeriksaan wajib LULUS.')
}
if (blockers.length) {
  console.log('\nBLOCKER PUBLIKASI (belum boleh dipublikasikan):')
  for (const b of blockers) console.log(' - ' + b)
}
if (strict && (problems.length || blockers.length)) {
  console.error('\nMode --strict: keluar dengan kode 1.')
  process.exit(1)
}
process.exit(problems.length ? 1 : 0)
