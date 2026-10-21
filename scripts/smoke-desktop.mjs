// Smoke test aplikasi desktop yang SUDAH DIBANGUN. Menjalankan biner sungguhan dengan profil terisolasi,
// mengendalikannya lewat Chrome DevTools Protocol, lalu memverifikasi perilaku utama.
//
// Pakai:   node scripts/smoke-desktop.mjs <path-ke-biner> [--no-sandbox]
// Linux tanpa display:  xvfb-run -a node scripts/smoke-desktop.mjs release/linux-unpacked/dudu-ai
// Perlu Node >= 22 (WebSocket bawaan). Keluar dengan kode 1 jika ada pemeriksaan yang gagal.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = process.env.DUDU_SMOKE_FIXTURES || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')
const SHOTS = process.env.DUDU_SMOKE_SHOTS || ''
const bin = process.argv[2]
const extra = process.argv.slice(3)
if (!bin || !fs.existsSync(bin)) { console.error('Berkas biner tidak ditemukan:', bin); process.exit(2) }

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dudu-smoke-'))
const PORT = 9300 + Math.floor(Math.random() * 500)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'LULUS ' : 'GAGAL '} ${name}${detail ? ` — ${detail}` : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function launch() {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData'), DUDU_USER_DATA: path.join(home, 'AppData', 'Dudu AI'), DUDU_PROVIDER_API_KEY: '' }
  delete env.DUDU_DEV_URL
  const child = spawn(bin, [`--remote-debugging-port=${PORT}`, ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: os.tmpdir(), detached: true }) // grup sendiri: AppImage meninggalkan anak proses bila hanya pembungkusnya yang dimatikan // cwd BUKAN folder proyek
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  child.getLog = () => log
  return child
}

const portAnswers = async () => { try { await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) }); return true } catch { return false } }
const killGroup = (child, sig) => { try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* sudah mati */ } } }
async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = targets.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* belum siap */ }
    await sleep(250)
  }
  throw new Error('DevTools endpoint tidak muncul — aplikasi gagal start?')
}

class Cdp {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.events = []
    this.ws = new WebSocket(url)
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej })
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id) } else this.events.push(msg)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error')
    return r.result?.result?.value
  }
  async waitFor(expression, timeout = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) { try { if (await this.eval(expression)) return true } catch { /* ulang */ } await sleep(200) }
    return false
  }
}

async function session(label, fn) {
  console.log(`\n=== ${label} ===`)
  // Setiap sesi HARUS peluncuran baru: bila instance lama masih menjawab, hasil sesi ini tidak sahih.
  if (await portAnswers()) { check(`${label}: dimulai dari instance baru`, false, 'port DevTools masih dijawab instance sebelumnya'); return }
  const child = launch()
  let exited = null
  let cdp = null
  child.on('exit', (code, sig) => { exited = { code, sig } })
  try {
    cdp = new Cdp(await connect())
    await cdp.ready
    await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable')
    await fn(cdp, child)
    return cdp
  } catch (e) {
    check(`${label}: sesi berjalan tanpa error`, false, e.message)
    console.log(child.getLog().split('\n').slice(-15).join('\n'))
  } finally {
    // Beri React/localStorage waktu menulis, lalu tutup jendela dengan sopan agar LevelDB ter-flush.
    // SIGTERM langsung di Windows bersifat seperti TerminateProcess dan bisa membuang tulisan terakhir.
    await sleep(500)
    if (cdp) { try { cdp.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch { /* sudah tertutup */ } }
    for (let i = 0; i < 60 && await portAnswers(); i++) await sleep(150)
    if (await portAnswers()) { killGroup(child, 'SIGTERM'); for (let i = 0; i < 30 && await portAnswers(); i++) await sleep(150) }
    if (await portAnswers()) { killGroup(child, 'SIGKILL'); for (let i = 0; i < 30 && await portAnswers(); i++) await sleep(150) }
    if (await portAnswers()) check(`${label}: instance berhenti setelah sesi`, false, 'port DevTools masih menjawab')
  }
}

const typeAndSend = async (cdp, text) => {
  await cdp.eval(`document.getElementById('composer').focus()`)
  await cdp.send('Input.insertText', { text })
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'rawKeyDown' ? '\r' : undefined })
  }
}

let consoleProblems = []
// Satu-satunya log yang DIHARAPKAN: smoke test ini sengaja berjalan tanpa API key, sehingga /api/chat
// membalas 501 (kontrak "provider belum dikonfigurasi") dan Chromium mencatat setiap respons non-2xx.
const EXPECTED_LOGS = [/status of 501 \(Not Implemented\).*dudu:\/\/app\/api\/chat/]
const isExpected = (text) => EXPECTED_LOGS.some((re) => re.test(text))
const collectProblems = (cdp) => {
  for (const ev of cdp.events) {
    if (ev.method === 'Runtime.exceptionThrown') consoleProblems.push('exception: ' + (ev.params.exceptionDetails.exception?.description || ev.params.exceptionDetails.text))
    if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(ev.params.type)) consoleProblems.push('console.' + ev.params.type + ': ' + ev.params.args.map((a) => a.value ?? a.description).join(' '))
    if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
      const text = ev.params.entry.text + ' ' + (ev.params.entry.url || '')
      if (!isExpected(text)) consoleProblems.push('log: ' + text)
    }
  }
}

// ---- Sesi 1: peluncuran pertama ----
const externalRequests = []
await session('Peluncuran pertama', async (cdp) => {
  check('Halaman dimuat dari dudu://app (bukan http dev server)', await cdp.waitFor(`location.href.startsWith('dudu://app')`), await cdp.eval('location.href'))
  check('Judul jendela "Dudu — AI Workforce & Agent OS" dimuat', (await cdp.eval('document.title')).includes('Dudu'))
  check('UI render: heading "Halo! Saya Dudu."', await cdp.waitFor(`document.querySelector('h1')?.textContent.includes('Halo! Saya Dudu')`))
  check('Preload: window.dudu.isDesktop === true', (await cdp.eval('window.dudu && window.dudu.isDesktop')) === true)
  check('Isolasi: tidak ada require/process/Buffer di halaman', (await cdp.eval(`[typeof require, typeof process, typeof Buffer].join(',')`)) === 'undefined,undefined,undefined')
  check('Kunci API tidak ada di bundle frontend', !(await cdp.eval(`fetch('/assets/'+[...document.scripts].map(s=>s.src.split('/').pop()).find(Boolean)).then(r=>r.text()).then(t=>/DUDU_PROVIDER_API_KEY\\s*[:=]\\s*["'][A-Za-z0-9]/.test(t)||/sk-[A-Za-z0-9]{16,}/.test(t))`)))

  await typeAndSend(cdp, 'Halo Dudu desktop')
  check('Enter mengirim: pesan pengguna tampil di .msg-row.user', await cdp.waitFor(`document.querySelectorAll('.msg-row.user').length===1 && document.querySelector('.msg-row.user .msg-text').textContent.includes('Halo Dudu desktop')`))
  check('Textarea dikosongkan setelah kirim', (await cdp.eval(`document.getElementById('composer').value`)) === '')
  check('Provider tanpa kunci → error jujur + tombol Coba lagi (tanpa respons palsu)', await cdp.waitFor(`(()=>{const e=document.querySelector('.msg-error');return !!e && e.textContent.trim().length>10 && /Coba lagi/.test(e.textContent) && !document.querySelector('.msg-row.assistant .msg-text')})()`))
  check('Tepat satu pesan pengguna (tidak terkirim ganda)', (await cdp.eval(`document.querySelectorAll('.msg-row.user').length`)) === 1)
  await cdp.eval(`document.getElementById('composer').focus()`)
  await cdp.send('Input.insertText', { text: 'baris1' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
  check('Shift+Enter tidak mengirim', (await cdp.eval(`document.querySelectorAll('.msg-row.user').length`)) === 1)
  await cdp.eval(`(()=>{const t=document.getElementById('composer');const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}))})()`)

  const bodyFont = await cdp.eval(`document.fonts.ready.then(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family).join(',')) `)
  check('Font Inter dimuat dari bundel lokal', /Inter/.test(bodyFont), bodyFont)
  const w = await cdp.eval(`[document.documentElement.scrollWidth, window.innerWidth].join('/')`)
  const [sw, iw] = w.split('/').map(Number)
  check('Layout tidak overflow horizontal pada ukuran jendela default', sw <= iw, w)
  collectProblems(cdp)
  for (const ev of cdp.events) if (ev.method === 'Network.requestWillBeSent' && /^https?:/.test(ev.params.request.url)) externalRequests.push(ev.params.request.url)
  // Probe NEGATIF (sengaja memicu 415/403/pelanggaran CSP) dijalankan SETELAH pengumpulan error,
  // supaya log yang ia timbulkan tidak tercampur dengan error aplikasi yang sebenarnya.
  const health = await cdp.eval(`fetch('/api/health').then(r=>r.json())`)
  check('GET /api/health lewat protokol internal (tanpa port TCP)', health && health.configured === false, JSON.stringify(health))
  const noCt = await cdp.eval(`fetch('/api/chat',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}).then(r=>r.status)`)
  check('POST /api/chat tanpa Content-Type JSON ditolak (415)', noCt === 415, String(noCt))
  const traversal = await cdp.eval(`fetch('/..%2f..%2fpackage.json').then(r=>r.status).catch(()=>'err')`)
  check('Path traversal ke luar dist/ tidak menghasilkan berkas', traversal !== 200, String(traversal))
  const ext = await cdp.eval(`fetch('https://example.com/',{mode:'no-cors'}).then(()=>'terkirim').catch(()=>'diblokir')`)
  check('CSP memblokir request keluar ke domain eksternal', ext === 'diblokir', ext)
  const hasCsp = await cdp.eval(`fetch('/').then(r=>r.headers.get('content-security-policy')||'')`)
  check('Header Content-Security-Policy terpasang', hasCsp.includes("default-src 'self'"))

})
check('Tidak ada request http(s) eksternal saat startup/penggunaan normal', externalRequests.filter((u) => !u.startsWith('https://example.com')).length === 0, externalRequests.filter((u) => !u.startsWith('https://example.com')).join(', '))
check('Tidak ada console error / exception di renderer', consoleProblems.length === 0, consoleProblems.slice(0, 3).join(' | '))

// ---- Sesi 2: buka ulang dengan profil yang sama ----
await session('Buka ulang (profil sama)', async (cdp) => {
  check('Percakapan dipulihkan setelah aplikasi dibuka ulang', await cdp.waitFor(`document.querySelectorAll('.msg-row.user').length===1 && document.querySelector('.msg-row.user .msg-text').textContent.includes('Halo Dudu desktop')`))
  check('Sidebar menampilkan judul percakapan tersimpan', await cdp.eval(`[...document.querySelectorAll('.conv-title')].some(b=>b.textContent.includes('Halo Dudu desktop'))`))
})

// ---- Sesi 3: provider terkonfigurasi lewat dudu.env (provider PALSU lokal; bukan uji provider asli) ----
const seenAuth = []
let lastBody = null
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seenAuth.push(req.headers.authorization)
    lastBody = JSON.parse(body)
    const n = JSON.parse(body).messages.length
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: `Balasan dari mock (riwayat=${n})` } }] }))
  })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const userData = process.platform === 'win32' ? path.join(home, 'AppData', 'Dudu AI') : path.join(home, '.config', 'Dudu AI')
fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(path.join(userData, 'dudu.env'), `DUDU_PROVIDER_API_KEY=kunci-uji-smoke\nDUDU_PROVIDER_BASE_URL=http://127.0.0.1:${mock.address().port}\nDUDU_MODEL=mock-model\n`, { mode: 0o600 })
await session('Provider terkonfigurasi via dudu.env', async (cdp) => {
  check('Health melaporkan configured=true dari dudu.env', await cdp.waitFor(`fetch('/api/health').then(r=>r.json()).then(j=>j.configured===true)`))
  await cdp.waitFor(`document.getElementById('composer')`)
  await typeAndSend(cdp, 'Pesan kedua')
  check('Balasan assistant tampil (jalur sukses end-to-end)', await cdp.waitFor(`document.body.textContent.includes('Balasan dari mock')`))
  check('Pill status menampilkan Terhubung · mock-model', await cdp.waitFor(`document.querySelector('.pill.ok')?.textContent.includes('mock-model')`))
  check('Provider menerima header Authorization dari dudu.env', seenAuth.includes('Bearer kunci-uji-smoke'), String(seenAuth.length) + ' request')
  check('Kunci API tidak bocor ke DOM/localStorage renderer', !(await cdp.eval(`document.documentElement.outerHTML.includes('kunci-uji-smoke') || JSON.stringify(localStorage).includes('kunci-uji-smoke')`)))
  check('Riwayat ke provider tepat 3 pesan: system + pesan lama + pesan baru (pesan error terfilter)', await cdp.waitFor(`document.body.textContent.includes('riwayat=3)')`))

  // ---- Fitur lampiran / file / KB / misi pada aplikasi terpaket (UI asli, input file asli) ----
  const clickNav = async (label) => cdp.eval(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`)
  const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')) }
  const setFiles = async (selector, files) => {
    const doc = await cdp.send('DOM.getDocument'); const q = await cdp.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector })
    await cdp.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files })
  }
  await clickNav('Chat & Voice')
  await cdp.waitFor(`document.getElementById('composer')`)
  await setFiles('[data-testid=file-input]', [path.join(FIXTURES, 'real.docx')])
  check('Lampiran DOCX asli: unggah lewat dudu:// → chip "Siap untuk AI"', await cdp.waitFor(`document.querySelector('.att-chip')?.dataset.stage==='ready' && /Siap untuk AI/.test(document.querySelector('.att-chip').textContent)`))
  await shot('01-composer-lampiran-siap')
  await typeAndSend(cdp, 'Ringkas lampiran')
  check('Pesan terkirim dengan lampiran; chip ditandai "dianalisis" dari laporan server', await cdp.waitFor(`/dianalisis/.test(document.querySelector('.msg-row.user:last-of-type .msg-atts')?.textContent||document.body.textContent)`, 15000))
  const userMsg = lastBody?.messages?.filter((m) => m.role === 'user').at(-1)?.content
  check('Isi DOCX (diekstrak di dalam app.asar) benar-benar sampai ke provider', typeof userMsg === 'string' && userMsg.includes('Penjualan naik 12 persen') && userMsg.includes('| Jawa Barat | 1500 |'), String(userMsg).slice(0, 60))
  await setFiles('[data-testid=file-input]', [path.join(FIXTURES, 'real.pdf')])
  await cdp.waitFor(`document.querySelector('.att-chip')?.dataset.stage==='ready'`)
  await typeAndSend(cdp, 'Baca PDF ini')
  for (let i = 0; i < 100 && !String(lastBody?.messages?.filter((m) => m.role === 'user').at(-1)?.content).includes('Baca PDF ini'); i++) await sleep(150)
  check('PDF (pdf.js di dalam app.asar): teks per halaman sampai ke provider', (lastBody?.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? '').includes('[Halaman 1]') )
  await setFiles('[data-testid=file-input]', [path.join(FIXTURES, 'scan.pdf')])
  check('PDF pindaian: chip "Tersimpan, belum dapat dibaca AI" + alasan OCR (tidak dilabeli siap)', await cdp.waitFor(`document.querySelector('.att-chip')?.dataset.stage==='stored' && /OCR belum tersedia/.test(document.querySelector('.att-chip').textContent)`))
  await cdp.eval(`document.querySelector('.att-chip button').click()`)

  const progress = await cdp.eval(`new Promise(res=>{const f=new File([new Uint8Array(3*1024*1024).fill(65)],'besar.txt');const x=new XMLHttpRequest();let n=0;x.open('POST','/api/files');x.setRequestHeader('X-Dudu-Client','1');x.setRequestHeader('X-File-Name','besar.txt');x.upload.onprogress=()=>n++;x.onload=()=>res({status:x.status,progress:n,body:JSON.parse(x.responseText).file?.size});x.onerror=()=>res({error:true});x.send(f)})`)
  check(`XHR upload 3 MB lewat protokol dudu:// berhasil (event progress diterima: ${progress.progress}; bila 0, UI memakai indikator tak-tentu)`, progress.status === 201 && progress.body === 3 * 1024 * 1024, JSON.stringify(progress))
  const tooBig = await cdp.eval(`fetch('/api/files',{method:'POST',headers:{'X-Dudu-Client':'1','X-File-Name':'x.exe'},body:new Uint8Array([77,90])}).then(r=>r.status)`)
  check('Upload executable ditolak (415) di aplikasi terpaket', tooBig === 415, String(tooBig))
  const noHdr = await cdp.eval(`fetch('/api/files/00000000-0000-4000-8000-000000000000',{method:'DELETE'}).then(r=>r.status)`)
  check('DELETE tanpa header anti-CSRF ditolak (403)', noHdr === 403, String(noHdr))

  await clickNav('Files & Artifacts')
  check('Halaman Files & Artifacts memuat daftar file nyata', await cdp.waitFor(`[...document.querySelectorAll('.card strong')].some(s=>s.textContent==='real.docx')`))
  await setFiles('[data-testid=files-input]', [path.join(FIXTURES, 'sales.csv')])
  check('Unggah dari halaman Files: sales.csv muncul dengan status "Teks terbaca"', await cdp.waitFor(`(()=>{const c=[...document.querySelectorAll('.card')].find(c=>c.querySelector('strong')?.textContent==='sales.csv');return c&&/Teks terbaca/.test(c.textContent)})()`))
  await shot('02-files')

  const fid = await cdp.eval(`fetch('/api/files').then(r=>r.json()).then(j=>j.files.find(f=>f.name==='sales.csv').id)`)
  const docId = await cdp.eval(`fetch('/api/files').then(r=>r.json()).then(j=>j.files.find(f=>f.name==='real.docx').id)`)
  const kbIdx = await cdp.eval(`fetch('/api/kb/docs',{method:'POST',headers:{'X-Dudu-Client':'1','Content-Type':'application/json'},body:JSON.stringify({fileId:${JSON.stringify(docId)}})}).then(r=>r.json())`)
  const kbRes = await cdp.eval(`fetch('/api/kb/search',{method:'POST',headers:{'X-Dudu-Client':'1','Content-Type':'application/json'},body:JSON.stringify({query:'omzet Jawa Barat'})}).then(r=>r.json())`)
  check('Knowledge Base di app terpaket: indeks + retrieval BM25 dengan sumber', kbIdx.chunks >= 1 && kbRes.results?.[0]?.name === 'real.docx', JSON.stringify(kbRes.results?.[0]?.name))

  await clickNav('Misi & Tugas')
  await cdp.waitFor(`document.getElementById('m-goal')`)
  await cdp.eval(`(()=>{const t=document.getElementById('m-goal');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Analisis penjualan dari file smoke');t.dispatchEvent(new Event('input',{bubbles:true}));const s=document.getElementById('m-file');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(fid)});s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await cdp.waitFor(`!document.querySelector('form.mission-form button[type=submit]').disabled`)
  await cdp.eval(`document.querySelector('form.mission-form button[type=submit]').click()`)
  check('Misi dibuat sebagai Draft dan menunggu persetujuan manusia', await cdp.waitFor(`document.querySelector('[data-testid=mission-state]')?.textContent==='Draft' && /menunggu persetujuan/i.test(document.body.textContent)`))
  await shot('03-misi-draft')
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>/Setujui & jalankan/.test(b.textContent)).click()`)
  check('Setelah disetujui: misi Selesai, 5 kriteria "lulus" berbukti', await cdp.waitFor(`document.querySelector('[data-testid=mission-state]')?.textContent==='Selesai' && document.querySelectorAll('.criteria .pill.ok').length===5`, 20000))
  check('Bukti verifikasi independen tampil: hitung-ulang=4, laporan=4, profile.json=4', await cdp.eval(`/hitung-ulang=4, laporan=4, profile\\.json=4/.test(document.body.textContent)`))
  await shot('04-misi-selesai')
  const mid = await cdp.eval(`fetch('/api/missions').then(r=>r.json()).then(j=>j.missions[0].id)`)
  const art = await cdp.eval(`fetch('/api/missions/${'${mid}'}/artifacts/report.md').then(async r=>({s:r.status,d:r.headers.get('content-disposition'),csp:r.headers.get('content-security-policy'),t:await r.text()}))`.replace('${mid}', mid))
  check('Unduh artefak laporan: isi benar, attachment, CSP sandbox', art.s === 200 && art.t.includes('Jumlah baris data: 4') && /^attachment/.test(art.d) && /sandbox/.test(art.csp), art.d)
  await clickNav('Tools & Integrations')
  check('Tools: vision/OCR/video dilaporkan jujur (bukan "tersedia")', await cdp.waitFor(`(()=>{const r=n=>[...document.querySelectorAll('.card')].find(c=>c.querySelector('strong')?.textContent===n)?.textContent||'';return /Belum dikonfigurasi/.test(r('Vision (gambar)'))&&/Tidak tersedia/.test(r('Pemrosesan video'))&&/Tidak tersedia/.test(r('OCR (PDF/gambar pindaian)'))})()`))
  await clickNav('Pengaturan'); await cdp.waitFor(`document.querySelector('h1')?.textContent==='Pengaturan'`)
  check('Pengaturan tidak menampilkan kunci API', !(await cdp.eval(`document.documentElement.outerHTML.includes('kunci-uji-smoke')`)))

  // Regresi: elemen .sr-only di panel kanan lolos dari overflow:hidden dan membuat dokumen bisa digulir horizontal.
  await cdp.eval(`document.querySelector('.sidebar-right .collapse-btn').click()`)
  await cdp.waitFor(`document.documentElement.scrollWidth <= window.innerWidth`, 3000)
  const closedW = await cdp.eval(`[document.documentElement.scrollWidth, window.innerWidth].join('/')`)
  check('Panel kanan ditutup di lebar desktop: tanpa overflow horizontal (regresi .sr-only)', Number(closedW.split('/')[0]) <= Number(closedW.split('/')[1]), closedW)
  const PAGES = ['Chat & Voice', 'Misi & Tugas', 'Agent Workforce', 'Knowledge Base', 'Tools & Integrations', 'Files & Artifacts', 'Memory', 'Pengaturan']
  for (const w of [800, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: false })
    await sleep(350)
    const bad = []
    for (const p of PAGES) {
      await clickNav(p); await sleep(300)
      const [sw, iw] = (await cdp.eval(`[document.documentElement.scrollWidth, window.innerWidth].join('/')`)).split('/').map(Number)
      const inner = await cdp.eval(`(()=>{const b=document.querySelector('.page-body,.messages,.chat-scroll');return b?b.scrollWidth-b.clientWidth:0})()`)
      if (sw > iw || inner > 1) bad.push(`${p}: ${sw}/${iw} +${inner}`)
    }
    check(`Responsif ${w}px: tanpa overflow horizontal di ${PAGES.length} halaman`, bad.length === 0, bad.join(' | '))
    if (w === 390) { await clickNav('Files & Artifacts'); await sleep(300); await shot('05-files-390px'); await clickNav('Misi & Tugas'); await sleep(300); await shot('06-misi-390px') }
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride'); await sleep(200)
  await clickNav('Chat & Voice')
  // Lebar sidebar beranimasi; ukur setelah transisi mereda (maks 3 dtk), bukan di tengah animasi.
  await cdp.waitFor(`document.documentElement.scrollWidth <= window.innerWidth`, 3000)
  const mobileOverflow = await cdp.eval(`[document.documentElement.scrollWidth, window.innerWidth].join('/')`)
  check('Tidak ada overflow horizontal setelah menjelajahi semua halaman', Number(mobileOverflow.split('/')[0]) <= Number(mobileOverflow.split('/')[1]), mobileOverflow)
  collectProblems(cdp)
  check('Tidak ada console error/exception tak terduga pada fitur baru', consoleProblems.filter((p) => !/415|403|Failed to load resource/.test(p)).length === 0, consoleProblems.slice(0, 3).join(' | '))
})
mock.close()

// ---- Lokasi data ----
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p) } }
walk(home)
const dataDirs = [...new Set(files.filter((f) => /Local Storage/.test(f)).map((f) => path.dirname(f)))]
check('Data pengguna disimpan di folder data aplikasi OS (bukan folder kerja/instalasi)', dataDirs.length > 0 && dataDirs.every((d) => d.startsWith(home)), dataDirs.map((d) => path.relative(home, d)).join(', '))

fs.rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
const failed = results.filter((r) => !r.ok)
console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} pemeriksaan lulus`)
process.exit(failed.length ? 1 : 0)
