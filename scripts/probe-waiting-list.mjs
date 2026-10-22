// Probe integrasi lokal yang AMAN untuk audit waiting list (data sintetis, tanpa email nyata).
// Dijalankan manual (bukan bagian test suite): node scripts/probe-waiting-list.mjs
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-probe-wl-'))
const api = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
const H = { 'x-dudu-client': '1' }
const J = (method, p, body, headers = H) => ({ method, path: p, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body), headers })
const line = (n, s) => console.log(String(n).padStart(2) + '. ' + s)

// 1. Pendaftaran valid
let r = await api.handle(J('POST', '/api/waiting-list', { email: 'probe.one@example.invalid', platform: 'android', role: 'creator', note: 'catatan sintetis' }))
line(1, `valid → HTTP ${r.status} ${JSON.stringify(r.body)}`)

// 2. Duplikat
r = await api.handle(J('POST', '/api/waiting-list', { email: 'PROBE.ONE@example.invalid' }))
line(2, `duplikat (beda kapitalisasi) → HTTP ${r.status} created=${r.body?.created}  [oracle: status berbeda = email bisa ditebak]`)

// 3. Email dengan tanda baca yang sering dipakai (hyphen, plus, titik)
for (const mail of ['probe-two@example.invalid', 'probe+tag@example.invalid', 'probe.two@example.invalid']) {
  const x = await api.handle(J('POST', '/api/waiting-list', { email: mail }))
  line(3, `email "${mail}" → HTTP ${x.status} ${x.body?.error ?? 'ok'}`)
}

// 4. Input tidak valid
for (const [label, body] of [
  ['email bukan email', { email: 'nope' }],
  ['email kosong', { email: '' }],
  ['platform asing', { email: 'probe.three@example.invalid', platform: 'nintendo' }],
  ['role asing', { email: 'probe.three@example.invalid', role: 'wizard' }],
  ['body JSON rusak', '{bukan json'],
  ['tanpa email', { platform: 'web' }],
]) {
  const x = await api.handle(J('POST', '/api/waiting-list', body))
  line(4, `${label} → HTTP ${x.status} ${x.body?.error ?? ''}`)
}

// 5. Tanpa header anti-CSRF
r = await api.handle({ method: 'POST', path: '/api/waiting-list', contentType: 'application/json', body: JSON.stringify({ email: 'probe.four@example.invalid' }), headers: {} })
line(5, `tanpa X-Dudu-Client → HTTP ${r.status} ${r.body?.error ?? ''}`)

// 6. Body raksasa (batas transport = 256 KB)
const huge = JSON.stringify({ email: 'x@example.invalid', note: 'A'.repeat(400_000) })
r = await api.handle(J('POST', '/api/waiting-list', huge))
line(6, `body 400 KB (di luar batas transport) → HTTP ${r.status} ${r.body?.error ?? 'diterima'} (catatan disimpan: ${(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8')).length} B)`)

// 7. GET tidak boleh membocorkan
for (const p of ['/api/waiting-list', '/api/waiting-list/list', '/api/waiting-list/count']) {
  const x = await api.handle({ method: 'GET', path: p })
  const leaked = JSON.stringify(x.body ?? {}).includes('example.invalid')
  line(7, `GET ${p} → HTTP ${x.status} leak=${leaked}`)
}

// 8. Konkurensi: 20 pendaftaran paralel dengan email berbeda → apakah semuanya tersimpan?
const emails = Array.from({ length: 20 }, (_, i) => `probe.par.${i}@example.invalid`)
await Promise.all(emails.map((e) => api.handle(J('POST', '/api/waiting-list', { email: e }))))
const stored = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
const missing = emails.filter((e) => !stored.entries.some((x) => x.email === e))
line(8, `konkurensi 20 parallel → tersimpan ${stored.entries.length - 4}/${emails.length} (hilang: ${missing.length})`)

// 9. Direktori penyimpanan tidak tersedia (disimulasikan dengan path di bawah berkas)
const brokenDir = path.join(dir, 'blokir-file')
await fs.writeFile(brokenDir, 'bukan direktori')
const api2 = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: path.join(brokenDir, 'sub') })
r = await api2.handle(J('POST', '/api/waiting-list', { email: 'probe.broken@example.invalid' }))
line(9, `folder data tidak tersedia → HTTP ${r.status} ${r.body?.error ?? ''} (pesan: ${JSON.stringify(r.body?.message ?? '')})`)

// 10. Berkas rusak (JSON tidak valid) → apakah data lama hilang diam-diam?
await fs.writeFile(path.join(dir, 'waiting-list.json'), '{bukan json')
const api3 = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
r = await api3.handle(J('POST', '/api/waiting-list', { email: 'probe.after.corrupt@example.invalid' }))
const after = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
const kept = (await fs.readdir(dir)).filter((f) => f.includes('corrupt'))
line(10, `berkas rusak → HTTP ${r.status}; entri aktif = ${after.entries.length}; berkas rusak DIPRAHAN = ${kept.length ? kept.join(',') : 'TIDAK (data hilang)'}`)

// 11. Perilaku restart: instance baru membaca dari disk
const api4 = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
r = await api4.handle(J('POST', '/api/waiting-list', { email: 'probe.after.corrupt@example.invalid' }))
line(11, `restart (instance baru) → HTTP ${r.status} (respons seragam)`)

// 12. Ukuran berkas & izin
const st = await fs.stat(path.join(dir, 'waiting-list.json'))
line(12, `berkas: ${st.size} B, mode=${st.mode.toString(8)} (0600 hanya berlaku di POSIX)`)

// 13. Batas laju: instance baru, 70 permintaan beruntun → harus ada 429
const api5 = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
let ok = 0, limited = 0, lastStatus = 0
for (let i = 0; i < 70; i++) {
  const x = await api5.handle(J('POST', '/api/waiting-list', { email: `probe.rate.${i}@example.invalid` }))
  lastStatus = x.status
  if (x.status === 201) ok++; else if (x.status === 429) limited++
}
line(13, `batas laju: 70 permintaan → ${ok} diterima, ${limited} ditolak 429 (status terakhir ${lastStatus})`)

// 14. Batas jumlah entri
const api6 = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
const store6 = (await import('../server/waiting-list.mjs')).createWaitingListStore({ dataDir: dir, maxEntries: 3 })
for (let i = 0; i < 5; i++) {
  try { await store6.add({ email: `probe.cap.${i}@example.invalid` }) } catch (e) { line(14, `batas entri: ditolak pada entri ke-${i + 1} → ${e.code} (${e.status})`); break }
}

await fs.rm(dir, { recursive: true, force: true })
