// Halaman integrasi v0.4.0: Akun (daftar/login email + OAuth Google/GitHub), MCP, CLI, Plugin,
// Connector, dan Input Data (→ Knowledge Base). Kejujuran jadi desain: status yang belum
// terverifikasi ditampilkan apa adanya, tanpa tombol yang berpura-pura berhasil.
import { useEffect, useState } from 'react'
import { api, authState, type SessionUser } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import { cx } from '../../lib/util'
import { CapabilityCatalog } from './CapabilityCatalog'
import { PageShell } from './PageShell'

const StateMsg = ({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry?: () => void }) =>
  error ? <p className="state-msg error" role="alert">{error}{onRetry && <button type="button" className="btn-link" onClick={onRetry}>Coba lagi</button>}</p>
  : loading ? <p className="state-msg" role="status">Memuat…</p> : null

/* ======================= AKUN (daftar/login + OAuth) ======================= */

export function AccountPage({ onToggleLeft, leftCollapsed }: { onToggleLeft: () => void; leftCollapsed: boolean }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  useEffect(() => authState.subscribe(setUser), [])
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(''); const [pass, setPass] = useState(''); const [name, setName] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const oauth = useLoad(async () => Promise.all([api.oauthStatus('google'), api.oauthStatus('github')]), [user?.id])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      if (mode === 'register') await api.authRegister(email, pass, name)
      else await api.authLogin(email, pass)
      setPass(''); setEmail('')
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)) } finally { setBusy(false) }
  }

  return (
    <PageShell title="Akun & Login" subtitle="Akun tersimpan di perangkat ini (server lokal). Tanpa login pun semua fitur tetap jalan — akun hanya identitas." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      {user ? (
        <section className="panel" aria-labelledby="acc-session-title">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="acc-session-title">Sesi aktif</h2>
              <p className="panel-sub">Anda masuk sebagai akun lokal di perangkat ini.</p>
            </div>
            <div className="panel-actions">
              <button type="button" className="btn-ghost" onClick={() => void api.authLogout()}>Keluar</button>
            </div>
          </div>
          <dl className="kv">
            <dt>Nama</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Metode</dt><dd>{user.provider}</dd>
          </dl>
          <p className="notice info"><span className="notice-body">Keluar tidak menghapus data percakapan/file — ia hanya menghapus sesi.</span></p>
        </section>
      ) : (
        <section className="panel" aria-labelledby="acc-form-title">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="acc-form-title">{mode === 'login' ? 'Masuk' : 'Daftar'} dengan email</h2>
              <p className="panel-sub">Akun lokal: kata sandi disimpan sebagai hash scrypt + salt di folder data perangkat ini, tidak pernah di server pusat.</p>
            </div>
            <div className="panel-actions">
              <button type="button" className="btn-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null) }}>
                {mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
              </button>
            </div>
          </div>
          <form onSubmit={(e) => void submit(e)}>
            <div className="form-grid">
              {mode === 'register' && (
                <label className="field" htmlFor="acc-name">
                  <span className="field-label">Nama</span>
                  <input id="acc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </label>
              )}
              <label className="field" htmlFor="acc-email">
                <span className="field-label">Email</span>
                <input id="acc-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <label className="field" htmlFor="acc-pass">
                <span className="field-label">Kata sandi</span>
                <input id="acc-pass" className="input" type="password" required minLength={8} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                {mode === 'register' && <span className="field-hint">Minimal 8 karakter. Disimpan sebagai hash scrypt + salt — sandi asli tidak pernah disimpan.</span>}
              </label>
            </div>
            {err && <p className="state-msg error" role="alert">{err}</p>}
            <div className="panel-foot">
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Daftar'}</button>
            </div>
          </form>
        </section>
      )}

      <section className="panel" aria-labelledby="acc-oauth-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="acc-oauth-title">Masuk dengan Google / GitHub</h2>
            <p className="panel-sub">
              OAuth butuh <strong>aplikasi milik Anda sendiri</strong> (Client ID + Client Secret) karena Dudu berjalan lokal dan tidak punya server pusat. Daftarkan sekali — lalu tombolnya benar-benar berfungsi.
              {' '}Redirect URI untuk pendaftaran aplikasi: <code>{`${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`}</code>
            </p>
          </div>
        </div>
        <StateMsg loading={oauth.loading && !oauth.data} error={oauth.error} onRetry={oauth.reload} />
        {(['google', 'github'] as const).map((provider) => {
          const st = oauth.data?.find((x) => x.provider === provider)
          return (
            <OAuthRow key={provider} provider={provider} configured={Boolean(st?.configured)} reload={oauth.reload} />
          )
        })}
      </section>
    </PageShell>
  )
}

function OAuthRow({ provider, configured, reload }: { provider: 'google' | 'github'; configured: boolean; reload: () => void }) {
  const [cid, setCid] = useState(''); const [secret, setSecret] = useState(''); const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null)
  const redirect = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : '/auth/callback'
  const [code, setCode] = useState('')

  async function saveApp() {
    setBusy(true); setErr(null); setMsg(null)
    try { await api.oauthSaveApp(provider, cid, secret); setMsg('Aplikasi tersimpan.'); setCid(''); setSecret(''); reload() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function signIn() {
    setBusy(true); setErr(null)
    try {
      const url = await api.oauthAuthorizeUrl(provider, redirect)
      window.open(url, '_blank', 'noopener')
      setMsg('Halaman otorisasi dibuka di tab baru. Setelah setuju, salin parameter ?code=… dari URL tujuan dan tempel di bawah.')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function exchange() {
    setBusy(true); setErr(null)
    try { await api.oauthExchange(provider, code.trim(), redirect); setMsg('Login berhasil.'); setCode(''); reload() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="oauth-row">
      <div className="panel-head">
        <h3 className="panel-title" style={{ fontSize: 'var(--fs-base)' }}>
          {provider === 'google' ? 'Google' : 'GitHub'}
          <span className={configured ? 'pill ok' : 'pill neutral'}>{configured ? 'terkonfigurasi' : 'belum dikonfigurasi'}</span>
        </h3>
      </div>
      {!configured ? (
        <>
          <div className="form-grid">
            <label className="field" htmlFor={`cid-${provider}`}>
              <span className="field-label">Client ID</span>
              <input id={`cid-${provider}`} className="input" value={cid} onChange={(e) => setCid(e.target.value)} autoComplete="off" />
            </label>
            <label className="field" htmlFor={`cs-${provider}`}>
              <span className="field-label">Client Secret</span>
              <input id={`cs-${provider}`} className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
            </label>
          </div>
          <p className="field-hint">
            {provider === 'google'
              ? 'Daftarkan di Google Cloud Console → OAuth client (Web application), lalu tempel Client ID + Client Secret di sini.'
              : 'Daftarkan di GitHub → Settings → Developer settings → OAuth Apps → New OAuth App, lalu tempel Client ID + Client Secret di sini.'}
            {' '}Rahasia disimpan di server lokal, tidak pernah dikirim ke UI lagi (hanya status).
          </p>
          <div className="panel-foot">
            <button type="button" className="btn-primary" disabled={busy || !cid || !secret} onClick={() => void saveApp()}>
              {busy ? 'Menyimpan…' : `Simpan aplikasi ${provider}`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="panel-foot" style={{ borderTop: 0, paddingTop: 0 }}>
            <button type="button" className="btn-primary" onClick={() => void signIn()}>Masuk dengan {provider}</button>
          </div>
          <label className="field" htmlFor={`code-${provider}`}>
            <span className="field-label">Kode dari redirect</span>
            <input id={`code-${provider}`} className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="tempel ?code=… di sini" />
          </label>
          <div className="panel-foot">
            <button type="button" className="btn-ghost" disabled={busy || !code.trim()} onClick={() => void exchange()}>Selesaikan login</button>
          </div>
        </>
      )}
      {msg && <p className="notice ok" role="status"><span className="notice-body">{msg}</span></p>}
      {err && <p className="state-msg error" role="alert">{err}</p>}
    </div>
  )
}

/* ======================= MCP ======================= */

export function McpPage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity?: (m: string) => void }) {
  const tools = useLoad(api.mcpTools, [])
  const servers = useLoad(api.mcpServers, [])
  const [label, setLabel] = useState(''); const [command, setCommand] = useState(''); const [args, setArgs] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [probingId, setProbingId] = useState<string | null>(null)

  async function add() {
    setBusy(true); setErr(null)
    try { await api.mcpAddServer(label, command, args.split(/\s+/).filter(Boolean)); setLabel(''); setCommand(''); setArgs(''); servers.reload() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function probe(id: string) {
    setProbingId(id); setErr(null)
    try { await api.mcpProbe(id); await servers.reload(); onActivity?.('Probe MCP selesai') } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setProbingId(null) }
  }
  const maskArg = (a: string) => /token|secret|key|pass/i.test(a) ? '[disamarkan]' : a

  return (
    <PageShell title="MCP" subtitle="Model Context Protocol — dua arah: server lokal menyediakan tool nyata; server eksternal bisa didaftarkan dan DITES dengan handshake sungguhan." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <StateMsg loading={tools.loading && !tools.data} error={tools.error} onRetry={tools.reload} />

      <section className="panel" aria-labelledby="mcp-local-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="mcp-local-title">Tool MCP Dudu <span className="pill ok">Server lokal · JSON-RPC 2.0</span></h2>
            <p className="panel-sub">Tool yang benar-benar dipetakan ke kemampuan Dudu: pencarian Knowledge Base (BM25), statistik Knowledge Base, dan daftar file.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{tools.data?.length ?? 0} tool</span>
          </div>
        </div>

        {tools.data && (
          <ul className="card-grid">
            {tools.data.map((t) => (
              <li key={t.name} className="card card-block">
                <div className="tile-top">
                  <span className="tile-avatar">MCP</span>
                  <span className="source-badge source-dudu">Dudu</span>
                </div>
                <div className="tile-head">
                  <strong>{t.name}</strong>
                  <span className="pill ok"><span className="status-dot ok" aria-hidden="true" />Tersedia</span>
                </div>
                <p className="meta">{t.description}</p>
                <details className="tile-where">
                  <summary>Input schema</summary>
                  <pre className="code-block">{JSON.stringify(t.inputSchema, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}

        <div className="panel-foot">
          <span className="meta">Transport: <code>POST /api/mcp/call</code> · Alur: <code>initialize → tools/list → tools/call</code></span>
        </div>
      </section>

      <section className="panel" aria-labelledby="mcp-ext-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="mcp-ext-title">MCP server eksternal (stdio) <span className="pill warn">Butuh proses lokal</span></h2>
            <p className="panel-sub">Daftarkan executable MCP server di perangkat ini. Dudu menjalankan handshake <code>initialize</code> + <code>tools/list</code> saat Anda menekan “Uji handshake”.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{servers.data?.length ?? 0} server</span>
          </div>
        </div>

        <div className="panel-body">
          <StateMsg loading={servers.loading && !servers.data} error={servers.error} onRetry={servers.reload} />
          {servers.data && servers.data.length === 0 && (
            <p className="empty-note">Belum ada server eksternal yang didaftarkan.</p>
          )}
          <ul className="cards">
            {servers.data?.map((s) => (
              <li key={s.id} className="card">
                <div className="card-text">
                  <div className="tile-head">
                    <strong>{s.label}</strong>
                    <span className={cx('pill', s.lastProbe?.ok ? 'ok' : s.lastProbe ? 'danger' : 'warn')}>
                      {s.lastProbe?.ok ? 'Handshake berhasil' : s.lastProbe ? 'Handshake gagal' : 'Belum diuji'}
                    </span>
                  </div>
                  <code className="cmd-code">{s.command} {s.args.map(maskArg).join(' ')}</code>
                  <span className="meta">
                    {s.lastProbe == null
                      ? 'Belum pernah diuji. Tekan “Uji handshake” untuk handshake initialize + tools/list nyata.'
                      : s.lastProbe.ok
                        ? `${s.lastProbe.ms ?? '?'} ms · tool: ${s.lastProbe.tools?.join(', ') || '(kosong)'}`
                        : `Gagal: ${s.lastProbe.error ?? '?'}`}
                  </span>
                </div>
                <div className="card-actions">
                  <button type="button" className="btn-ghost" disabled={probingId === s.id} onClick={() => void probe(s.id)}>{probingId === s.id ? 'Menguji…' : 'Uji handshake'}</button>
                  <button type="button" className="btn-danger" onClick={() => void api.mcpRemoveServer(s.id).then(servers.reload)}>Hapus</button>
                </div>
              </li>
            ))}
          </ul>

          <div className="divider" />
          <h3 className="section-title">Daftarkan server baru</h3>
          <div className="form-grid">
            <label className="field" htmlFor="mc-label">
              <span className="field-label">Label</span>
              <input id="mc-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. server-filesystem" />
              <span className="field-hint">Nama tampilan server ini di daftar.</span>
            </label>
            <label className="field" htmlFor="mc-cmd">
              <span className="field-label">Perintah (executable, tanpa shell)</span>
              <input id="mc-cmd" className="input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="contoh: node" />
              <span className="field-hint">Path executable absolut; tidak dijalankan lewat shell.</span>
            </label>
            <label className="field field--wide" htmlFor="mc-args">
              <span className="field-label">Argumen (dipisah spasi)</span>
              <input id="mc-args" className="input" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="contoh: C:\mcp\server.mjs" />
              <span className="field-hint">Argumen dibaca sebagai daftar terpisah, bukan string shell.</span>
            </label>
          </div>
          {err && <p className="state-msg error" role="alert">{err}</p>}
          <div className="panel-foot">
            <span className="meta">Perintah dijalankan tanpa shell dengan timeout handshake. Tool server eksternal belum dipanggil dari Dudu.</span>
            <button type="button" className="btn-primary" disabled={busy || !command} onClick={() => void add()}>{busy ? 'Mendaftarkan…' : 'Daftarkan server'}</button>
          </div>
        </div>

        <p className="notice warn">
          <span className="notice-body">
            <strong className="notice-title">Batas keamanan</strong>
            Jangan daftarkan server yang tidak Anda percaya: prosesnya berjalan dengan izin akun Anda di mesin ini.
          </span>
        </p>
      </section>

      <CapabilityCatalog category="mcp_server" externalOnly title="Referensi MCP eksternal" subtitle="Pemetaan dukungan MCP dari Hermes/OpenClaw. Referensi dokumentasi; bukan server yang terpasang." onActivity={onActivity} />
    </PageShell>
  )
}

/* ======================= CLI ======================= */

const CLI_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: 'Status & konfigurasi', items: [
    ['dudu status', 'Status server, provider, dan kapabilitas'],
    ['dudu status --json --port 8787', 'Keluaran JSON untuk skrip'],
  ] },
  { title: 'Chat', items: [
    ['dudu chat "ringkas dokumen terakhir"', 'Kirim pesan lewat /api/chat'],
  ] },
  { title: 'Knowledge Base', items: [
    ['dudu kb "kata kunci"', 'Cari di Knowledge Base (BM25)'],
  ] },
  { title: 'Pemakaian', items: [
    ['dudu usage', 'Ringkasan token/biaya yang dilaporkan provider'],
  ] },
]

export function CliPage({ onToggleLeft, leftCollapsed }: { onToggleLeft: () => void; leftCollapsed: boolean }) {
  const health = useLoad(async () => apiJsonSafe('/api/capabilities'), [])
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(cmd)
      window.setTimeout(() => setCopied((c) => (c === cmd ? null : c)), 1600)
    } catch {
      setCopied(null) // clipboard ditolak browser → tidak ada umpan balik palsu
    }
  }

  return (
    <PageShell title="CLI" subtitle="Perintah dudu bicara ke server lokal via HTTP — status, chat, pencarian KB, dan pemakaian." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <section className="panel" aria-labelledby="cli-server-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="cli-server-title">Server lokal</h2>
            <p className="panel-sub">Semua perintah di bawah bicara ke server Dudu yang sedang berjalan di perangkat ini.</p>
          </div>
          <div className="panel-actions">
            <span className={cx('pill', health.data ? 'ok' : 'warn')}>
              <span className={cx('status-dot', health.data ? 'ok' : 'warn')} aria-hidden="true" />
              {health.data ? 'Terjangkau' : health.loading ? 'Memeriksa…' : 'Tidak terjangkau'}
            </span>
          </div>
        </div>
        <StateMsg loading={health.loading && !health.data} error={health.error} onRetry={health.reload} />
        <p className={cx('notice', health.data ? 'ok' : 'warn')}>
          <span className="notice-body">
            {health.data
              ? 'Server merespons. Semua perintah di bawah siap dijalankan.'
              : 'Server belum merespons. Jalankan aplikasi atau perintah "npm run server" terlebih dahulu.'}
          </span>
        </p>
      </section>

      <section className="panel" aria-labelledby="cli-cmds-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="cli-cmds-title">Referensi perintah</h2>
            <p className="panel-sub">Klik “Salin” untuk menyalin perintah ke papan klip. Perintah berjalan di terminal, bukan di halaman ini.</p>
          </div>
        </div>
        <div className="panel-body">
          {CLI_GROUPS.map((g) => (
            <div key={g.title} className="cli-group">
              <h3 className="section-title">{g.title}</h3>
              <div className="cards">
                {g.items.map(([cmd, desc]) => (
                  <div key={cmd} className="cmd-row">
                    <div className="cmd-main">
                      <code className="cmd-code"><span className="cmd-prompt" aria-hidden="true">$</span>{cmd}</code>
                      <span className="cmd-desc">{desc}</span>
                    </div>
                    <button type="button" className={cx('copy-btn', copied === cmd && 'copied')} onClick={() => void copy(cmd)}
                      aria-label={`Salin perintah ${cmd}`}>
                      {copied === cmd ? 'Tersalin' : 'Salin'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel--quiet" aria-labelledby="cli-req-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="cli-req-title">Prasyarat & autentikasi</h2>
          </div>
        </div>
        <p className="panel-sub">
          Saat aplikasi terinstal, jalankan dari terminal: <code>node server/cli.mjs chat "halo"</code>, atau pasang global
          (<code>npm link</code>) untuk memakai perintah <code>dudu</code>. Token sesi bersifat opsional lewat variabel
          <code> DUDU_BEARER</code>; token kosong tetap berfungsi karena mode lokal tidak memaksa login.
        </p>
      </section>
    </PageShell>
  )
}
async function apiJsonSafe(path: string) { try { return await fetch(path, { headers: { 'X-Dudu-Client': '1' } }).then((r) => r.ok) } catch { return false } }

/* ======================= PLUGIN ======================= */

export function PluginsPage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity?: (m: string) => void }) {
  const plugins = useLoad(api.plugins, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [out, setOut] = useState<Record<string, string>>({})
  async function toggle(id: string, enabled: boolean) {
    setBusy(id)
    try { await api.pluginSetEnabled(id, enabled); await plugins.reload(); onActivity?.(`Plugin ${id} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`) }
    catch (e) { setOut((o) => ({ ...o, [id]: `Gagal: ${e instanceof Error ? e.message : String(e)}` })) }
    finally { setBusy(null) }
  }
  async function run(id: string) {
    if (!window.confirm('Jalankan kode plugin ini? Plugin berjalan di proses server lokal dengan izin penuh.')) return
    setBusy(id)
    try { const r = await api.pluginRun(id); setOut((o) => ({ ...o, [id]: typeof r === 'object' && r !== null && 'result' in r ? JSON.stringify((r as Record<string, unknown>).result, null, 2) : String(r) })) }
    catch (e) { setOut((o) => ({ ...o, [id]: `Gagal: ${e instanceof Error ? e.message : String(e)}` })) } finally { setBusy(null) }
  }
  return (
    <PageShell title="Plugin" subtitle="Plugin lokal di folder data aplikasi. Tidak ada toko plugin online — semua berkas di perangkat ini." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <StateMsg loading={plugins.loading && !plugins.data} error={plugins.error} onRetry={plugins.reload} />

      <section className="panel" aria-labelledby="plug-local-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="plug-local-title">Plugin terpasang</h2>
            <p className="panel-sub">Plugin adalah <strong>kode lokal</strong>. Status “aktif” berarti siap dijalankan, bukan bukti kode aman. Dudu tidak memasang plugin otomatis dan tidak menyalin plugin eksternal.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{plugins.data?.length ?? 0} plugin</span>
            <span className="pill ok">{plugins.data?.filter((p) => p.enabled && !p.error).length ?? 0} aktif</span>
          </div>
        </div>

        {plugins.loading && !plugins.data && <StateMsg loading error={null} />}
        {!plugins.loading && plugins.data && plugins.data.length === 0 && (
          <div className="empty-state">
            <h3>Belum ada plugin</h3>
            <p>Buat folder <code>&lt;folder-data&gt;/plugins/nama-plugin/manifest.json</code> minimal <code>{'{ "name": "nama", "version": "1.0.0", "entry": "plugin.mjs" }'}</code>, lalu <code>plugin.mjs</code> mengekspor default <code>{'{ run(args) }'}</code>. Daftar dimuat ulang tiap kali halaman dibuka.</p>
          </div>
        )}

        {plugins.data && plugins.data.length > 0 && (
          <ul className="card-grid">
            {plugins.data.map((p) => (
              <li key={p.id} className="card card-block">
                <div className="tile-top">
                  <span className="tile-avatar">PL</span>
                  <span className="source-badge source-user">Lokal</span>
                  <span className={cx('pill', p.error ? 'danger' : p.enabled ? 'ok' : 'neutral')}>
                    {p.error ? 'Rusak' : p.enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                <div className="tile-head"><strong>{p.displayName}</strong></div>
                <span className="meta">{p.id}{p.version ? ` · v${p.version}` : ''}{p.entry ? ` · ${p.entry}` : ''}</span>
                <p className="meta">{p.description ?? '(tanpa deskripsi)'}</p>
                {p.error && <p className="state-msg error" role="alert">{p.error}</p>}
                {out[p.id] && <details className="tile-where" open><summary>Hasil terakhir</summary><pre className="code-block">{out[p.id]}</pre></details>}
                <div className="tile-actions">
                  <label className="checkbox-field">
                    <input type="checkbox" checked={p.enabled} disabled={busy === p.id || Boolean(p.error)} onChange={(e) => void toggle(p.id, e.target.checked)} />
                    <span>Aktif</span>
                  </label>
                  <button type="button" className="btn-ghost" disabled={!p.enabled || Boolean(p.error) || busy === p.id} onClick={() => void run(p.id)}>{busy === p.id ? 'Menjalankan…' : 'Jalankan'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="notice info">
          <span className="notice-body">
            <strong className="notice-title">Cara kerja</strong>
            Entry plugin mengekspor <code>default.run(args)</code> yang dijalankan server lokal <strong>bila plugin diaktifkan</strong>; error eksekusi dilaporkan apa adanya. Validasi manifest tersedia di katalog kapabilitas.
          </span>
        </p>
      </section>

      <CapabilityCatalog category="plugin" externalOnly title="Referensi plugin eksternal" subtitle="Plugin Hermes/OpenClaw hanya dipetakan dari dokumentasi resmi; format dan lifecycle-nya belum diadopsi." onActivity={onActivity} />
    </PageShell>
  )
}

/* ======================= CONNECTOR ======================= */

export function ConnectorsPage({ onToggleLeft, leftCollapsed, onActivity }: { onToggleLeft: () => void; leftCollapsed: boolean; onActivity?: (m: string) => void }) {
  const connectors = useLoad(api.connectors, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({})

  async function save(id: string) {
    setBusy(id); setErr(null); setNote(null)
    try {
      await api.connectorSave(id, draft[id] ?? {})
      setDraft((d) => ({ ...d, [id]: {} }))
      setNote('Konfigurasi tersimpan. Uji koneksi untuk mendapatkan status nyata.')
      await connectors.reload(); onActivity?.('Connector dikonfigurasi')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  async function test(id: string) {
    setBusy(id); setErr(null); setNote(null)
    try { await api.connectorTest(id); await connectors.reload(); onActivity?.('Tes connector dijalankan') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <PageShell title="Connector" subtitle="Integrasi pihak ketiga. Status di sini benar-benar mencerminkan kemampuan saat ini." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <StateMsg loading={connectors.loading && !connectors.data} error={connectors.error} onRetry={connectors.reload} />
      {err && <p className="state-msg error" role="alert">{err}</p>}
      {note && <p className="notice ok" role="status"><span className="notice-body">{note}</span></p>}

      <section className="panel" aria-labelledby="conn-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="conn-title">Connector lokal</h2>
            <p className="panel-sub">Simpan konfigurasi lebih dulu, lalu uji koneksi untuk melihat hasil yang sebenarnya. Hanya <strong>webhook</strong> yang benar-benar dieksekusi.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{connectors.data?.length ?? 0} connector</span>
            <span className="pill ok">{connectors.data?.filter((c) => c.live).length ?? 0} live</span>
          </div>
        </div>

        <ul className="card-grid">
          {connectors.data?.map((c) => {
            const last = c.lastTest
            const status = !c.live
              ? { cls: 'warn', text: 'Kerangka — belum live' }
              : !c.configured
                ? { cls: 'neutral', text: 'Perlu konfigurasi' }
                : last
                  ? { cls: last.ok ? 'ok' : 'danger', text: last.ok ? 'Terhubung (teruji)' : 'Tes gagal' }
                  : { cls: 'warn', text: 'Belum diuji' }
            const draftHasValue = Object.values(draft[c.id] ?? {}).some((v) => v.trim())
            return (
              <li key={c.id} className="card card-block">
                <div className="tile-top">
                  <span className="tile-avatar">CO</span>
                  <span className="source-badge source-user">Lokal</span>
                  <span className={cx('pill', status.cls)}>
                    <span className={cx('status-dot', status.cls === 'ok' ? 'ok' : status.cls === 'danger' ? 'err' : status.cls === 'warn' ? 'warn' : 'idle')} aria-hidden="true" />
                    {status.text}
                  </span>
                </div>
                <div className="tile-head"><strong>{c.label}</strong></div>
                <div className="chip-row">
                  <span className="mini-badge">{c.category ?? 'Umum'}</span>
                  <span className={cx('mini-badge', c.live ? 'ok' : 'warn')}>{c.live ? 'implementasi live' : 'kerangka'}</span>
                  <span className="mini-badge">{c.access === 'read' ? 'baca' : 'tulis'}</span>
                </div>
                <p className="meta">{c.description}</p>
                {last && (
                  <p className={cx('meta', last.ok ? 'text-ok' : 'text-danger')}>
                    Uji terakhir: {last.ok ? `berhasil · HTTP ${last.status ?? '—'}` : `gagal — ${last.error ?? `HTTP ${last.status ?? '?'}`}`}
                  </p>
                )}

                <div className="connector-fields">
                  {c.requiredFields.map((f) => {
                    const current = c.fields[f]
                    const isSecret = /secret|token|pass/i.test(f)
                    return (
                      <label key={f} className="field" htmlFor={`cf-${c.id}-${f}`}>
                        <span className="field-label">{f}</span>
                        <input
                          id={`cf-${c.id}-${f}`}
                          className="input"
                          type={isSecret ? 'password' : 'text'}
                          autoComplete="off"
                          value={draft[c.id]?.[f] ?? ''}
                          placeholder={current?.set ? (current.value ? `tersimpan: ${current.value}` : 'tersimpan (rahasia)') : 'belum diisi'}
                          onChange={(e) => setDraft((d) => ({ ...d, [c.id]: { ...d[c.id], [f]: e.target.value } }))}
                        />
                        {isSecret && <span className="field-hint">Disimpan di server; nilai yang tersimpan hanya ditampilkan dalam bentuk tersamar.</span>}
                      </label>
                    )
                  })}
                </div>

                <div className="tile-actions">
                  <button type="button" className="btn-ghost" disabled={busy === c.id || !draftHasValue} onClick={() => void save(c.id)}>{busy === c.id ? 'Menyimpan…' : 'Simpan konfigurasi'}</button>
                  {c.live && <button type="button" className="btn-primary" disabled={busy === c.id || !c.configured} onClick={() => void test(c.id)}>{busy === c.id ? 'Menguji…' : 'Uji koneksi'}</button>}
                </div>
                {!c.live && <p className="meta">Status live belum tersedia. Tidak ada request keluar yang dilakukan.</p>}
              </li>
            )
          })}
        </ul>
      </section>

      <CapabilityCatalog category="connector" externalOnly title="Referensi connector eksternal" subtitle="Connector WorkBuddy (OAuth) dipetakan dari dokumentasi resmi dan belum diimpor ke Dudu." onActivity={onActivity} />
    </PageShell>
  )
}

/* ======================= INPUT DATA → KB ======================= */

export function DataInputPage({ onToggleLeft, leftCollapsed }: { onToggleLeft: () => void; leftCollapsed: boolean }) {
  const [title, setTitle] = useState(''); const [text, setText] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null)
  const kb = useLoad(async () => api.kb(), [])
  const [query, setQuery] = useState(''); const [hits, setHits] = useState<Array<{ name: string; loc: string | null; text: string }> | null>(null)

  async function save() {
    setBusy(true); setErr(null); setDone(null)
    try {
      const r = await api.kbAddText(title, text)
      setDone(`"${r.file.name}" tersimpan & terindeks (${r.indexed.chunks} potongan). Chat akan membacanya otomatis sesuai kata kunci (BM25).`)
      setTitle(''); setText(''); kb.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function search() {
    setErr(null)
    try { const r = await fetch('/api/kb/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dudu-Client': '1' }, body: JSON.stringify({ query }) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); setHits(((await r.json()) as { results: Array<{ name: string; loc: string | null; text: string }> }).results) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <PageShell title="Input Data" subtitle="Masukkan teks/catatan langsung — data langsung diindeks ke Knowledge Base dan TERBACA oleh chat, misi, dan MCP." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <section className="panel" aria-labelledby="di-add-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="di-add-title">Tambah dokumen</h2>
            <p className="panel-sub">Teks di bawah disimpan di perangkat ini, dipecah menjadi potongan, lalu diindeks untuk pencarian BM25. Setelah tersimpan, chat dan misi bisa mengutipnya.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{kb.data?.docs.length ?? 0} dokumen</span>
            <span className="pill neutral">{kb.data?.chunks ?? 0} potongan</span>
          </div>
        </div>

        <div className="panel-body">
          <label className="field" htmlFor="di-title">
            <span className="field-label">Judul</span>
            <input id="di-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. SOP Peluncuran" maxLength={60} />
            <span className="field-hint">Nama dokumen yang mudah dikenali saat hasil pencarian muncul.</span>
          </label>

          <label className="field" htmlFor="di-text">
            <span className="field-label">Isi dokumen</span>
            <textarea id="di-text" className="input" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tempelkan teks, catatan rapat, spesifikasi…" />
          </label>

          {err && <p className="state-msg error" role="alert">{err}</p>}
          {done && <p className="notice ok" role="status"><span className="notice-body">{done}</span></p>}
        </div>

        <div className="panel-foot">
          <span className="meta">{text.length.toLocaleString('id-ID')} karakter · batas 200.000 per dokumen</span>
          <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={() => void save()}>
            {busy ? 'Menyimpan…' : 'Masukkan ke Knowledge Base'}
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="di-test-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="di-test-title">Uji bahwa sistem membacanya</h2>
            <p className="panel-sub">Cari kata kunci dari dokumen yang tadi dimasukkan. Pencarian memakai pencocokan kata kunci (BM25), jadi kata dengan ejaan berbeda belum tentu ditemukan.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="toolbar">
            <label className="sr-only" htmlFor="di-q">Kata kunci pencarian</label>
            <input id="di-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="kata kunci dari dokumen yang tadi dimasukkan" onKeyDown={(e) => { if (e.key === 'Enter') void search() }} />
            <button type="button" className="btn-primary" disabled={!query.trim()} onClick={() => void search()}>Cari</button>
          </div>
          {hits != null && (
            hits.length === 0
              ? <p className="notice info"><span className="notice-body">Tidak ada hasil — jika ini dokumen yang baru saja Anda masukkan, kata kuncinya belum cocok (retrieval leksikal BM25).</span></p>
              : <ul className="cards">{hits.map((h, i) => (
                <li key={i} className="card">
                  <div className="card-text">
                    <strong>{h.name}{h.loc ? ` — ${h.loc}` : ''}</strong>
                    <p className="snippet">{h.text.slice(0, 240)}{h.text.length > 240 ? '…' : ''}</p>
                  </div>
                </li>
              ))}</ul>
          )}
          <StateMsg loading={kb.loading && !kb.data} error={kb.error} onRetry={kb.reload} />
          {kb.data && (
            <div className="stat-grid">
              <div className="stat"><span className="stat-value">{kb.data.docs.length}</span><span className="stat-label">Dokumen terindeks</span></div>
              <div className="stat"><span className="stat-value">{kb.data.chunks}</span><span className="stat-label">Potongan retrieval</span></div>
              <div className="stat"><span className="stat-value">BM25</span><span className="stat-label">Metode pencarian</span></div>
            </div>
          )}
        </div>
      </section>
    </PageShell>
  )
}

