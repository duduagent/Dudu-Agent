// Validator statis konfigurasi reverse proxy Dudu.
//
// Nginx TIDAK tersedia di mesin pengembangan ini, jadi konfigurasi tidak bisa diuji
// dengan proxy sungguhan. Skrip ini memeriksa PROPERTI KEAMANAN yang wajib ada
// pada berkas konfigurasi, sehingga regresi (mis. CORS ditambahkan, XFF dari klien
// dipercaya, body dibiarkan besar) tertangkap otomatis.
//
// Pakai: node scripts/check-proxy-config.mjs [--strict]
//   tanpa --strict : exit 0 bila pemeriksaan wajib lulus
//   dengan --strict : exit 1 bila ada placeholder yang belum diganti
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const confPath = path.join(root, 'deploy', 'nginx', 'dudu-landing.conf')
const strict = process.argv.includes('--strict')

if (!fs.existsSync(confPath)) {
  console.error('Berkas konfigurasi tidak ditemukan:', path.relative(root, confPath))
  process.exit(2)
}
const confRaw = fs.readFileSync(confPath, 'utf8')
// Komentar nginx (#) bukan instruksi → dibuang sebelum pemeriksaan, supaya penjelasan
// di dalam konfigurasi tidak dianggap sebagai pengaturan.
const conf = confRaw.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n')
const problems = []
const placeholders = []
const has = (re) => re.test(conf)

/* ---------- 1. TLS di proxy ---------- */
if (!has(/listen\s+443\s+ssl/)) problems.push('blok TLS (listen 443 ssl) tidak ada')
if (!has(/ssl_certificate\s+<PATH_SERT>/)) problems.push('ssl_certificate tidak dikonfigurasi')
if (!has(/ssl_protocols\s+TLSv1\.2\s+TLSv1\.3/)) problems.push('ssl_protocols tidak dibatasi ke TLSv1.2/1.3')
if (!has(/listen\s+80/) || !has(/return\s+301\s+https:\/\/\$host\$request_uri/)) {
  problems.push('redirection HTTP → HTTPS tidak ada')
}
if (!has(/Strict-Transport-Security/)) problems.push('header HSTS tidak ada')

/* ---------- 2. API hanya via loopback, tidak ada CORS ---------- */
const upstreams = [...conf.matchAll(/proxy_pass\s+(\S+);/g)].map((m) => m[1])
if (!upstreams.length) problems.push('tidak ada proxy_pass ke API')
for (const up of upstreams) {
  if (!/^http:\/\/127\.0\.0\.1(:\d+)?/.test(up)) {
    problems.push(`proxy_pass bukan loopback: ${up} (API tidak boleh terekspos lewat host publik)`)
  }
}
if (has(/Access-Control-Allow-Origin/i)) {
  problems.push('CORS diaktifkan (Access-Control-Allow-Origin) — arsitektur same-origin tidak memerlukannya')
}

/* ---------- 3. Hanya satu endpoint API yang diekspos ---------- */
// Blok location dipotong pada Location berikutnya (blok bisa berisi kurung kurawal bersarang).
const locStarts = [...conf.matchAll(/location\s+([^\{]+)\{/g)].map((m) => ({ raw: m[1].trim(), at: m.index }))
const apiBlocks = locStarts
  .map((b, i) => {
    const next = locStarts.find((x) => x.at > b.at)
    const end = next ? next.at : conf.length
    // Path di dalam location (modifier "=", "~", "^~", "@" dibuang).
    const path = (b.raw.match(/\/api\/[^\s]*/) || [''])[0]
    return { path, raw: b.raw, body: conf.slice(b.at, end) }
  })
  .filter((b) => b.path.startsWith('/api'))
const forwardedApi = apiBlocks.filter((b) => b.body.includes('proxy_pass')).map((b) => b.path)
const deniedApi = apiBlocks.filter((b) => /return\s+404/.test(b.body)).map((b) => b.path)
const nonWaiting = forwardedApi.filter((l) => l !== '/api/waiting-list')
if (nonWaiting.length) problems.push(`endpoint API lain diteruskan ke backend: ${nonWaiting.join(', ')} (API Dudu tanpa autentikasi)`)
if (!forwardedApi.includes('/api/waiting-list')) problems.push('location = /api/waiting-list tidak meneruskan ke backend')
if (!deniedApi.length) problems.push('tidak ada blok penolakan untuk /api/* lain (harus 404)')
if (!has(/limit_except\s+POST\s*\{\s*deny\s+all;\s*\}/)) {
  problems.push('endpoint daftar tunggu tidak dibatasi ke POST (limit_except POST { deny all; })')
}

/* ---------- 4. Batas laju per-IP tanpa mempercayai XFF klien ---------- */
if (!has(/limit_req_zone\s+\$binary_remote_addr\s+zone=dudu_waitinglist/)) {
  problems.push('limit_req_zone per-IP ($binary_remote_addr) tidak ada')
}
if (!has(/limit_req\s+zone=dudu_waitinglist/)) problems.push('limit_req tidak diterapkan pada endpoint daftar tunggu')
if (has(/real_ip_header\s+X-Forwarded-For/i)) {
  problems.push('real_ip_header X-Forwarded-For — header dari klien tidak boleh dipercaya')
}
if (has(/set_real_ip_from\s+0\.0\.0\.0\/0|set_real_ip_from\s+::\/0/)) {
}
if (has(/proxy_set_header\s+X-Forwarded-For\s+\$http_x_forwarded_for/)) {
  problems.push('X-Forwarded-For diteruskan dari klien — jangan; pakai $remote_addr')
}

/* ---------- 5. Batas body & timeout ---------- */
const bodySize = conf.match(/client_max_body_size\s+(\S+);/)
if (!bodySize) problems.push('client_max_body_size tidak ada')
else {
  const m = /^(\d+)([kKmM]?)$/.exec(bodySize[1])
  const bytes = m ? Number(m[1]) * (m[2].toLowerCase() === 'k' ? 1024 : m[2].toLowerCase() === 'm' ? 1048576 : 1) : NaN
  if (!(bytes > 0 && bytes <= 64 * 1024)) problems.push(`client_max_body_size terlalu besar: ${bodySize[1]} (maks 64k)`)
}
for (const d of ['proxy_connect_timeout', 'proxy_read_timeout', 'proxy_send_timeout']) {
  if (!has(new RegExp(`${d}\\s+\\d+s`))) problems.push(`${d} tidak disetel`)
}
if (!has(/proxy_intercept_errors\s+on/)) problems.push('proxy_intercept_errors on tidak ada (backend mati → error proxy mentah)')
if (!has(/error_page\s+502\s+503\s+504/)) problems.push('error_page untuk 502/503/504 tidak ada')

/* ---------- 6. Header keamanan landing page ---------- */
for (const [re, label] of [
  [/X-Content-Type-Options\s+"nosniff"/, 'X-Content-Type-Options'],
  [/Referrer-Policy\s+"strict-origin-when-cross-origin"/, 'Referrer-Policy'],
  [/X-Frame-Options\s+"DENY"/, 'X-Frame-Options'],
  [/Content-Security-Policy\s+"[^"]*form-action 'self'/, 'Content-Security-Policy (form-action self)'],
  [/Content-Security-Policy\s+"[^"]*frame-ancestors 'none'/, 'Content-Security-Policy (frame-ancestors none)'],
]) {
  if (!has(re)) problems.push(`header keamanan hilang: ${label}`)
}

/* ---------- 7. Anti-CSRF ---------- */
if (!has(/proxy_set_header\s+X-Dudu-Client\s+1/)) problems.push('X-Dudu-Client tidak disetel oleh proxy (API mewajibkan header ini)')

/* ---------- 8. Placeholder yang harus diganti ---------- */
for (const m of new Set([...conf.matchAll(/<([A-Z_]+)>/g)].map((m) => m[1]))) {
  placeholders.push(m)
}

/* ---------- Laporan ---------- */
console.log('Pemeriksaan konfigurasi reverse proxy (deploy/nginx/dudu-landing.conf)')
console.log(`- upstream API: ${upstreams.join(', ') || '(tidak ada)'}`)
console.log(`- endpoint API diteruskan: ${forwardedApi.join(", ") || "(tidak ada)"} | ditolak 404: ${deniedApi.join(", ") || "(tidak ada)"}`)
console.log(`- placeholder yang belum diganti: ${placeholders.join(', ') || '(tidak ada)'}`)

if (problems.length) {
  console.error('\nPERMASALAH (harus diperbaiki):')
  for (const p of problems) console.error(' - ' + p)
} else {
  console.log('\nSemua pemeriksaan wajib LULUS.')
}
if (placeholders.length) {
  console.warn('\nBELUM SIAP PRODUKSI — placeholder yang harus diganti:')
  for (const p of placeholders) console.warn(` - <${p}>`)
}
if (strict && (problems.length || placeholders.length)) {
  console.error('\nMode --strict: keluar dengan kode 1.')
  process.exit(1)
}
process.exit(problems.length ? 1 : 0)
