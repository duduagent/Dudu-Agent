import { useEffect, useState, type FormEvent } from 'react'
import { api, type Capabilities, type CatalogModel, type GatewayProvider, type RoutingMode, type RoutingSettings, type UsageSummary } from '../../lib/api'
import { MAX_NOTES, MAX_NOTE_CHARS, loadMemory, saveMemory, type MemoryNote } from '../../lib/memory'
import { useLoad } from '../../lib/useLoad'
import { cx } from '../../lib/util'
import { Icon } from '../ui'
import { STATE_LABEL } from './MissionsPage'
import { CapabilityCatalog } from './CapabilityCatalog'
import { PageShell, StateMsg, fmtDate } from './PageShell'

interface PageProps { onToggleLeft: () => void; leftCollapsed: boolean; onActivity?: (m: string) => void }

type Status = 'ok' | 'warn' | 'off'
const statusOf = (configured: boolean): { s: Status; label: string } => configured ? { s: 'warn', label: 'Dikonfigurasi (koneksi belum diuji)' } : { s: 'off', label: 'Belum dikonfigurasi' }

function toolRows(c: Capabilities): Array<{ name: string; desc: string; s: Status; label: string; note?: string }> {
  const chat = statusOf(c.chat.configured), vision = statusOf(c.vision.configured), stt = statusOf(c.stt.configured)
  return [
    { name: 'Ekstraksi dokumen', desc: 'PDF (teks), DOCX, XLSX, PPTX, ODT/ODS/ODP, RTF, HTML, teks/kode/CSV/JSON, daftar isi ZIP', s: 'ok', label: 'Tersedia (lokal)' },
    { name: 'OCR (PDF/gambar pindaian)', desc: 'Membaca teks dari gambar', s: 'off', label: 'Tidak tersedia', note: c.ocr.reason },
    { name: 'Analisis data (data.profile)', desc: 'Parse CSV/TSV/JSON/JSONL/XLSX, profil kolom dan statistik', s: 'ok', label: 'Tersedia (lokal)' },
    { name: 'Penulis laporan (report.write)', desc: 'Menulis artefak report.md dan profile.json dengan hash', s: 'ok', label: 'Tersedia (lokal)' },
    { name: 'Knowledge Base', desc: 'Chunking + indeks persisten + retrieval BM25 dengan sumber', s: 'ok', label: 'Tersedia (kata kunci)', note: c.embeddings.reason },
    { name: 'Provider chat', desc: `Model: ${c.chat.model}`, s: chat.s, label: chat.label, note: c.chat.configured ? 'Status "Terhubung" muncul di chat setelah balasan pertama yang sukses.' : 'Isi DUDU_PROVIDER_API_KEY.' },
    { name: 'Vision (gambar)', desc: c.vision.model ? `Model: ${c.vision.model}` : 'Memahami isi gambar', s: vision.s, label: vision.label, note: c.vision.reason ?? undefined },
    { name: 'Transkripsi audio', desc: c.stt.model ? `Model: ${c.stt.model}` : 'Mengubah audio menjadi teks', s: stt.s, label: stt.label, note: c.stt.reason ?? undefined },
    { name: 'Pemrosesan video', desc: 'Ekstraksi frame + transkripsi audio', s: 'off', label: 'Tidak tersedia', note: c.video.reason },
    { name: 'Embedding semantik', desc: 'Pencarian berdasarkan makna', s: 'off', label: 'Tidak tersedia', note: c.embeddings.reason },
  ]
}
const ToolsTable = ({ c }: { c: Capabilities }) => (
  <ul className="cards" aria-label="Registri tool">
    {toolRows(c).map(r => (
      <li key={r.name} className="card"><div className="card-text"><strong>{r.name}</strong><span className="meta">{r.desc}</span>{r.note && <span className="meta">{r.note}</span>}</div>
        <span className={cx('pill', r.s === 'ok' ? 'ok' : r.s === 'warn' ? 'warn' : 'neutral')}>{r.label}</span></li>
    ))}
  </ul>
)

export function ToolsPage({ onToggleLeft, leftCollapsed, onActivity }: PageProps) {
  const caps = useLoad(api.capabilities)
  return (
    <PageShell title="Tools & Integrations" subtitle="Kemampuan yang benar-benar ada, dengan status sebenarnya." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <p className="notice info">
        <span className="notice-body">
          “Dikonfigurasi” berarti kunci dan model sudah diatur — <strong>bukan</strong> bukti bahwa layanan eksternal bekerja. Tidak ada integrasi pihak ketiga (email, kalender, repositori, dll.) yang terhubung saat ini.
        </span>
      </p>
      <StateMsg loading={caps.loading && !caps.data} error={caps.error} onRetry={caps.reload} />
      {caps.data && (
        <section className="panel" aria-labelledby="tools-registry-title">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="tools-registry-title">Registri tool</h2>
              <p className="panel-sub">Setiap baris berasal dari server — status “Tersedia” berarti kemampuan itu benar-benar ada di aplikasi ini.</p>
            </div>
            <div className="panel-actions">
              <span className="pill ok">{toolRows(caps.data).filter((r) => r.s === 'ok').length} tersedia</span>
              <span className="pill neutral">{toolRows(caps.data).filter((r) => r.s !== 'ok').length} tidak tersedia</span>
            </div>
          </div>
          <ToolsTable c={caps.data} />
        </section>
      )}
      <CapabilityCatalog onActivity={onActivity} />
    </PageShell>
  )
}

export function WorkforcePage({ onToggleLeft, leftCollapsed }: PageProps) {
  const ms = useLoad(api.missions)
  const list = ms.data ?? []
  const count = (s: string) => list.filter(m => m.state === s).length
  return (
    <PageShell title="Agent Workforce" subtitle="Pelaksana yang benar-benar tersedia saat ini." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <StateMsg loading={ms.loading && !ms.data} error={ms.error} onRetry={ms.reload} />

      <section className="panel" aria-labelledby="wf-active-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="wf-active-title">Pelaksana aktif</h2>
            <p className="panel-sub">Pelaksana yang berjalan di perangkat ini, dengan izin dan verifikasinya sendiri.</p>
          </div>
          <div className="panel-actions"><span className="pill ok">Tersedia</span></div>
        </div>
        <ul className="cards"><li className="card">
          <div className="card-text">
            <strong>Pelaksana Analisis Data (lokal)</strong>
            <span className="meta">Tool: input.validate → data.load → data.profile → report.write → verify.criteria. Berjalan di perangkat ini; tanpa jaringan; menulis hanya ke folder artefak misi.</span>
            <span className="meta">Misi: {list.length} total · {count('completed')} selesai · {count('needs_attention')} {STATE_LABEL.needs_attention.toLowerCase()} · {count('failed')} gagal · {count('draft')} draft</span>
          </div>
        </li></ul>
      </section>

      <section className="panel" aria-labelledby="wf-missing-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="wf-missing-title">Belum ada</h2>
            <p className="panel-sub">Direncanakan, tetapi belum diimplementasikan — status ini ditampilkan apa adanya, bukan disamarakan.</p>
          </div>
        </div>
        <ul className="cards">
          {['Agen otonom berbasis LLM (perencanaan dan pemilihan tool oleh model)', 'Adapter coding-agent eksternal', 'Eksekusi paralel beberapa agen'].map(t => (
            <li key={t} className="card"><div className="card-text"><strong>{t}</strong></div><span className="pill neutral">Belum diimplementasikan</span></li>
          ))}
        </ul>
        <p className="notice info"><span className="notice-body">Dudu saat ini bukan "tenaga kerja agen otonom". Yang ada: satu pelaksana deterministik dengan persetujuan manusia dan verifikasi independen.</span></p>
      </section>
    </PageShell>
  )
}

export function MemoryPage({ onToggleLeft, leftCollapsed, onActivity }: PageProps) {
  const [notes, setNotes] = useState<MemoryNote[]>(loadMemory)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const commit = (next: MemoryNote[]) => { setNotes(next); if (!saveMemory(next)) setErr('Penyimpanan lokal gagal; perubahan belum tentu tersimpan.'); else setErr(null) }

  function add(e: FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    if (notes.length >= MAX_NOTES) return setErr(`Maksimal ${MAX_NOTES} catatan.`)
    commit([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: t.slice(0, MAX_NOTE_CHARS), createdAt: Date.now(), enabled: true }, ...notes]); setText(''); onActivity?.('Catatan memori ditambahkan')
  }
  return (
    <PageShell title="Memory" subtitle="Catatan yang Anda tulis sendiri; dikirim ke model sebagai konteks di setiap percakapan." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <section className="panel" aria-labelledby="mem-form-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="mem-form-title">Tambah catatan</h2>
            <p className="panel-sub">Ini <strong>memori eksplisit</strong>: hanya berisi apa yang Anda ketik di sini. Dudu tidak menyimpan memori otomatis dari percakapan. Catatan yang aktif dikirim ke provider model pada setiap pesan — jangan menyimpan rahasia (kata sandi, kunci).</p>
          </div>
        </div>
        <form className="toolbar" onSubmit={add}>
          <label className="sr-only" htmlFor="mem-text">Catatan baru</label>
          <input id="mem-text" className="input" value={text} onChange={e => setText(e.target.value)} maxLength={MAX_NOTE_CHARS} placeholder="Mis. Saya lebih suka jawaban singkat dalam poin-poin" />
          <button type="submit" className="btn-primary" disabled={!text.trim()}>Simpan catatan</button>
        </form>
        {err && <p className="state-msg error" role="alert">{err}</p>}
      </section>

      <section className="panel" aria-labelledby="mem-list-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="mem-list-title">Catatan tersimpan</h2>
            <p className="panel-sub">Nonaktifkan catatan bila tidak ingin lagi dikirim ke model.</p>
          </div>
          <div className="panel-actions">
            <span className="pill neutral">{notes.length} catatan</span>
            <span className="pill ok">{notes.filter((n) => n.enabled).length} aktif</span>
          </div>
        </div>
        {notes.length === 0 && <p className="empty-note">Belum ada catatan memori.</p>}
        <ul className="cards">
          {notes.map(n => (
            <li key={n.id} className="card">
              <div className="card-text"><span className={cx(!n.enabled && 'muted')}>{n.text}</span><span className="meta">{fmtDate(n.createdAt)}{n.enabled ? '' : ' · nonaktif'}</span></div>
              <div className="card-actions">
                <button type="button" className="chip-btn" aria-pressed={n.enabled} onClick={() => commit(notes.map(x => (x.id === n.id ? { ...x, enabled: !x.enabled } : x)))}>{n.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button type="button" className="chip-btn danger" aria-label={`Hapus catatan: ${n.text.slice(0, 30)}`} onClick={() => { commit(notes.filter(x => x.id !== n.id)); onActivity?.('Catatan memori dihapus') }}><Icon name="trash" size={12} /> Hapus</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  )
}

export function SettingsPage({ onToggleLeft, leftCollapsed }: PageProps) {
  const caps = useLoad(api.capabilities)
  const desktop = typeof window !== 'undefined' && window.dudu?.isDesktop
  const platform = window.dudu?.platform
  const c = caps.data
  return (
    <PageShell title="Pengaturan" subtitle="Provider, batas, penyimpanan, dan routing AI." onToggleLeft={onToggleLeft} leftCollapsed={leftCollapsed}>
      <StateMsg loading={caps.loading && !caps.data} error={caps.error} onRetry={caps.reload} />

      {c && (
        <section className="panel" aria-labelledby="set-provider-title">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="set-provider-title">Provider & model</h2>
              <p className="panel-sub">Status model yang dipakai Dudu. Kunci API tidak pernah ditampilkan atau dikirim ke UI.</p>
            </div>
          </div>
          <dl className="kv">
            <dt>Model chat</dt>
            <dd>{c.chat.model} — {statusOf(c.chat.configured).label}</dd>
            <dt>Vision (gambar)</dt>
            <dd>{c.vision.configured ? `${c.vision.model} — dikonfigurasi (koneksi belum diuji)` : `Belum dikonfigurasi (${c.vision.reason})`}</dd>
            <dt>Transkripsi audio</dt>
            <dd>{c.stt.configured ? `${c.stt.model} — dikonfigurasi (koneksi belum diuji)` : `Belum dikonfigurasi (${c.stt.reason})`}</dd>
          </dl>
          <p className="notice info">
            <span className="notice-body">
              <strong className="notice-title">Di mana kuncinya diubah</strong>
              {desktop
                ? 'Ubah lewat menu Dudu AI → Buka folder konfigurasi (dudu.env); berlaku pada pesan berikutnya.'
                : 'Ubah lewat file .env di server development; mulai ulang server setelah mengubah.'}
            </span>
          </p>
        </section>
      )}

      <GatewaySettings desktop={desktop} />

      {c && (
        <section className="panel" aria-labelledby="set-limits-title">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="set-limits-title">Batas & penyimpanan</h2>
              <p className="panel-sub">Batas unggahan, lampiran per pesan, dan lokasi seluruh data Dudu di perangkat ini.</p>
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat"><span className="stat-value">{c.limits.maxAttachments}</span><span className="stat-label">Lampiran per pesan</span></div>
            <div className="stat"><span className="stat-value">{desktop ? 'Desktop' : 'Web'}</span><span className="stat-label">Mode aplikasi{platform ? ` (${platform})` : ''}</span></div>
          </div>
          <dl className="kv">
            <dt>Ukuran maksimum file</dt>
            <dd>{Math.round(c.limits.maxUploadBytes / 1048576)} MB (DUDU_MAX_UPLOAD_MB)</dd>
            <dt>Penyimpanan</dt>
            <dd>{desktop ? 'Folder data aplikasi di akun OS Anda (file, indeks, misi, artefak, percakapan, dan dudu.env). Uninstall tidak menghapusnya.' : 'File/KB/misi: folder DUDU_DATA_DIR server; percakapan: localStorage browser.'}</dd>
            <dt>Cloud</dt>
            <dd>Tidak ada. Data hanya keluar dari perangkat saat isi pesan/lampiran dikirim ke provider model yang Anda konfigurasi.</dd>
          </dl>
        </section>
      )}
    </PageShell>
  )
}

/* ---------- Gateway AI: provider multi-provider, routing, anggaran, pemakaian ---------- */

const MODE_INFO: Record<RoutingMode, string> = {
  FREE_ONLY: 'Hanya model gratis/lokal. Model berbayar tidak pernah dipakai, apa pun alasannya.',
  FREE_FIRST: 'Gratis dulu; model berbayar hanya bila tidak ada kandidat gratis yang memenuhi (alasan selalu dicatat).',
  BEST_VALUE: 'Gratis dan berbayar ditimbang: kecocokan kebutuhan, konteks, dan biaya.',
  BEST_QUALITY: 'Kualitas terbaik yang tersedia; pemakaian berbayar tetap dijaga anggaran.',
  MANUAL: 'Anda pilih model sendiri; gateway tidak pernah menggantinya.',
  ROTATE: 'Perputaran otomatis antar provider/model saat semua kunci terisi: urutan pemilihan bergilir per kategori tugas (gratis/lokal selalu didahulukan) agar pemakaian menyebar dan token hemat.',
}

function labelStyle(prov: GatewayProvider): { status: string; cls: '' | 'ok' | 'warn' } {
  if (prov.enabled) return { status: 'Aktif — masuk routing', cls: 'ok' }
  if (prov.configured) return { status: prov.lastOk === false ? 'Kunci tersimpan, uji koneksi terakhir gagal' : 'Tersimpan, belum aktif' , cls: 'warn' }
  if (prov.needsCustomBaseUrl) return { status: 'Perlu baseUrl + kunci opsional', cls: '' }
  return { status: 'Belum dikonfigurasi', cls: '' }
}

function GatewaySettings({ desktop }: { desktop?: boolean }) {
  const gw = useLoad(async () => {
    const [providersRes, settingsRes, usageRes] = await Promise.all([
      api.gatewayProviders(),
      api.gatewaySettings(),
      api.usage(),
    ])
    return { providersRes, settings: settingsRes.settings, usage: usageRes.summary }
  })
  const d = gw.data
  if (gw.error) {
    return (
      <section className="panel" aria-labelledby="gw-error-title">
        <h2 className="panel-title" id="gw-error-title">Gateway AI (multi-provider)</h2>
        <p className="state-msg error" role="alert">Gateway tidak memuat dari server ini: {gw.error}</p>
        <StateMsg loading={false} error={null} onRetry={gw.reload} />
      </section>
    )
  }
  if (!d) return <StateMsg loading={gw.loading} error={null} onRetry={gw.reload} />
  const { providersRes, settings, usage } = d
  return (
    <>
      <section className="panel" aria-labelledby="gw-1-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="gw-1-title"><span className="kicker">1</span> Provider &amp; API</h2>
            <p className="panel-sub">Isi kunci per provider — kunci disimpan di server (folder data aplikasi), UI hanya melihat empat karakter terakhir. Tombol <strong>Uji koneksi</strong> memanggil endpoint resmi provider; hasilnya disimpan apa adanya. Tanpa kunci yang diisi, chat memakai provider “env” dari konfigurasi lama (DUDU_*).</p>
          </div>
        </div>
        <ul className="cards provider-list" aria-label="Provider gateway">
          {providersRes.providers.map(p => <ProviderRow key={p.id} p={p} desktop={desktop} onDone={gw.reload} />)}
        </ul>
      </section>

      <section className="panel" aria-labelledby="gw-2-title">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="gw-2-title"><span className="kicker">2</span> Model AI — pemilihan real-time</h2>
            <p className="panel-sub">Katalog model dimuat langsung dari provider aktif. Pilihan berlaku pada chat berikutnya, tanpa restart.</p>
          </div>
        </div>
        <LiveModelPicker settings={settings} onSaved={gw.reload} />
      </section>

      <RoutingPolicy settings={settings} providers={providersRes.providers} env={providersRes.env} onSaved={gw.reload} />
      <UsageSection usage={usage} />
    </>
  )
}

/** Pemilih model real-time: katalog langsung dari provider aktif, bisa dicari & diganti tanpa restart. */
function LiveModelPicker({ settings, onSaved }: { settings: RoutingSettings; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<'semua' | 'free' | 'local' | 'paid' | 'unknown'>('semua')
  const [live, setLive] = useState(true)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!live) return
    const h = window.setInterval(() => setTick((t) => t + 1), 20_000) // katalog disegarkan tiap 20 detik
    return () => window.clearInterval(h)
  }, [live])
  const models = useLoad(api.gatewayModels, [tick])
  const manual = settings.defaultMode === 'MANUAL' ? settings.manualSelection : null
  const list = (models.data ?? []).filter((m) => {
    const okTier = tier === 'semua' || m.tier === tier
    const hay = `${m.providerId ?? ''} ${m.id} ${m.name}`.toLowerCase()
    return okTier && (!q.trim() || hay.includes(q.trim().toLowerCase()))
  })

  async function pick(m: CatalogModel) {
    if (!m.providerId) { setErr('Model ini tidak menyertakan provider — tidak bisa dipilih manual.'); return }
    setBusy(m.id); setErr(null); setNote(null)
    try {
      await api.gatewaySaveSettings({ defaultMode: 'MANUAL', manualSelection: { providerId: m.providerId, modelId: m.id } })
      setNote(`Model aktif diganti ke ${m.providerId}/${m.id} (manual). Berlaku untuk chat berikutnya — tanpa restart.`)
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  async function backToAuto() {
    setBusy('auto'); setErr(null); setNote(null)
    try {
      await api.gatewaySaveSettings({ defaultMode: 'ROTATE', manualSelection: null })
      setNote('Kembali ke otomatis (ROTATE): model dipilih sesuai kategori tugas, gratis/lokal didahulukan.')
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <div className="panel-body">
      <div className="live-head">
        <div>
          <strong>Model aktif sekarang: </strong>
          {manual
            ? <span className="pill ok">Manual · {manual.providerId}/{manual.modelId}</span>
            : <span className="pill neutral">Otomatis · {settings.defaultMode}</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="checkbox-field"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /><span>Segarkan tiap 20 dtk</span></label>
          <button type="button" className="btn-ghost" onClick={() => models.reload()} disabled={models.loading}>Muat ulang</button>
          <button type="button" className="btn-ghost" onClick={() => void backToAuto()} disabled={busy === 'auto'}>Kembali ke otomatis</button>
        </div>
      </div>
      <div className="toolbar">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari provider atau model…" aria-label="Cari model" />
        <select className="select" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)} aria-label="Filter tier">
          <option value="semua">Semua tier</option>
          <option value="free">Gratis</option>
          <option value="local">Lokal</option>
          <option value="paid">Berbayar</option>
          <option value="unknown">Tidak diketahui</option>
        </select>
      </div>
      {models.error && <p className="state-msg error" role="alert">{models.error}</p>}
      {!models.loading && (models.data?.length ?? 0) === 0 && (
        <p className="empty-note">Katalog kosong. Simpan kunci provider di atas (katalog dimuat otomatis) atau klik <strong>Muat katalog</strong> pada kartu provider, lalu muat ulang di sini.</p>
      )}
      {err && <p className="state-msg error" role="alert">{err}</p>}
      {note && <p className="notice ok" role="status"><span className="notice-body">{note}</span></p>}
      <ul className="model-list" aria-label="Katalog model real-time">
        {list.map((m) => {
          const isActive = Boolean(manual && manual.providerId === m.providerId && manual.modelId === m.id)
          return (
            <li key={`${m.providerId}/${m.id}`} className={isActive ? 'model-row active' : 'model-row'}>
              <div>
                <strong>{m.id}</strong>
                <span className="meta"> · {m.providerId ?? 'tanpa provider'} · tier {m.tier}{m.contextWindow ? ` · konteks ${m.contextWindow.toLocaleString()}` : ''}</span>
                <div className="meta">
                  {m.pricing ? `harga resmi: in USD ${m.pricing.inputPer1M}/out USD ${m.pricing.outputPer1M} per 1M token` : 'harga: tidak tercatat di katalog (tidak ditebak)'}
                  {m.capabilities.vision ? ' · vision' : ''}{m.capabilities.tools ? ' · tools' : ''}
                </div>
              </div>
              <button type="button" className={isActive ? 'chip-btn active' : 'chip-btn'} disabled={busy === m.id || isActive} onClick={() => void pick(m)}>
                {isActive ? 'Sedang dipakai' : 'Pakai model ini'}
              </button>
            </li>
          )
        })}
        {!models.loading && (models.data?.length ?? 0) > 0 && list.length === 0 && <li className="empty-note">Tidak ada model yang cocok dengan pencarian/filter.</li>}
      </ul>
      <p className="notice info"><span className="notice-body">Pilihan di sini tersimpan seketika (mode MANUAL). Mengganti model tidak menghapus riwayat; biaya/kuota hanya ditampilkan bila provider melaporkannya — tidak pernah dikarang.</span></p>
    </div>
  )
}

function ProviderRow({ p, desktop, onDone }: { p: GatewayProvider; desktop?: boolean; onDone: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(p.defaultBaseUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const stale = labelStyle(p)
  async function run<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true); setErr(null); setInfo(null)
    try { await fn(); setInfo(ok); onDone() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <li className="card provider-card">
      <div className="card-text">
        <div className="card-head">
          <strong>{p.label}</strong>
          <span className={cx('pill', stale.cls)}>{stale.status}</span>
        </div>
        <span className="meta">{p.description}</span>
        <span className="meta">
          {p.needsCustomBaseUrl && p.baseUrl ? `baseUrl: ${p.baseUrl}` : p.baseUrl ? `baseUrl khusus: ${p.baseUrl}` : `default: ${p.defaultBaseUrl}`}
          {p.keySuffix ? ` · kunci ····${p.keySuffix}` : ''}
          {p.lastTest ? ` · uji terakhir: ${p.lastOk ? 'berhasil' : `gagal (${p.lastError ?? 'tanpa alasan'})`}` : ''}
        </span>
        {p.docs && <span className="meta">Dokumentasi: <a href={p.docs} target="_blank" rel="noreferrer">{p.docs}</a></span>}
        {info && <span className="meta">{info}</span>}
        {err && <span className="state-msg error" role="alert">{err}</span>}
      </div>
      <div className="card-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <div className="row provider-form" style={{ gap: 6 }}>
          {!p.configured && (
            <>
              <input className="input" type="password" autoComplete="off" placeholder={p.needsCustomBaseUrl ? 'Kunci (opsional)' : 'Kunci API'}
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                aria-label={`Kunci API ${p.label}`} />
              {p.needsCustomBaseUrl && (
                <input className="input" type="text" placeholder="https://endpoint Anda/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} aria-label={`baseUrl ${p.label}`} />
              )}
              <button type="button" className="btn-primary" disabled={busy || (p.needsCustomBaseUrl ? !baseUrl.trim() : !apiKey.trim())}
                onClick={() => run(() => api.gatewaySetKey(p.id, apiKey.trim(), p.needsCustomBaseUrl ? baseUrl.trim() : undefined), 'Kunci disimpan di server (dikelola server-side, tidak tersebar di UI).')}
                title={desktop ? 'Disimpan di folder data aplikasi server' : 'Disimpan di folder data server'}>
                Simpan kunci
              </button>
            </>
          )}
          {p.configured && !p.enabled && (
            <button type="button" className="btn-primary" disabled={busy}
              onClick={() => run(() => api.gatewayUpdateProvider(p.id, { enabled: true }), 'Provider diaktifkan.')}>
              Aktifkan
            </button>
          )}
          {p.configured && p.enabled && (
            <button type="button" disabled={busy}
              onClick={() => run(() => api.gatewayUpdateProvider(p.id, { enabled: false }), 'Provider dinonaktifkan (tak dipakai routing).')}
              title="Menonaktifkan tidak menghapus kunci">
              Nonaktifkan
            </button>
          )}
          {p.configured && (
            <>
              <button type="button" className="chip-btn" disabled={busy}
                onClick={() => run(async () => {
                  const r = await api.gatewayTestProvider(p.id)
                  if (!r.ok) throw new Error(`Uji koneksi gagal: ${r.reason ?? `HTTP ${r.status ?? '?'}`}`)
                  setInfo(`Uji koneksi berhasil${r.status ? ` (HTTP ${r.status}${r.latencyMs ? `, ${r.latencyMs} ms` : ''})` : ''}.`)
                }, '')}>
                Uji koneksi
              </button>
              <button type="button" className="chip-btn" disabled={busy}
                onClick={() => run(async () => {
                  const r = await api.gatewayProviderModels(p.id, true)
                  if (r.count === 0) throw new Error('Katalog kosong (provider tidak melaporkan model atau endpoint berbeda).')
                  const tiers = r.models.reduce<Record<string, number>>((a, m) => { a[m.tier] = (a[m.tier] ?? 0) + 1; return a }, {})
                  setInfo(`Katalog dimuat: ${r.count} model (${Object.entries(tiers).map(([t, n]) => `${t}: ${n}`).join(', ')}).`)
                }, '')}>
                Muat katalog
              </button>
              <button type="button" className="chip-btn danger" disabled={busy}
                onClick={() => { if (!window.confirm(`Hapus kunci API ${p.label}?`)) return
                  run(() => api.gatewayRemoveKey(p.id), 'Kunci dihapus.')}}>
                Hapus kunci
              </button>
            </>
          )}
        </div>
        {p.id === 'custom' && <span className="meta">Untuk 9Router/FreeLLM atau gateway lain: isi baseUrl jika protokolnya kompatibel OpenAI Chat Completions. Harga/kuotanya tidak tertebak dari sini — status " gratis" hanya dari metadata resmi provider.</span>}
      </div>
    </li>
  )
}

function RoutingPolicy({ settings, providers, env, onSaved }: { settings: RoutingSettings; providers: GatewayProvider[]; env: { configured: boolean; model: string | null; baseUrl: string | null }; onSaved: () => void }) {
  const [auto, setAuto] = useState(settings.defaultMode !== 'MANUAL')
  const [mode, setMode] = useState<RoutingMode>(settings.defaultMode === 'MANUAL' ? 'ROTATE' : settings.defaultMode)
  const [maxFallbacks, setMaxFallbacks] = useState(settings.maxFallbacks)
  const [budget, setBudget] = useState(String(settings.budget.paidUsdMonthly ?? 0))
  const [selProvider, setSelProvider] = useState(settings.manualSelection?.providerId ?? '')
  const [selModel, setSelModel] = useState(settings.manualSelection?.modelId ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Katalog model untuk provider yang dipilih (manual). Tidak dipanggil untuk provider "env".
  const catalog = useLoad(async () => {
    if (auto || !selProvider || selProvider === 'env') return [] as CatalogModel[]
    try { return (await api.gatewayProviderModels(selProvider)).models } catch { return [] as CatalogModel[] }
  }, [auto, selProvider])

  const autoModes = (Object.keys(MODE_INFO) as RoutingMode[]).filter(m => m !== 'MANUAL')
  // Provider yang bisa dipilih manual: yang diaktifkan + env (bila terkonfigurasi).
  const manualProviders = [
    ...providers.filter(p => p.enabled).map(p => ({ id: p.id, label: p.label })),
    ...(env.configured ? [{ id: 'env', label: 'env — konfigurasi lama (DUDU_*)' }] : []),
  ]
  const manualModels: CatalogModel[] = selProvider === 'env'
    ? [{ providerId: 'env', id: env.model ?? 'env-model', name: env.model ?? 'env-model', tier: 'unknown', pricing: null, contextWindow: null, capabilities: { vision: null, tools: null }, source: 'environment_config' }]
    : catalog.data ?? []
  const choiceOk = auto || (Boolean(selProvider) && Boolean(selModel))

  async function save() {
    setBusy(true); setErr(null)
    const paidUsdMonthly = Number(budget)
    try {
      await api.gatewaySaveSettings({
        defaultMode: auto ? mode : 'MANUAL',
        maxFallbacks,
        budget: { paidUsdMonthly: Number.isFinite(paidUsdMonthly) && paidUsdMonthly >= 0 ? paidUsdMonthly : 0 },
        manualSelection: auto ? null : (selProvider && selModel ? { providerId: selProvider, modelId: selModel } : null),
      })
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <section className="panel" aria-labelledby="gw-3-title">
      <div className="panel-head">
        <div>
          <h2 className="panel-title" id="gw-3-title"><span className="kicker">3</span> Routing otomatis &amp; anggaran</h2>
          <p className="panel-sub"><strong>Pilihan model:</strong> <em>Otomatis</em> = gateway memilih model sesuai task Anda (hemat token: batas output ditetapkan per kategori tugas, gratis/lokal didahulukan). <em>Manual</em> = Anda yang menentukan satu model tetap; gateway TIDAK PERNAH menggantinya dan error diteruskan apa adanya. Mode ini berlaku untuk semua chat.</p>
        </div>
      </div>
      <dl className="kv">
        <dt>Pilihan model</dt>
        <dd className="row" style={{ gap: 14 }}>
          <label><input type="radio" name="gw-automan" checked={auto} onChange={() => setAuto(true)} /> Otomatis (per task — direkomendasikan)</label>
          <label><input type="radio" name="gw-automan" checked={!auto} onChange={() => setAuto(false)} /> Manual (satu model tetap)</label>
        </dd>
        {auto && (
          <>
            <dt><label htmlFor="gw-mode">Mode routing otomatis</label></dt>
            <dd>
              <select id="gw-mode" className="input" value={mode} onChange={e => setMode(e.target.value as RoutingMode)}>
                {autoModes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="meta">{MODE_INFO[mode]}</span>
            </dd>
          </>
        )}
        {!auto && (
          <>
            <dt><label htmlFor="gw-manual-provider">Provider</label></dt>
            <dd>
              <select id="gw-manual-provider" className="input" value={selProvider}
                onChange={e => { setSelProvider(e.target.value); setSelModel('') }}>
                <option value="">— pilih provider —</option>
                {manualProviders.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {selProvider && selProvider !== 'env' && manualModels.length === 0 && (
                <span className="meta">Katalog provider ini masih kosong — klik tombol "Muat katalog" pada kartu provider di atas, lalu kembali ke sini.</span>
              )}
            </dd>
            <dt><label htmlFor="gw-manual-model">Model</label></dt>
            <dd>
              <select id="gw-manual-model" className="input" value={selModel} onChange={e => setSelModel(e.target.value)} disabled={!selProvider}>
                <option value="">— pilih model —</option>
                {manualModels.map(m => (
                  <option key={m.id} value={m.id}>{m.id} (tier: {m.tier}{m.pricing ? ` · in USD ${m.pricing.inputPer1M}/out USD ${m.pricing.outputPer1M} per 1M token` : ''})</option>
                ))}
              </select>
            </dd>
          </>
        )}
        <dt><label htmlFor="gw-fallbacks">Fallback maksimum per permintaan</label></dt>
        <dd>
          <select id="gw-fallbacks" className="input" value={maxFallbacks} onChange={e => setMaxFallbacks(Number(e.target.value))}>
            {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="meta">Berapa kali gateway boleh mencoba kandidat berikutnya bila provider gagal. Setiap lompatan dicatat dengan alasan.</span>
        </dd>
        <dt><label htmlFor="gw-budget">Anggaran berbayar / bulan (USD)</label></dt>
        <dd>
          <input id="gw-budget" className="input" type="number" min={0} step="0.5" value={budget} onChange={e => setBudget(e.target.value)} />
          <span className="meta">0 = belum ditetapkan (tidak menghalangi apa pun, tetapi statusnya "unset" — bukan "gratis"). Bila anggaran habis, model berbayar diblokir; kandidat gratis tetap dipakai.</span>
        </dd>
      </dl>
      {err && <p className="state-msg error" role="alert">{err}</p>}
      <div className="panel-foot">
        <button type="button" className="btn-primary" disabled={busy || !choiceOk} onClick={() => void save()}>
          {busy ? 'Menyimpan…' : 'Simpan kebijakan routing'}
        </button>
      </div>
    </section>
  )
}

function UsageSection({ usage }: { usage: UsageSummary }) {
  const t = usage.totals
  const budgetLabel =
    usage.budget.state === 'unset' ? `belum ditetapkan (pemakaian berbayar tercatat: USD ${usage.budget.spent.toFixed(4)})` :
    `${usage.budget.spent.toFixed(4)} / USD ${usage.budget.cap} (${usage.budget.pct ?? 0}%) — ${usage.budget.state}`
  return (
    <section className="panel" aria-labelledby="gw-4-title">
      <div className="panel-head">
        <div>
          <h2 className="panel-title" id="gw-4-title"><span className="kicker">4</span> Pemakaian (bulan berjalan)</h2>
          <p className="panel-sub">Angka yang dilaporkan provider. Nilai estimasi lokal ditandai terpisah dan tidak pernah disamakan dengan angka provider.</p>
        </div>
      </div>
      <dl className="kv">
        <dt>Permintaan</dt><dd>{t.requests} total · {t.success} sukses · {t.failed} gagal</dd>
        <dt>Token masuk</dt><dd>{t.tokens.inputActual ? `${t.tokens.inputActual} dilaporkan provider` : '0 dilaporkan provider'}{t.tokens.inputEstimated ? ` · ${t.tokens.inputEstimated} estimasi lokal` : ''}</dd>
        <dt>Token keluar</dt><dd>{t.tokens.outputActual ? `${t.tokens.outputActual} dilaporkan provider` : '0 dilaporkan provider'}{t.tokens.outputEstimated ? ` · ${t.tokens.outputEstimated} estimasi lokal` : ''}</dd>
        <dt>Biaya model berbayar</dt>
        <dd>{t.cost > 0 ? `USD ${t.cost.toFixed(4)}${t.costApprox ? ' (≈, dihitung dari harga katalog)' : ''}` : 'USD 0 tercatat'}{t.costUnknown ? ` · ${t.costUnknown} permintaan berbayar tanpa info biaya` : ''}</dd>
        {Object.keys(usage.byProvider).length > 0 && (
          <>
            <dt>Per provider</dt>
            <dd>{Object.entries(usage.byProvider).map(([id, b]) => `${id}: ${b.requests} req · ${b.tokens.input}→${b.tokens.output} token· biaya USD ${b.cost.toFixed(4)}`).join(' · ')}</dd>
          </>
        )}
        <dt>Anggaran</dt><dd>{budgetLabel}</dd>
      </dl>
      {usage.alerts.length > 0 && (
        <ul className="cards" aria-label="Peringatan pemakaian">
          {usage.alerts.map((a, i) => (
            <li key={`${a.kind}-${i}`} className="card"><div className="card-text"><strong>{a.kind}</strong><span className="meta">{a.message}</span></div></li>
          ))}
        </ul>
      )}
    </section>
  )
}
