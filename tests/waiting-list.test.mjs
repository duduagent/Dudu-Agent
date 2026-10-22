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
    expect(res.body.created).toBe(true)
    expect(res.body.entry.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('pendaftaran ulang mengembalikan 200 created=false', async () => {
    const api = mkApi()
    await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'dup@example.com' }))
    const res = await api.handle(H_JSON('POST', '/api/waiting-list', { email: 'dup@example.com' }))
    expect(res.status).toBe(200)
    expect(res.body.created).toBe(false)
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
