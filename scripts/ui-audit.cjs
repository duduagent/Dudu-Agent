// Audit UI responsif: mengukur overflow horizontal + elemen terpotong per halaman pada
// beberapa lebar viewport, lalu menyimpan screenshot.
//
// Pakai:  node_modules\electron\dist\electron.exe scripts\ui-audit.cjs <baseUrl> <outDir>
// Contoh: node_modules\electron\dist\electron.exe scripts\ui-audit.cjs http://localhost:5174 ui-audit
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

try { fs.appendFileSync('ui-audit-boot.log', 'BOOT ' + new Date().toISOString() + '\n') } catch { /* abaikan */ }

const baseUrl = process.env.UI_AUDIT_URL || process.argv[2] || 'http://localhost:5174'
const outDir = path.resolve(process.env.UI_AUDIT_OUT || process.argv[3] || (process.env.UI_AUDIT_URL ? process.argv[2] : null) || 'ui-audit')
const WIDTHS = [1440, 1280, 1024, 768, 390, 360]
const VIEWS = [
  ['chat', 'Chat & Voice'],
  ['missions', 'Misi & Tugas'],
  ['execution', 'Pusat Eksekusi'],
  ['workforce', 'Agent Workforce'],
  ['knowledge', 'Knowledge Base'],
  ['datainput', 'Input Data', 'Knowledge Base'],
  ['tools', 'Tools & Integrations'],
  ['skills', 'Skill', 'Tools & Integrations'],
  ['mcp', 'MCP', 'Tools & Integrations'],
  ['cli', 'CLI', 'Tools & Integrations'],
  ['plugins', 'Plugin', 'Tools & Integrations'],
  ['connectors', 'Connector', 'Tools & Integrations'],
  ['files', 'Files & Artifacts'],
  ['memory', 'Memory'],
  ['settings', 'Pengaturan'],
  ['account', 'Akun & Login', 'Pengaturan'],
]

// Skrip yang dijalankan di dalam renderer: mengukur overflow halaman + elemen yang meluber.
const MEASURE = `(() => {
  const de = document.documentElement
  const offenders = []
  const seen = new Set()
  const all = Array.from(document.querySelectorAll('.page-body, .page-body *'))
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const st = getComputedStyle(el)
    if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue
    if (el.classList.contains('sr-only')) continue
    const clipped = el.scrollWidth - el.clientWidth
    const outside = r.right - de.clientWidth
    if ((clipped > 2 || outside > 2) && !seen.has(String(el.className))) {
      seen.add(String(el.className))
      offenders.push({ cls: String(el.className).slice(0, 50), clipped: Math.round(clipped), outside: Math.round(outside), text: (el.textContent || '').trim().slice(0, 40) })
    }
  }
  const h1 = document.querySelector('.page-header h1')
  return { pageOverflow: Math.round(de.scrollWidth - de.clientWidth), title: h1 ? h1.textContent.trim() : '', offenders: offenders.slice(0, 6) }
})()`

const navCode = (label) => `(() => { try {
  const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => (x.textContent || '').includes(${JSON.stringify(label)}))
  if (!b) return 'not-found'
  b.click()
  return 'ok'
} catch (e) { return 'error' } })()`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  fs.mkdirSync(outDir, { recursive: true })
  const logFile = path.join(outDir, 'run.log')
  const log = (m) => { try { fs.appendFileSync(logFile, m + '\n') } catch { /* abaikan */ } }
  log('mulai ' + baseUrl)

  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } })
  await win.loadURL(baseUrl)
  log('halaman dimuat')

  const results = []
  for (const width of WIDTHS) {
    win.setContentSize(width, width < 500 ? 760 : 900)
    await wait(250)
    for (const [id, label, parent] of VIEWS) {
      // Submenu hanya tampil bila grupnya terbuka. Klik grup bisa menutupnya, jadi klik
      // sampai tombol anak benar-benar ada (maks 3 percobaan).
      let clicked = 'not-found'
      for (let attempt = 0; attempt < 3 && clicked !== 'ok'; attempt++) {
        if (parent && attempt > 0) {
          const opened = await win.webContents.executeJavaScript(navCode(parent), true).catch(() => 'error')
          if (opened !== 'ok') break
          await wait(450)
        }
        clicked = await win.webContents.executeJavaScript(navCode(label), true).catch((e) => 'error:' + e.message)
        if (clicked !== 'ok') await wait(180)
      }
      if (clicked !== 'ok') { results.push({ width, id, label, error: 'nav:' + clicked }); continue }
      await wait(420)
      let m
      try { m = await win.webContents.executeJavaScript(MEASURE, true) }
      catch (e) { m = { pageOverflow: -1, offenders: [], measureError: String(e.message).slice(0, 160) } }
      const file = path.join(outDir, String(width).padStart(4, '0') + '-' + id + '.png')
      // Jendela tersembunyi tidak selalu melukis ulang → buat terlihat sesaat (tanpa fokus) agar
      // capturePage mengambil frame terkini, lalu sembunyikan lagi.
      win.showInactive()
      await wait(260)
      try { fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()) } catch { /* abaikan */ }
      win.hide()
      results.push(Object.assign({ width, id, label }, m))
    }
    log('lebar ' + width + ' selesai')
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ baseUrl, at: new Date().toISOString(), results }, null, 2))
  let bad = 0
  for (const r of results) {
    const issues = []
    if (r.error) issues.push(r.error)
    if (r.pageOverflow > 0) issues.push('overflow halaman ' + r.pageOverflow + 'px')
    if (r.offenders && r.offenders.length) issues.push(r.offenders.length + ' elemen meluber')
    if (issues.length) { bad++; log('  [' + r.width + '] ' + r.label + ': ' + issues.join(', ')) }
  }
  log('TOTAL TEMUAN: ' + bad + ' dari ' + results.length + ' kombinasi')
  app.exit(bad ? 2 : 0)
}

app.whenReady().then(run).catch((e) => {
  try { fs.appendFileSync(path.join(outDir, 'run.log'), 'ERROR ' + (e && e.stack ? e.stack : e) + '\n') } catch { /* abaikan */ }
  app.exit(1)
})
