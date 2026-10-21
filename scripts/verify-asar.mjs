// Memeriksa apakah app.asar memuat kode rilis yang diharapkan (dipakai saat verifikasi paket).
// Pakai: node scripts/verify-asar.mjs <path-app.asar> <version>
import fs from 'node:fs'

const [asar, version] = process.argv.slice(2)
if (!asar) { console.error('Pakai: node scripts/verify-asar.mjs <app.asar> [versi]'); process.exit(2) }
const s = fs.readFileSync(asar).toString('latin1')
const checks = [
  ['versi paket', version ? new RegExp(`"version"\\s*:\\s*"${version.replace(/\./g, '\\.')}"`).test(s) : null],
  ['pembatalan misi (server)', 'cancelRequested'],
  ['kode penolakan pembatalan', 'not_cancellable'],
  ['jembatan Chat → Misi (frontend)', 'Jadikan Misi Analisis Data'],
  ['panel bukti kapabilitas (frontend)', 'Bukti kapabilitas'],
  ['runner kapabilitas dari misi (frontend)', 'Jalankan kapabilitas (dalam konteks misi)'],
  ['registry kapabilitas', '/api/capability-registry'],
  ['tanpa kunci API di frontend', null],
]
let bad = 0
for (const [name, needle] of checks) {
  if (needle === null || needle === undefined) { console.log(`  ?  ${name} (diperiksa manual)`); continue }
  const ok = typeof needle === 'string' ? s.includes(needle) : needle === true
  if (!ok) bad++
  console.log(`  ${ok ? 'OK ' : 'GAGAL'} ${name}`)
}
const apiKeyPattern = /DUDU_PROVIDER_API_KEY\s*[:=]\s*["'][A-Za-z0-9]/
console.log(`  ${apiKeyPattern.test(s) ? 'GAGAL' : 'OK '} tidak ada kunci API literal di dalam asar`)
if (apiKeyPattern.test(s)) bad++
console.log(bad === 0 ? 'SEMUA PEMERIKSAAN LULUS' : `${bad} PEMERIKSAAN GAGAL`)
process.exit(bad === 0 ? 0 : 1)
