// Audit responsif landing page publik: mengukur overflow horizontal + elemen terpotong
// pada beberapa lebar viewport (desktop, tablet, mobile) dan menyimpan screenshot.
//
// Pakai: node_modules\electron\dist\electron.exe scripts\landing-audit.cjs <url> <outDir>
// Contoh: node_modules\electron\dist\electron.exe scripts\landing-audit.cjs http://127.0.0.1:4173 landing-audit
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const url = process.env.LANDING_AUDIT_URL || process.argv[2] || 'http://127.0.0.1:4173/'
const outDir = path.resolve(process.env.LANDING_AUDIT_OUT || process.argv[3] || 'landing-audit')
const WIDTHS = [1440, 1280, 1024, 768, 390, 360]
const HEIGHT = 900

const MEASURE = `(() => {
  const de = document.documentElement
  const offenders = []
  const seen = new Set()
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const st = getComputedStyle(el)
    if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue
    if (el.classList.contains('sr-only')) continue
    if (el.closest('.table-wrap')) continue   // tabel memang boleh digulir horizontal
    const clipped = el.scrollWidth - el.clientWidth
    const outside = r.right - de.clientWidth
    if ((clipped > 2 || outside > 2) && !seen.has(String(el.className))) {
      seen.add(String(el.className))
      offenders.push({
        cls: String(el.className).slice(0, 48),
        clipped: Math.round(clipped),
        outside: Math.round(outside),
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48)
      })
    }
  }
  return {
    viewport: de.clientWidth,
    pageOverflow: Math.round(de.scrollWidth - de.clientWidth),
    offenders: offenders.slice(0, 6)
  }
})()`

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const win = new BrowserWindow({ width: WIDTHS[0], height: HEIGHT, show: false, backgroundColor: '#FFFFFF' })
  await win.loadURL(url)
  let bad = 0
  for (const w of WIDTHS) {
    win.setSize(w, HEIGHT)
    await new Promise((r) => setTimeout(r, 450))
    const m = await win.webContents.executeJavaScript(MEASURE)
    const ok = m.pageOverflow <= 1 && m.offenders.length === 0
    if (!ok) bad++
    console.log(`${ok ? 'LULUS ' : 'GAGAL'} lebar=${w} viewport=${m.viewport} overflow=${m.pageOverflow} offender=${m.offenders.length}`)
    for (const o of m.offenders) console.log(`        - ${o.cls} | clipped=${o.clipped} outside=${o.outside} | ${o.text}`)
    try {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(outDir, `landing-${w}.png`), img.toPNG())
    } catch (e) {
      console.log(`        (screenshot gagal: ${e.message})`)
    }
  }
  console.log(bad === 0 ? 'AUDIT LANDING: LOLOS (semua lebar tanpa overflow)' : `AUDIT LANDING: ${bad} lebar bermasalah`)
  app.exit(bad === 0 ? 0 : 1)
}).catch((e) => { console.error('GAGAL:', e && e.message); app.exit(1) })
