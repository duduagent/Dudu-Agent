// CLI Dudu (`dudu`) — bicara ke API lokal lewat HTTP, tanpa magic:
//   dudu status                → /api/health
//   dudu chat "pesan"          → /api/chat  (balasan + provider model, jika gateway aktif)
//   dudu kb "kueri pencarian"  → /api/kb/search
//   dudu usage                 → /api/usage
// Port: PORT (env) atau 8787 (default server). Token sesi: DUDU_BEARER (opsional).
// Header X-Dudu-Client selalu dikirim (sama seperti frontend) karena CLI mengubah data.
import util from 'node:util'

export const DEFAULT_PORT = 8787

export function parseArgs(argv) {
  const args = [...argv]
  const port = (() => { const i = args.indexOf('--port'); const v = i >= 0 ? Number(args[i + 1]) : NaN; if (i >= 0) { args.splice(i, 2) } return Number.isFinite(v) && v > 0 ? v : null })()
  const json = (() => { const j = args.includes('--json'); return j && args.splice(args.indexOf('--json'), 1), j })()
  const [cmd, ...rest] = args
  const valid = ['status', 'chat', 'kb', 'usage', 'help']
  return { command: valid.includes(cmd) ? cmd : null, outJson: json, port, arg: rest.join(' ').trim() }
}

async function call(path, { port, body, method, bearer }, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), 'x-dudu-client': '1', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

export async function run(argv, { fetchImpl = globalThis.fetch, env = {}, write = null } = {}) {
  const out = write ?? ((s) => process.stdout.write(s + '\n'))
  const errs = write ? out : ((s) => process.stderr.write(s + '\n'))
  const P = parseArgs(argv)
  const port = P.port ?? (Number(env.PORT) || DEFAULT_PORT)
  const bearer = env.DUDU_BEARER ?? null
  const print = (v) => { out(P.outJson ? JSON.stringify(v) : util.inspect(v, { depth: 6, colors: !P.outJson })) }
  if (!P.command || P.command === 'help') {
    errs([
      'dudu — CLI asisten Dudu AI (bicara ke server lokal).',
      '',
      '  dudu status            Status server + provider',
      '  dudu chat "<pesan>"    Kirim pesan ke chat dan tampilkan balasannya',
      '  dudu kb "<kueri>"      Cari di Knowledge Base',
      '  dudu usage             Ringkasan pemakaian & anggaran',
      '  --json                 Output JSON mentah   ·   --port N   Port server (default 8787)',
    ].join('\n'))
    return P.command ? 0 : 1
  }
  try {
    if (P.command === 'status') {
      const r = await call('/api/health', { port, bearer }, fetchImpl); print(r.body ?? r.status); return r.status === 200 ? 0 : 1
    }
    if (P.command === 'chat') {
      if (!P.arg) { errs('Berikan pesan: dudu chat "halo".'); return 1 }
      const r = await call('/api/chat', { port, bearer, body: { messages: [{ role: 'user', content: P.arg }], source: 'cli' } }, fetchImpl)
      if (r.status === 200) { out(P.outJson ? JSON.stringify(r.body.content) : r.body.content); if (!P.outJson && r.body.route) out(`— ${r.body.route.providerId}/${r.body.route.modelId} (${r.body.route.tier}, mode ${r.body.route.mode})`); return 0 }
      errs(`Gagal (${r.status}): ${r.body?.message || r.body?.error || 'tidak diketahui'}`); return 1
    }
    if (P.command === 'kb') {
      if (!P.arg) { errs('Berikan kueri: dudu kb "kata kunci".'); return 1 }
      const r = await call('/api/kb/search', { port, bearer, body: { query: P.arg } }, fetchImpl)
      if (r.status !== 200) { errs(`Gagal (${r.status}).`); return 1 }
      for (const h of r.body.results) out(`[${h.name} ${h.loc ?? ''}] ${h.text.slice(0, 240).replace(/\s+/g, ' ')}\n`)
      if (!r.body.results.length) out('Tidak ada hasil.'); return 0
    }
    if (P.command === 'usage') {
      const r = await call('/api/usage', { port, bearer }, fetchImpl)
      if (r.status !== 200) { errs(`Gagal (${r.status}).`); return 1 }
      const s = r.body?.summary ?? r.body
      if (P.outJson) print(s)
      else out(`Total permintaan: ${s?.totals?.requests ?? '?'} · token: in ${s?.totals?.promptTokens ?? '?'}/out ${s?.totals?.completionTokens ?? '?'} · berbayar: USD ${s?.cost?.paidUsd ?? 0}\nAnggaran: ${s?.budget?.state ?? '?'}`)
      return 0
    }
    return 1
  } catch (e) {
    errs(`Server lokal tidak terjangkau di port ${port}: ${e.message}. Jalankan aplikasi Dudu (atau npm run server) dulu.`)
    return 1
  }
}

// Hanya jalankan bila file ini entry point langsung.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('cli.mjs')) {
  run(process.argv.slice(2)).then((code) => process.exitCode = code)
}
