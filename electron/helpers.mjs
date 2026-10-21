// Logika murni (tanpa API Electron) agar dapat diuji unit.
import fs from 'node:fs'
import path from 'node:path'
import { ENV_TEMPLATE, parseEnvFile, resolveConfig } from '../server/config.mjs'

export const SCHEME = 'dudu'
export const HOST = 'app'
export const ORIGIN = `${SCHEME}://${HOST}`
export const ENV_FILE_NAME = 'dudu.env'

// Hanya sumber dari origin aplikasi sendiri. Font di-bundle lokal, API lewat origin yang sama.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Ubah path URL menjadi path file di dalam `root`; null bila mencoba keluar dari root. */
export function resolveStaticPath(root, urlPathname) {
  let decoded
  try { decoded = decodeURIComponent(urlPathname) } catch { return null }
  if (decoded.includes('\0')) return null
  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const resolvedRoot = path.resolve(root)
  const full = path.resolve(resolvedRoot, rel)
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) return null
  return full
}

/** Hanya http(s) yang boleh dibuka di browser eksternal. */
export function isAllowedExternalUrl(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch { return false }
}

// Catatan: URL.origin di Node bernilai "null" untuk skema non-standar, jadi bandingkan protocol + host.
export function isAppUrl(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === `${SCHEME}:` && u.host === HOST
  } catch { return false }
}

export function envFilePath(userDataDir) {
  return path.join(userDataDir, ENV_FILE_NAME)
}

/** Konfigurasi = environment sistem (prioritas) + dudu.env di folder data pengguna. Dibaca ulang tiap dipanggil. */
export function loadDesktopConfig(userDataDir, env = process.env) {
  let fileValues = {}
  try { fileValues = parseEnvFile(fs.readFileSync(envFilePath(userDataDir), 'utf8')) } catch { /* belum ada: wajar */ }
  return resolveConfig(env, fileValues)
}

/** Buat dudu.env berisi template (tanpa rahasia) bila belum ada. Izin 0600 agar kunci API tidak terbaca user lain. */
export function ensureEnvTemplate(userDataDir) {
  const file = envFilePath(userDataDir)
  fs.mkdirSync(userDataDir, { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, ENV_TEMPLATE, { mode: 0o600 })
  return file
}
