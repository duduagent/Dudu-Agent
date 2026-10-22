// @vitest-environment node
// Uji backend waiting list (landing page publik): validasi server, penyimpanan lokal
// yang aman, idempotensi per email, dan privasi (tidak ada endpoint pembacaan daftar).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../server/api.mjs'
import { resolveConfig } from '../server/config.mjs'
import { createWaitingListStore } from '../server/waiting-list.mjs'

const H = { 'x-dudu-client': '1' }
const H_JSON = (method, p, body) => ({ method, path: p, contentType: 'application/json', body: JSON.stringify(body ?? {}), headers: H })

let dir
const mkApi = () => createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: dir })

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dudu-wl-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('Waiting list: validasi & penyimpanan', () => {
  it('menyimpan entri dan mengembalikan receipt yang aman', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    const { entry, created } = await store.add({ email: '  Alumni@Example.com ', platform: 'android', role: 'creator', note: 'minat beta' })
    expect(created).toBe(true)
    expect(entry.email).toBe('alumni@example.com')     // dinormalisasi
    expect(entry.platform).toBe('android')
    expect(entry.role).toBe('creator')
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry).not.toHaveProperty('note')           // catatan internal tidak dikembalikan
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0].note).toBe('minat beta')
  })

  it('menolak email, platform, dan role yang tidak valid', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    await expect(store.add({ email: 'bukan-email' })).rejects.toMatchObject({ status: 400, code: 'bad_email' })
    await expect(store.add({ email: 'a@b.com', platform: 'nintendo' })).rejects.toMatchObject({ status: 400, code: 'bad_platform' })
    await expect(store.add({ email: 'a@b.com', role: 'wizard' })).rejects.toMatchObject({ status: 400, code: 'bad_role' })
  })

  it('idempoten per email: pendaftaran ulang tidak menduplikasi', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    await store.add({ email: 'a@example.com', platform: 'web' })
    const again = await store.add({ email: 'A@Example.com', platform: 'ios' })
    expect(again.created).toBe(false)
    expect(await store.count()).toBe(1)
  })

  it('memotong catatan panjang dan membuang karakter kontrol', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    await store.add({ email: 'a@example.com', note: 'x'.repeat(900) + '\u0000\u0007' })
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
    expect(raw.entries[0].note.length).toBeLessThanOrEqual(500)
    expect(raw.entries[0].note).not.toMatch(/[\u0000-\u001F]/)
  })

  it('berkas tidak bocor lewat endpoint baca mana pun', async () => {
    const api = mkApi()
    await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'a@example.com', platform: 'web' }))
    // Tidak boleh ada endpoint yang mengembalikan daftar/alamat email.
    for (const p of ['/api/waiting-list', '/api/waiting-list/list', '/api/waiting-list/count']) {
      const res = await api.handle({ method: 'GET', path: p })
      expect([404, 405], `GET ${p}`).toContain(res.status)
      expect(JSON.stringify(res.body ?? {})).not.toContain('a@example.com')
    }
  })
})

describe('Waiting list: API', () => {
  it('POST membuat entri (201) dan mengembalikan id', async () => {
    const api = mkApi()
    const res = await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'new@example.com', platform: 'windows', role: 'developer', note: 'hi' }))
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.entry.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('respons seragam: alamat yang sudah terdaftar tidak dibedakan (tanpa oracle penebakan email)', async () => {
    const api = mkApi()
    const first = await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'dup@example.com' }))
    const second = await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'DUP@example.com' }))
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    // Bentuk payload sama → penyerang tidak bisa menebak email yang sudah terdaftar.
    expect(Object.keys(second.body).sort()).toEqual(Object.keys(first.body).sort())
    expect(Object.keys(second.body.entry).sort()).toEqual(Object.keys(first.body.entry).sort())
    expect(second.body).not.toHaveProperty('created')
    // Alamat email milik sendiri pun tidak dikembalikan.
    expect(JSON.stringify(second.body)).not.toContain('dup@example.com')
  })

  it('input tidak valid → 400 dengan kode yang jelas', async () => {
    const api = mkApi()
    const res = await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'salah' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('bad_email')
    expect(res.body.message).toBeTruthy()
  })

  it('mutasi tanpa header anti-CSRF → 403 (konsisten dengan API lain)', async () => {
    const api = mkApi()
    const res = await api.handle({ method: 'POST', path: '/api/waiting-list', contentType: 'application/json', body: JSON.stringify({ email: 'x@example.com' }) })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  it('berkas tersimpan di folder data lokal, bukan di repo', async () => {
    const api = mkApi()
    await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'local@example.com' }))
    const exists = await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8')
    expect(exists).toContain('local@example.com')
    // Tidak ada berkas waiting-list di dalam repo/proyek.
    const inRepo = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    expect(inRepo).not.toContain('waiting-list.json')
  })
})

describe('Waiting list: ketahanan (audit v0.6.4)', () => {
  it('permintaan paralel aman: tidak ada entri hilang dan tidak ada error 500', async () => {
    const api = mkApi()
    const emails = Array.from({ length: 25 }, (_, i) => `par.${i}@example.invalid`)
    const results = await Promise.all(emails.map((e) => api.handle(H_JSON('POST', '/api/waiting-list', { email: e }))))
    expect(results.every((r) => r.status === 201)).toBe(true)
    const stored = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
    for (const e of emails) {
      expect(stored.entries.some((x) => x.email === e), `entri hilang: ${e}`).toBe(true)
    }
    expect(stored.entries).toHaveLength(emails.length)
  })

  it('batas laju: permintaan berlebih ditolak 429 (anti spam/banjir)', async () => {
    const store = createWaitingListStore({ dataDir: dir, maxPerMinute: 5 })
    for (let i = 0; i < 5; i++) await store.add({ email: `rate.${i}@example.invalid` })
    await expect(store.add({ email: 'rate.overflow@example.invalid' })).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
  })

  it('batas jumlah entri: daftar penuh ditolak, bukan membengkak tanpa batas', async () => {
    const store = createWaitingListStore({ dataDir: dir, maxEntries: 3 })
    for (let i = 0; i < 3; i++) await store.add({ email: `cap.${i}@example.invalid` })
    await expect(store.add({ email: 'cap.overflow@example.invalid' })).rejects.toMatchObject({ status: 429, code: 'list_full' })
  })

  it('berkas rusak diprahkan, bukan dihapus diam-diam', async () => {
    await fs.writeFile(path.join(dir, 'waiting-list.json'), '{bukan json')
    const store = createWaitingListStore({ dataDir: dir })
    const res = await store.add({ email: 'after.corrupt@example.invalid' })
    expect(res.entry.id).toMatch(/^[0-9a-f-]{36}$/)
    const files = await fs.readdir(dir)
    expect(files.some((f) => f.includes('corrupt')), 'berkas rusak haruskept').toBe(true)
    const summary = await store.summary()
    expect(summary.lastRecovery).toBeTruthy()
  })

  it('operator dapat menghapus entri (retensi/penghapusan)', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    await store.add({ email: 'hapus@example.invalid' })
    expect(await store.count()).toBe(1)
    expect((await store.remove('HAPUS@example.invalid')).removed).toBe(true)
    expect(await store.count()).toBe(0)
    expect((await store.remove('tidak.ada@example.invalid')).removed).toBe(false)
  })

  it('restart: instance baru membaca daftar dari disk', async () => {
    const api = mkApi()
    await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'restart@example.invalid' }))
    const fresh = createWaitingListStore({ dataDir: dir })
    expect(await fresh.count()).toBe(1)
  })

  it('email dengan tanda baca umum tetap valid (hyphen, plus, titik)', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    for (const mail of ['a-b@example.invalid', 'a+b@example.invalid', 'a.b@example.invalid']) {
      const res = await store.add({ email: mail })
      expect(res.entry.email, mail).toBe(mail)
    }
  })

  it('karakter kontrol dibuang, teks biasa tidak dirusak', async () => {
    const store = createWaitingListStore({ dataDir: dir })
    const res = await store.add({ email: 'ctrl@example.invalid', note: 'halo dunia' })
    expect(res.entry.id).toMatch(/^[0-9a-f-]{36}$/)
    const stored = JSON.parse(await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8'))
    expect(stored.entries[0].note).not.toMatch(/[\u0000-\u001F]/)
    expect(stored.entries[0].note).toContain('dunia')
  })

  it('folder penyimpanan tidak tersedia → error terkelola (bukan crash, tanpa membocorkan path)', async () => {
    const blocker = path.join(dir, 'blokir')
    await fs.writeFile(blocker, 'bukan direktori')
    const api = createApi({ getConfig: () => resolveConfig({ DUDU_PROVIDER_API_KEY: 'k' }), dataDir: path.join(blocker, 'sub') })
    const res = await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'broken@example.invalid' }))
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('storage_unavailable')
    // Pesan untuk operator harus bisa ditindaklanjuti, tanpa path internal.
    expect(res.body.message).toMatch(/folder data|ruang disk/i)
    expect(res.body.message).not.toContain('blokir')
    expect(JSON.stringify(res.body)).not.toContain('example.invalid')
  })

  it('body melebihi batas endpoint → 413 (berlaku juga di jalur lokal/Electron tanpa transport)', async () => {
    const api = mkApi()
    const big = JSON.stringify({ email: 'big@example.invalid', note: 'A'.repeat(20000) })
    const res = await api.handle(H_JSON('POST', '/api/waiting-list', big))
    expect(res.status).toBe(413)
    expect(res.body.error).toBe('request_too_large')
    const stored = await fs.readFile(path.join(dir, 'waiting-list.json'), 'utf8').catch(() => '')
    expect(stored).not.toContain('big@example.invalid')
  })
})
