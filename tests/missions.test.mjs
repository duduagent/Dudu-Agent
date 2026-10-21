// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileStore } from '../server/files.mjs'
import { MissionError, createMissionService } from '../server/missions.mjs'
import { independentRowCount, loadTable, profileTable } from '../server/data-tools.mjs'

const fx = (n) => fsSync.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n))
let dir, files, svc
const mk = (over = {}) => createMissionService({ dataDir: dir, files, ...over })
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-ms-')); files = createFileStore({ dataDir: dir }); svc = mk() })
afterEach(() => fs.rm(dir, { recursive: true, force: true }))
const up = (name, bytes) => files.save({ name, bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) })

describe('tool data (nilai diketahui dari sales.csv)', () => {
  it('parse + profil: 4 baris, Jumlah total 41, Harga total 142000.5', () => {
    const t = loadTable({ ext: 'csv', bytes: fx('sales.csv') })
    expect(t.columns).toEqual(['Produk', 'Wilayah', 'Jumlah', 'Harga']); expect(t.rows).toHaveLength(4)
    const p = profileTable(t)
    const jumlah = p.columns.find((c) => c.name === 'Jumlah'), harga = p.columns.find((c) => c.name === 'Harga'), wil = p.columns.find((c) => c.name === 'Wilayah')
    expect(jumlah).toMatchObject({ type: 'integer', min: 4, max: 20, sum: 41, mean: 10.25, median: 8.5 })
    expect(harga.sum).toBeCloseTo(142000.5, 6); expect(wil.nulls).toBe(1); expect(wil.top[0]).toEqual({ value: 'Jawa Barat', count: 2 })
    expect(independentRowCount('csv', fx('sales.csv'))).toBe(4)
  })
  it('CSV dengan kutip, koma di dalam sel, baris baru di dalam sel, dan titik koma', () => {
    const b = Buffer.from('a;b\n"x;y";"baris1\nbaris2"\n2;3\n')
    const t = loadTable({ ext: 'csv', bytes: b })
    expect(t.rows).toEqual([['x;y', 'baris1\nbaris2'], ['2', '3']]); expect(independentRowCount('csv', b)).toBe(2)
  })
})

describe('misi analisis data: alur penuh', () => {
  it('Draft → persetujuan manusia → Completed dengan bukti, artefak, dan verifikasi independen', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    const draft = await svc.create({ goal: 'Analisis penjualan per wilayah', fileId: f.id })
    expect(draft).toMatchObject({ state: 'draft', approval: { status: 'pending' }, planner: 'rule-based' })
    expect(draft.acceptance).toHaveLength(5); expect(draft.acceptance.every((c) => c.status === 'pending')).toBe(true)
    expect(draft.steps.map((s) => s.tool)).toEqual(['input.validate', 'data.load', 'data.profile', 'report.write', 'verify.criteria'])
    expect(draft.artifacts).toEqual([])
    await expect(svc.retry(draft.id)).rejects.toMatchObject({ status: 409 })

    const m = await svc.approve(draft.id)
    expect(m.state).toBe('completed'); expect(m.failure).toBeNull(); expect(m.approval.status).toBe('approved')
    expect(m.acceptance.map((c) => c.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed'])
    expect(m.acceptance.every((c) => c.evidence && c.checkedAt)).toBe(true)
    for (const s of m.steps) { expect(s.status).toBe('done'); expect(s.attempts[0]).toMatchObject({ ok: true }); expect(s.attempts[0].execId).toMatch(/^[0-9a-f-]{36}$/); expect(s.attempts[0].finishedAt).toBeGreaterThanOrEqual(s.attempts[0].startedAt) }
    expect(new Set(m.steps.map((s) => s.attempts[0].execId)).size).toBe(5)

    // artefak benar-benar ada di disk dan isinya cocok dengan data sumber
    expect(m.artifacts.map((a) => a.name)).toEqual(['report.md', 'profile.json'])
    const report = await fs.readFile(path.join(dir, 'artifacts', m.id, 'report.md'), 'utf8')
    expect(report).toContain('Jumlah baris data: 4'); expect(report).toContain('| Jumlah | integer | 4 | 0 | 4 |'); expect(report).toContain('| Jumlah | 4 | 20 | 10.25 | 8.5 | 41 |')
    const prof = JSON.parse(await fs.readFile(path.join(dir, 'artifacts', m.id, 'profile.json'), 'utf8'))
    expect(prof.profile.rowCount).toBe(4); expect(prof.source.sha256).toBe(f.sha256)
    // persisten: instance baru membaca status yang sama
    expect((await mk().get(m.id)).state).toBe('completed')
    expect(m.log.some((l) => /Pengguna menyetujui/.test(l.msg))).toBe(true)
    await expect(svc.approve(m.id)).rejects.toMatchObject({ status: 409, code: 'bad_state' })
  })

  it('sumber XLSX asli (openpyxl) dan JSON juga lulus verifikasi', async () => {
    const x = await svc.approve((await svc.create({ goal: 'Profil data xlsx', fileId: (await up('real.xlsx', fx('real.xlsx'))).id })).id)
    expect(x.state).toBe('completed'); expect(x.steps[1].output).toMatchObject({ rows: 4, columns: 5, sheet: 'Penjualan' })
    const j = await svc.approve((await svc.create({ goal: 'Profil data json', fileId: (await up('d.json', JSON.stringify([{ a: 1, b: 'x' }, { a: 3, b: 'y' }]))).id })).id)
    expect(j.state).toBe('completed'); expect(j.steps[1].output.rows).toBe(2)
  })

  it('penolakan awal: tujuan terlalu pendek, file tak ada, format non-tabular', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    await expect(svc.create({ goal: 'ab', fileId: f.id })).rejects.toMatchObject({ code: 'bad_goal' })
    await expect(svc.create({ goal: 'analisis data', fileId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ status: 404 })
    const pdf = await up('r.pdf', fx('real.pdf'))
    await expect(svc.create({ goal: 'analisis data pdf', fileId: pdf.id })).rejects.toMatchObject({ status: 422, code: 'input_invalid' })
  })
})

describe('kegagalan: klasifikasi, retry terbatas, pemulihan', () => {
  it('input_invalid: file dihapus setelah Draft → Failed, tidak dapat dicoba ulang', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    const d = await svc.create({ goal: 'analisis sebelum dihapus', fileId: f.id })
    await files.remove(f.id)
    const m = await svc.approve(d.id)
    expect(m.state).toBe('failed'); expect(m.failure).toMatchObject({ class: 'input_invalid', retryable: false })
    expect(m.steps[0].status).toBe('failed'); expect(m.steps[1].status).toBe('pending')
    await expect(svc.retry(m.id)).rejects.toMatchObject({ code: 'not_retryable' })
  })
  it('parse_error: CSV dengan tanda kutip tidak tertutup → Failed', async () => {
    const f = await up('rusak.csv', 'a,b\n"1,2\n3,4\n')
    const m = await svc.approve((await svc.create({ goal: 'analisis csv rusak', fileId: f.id })).id)
    expect(m.state).toBe('failed'); expect(m.failure.class).toBe('parse_error')
  })
  it('tool_error sementara: retry otomatis tepat 1 kali lalu berhasil (attempt tercatat)', async () => {
    let calls = 0
    const flaky = { ...fs, writeFile: async (p, ...a) => { if (String(p).endsWith('report.md') && calls++ === 0) throw new Error('EIO simulasi'); return fs.writeFile(p, ...a) } }
    const f = await up('sales.csv', fx('sales.csv'))
    const m = await mk({ fs: flaky }).approve((await mk({ fs: flaky }).create({ goal: 'analisis dengan gangguan disk', fileId: f.id })).id)
    expect(m.state).toBe('completed')
    const s4 = m.steps.find((s) => s.id === 's4')
    expect(s4.attempts.map((a) => a.ok)).toEqual([false, true]); expect(s4.attempts[0]).toMatchObject({ class: 'tool_error', error: expect.stringMatching(/EIO simulasi/) })
    expect(m.log.some((l) => /mencoba ulang otomatis \(1\/1\)/.test(l.msg))).toBe(true)
  })
  it('tool_error persisten: berhenti di Needs Attention (batas retry), lalu retry manual setelah diperbaiki', async () => {
    let broken = true
    const flaky = { ...fs, writeFile: async (p, ...a) => { if (broken && String(p).endsWith('profile.json')) throw new Error('disk penuh'); return fs.writeFile(p, ...a) } }
    const s = mk({ fs: flaky })
    const f = await up('sales.csv', fx('sales.csv'))
    const m1 = await s.approve((await s.create({ goal: 'analisis disk penuh', fileId: f.id })).id)
    expect(m1.state).toBe('needs_attention'); expect(m1.failure).toMatchObject({ class: 'tool_error', retryable: true })
    expect(m1.steps.find((x) => x.id === 's4').attempts).toHaveLength(2) // 1 + maxAutoRetries, tidak lebih
    expect(m1.steps.find((x) => x.id === 's5').status).toBe('pending') // verifikasi tidak dijalankan atas artefak setengah jadi
    broken = false
    const m2 = await s.retry(m1.id)
    expect(m2.state).toBe('completed'); expect(m2.failure).toBeNull(); expect(m2.acceptance.every((c) => c.status === 'passed')).toBe(true)
  })
  it('verifikasi independen menangkap artefak yang dirusak (hash tidak cocok) → Needs Attention, tidak "Completed"', async () => {
    const tamper = { ...fs, writeFile: async (p, data, ...a) => fs.writeFile(p, String(p).endsWith('report.md') ? Buffer.from(String(data).replace('Jumlah baris data: 4', 'Jumlah baris data: 99')) : data, ...a) }
    const s = mk({ fs: tamper })
    const f = await up('sales.csv', fx('sales.csv'))
    const m = await s.approve((await s.create({ goal: 'analisis yang artefaknya dirusak', fileId: f.id })).id)
    expect(m.state).toBe('needs_attention'); expect(m.failure).toMatchObject({ class: 'verification_failed', retryable: false })
    const byId = Object.fromEntries(m.acceptance.map((c) => [c.id, c]))
    expect(byId.ac1.status).toBe('failed'); expect(byId.ac1.evidence).toMatch(/TIDAK cocok/); expect(byId.ac2.status).toBe('failed'); expect(byId.ac2.evidence).toMatch(/hitung-ulang=4, laporan=99/)
    expect(byId.ac3.status).toBe('passed')
    await expect(s.retry(m.id)).rejects.toMatchObject({ code: 'not_retryable' })
  })
  it('misi yang tertinggal "running" saat aplikasi ditutup dipulihkan sebagai Needs Attention', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    const d = await svc.create({ goal: 'analisis yang terputus', fileId: f.id })
    const file = path.join(dir, 'missions', `${d.id}.json`)
    const rec = JSON.parse(await fs.readFile(file, 'utf8')); rec.state = 'running'; rec.approval = { status: 'approved', at: 1 }; rec.steps[1].status = 'running'
    await fs.writeFile(file, JSON.stringify(rec))
    const after = await mk().get(d.id)
    expect(after.state).toBe('needs_attention'); expect(after.failure).toMatchObject({ retryable: true, message: expect.stringMatching(/terputus/) }); expect(after.steps[1].status).toBe('pending')
    expect((await mk().retry(d.id)).state).toBe('completed')
  })
  it('cancel kooperatif: misi berjalan dibatalkan di antara langkah → state cancelled tanpa failure; cancel di luar running/antre ditolak 409', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    // Files "lambat": s1 (readBytes) menunggu gate → titik pembatalan yang deterministik.
    let entered = false
    let release
    const gate = new Promise((r) => { release = r })
    const slowFiles = {
      get: (id) => files.get(id),
      readBytes: async (id) => { entered = true; await gate; return files.readBytes(id) },
    }
    const slow = mk({ files: slowFiles })
    const d = await slow.create({ goal: 'misi untuk dibatalkan pengguna', fileId: f.id })
    const running = slow.approve(d.id) // sengaja tidak di-await
    for (let i = 0; !entered && i < 2000; i++) await new Promise((r) => setTimeout(r, 2))
    expect(entered).toBe(true)
    await slow.cancel(d.id)
    release()
    const m = await running
    expect(m.state).toBe('cancelled')
    expect(m.failure).toBeNull()
    const byId = Object.fromEntries(m.steps.map((s) => [s.id, s]))
    expect(byId.s1.status).toBe('done') // langkah yang berjalan diselesaikan dulu
    expect(byId.s2.status).toBe('pending') // langkah berikutnya tidak dijalankan
    await expect(slow.cancel(d.id)).rejects.toMatchObject({ code: 'not_cancellable' })
  })
  it('cancel misi draft/completed ditolak 409; cancel cukup sekali (duplikat 409)', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    const d = await svc.create({ goal: 'misi draft tidak bisa dibatalkan', fileId: f.id })
    await expect(svc.cancel(d.id)).rejects.toMatchObject({ code: 'not_cancellable' })
    const done = await svc.approve((await svc.create({ goal: 'misi selesai tidak bisa dibatalkan', fileId: f.id })).id)
    expect(done.state).toBe('completed')
    await expect(svc.cancel(done.id)).rejects.toMatchObject({ code: 'not_cancellable' })
  })
})

describe('daftar, hapus, dan akses artefak', () => {
  it('hapus misi menghapus artefak; artefak hanya dari allowlist; ID tidak valid ditolak', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    const m = await svc.approve((await svc.create({ goal: 'analisis untuk dihapus', fileId: f.id })).id)
    expect((await svc.list()).map((x) => x.id)).toEqual([m.id])
    expect((await svc.artifactPath(m.id, 'report.md')).path).toContain(m.id)
    expect(await svc.artifactPath(m.id, '../../missions/' + m.id + '.json')).toBeNull(); expect(await svc.artifactPath(m.id, 'rahasia.txt')).toBeNull()
    await expect(svc.get('../x')).rejects.toBeInstanceOf(MissionError)
    expect(await svc.remove(m.id)).toBe(true)
    expect(await svc.list()).toEqual([]); await expect(fs.access(path.join(dir, 'artifacts', m.id))).rejects.toThrow()
  })
  it('record misi rusak di disk tidak merusak daftar', async () => {
    const f = await up('sales.csv', fx('sales.csv'))
    const a = await svc.create({ goal: 'misi pertama valid', fileId: f.id }), b = await svc.create({ goal: 'misi kedua akan rusak', fileId: f.id })
    await fs.writeFile(path.join(dir, 'missions', `${b.id}.json`), '{rusak')
    expect((await mk().list()).map((x) => x.id)).toEqual([a.id])
  })
})
