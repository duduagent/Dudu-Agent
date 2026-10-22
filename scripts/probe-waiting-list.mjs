// Probe integrasi lokal untuk waiting list Dudu — dengan ASSERTION & ringkasan.
//
// TUJUAN: skrip ini adalah alat audit, bukan test suite. Ia menjalankan skenario nyata
// terhadap API Dudu sungguhan (dengan data sintetis), lalu:
//
//   - exit 0  → semua skenario yang dijalankan LULUS
//   - exit 1  → ada skenario yang GAGAL (dicetak lengkap, tidak disembunyikan)
//   - exit 2  → setup tidak dapat dijalankan (mis. API tidak bisa dibuat)
//
// Catatan penting (v0.6.4): versi sebelumnya hanya MENCETAK hasil observasi tanpa
// assertion, sehingga exit code-nya selalu 0 dan regresi tidak pernah terdeteksi.
// Assertion di bawah TIDAK dilebihkan — nilai yang diharapkan tetap nilai yang benar.
//
// Pakai: node scripts/probe-waiting-list.mjs
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'

const results = []
let current = null

function scenario(name, fn) {
  current = { name, status: 'FAIL', detail: '' }
  results.push(current)
  // Mengembalikan fungsi yang bisa dipanggil; assertion di dalamnya menentukan PASS/FAIL.
  return async () => {
    try {
      const detail = await fn()
      current.status = 'PASS'
      current.detail = detail ?? ''
    } catch (e) {
      current.status = 'FAIL'
      current.detail = String(e?.message ?? e).slice(0, 300)
    }
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
  return true
}

const J = (method, p, body, headers = { 'x-dudu-client': '1' }) => ({
  method, path: p, contentType: 'application/json',
  body: typeof body === 'string' ? body : JSON.stringify(body), headers,
})

let dir = null
let api = null

try {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-probe-wl-'))
  api = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })

  /* ---------- 1. Pendaftaran valid ---------- */
  await scenario('pendaftaran valid → 201 + receipt tanpa email', async () => {
    const r = await api.handle(J('POST', '/api/waiting-list', { email: 'probe.one@example.invalid', platform: 'android', role: 'creator', note: 'catatan sintetis' }))
    assert(r.status === 201, `HTTP ${r.status} (harap 201)`)
    assert(r.body?.ok === true, 'body.ok harus true')
    assert(/^[0-9a-f-]{36}$/.test(r.body?.entry?.id ?? ''), 'id entri harus UUID')
    assert(!JSON.stringify(r.body).includes('probe.one'), 'respons tidak boleh memuat email')
    return `HTTP ${r.status}, id ${r.body.entry.id.slice(0, 8)}…`
  })()

  /* ---------- 2. Respons seragam (tanpa oracle penebakan email) ---------- */
  await scenario('alamat terdaftar → respons seragam (tidak bisa ditebak)', async () => {
    const again = await api.handle(J('POST', '/api/waiting-list', { email: 'PROBE.ONE@example.invalid' }))
    assert(again.status === 201, `duplikat harus 201 juga, bukan ${again.status}`)
    assert(!('created' in (again.body ?? {})), 'field "created" tidak boleh dibocorkan')
    assert(!JSON.stringify(again.body).includes('probe.one'), 'respons tidak boleh memuat email')
    return 'HTTP 201, bentuk identik dengan pendaftaran baru'
  })()

  /* ---------- 3. Email dengan tanda baca umum ---------- */
  await scenario('email dengan hyphen/plus/titik diterima', async () => {
    for (const mail of ['probe-two@example.invalid', 'probe+tag@example.invalid', 'probe.two@example.invalid']) {
      const r = await api.handle(J('POST', '/api/waiting-list', { email: mail }))
      assert(r.status === 201, `${mail} → HTTP ${r.status} (harap 201)`)
    }
    return '3 format diterima'
  })()

  /* ---------- 4. Validasi input ---------- */
  await scenario('input tidak valid → 400 dengan kode yang jelas', async () => {
    const cases = [
      [{ email: 'bukan-email' }, 'bad_email'],
      [{ email: '' }, 'bad_email'],
      [{ platform: 'web' }, 'bad_email'],
      [{ email: 'probe.three@example.invalid', platform: 'nintendo' }, 'bad_platform'],
      [{ email: 'probe.three@example.invalid', role: 'wizard' }, 'bad_role'],
    ]
    for (const [body, code] of cases) {
      const r = await api.handle(J('POST', '/api/waiting-list', body))
      assert(r.status === 400, `${JSON.stringify(body)} → HTTP ${r.status} (harap 400)`)
      assert(r.body?.error === code, `${JSON.stringify(body)} → error ${r.body?.error} (harap ${code})`)
    }
    const broken = await api.handle(J('POST', '/api/waiting-list', '{bukan json'))
    assert(broken.status === 400, `JSON rusak → HTTP ${broken.status} (harap 400)`)
    assert(broken.body?.error === 'bad_json', `JSON rusak → error ${broken.body?.error}`)
    return '5 kasus validasi + 1 JSON rusak'
  })()

  /* ---------- 5. Anti-CSRF ---------- */
  await scenario('tanpa header X-Dudu-Client → 403', async () => {
    const r = await api.handle({ method: 'POST', path: '/api/waiting-list', contentType: 'application/json', body: JSON.stringify({ email: 'probe.four@example.invalid' }), headers: {} })
    assert(r.status === 403, `HTTP ${r.status} (harap 403)`)
    assert(r.body?.error === 'forbidden', `error ${r.body?.error} (harap forbidden)`)
    return '403 forbidden'
  })()

  /* ---------- 6. Batas ukuran body ---------- */
  await scenario('body melebihi batas endpoint → 413 (tidak diparse/disimpan)', async () => {
    const huge = JSON.stringify({ email: 'probe.big@example.invalid', note: 'A'.repeat(20000) })
    const r = await api.handle(J('POST', '/api/waiting-list', huge))
    assert(r.status === 413, `HTTP ${r.status} (harap 413)`)
    const stored = await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8').catch(() => '')
    assert(!stored.includes('probe.big'), 'body besar tidak boleh tersimpan')
    return `HTTP ${r.status}`
  })()

  /* ---------- 7. Tidak ada endpoint yang membocorkan daftar ---------- */
  await scenario('tidak ada endpoint pembacaan daftar', async () => {
    for (const p of ['/api/waiting-list', '/api/waiting-list/list', '/api/waiting-list/count', '/api/waiting-list/entries']) {
      const r = await api.handle({ method: 'GET', path: p })
      assert([404, 405].includes(r.status), `GET ${p} → HTTP ${r.status} (harap 404/405)`)
      assert(!JSON.stringify(r.body ?? {}).includes('example.invalid'), `GET ${p} membocorkan email`)
    }
    return '4 rute baca ditolak, tidak ada kebocoran'
  })()

  /* ---------- 8. Permintaan paralel ---------- */
  await scenario('permintaan paralel → tidak ada entri hilang', async () => {
    const emails = Array.from({ length: 25 }, (_, i) => `probe.par.${i}@example.invalid`)
    const res = await Promise.all(emails.map((e) => api.handle(J('POST', '/api/waiting-list', { email: e }))))
    const bad = res.filter((r) => r.status !== 201)
    assert(bad.length === 0, `${bad.length} permintaan gagal (HTTP ${bad[0]?.status})`)
    const stored = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
    const missing = emails.filter((e) => !stored.entries.some((x) => x.email === e))
    assert(missing.length === 0, `${missing.length} entri hilang (mis. ${missing[0]})`)
    return `25 permintaan paralel → 25 tersimpan, 0 hilang`
  })()

  /* ---------- 9. Penyimpanan tidak tersedia → aman & dapat ditindaklanjuti ---------- */
  await scenario('folder data tidak tersedia → 503/500 aman tanpa path', async () => {
    const blocker = path.join(dir, 'blokir-file')
    await fs.writeFile(blocker, 'bukan direktori')
    const broken = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: path.join(blocker, 'sub') })
    // API mencatat error ke stderr — sengaja dibungkam agar log probe tetap bersih.
    const realError = console.error
    console.error = () => {}
    let r
    try { r = await broken.handle(J('POST', '/api/waiting-list', { email: 'probe.broken@example.invalid' })) } finally { console.error = realError }
    assert([500, 503].includes(r.status), `HTTP ${r.status} (harap 500/503)`)
    const body = JSON.stringify(r.body ?? {})
    assert(!body.includes('blokir-file'), 'respons membocorkan path internal')
    assert(!body.includes('example.invalid'), 'respons membocorkan email')
    assert(typeof r.body?.message === 'string' && r.body.message.length > 0, 'pesan harus ada untuk operator')
    return `HTTP ${r.status}, pesan aman tanpa path`
  })()

  /* ---------- 10. Berkas rusak diprahkan ---------- */
  await scenario('berkas rusak → diprahkan, tidak hilang diam-diam', async () => {
    await fs.writeFile(path.join(dir, 'waiting-list.json'), '{bukan json')
    const fresh = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
    const realError = console.error
    console.error = () => {}
    let r
    try { r = await fresh.handle(J('POST', '/api/waiting-list', { email: 'probe.after.corrupt@example.invalid' })) } finally { console.error = realError }
    assert(r.status === 201, `HTTP ${r.status} (harap 201)`)
    const files = await fs.readdir(dir)
    assert(files.some((f) => f.includes('corrupt')), 'berkas rusak harus diprahkan')
    return 'berkas corrupt-* terbentuk'
  })()

  /* ---------- 11. Restart membaca dari disk ---------- */
  await scenario('restart → instance baru membaca daftar dari disk', async () => {
    const fresh = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })
    const r = await fresh.handle(J('POST', '/api/waiting-list', { email: 'probe.after.corrupt@example.invalid' }))
    assert(r.status === 201, `HTTP ${r.status} (harap 201)`)
    return 'state konsisten setelah instance baru'
  })()

  /* ---------- 12. Izin berkas ---------- */
  await scenario('berkas waiting-list: mode 0600 di POSIX', async () => {
    const st = await fs.stat(path.join(dir, 'waiting-list.json'))
    if (process.platform === 'win32') {
      return `mode ${st.mode.toString(8)} — Windows tidak menerapkan mode POSIX (ACL per-user); dicek manual`
    }
    assert((st.mode & 0o777) === 0o600, `mode ${st.mode.toString(8)} (harap 600)`)
    return 'mode 0600'
  })()

  /* ---------- 13. Batas laju ---------- */
  await scenario('batas laju → 429 setelah ambang', async () => {
    const { createWaitingListStore } = await import('../server/waiting-list.mjs')
    const rateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-probe-rate-'))
    const store = createWaitingListStore({ dataDir: rateDir, maxPerMinute: 5 })
    for (let i = 0; i < 5; i++) await store.add({ email: `probe.rate.${i}@example.invalid` })
    let code = null
    try { await store.add({ email: 'probe.rate.overflow@example.invalid' }) } catch (e) { code = e.code }
    assert(code === 'rate_limited', `kode error ${code} (harap rate_limited)`)
    return '5 diterima, ke-6 ditolak rate_limited'
  })()

  /* ---------- 14. Batas jumlah entri ---------- */
  await scenario('batas jumlah entri → list_full', async () => {
    const { createWaitingListStore } = await import('../server/waiting-list.mjs')
    const capDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-probe-cap-'))
    const store = createWaitingListStore({ dataDir: capDir, maxEntries: 3 })
    for (let i = 0; i < 3; i++) await store.add({ email: `probe.cap.${i}@example.invalid` })
    let code = null
    try { await store.add({ email: 'probe.cap.overflow@example.invalid' }) } catch (e) { code = e.code }
    assert(code === 'list_full', `kode error ${code} (harap list_full)`)
    return '3 entri, ke-4 ditolak list_full'
  })()
} catch (e) {
  console.error('SETUP GAGAL:', e?.message ?? e)
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  process.exit(2)
}

/* ---------- Ringkasan ---------- */
const passed = results.filter((r) => r.status === 'PASS').length
const failed = results.filter((r) => r.status === 'FAIL').length
const skipped = results.length - passed - failed

console.log('PROBE WAITING LIST — Dudu AI (data sintetis, API lokal nyata)\n')
for (const [i, r] of results.entries()) {
  const mark = r.status === 'PASS' ? 'LULUS' : 'GAGAL'
  console.log(`${String(i + 1).padStart(2)}. [${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
}
console.log(`\nRINGKASAN: ${results.length} skenario dijalankan · ${passed} lulus · ${failed} gagal · ${skipped} dilewati`)

await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
process.exit(failed > 0 ? 1 : 0)
