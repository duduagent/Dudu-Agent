// @vitest-environment node
// Regresi pengemasan rilis: aturan pencocokan artefak HARUS terikat versi.
// (Bug nyata: paket 0.6.0 sempat memuat installer 0.3.0 karena regex tidak memuat versi.)
import { describe, expect, it } from 'vitest'
import { buildRules } from '../scripts/package-release.mjs'

const match = (platform, name) => buildRules('0.6.0')[platform].some(([, re]) => re.test(name))

describe('Aturan pencocokan artefak rilis', () => {
  it('mencocokkan artefak versi yang sedang dirilIS', () => {
    expect(match('windows', 'Dudu-AI-Setup-0.6.0-x64.exe')).toBe(true)
    expect(match('windows', 'Dudu-AI-Portable-0.6.0-x64.exe')).toBe(true)
    expect(match('linux', 'dudu-ai_0.6.0_amd64.deb')).toBe(true)
    expect(match('linux', 'Dudu-AI-0.6.0-x86_64.AppImage')).toBe(true)
    expect(match('linux', 'Dudu-AI-0.6.0-linux-x64-portable.tar.gz')).toBe(true)
    expect(match('macos', 'Dudu-AI-0.6.0-x64.dmg')).toBe(true)
    expect(match('macos', 'Dudu-AI-0.6.0-arm64.dmg')).toBe(true)
    expect(match('macos', 'Dudu-AI-Portable-0.6.0-arm64.zip')).toBe(true)
  })
  it('TIDAK mencocokkan artefak versi lain (regresi 0.3.0 ikut terbawa)', () => {
    for (const n of ['Dudu-AI-Setup-0.3.0-x64.exe', 'Dudu-AI-Portable-0.3.0-x64.exe', 'Dudu-AI-Setup-0.5.0-x64.exe', 'Dudu-AI-Portable-0.5.0-x64.exe']) {
      expect(match('windows', n), n).toBe(false)
    }
    expect(match('linux', 'Dudu-AI-0.5.0-x86_64.AppImage')).toBe(false)
    expect(match('macos', 'Dudu-AI-0.5.0-x64.dmg')).toBe(false)
  })
  it('TIDAK mencocokkan berkas lain di release/ (blockmap, zip paket, hash)', () => {
    for (const n of ['Dudu-AI-Setup-0.6.0-x64.exe.blockmap', 'Dudu-AI-0.6.0-Windows-x64.zip', 'SHA256SUMS-0.6.0.txt', 'SHA256SUMS-0.6.0-Windows.txt']) {
      expect(match('windows', n), n).toBe(false)
    }
  })
  it('versi dengan tanda baca khusus tetap aman (regex di-escape)', () => {
    const rules = buildRules('0.6.0-rc.1')
    expect(rules.windows[0][1].test('Dudu-AI-Setup-0.6.0-rc.1-x64.exe')).toBe(true)
    expect(rules.windows[0][1].test('Dudu-AI-Setup-0x6x0-rcx1-x64.exe')).toBe(false)
  })
})
