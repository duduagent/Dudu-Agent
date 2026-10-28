// MCP (Model Context Protocol) — dua arah, tanpa karangan:
// 1) SERVER: Dudu menyediakan tool NYATA via JSON-RPC 2.0 (initialize / tools/list / tools/call).
//    Tool dipetakan ke kemampuan lokal: pencarian Knowledge Base, statistik KB, dan daftar file.
// 2) KLIEN: pengguna bisa mendaftarkan MCP server eksternal (stdio). "Uji" menjalankan handshake
//    initialize + tools/list sungguhan dengan timeout — hasil apa adanya, gagal dilaporkan jujur.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

export const JSONRPC_VERSION = '2.0'
const HANDSHAKE_TIMEOUT_MS = 10_000

export class McpError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function jsonRpcOk(id, result) { return { jsonrpc: JSONRPC_VERSION, id, result } }
function jsonRpcErr(id, code, message) { return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } } }

export function createMcpGateway({ tools }) {
  /** @param {{ jsonrpc?, id?, method?, params? }} msg */
  async function handle(msg) {
    const id = msg?.id ?? null
    if (msg?.jsonrpc !== JSONRPC_VERSION || !msg?.method) return { status: 400, body: jsonRpcErr(id, -32600, 'Bukan permintaan JSON-RPC 2.0 yang valid.') }
    try {
      if (msg.method === 'initialize') {
        return { status: 200, body: jsonRpcOk(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dudu-ai', version: '0.5.0' },
        }) }
      }
      if (msg.method === 'ping') return { status: 200, body: jsonRpcOk(id, {}) }
      if (msg.method === 'tools/list') {
        return { status: 200, body: jsonRpcOk(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }) }
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params ?? {}
        const tool = tools.find((t) => t.name === name)
        if (!tool) return { status: 200, body: jsonRpcErr(id, -32602, `Tool tidak dikenal: ${name}. Panggil tools/list untuk daftar yang ada.`) }
        try {
          const out = await tool.run(args ?? {})
          return { status: 200, body: jsonRpcOk(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }], isError: false }) }
        } catch (e) {
          return { status: 200, body: jsonRpcOk(id, { content: [{ type: 'text', text: `Gagal: ${e.message}` }], isError: true }) }
        }
      }
      return { status: 200, body: jsonRpcErr(id, -32601, `Metode tidak ada: ${msg.method}.`) }
    } catch (e) {
      return { status: 500, body: jsonRpcErr(id, -32603, `Kesalahan internal MCP: ${e.message}`) }
    }
  }
  return { handle }
}

/** Klien MCP stdio: handshake nyata (initialize → notifications/initialized → tools/list). */
async function probeExternalServer({ command, args = [] }) {
  if (typeof command !== 'string' || !command.trim()) throw new McpError(-32602, 'Perintah MCP server kosong.')
  const started = Date.now()
  // Tanpa shell: perintah harus berupa executable/path yang eksplisit (lebih aman & andal).
  const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const chunks = []
  proc.stdout?.on('data', (d) => chunks.push(d))
  let stderr = ''
  proc.stderr?.on('data', (d) => { if (stderr.length < 4000) stderr += String(d) })
  const send = (obj) => { try { proc.stdin?.write(`${JSON.stringify(obj)}\n`) } catch { /* stdin tutup */ } }

  // Kirim handshake lebih dulu, baru pantau balasannya.
  send({ jsonrpc: JSONRPC_VERSION, id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dudu-ai', version: '0.5.0' } } })
  send({ jsonrpc: JSONRPC_VERSION, method: 'notifications/initialized' })
  send({ jsonrpc: JSONRPC_VERSION, id: 2, method: 'tools/list' })

  const result = await new Promise((resolve) => {
    const cleanup = () => { clearTimeout(timer); try { proc.kill('kill') } catch { /* sudah mati */ } }
    const timer = setTimeout(() => {
      cleanup()
      const partial = Buffer.concat(chunks).toString('utf8').trim()
      resolve({ ok: false, error: `Timeout ${HANDSHAKE_TIMEOUT_MS / 1000} detik tanpa handshake lengkap.${partial ? ` Keluaran parsial: ${partial.slice(0, 200)}` : stderr ? ` stderr: ${stderr.slice(0, 200)}` : ''}` })
    }, HANDSHAKE_TIMEOUT_MS)
    proc.on('error', (e) => { cleanup(); resolve({ ok: false, error: `Gagal menjalankan "${command}": ${e.message}` }) })
    const poll = setInterval(() => {
      const buf = Buffer.concat(chunks).toString('utf8')
      const lines = buf.split('\n').filter((l) => l.trim())
      if (!lines.length) return
      // Cari balasan initialize (id 1) lalu tools/list (id 2).
      let init = null, toolList = null, parseErr = null
      for (const line of lines) {
        try { const msg = JSON.parse(line)
          if (msg.id === 1) init = msg
          if (msg.id === 2) toolList = msg
        } catch (e) { parseErr = e.message }
      }
      if (init?.error) { clearInterval(poll); cleanup(); resolve({ ok: false, error: `initialize ditolak server: ${init.error.message ?? JSON.stringify(init.error)}` }) }
      else if (init && toolList) {
        clearInterval(poll); cleanup()
        const tools = (toolList.result?.tools ?? []).map((t) => t.name)
        resolve({ ok: true, serverInfo: init.result?.serverInfo ?? null, tools, parseErr, ms: Date.now() - started }) 
      } else if (init && Date.now() - started > 4000) { clearInterval(poll); cleanup(); resolve({ ok: false, error: 'initialize dibalas tetapi tools/list tidak pernah datang.' }) }
    }, 150)
  })
  return result
}

export function createMcpClientStore({ dataDir, fetchImpl = globalThis.fetch }) {
  const file = path.join(dataDir, 'mcp-servers.json')
  let cache = null
  async function load() {
    if (cache) return cache
    try { cache = JSON.parse(await fs.readFile(file, 'utf8')) } catch {}
    cache = (cache && cache.version === 1 && Array.isArray(cache.servers)) ? cache : { version: 1, servers: [] }
    return cache
  }
  const persist = () => writeAtomic(file, JSON.stringify(cache, null, 1))
  function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    return fs.writeFile(tmp, data, 'utf8').then(() => fs.rename(tmp, file))
  }

  async function listServers() {
    const st = await load()
    return st.servers
  }
  async function addServer({ label, command, args }) {
    const st = await load()
    if (typeof command !== 'string' || !command.trim()) throw new McpError(-32602, 'Perintah wajib diisi.')
    const id = crypto.randomUUID()
    st.servers.push({ id, label: String(label ?? command).slice(0, 60), command: command.trim(), args: Array.isArray(args) ? args.map(String) : [], addedAt: Date.now(), lastProbe: null })
    await persist()
    return st.servers[st.servers.length - 1]
  }
  async function removeServer(id) {
    const st = await load()
    const i = st.servers.findIndex((s) => s.id === id)
    if (i < 0) return false
    st.servers.splice(i, 1); await persist(); return true
  }
  async function probe(id) {
    const st = await load()
    const s = st.servers.find((x) => x.id === id)
    if (!s) throw new McpError(-32602, 'Server MCP tidak ditemukan.')
    const out = await probeExternalServer(s)
    s.lastProbe = { at: Date.now(), ok: out.ok, tools: out.tools ?? null, serverInfo: out.serverInfo ?? null, error: out.error ?? null, ms: out.ms ?? null }
    await persist()
    return s.lastProbe
  }
  return { listServers, addServer, removeServer, probe: (id) => probe(id) }
}
