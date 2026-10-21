// Granular Permission Model — izin didefinisikan dari operasi nyata yang didukung.
//
// Setiap izin describing KONDISI EKSEKUSI yang nyata. Izin TIDAK diklaim berlaku bila
// adapter terkait benar-benar memeriksanya (lihat `enforce` di bawah).
//
// Default aman: izin jaringan / efek samping eksternal / credential TIDAK diberikan
// hanya karena kapabilitas ada — harus ada konfigurasi nyata + persetujuan eksplisit.
import crypto from 'node:crypto'

export const PERMISSIONS = Object.freeze({
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  PROCESS_EXEC: 'process:exec',
  NETWORK_OUT: 'network:out',
  CREDENTIAL_USE: 'credential:use',
  SIDE_EFFECT_EXTERNAL: 'side-effect:external',
  PLUGIN_EXEC: 'plugin:exec',
  MCP_EXEC: 'mcp:exec',
})

export const PERMISSION_DESCRIPTIONS = Object.freeze({
  [PERMISSIONS.FILE_READ]: 'membaca berkas lokal',
  [PERMISSIONS.FILE_WRITE]: 'menulis berkas lokal',
  [PERMISSIONS.PROCESS_EXEC]: 'menjalankan proses lokal',
  [PERMISSIONS.NETWORK_OUT]: 'mengirim request keluar',
  [PERMISSIONS.CREDENTIAL_USE]: 'memakai credential/rahasia tersimpan',
  [PERMISSIONS.SIDE_EFFECT_EXTERNAL]: 'menimbulkan efek samping pada sistem luar',
  [PERMISSIONS.PLUGIN_EXEC]: 'menjalankan kode plugin lokal',
  [PERMISSIONS.MCP_EXEC]: 'menjalankan tool MCP',
})

export class PermissionError extends Error {
  constructor(status, code, message, detail) { super(message); this.status = status; this.code = code; this.detail = detail }
}

/** Izin yang WAJIB ada untuk menjalankan sebuah adapter (dari operasi nyata adapter tersebut). */
export function requiredPermissionsFor(entry) {
  switch (entry?.kind) {
    case 'mcp_tool':
      // Tool MCP lokal berjalan in-process dan hanya membaca data lokal.
      return [PERMISSIONS.MCP_EXEC, PERMISSIONS.FILE_READ]
    case 'plugin':
      // Plugin = kode lokal milik pengguna, berjalan in-process.
      return [PERMISSIONS.PLUGIN_EXEC, PERMISSIONS.FILE_READ]
    case 'connector':
      // Connector live menembak jaringan luar; memakai secret bila dikonfigurasi.
      return [PERMISSIONS.NETWORK_OUT, PERMISSIONS.SIDE_EFFECT_EXTERNAL, PERMISSIONS.CREDENTIAL_USE]
    case 'workflow':
      return [PERMISSIONS.FILE_READ, PERMISSIONS.FILE_WRITE]
    default:
      return []
  }
}

/**
 * Izin yang DIBERIKAN oleh konfigurasi nyata saat ini.
 * Tidak ada izin jaringan/efek samping/credential yang diberikan tanpa bukti konfigurasi.
 */
export function grantedPermissionsFor(entry, { confirm = false } = {}) {
  const granted = new Set()
  const kind = entry?.kind
  if (kind === 'mcp_tool') {
    granted.add(PERMISSIONS.MCP_EXEC)
    granted.add(PERMISSIONS.FILE_READ)
  } else if (kind === 'plugin') {
    if (entry?.meta?.enabled) granted.add(PERMISSIONS.PLUGIN_EXEC)
    granted.add(PERMISSIONS.FILE_READ)
  } else if (kind === 'connector') {
    if (entry?.meta?.live) {
      granted.add(PERMISSIONS.NETWORK_OUT)
      granted.add(PERMISSIONS.SIDE_EFFECT_EXTERNAL)
      // Credential hanya diberikan bila connector memang punya secret/tertoken yang terisi
      // (dibaca dari data konfigurasi nyata, bukan asumsi).
      const fields = entry?.meta?.configuredFields ?? {}
      const usesSecret = Object.entries(fields).some(([k, v]) => /secret|token|pass/i.test(k) && v?.set)
      if (usesSecret) granted.add(PERMISSIONS.CREDENTIAL_USE)
    }
  } else if (kind === 'workflow') {
    granted.add(PERMISSIONS.FILE_READ)
    granted.add(PERMISSIONS.FILE_WRITE)
  }
  // Konfirmasi eksplisit Surfase-member authorizes efek samping; tanpa itu efek samping tetap DENIED.
  if (entry?.sideEffects && entry.sideEffects !== 'none' && confirm === true) granted.add(PERMISSIONS.SIDE_EFFECT_EXTERNAL)
  return granted
}

/**
 * Titik pemeriksaan izin yang tunggal (dipakai registry & misi).
 * Melempar PermissionError(403) bila ada izin yang tidak diberikan.
 */
export function enforce({ required = [], granted = new Set(), capabilityId = null, action = 'run' } = {}) {
  const missing = required.filter((p) => !granted.has(p))
  if (!missing.length) return { ok: true, granted: [...granted] }
  throw new PermissionError(403, 'permission_denied',
    `Izin tidak cukup untuk tindakan ini: ${missing.join(', ')}.`,
    { capabilityId, action, missing, required })
}

/** Digest stabil untuk mengikat approval pada target/parameter tertentu. */
export function digestOf(value) {
  const stable = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(stable)
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k])
    return out
  }
  try {
    return crypto.createHash('sha256').update(JSON.stringify(stable(value)) ?? 'null').digest('hex')
  } catch {
    return null
  }
}
