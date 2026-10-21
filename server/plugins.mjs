// Plugin Dudu — pendeteksi plugin lokal di <dataDir>/plugins/<nama-plugin>/manifest.json.
// Manifest: { name, version, displayName?, description?, entry? }
//entry (opsional): file .mjs yang mengekspor default { name, description?, run(args) }.
// Eksekusi HANYA terjadi bila plugin diaktifkan, dan error eksekusi dilaporkan apa adanya (tidak pernah dibungkus jadi "sukses").
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export class PluginError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

export function createPluginStore({ dataDir }) {
  const root = path.join(dataDir, 'plugins')
  const stateFile = path.join(dataDir, 'plugins-state.json')
  let enabled = null
  const loaded = new Map() // id -> { entryModule } (cache)

  async function loadState() {
    if (enabled) return enabled
    try {
      const raw = JSON.parse(await fs.readFile(stateFile, 'utf8'))
      enabled = (raw && typeof raw.enabled === 'object') ? raw.enabled : {}
    } catch { enabled = {} }
    return enabled
  }
  const persist = () => fs.writeFile(stateFile, JSON.stringify({ version: 1, enabled }, null, 1), 'utf8')

  async function list() {
    await loadState()
    let names = []
    try { names = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
    const out = []
    for (const dir of names) {
      try {
        const m = JSON.parse(await fs.readFile(path.join(root, dir, 'manifest.json'), 'utf8'))
        const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : dir
        out.push({
          id: dir, name, displayName: m.displayName ?? name, version: m.version ?? null,
          description: m.description ?? null, entry: m.entry ?? null,
          enabled: Boolean(enabled[dir]),
          error: null,
        })
      } catch (e) {
        out.push({ id: dir, name: dir, displayName: dir, version: null, description: null, entry: null, enabled: false, error: `manifest.json tidak valid: ${e.message}` })
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  async function setEnabled(id, value) {
    await loadState()
    const manifestPath = path.join(root, id, 'manifest.json')
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id) || id.includes('..')) throw new PluginError(400, 'bad_plugin', `Nama folder plugin tidak valid: ${id}`)
    await fs.access(manifestPath).catch(() => { throw new PluginError(404, 'not_found', 'Plugin tidak ditemukan.') })
    enabled[id] = Boolean(value)
    if (!value) loaded.delete(id)
    await persist()
    return { id, enabled: enabled[id] }
  }

  /** Muat entry plugin (aman: error apa adanya). Hanya dipakai bila plugin diaktifkan. */
  async function loadEntry(id) {
    if (loaded.has(id)) return loaded.get(id)
    const manifest = JSON.parse(await fs.readFile(path.join(root, id, 'manifest.json'), 'utf8'))
    if (typeof manifest.entry !== 'string' || !manifest.entry.endsWith('.mjs')) throw new PluginError(422, 'no_entry', 'Plugin ini tidak punya entry .mjs yang bisa dimuat.')
    const entryPath = path.resolve(root, id, manifest.entry)
    if (!entryPath.startsWith(path.resolve(root, id))) throw new PluginError(400, 'bad_entry', 'Entry plugin keluar dari foldernya — ditolak.')
    const mod = await import(`file://${entryPath.replace(/\\/g, '/')}`)
    if (typeof mod.default?.run !== 'function') throw new PluginError(422, 'bad_entry', 'Entry plugin tidak mengekspor default.run(argumen).')
    const def = { name: mod.default.name ?? id, description: mod.default.description ?? null, run: mod.default.run }
    loaded.set(id, def); return def
  }

  async function runTool(id, args) {
    await loadState()
    if (!enabled[id]) throw new PluginError(409, 'plugin_disabled', 'Plugin belum diaktifkan.')
    const def = await loadEntry(id)
    try { return await def.run(args ?? {}) } catch (e) { throw new PluginError(500, 'plugin_run_failed', `Plugin gagal dijalankan: ${e.message}`) }
  }

  return { list, setEnabled, loadEntry, runTool }
}
