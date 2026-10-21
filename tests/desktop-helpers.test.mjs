// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CSP, ENV_FILE_NAME, ensureEnvTemplate, isAllowedExternalUrl, isAppUrl, loadDesktopConfig, resolveStaticPath } from '../electron/helpers.mjs'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudu-test-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('resolveStaticPath (anti path traversal)', () => {
  const root = path.resolve('/app/dist')
  it('memetakan / ke index.html dan aset ke dalam root', () => {
    expect(resolveStaticPath(root, '/')).toBe(path.join(root, 'index.html'))
    expect(resolveStaticPath(root, '/assets/a.js')).toBe(path.join(root, 'assets', 'a.js'))
  })
  it.each(['/../secret', '/..%2f..%2fetc/passwd', '/assets/../../x', '/%2e%2e/%2e%2e/x', '/a%00b'])('menolak %s', (p) => {
    expect(resolveStaticPath(root, p)).toBeNull()
  })
  it('menolak escape yang namanya hanya berawalan sama dengan root', () => {
    expect(resolveStaticPath(root, '/../dist-evil/x')).toBeNull()
  })
  it('menolak persen-encoding rusak', () => {
    expect(resolveStaticPath(root, '/%E0%A4%A')).toBeNull()
  })
})

describe('URL', () => {
  it('hanya http(s) yang boleh dibuka eksternal', () => {
    expect(isAllowedExternalUrl('https://example.com/x')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(true)
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'dudu://app/', 'smb://x', 'bukan url']) expect(isAllowedExternalUrl(u)).toBe(false)
  })
  it('isAppUrl hanya mengenali origin dudu://app', () => {
    expect(isAppUrl('dudu://app/')).toBe(true)
    expect(isAppUrl('dudu://app/x?y=1')).toBe(true)
    expect(isAppUrl('dudu://evil/')).toBe(false)
    expect(isAppUrl('https://app/')).toBe(false)
  })
  it('CSP tidak mengizinkan script inline/eval maupun sumber eksternal', () => {
    expect(CSP).toContain("script-src 'self'")
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/)
  })
})

describe('konfigurasi desktop (folder data pengguna)', () => {
  it('tanpa file: provider belum terkonfigurasi, tidak melempar', () => {
    expect(loadDesktopConfig(dir, {}).apiKey).toBeUndefined()
  })
  it('membuat template tanpa rahasia, idempoten, dan tidak menimpa file yang sudah diisi', () => {
    const file = ensureEnvTemplate(dir)
    expect(path.basename(file)).toBe(ENV_FILE_NAME)
    expect(loadDesktopConfig(dir, {}).apiKey).toBeUndefined()
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    fs.writeFileSync(file, 'DUDU_PROVIDER_API_KEY=abc\nDUDU_MODEL=model-x\n')
    ensureEnvTemplate(dir)
    expect(loadDesktopConfig(dir, {})).toMatchObject({ apiKey: 'abc', model: 'model-x' })
  })
  it('dibaca ulang tiap dipanggil (perubahan berlaku tanpa restart) dan env sistem menang', () => {
    const file = ensureEnvTemplate(dir)
    fs.writeFileSync(file, 'DUDU_PROVIDER_API_KEY=lama\n')
    expect(loadDesktopConfig(dir, {}).apiKey).toBe('lama')
    fs.writeFileSync(file, 'DUDU_PROVIDER_API_KEY=baru\n')
    expect(loadDesktopConfig(dir, {}).apiKey).toBe('baru')
    expect(loadDesktopConfig(dir, { DUDU_PROVIDER_API_KEY: 'dari-env' }).apiKey).toBe('dari-env')
  })
})
