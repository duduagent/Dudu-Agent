// Audit kontras pada komponen yang BENAR-BENAR ter-render (bukan hanya nilai token).
//
// Menghitung untuk setiap elemen ber-teks: warna efektif + latar efektif (naik ke induk sampai
// ada latar opaque), lalu rasio WCAG.-Ambang: 4.5:1 untuk teks normal, 3:1 untuk teks besar
// (>=24px, atau >=18.66px bold). Kontrol nonaktif dikecualikan (WCAG 1.4.3).
// Non-teks (batas kontrol form, cincin fokus) diperiksa pada ambang 3:1 (WCAG 1.4.11).
//
// Pakai:  set UI_AUDIT_URL=http://localhost:5174
//         node_modules\electron\dist\electron.exe scripts\contrast-audit.cjs
// Keluar: kode 0 = semua lolos, 1 = ada kegagalan, 2 = tak ada pemeriksaan.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const baseUrl = process.env.UI_AUDIT_URL || 'http://localhost:5174'
const outDir = path.resolve(process.env.UI_AUDIT_OUT || 'ui-contrast')

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

// Diruns di dalam renderer: kumpulkan pasangan fg/bg dari elemen yang benar-benar tampil.
const COLLECT = `(() => {
  const parse = (c) => {
    const m = String(c || '').match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
  const bgOf = (el) => {
    let node = el
    let acc = null
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc }
      node = node.parentElement
    }
    const c = parse(getComputedStyle(document.body).backgroundColor)
    return c && c.a > 0 ? (acc ? over(acc, c) : c) : { r: 255, g: 255, b: 255, a: 1 }
  }
  const ownBg = (el) => { const c = parse(getComputedStyle(el).backgroundColor); return c && c.a > 0 ? c : null }

  const results = []
  const seen = new Set()
  const els = Array.from(document.querySelectorAll('body *'))
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none') continue
    if (st.opacity !== '1' && parseFloat(st.opacity) < 0.9) continue //状态 nonaktif/animasi: dikecualikan
    if (el.closest('[disabled]')) continue
    const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!direct) continue
    const fg = parse(st.color)
    if (!fg) continue
    const bg = bgOf(el)
    const eff = fg.a < 1 ? over(fg, bg) : fg
    const size = parseFloat(st.fontSize)
    const weight = parseInt(st.fontWeight, 10) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5
    const cr = ratio(eff, bg)
    const key = st.color + '|' + JSON.stringify(bg) + '|' + Math.round(size) + '|' + el.className
    if (seen.has(key)) continue
    seen.add(key)
    if (cr < need) {
      results.push({ kind: 'text', cls: String(el.className).slice(0, 46), tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40), fg: st.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', ratio: Math.round(cr * 100) / 100, need, size, weight })
    }
  }

  // Non-teks: batas kontrol form terhadap latar (3:1, WCAG 1.4.11)
  const borders = []
  const bseen = new Set()
  for (const el of Array.from(document.querySelectorAll('input,select,textarea'))) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none') continue
    const bc = parse(st.borderTopColor)
    if (!bc || bc.a < 0.5) continue
    const bg = bgOf(el)
    const cr = ratio(bc, bg)
    const key = st.borderTopColor + '|' + String(el.className)
    if (bseen.has(key)) continue
    bseen.add(key)
    if (cr < 3) borders.push({ kind: 'border', cls: String(el.className).slice(0, 46), tag: el.tagName.toLowerCase(), fg: st.borderTopColor, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', ratio: Math.round(cr * 100) / 100, need: 3 })
  }
  return { text: results, borders }
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
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } })
  await win.loadURL(baseUrl)
  const findings = []
  let checked = 0
  for (const [id, label, parent] of VIEWS) {
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (parent && attempt > 0) {
        await win.webContents.executeJavaScript(navCode(parent), true).catch(() => 'error')
        await wait(450)
      }
      const res = await win.webContents.executeJavaScript(navCode(label), true).catch(() => 'error')
      ok = res === 'ok'
      if (!ok) await wait(200)
    }
    if (!ok) { findings.push({ page: id, error: 'nav-not-found' }); continue }
    await wait(500)
    const out = await win.webContents.executeJavaScript(COLLECT, true).catch((e) => ({ text: [], borders: [], error: e.message }))
    for (const f of out.text ?? []) findings.push(Object.assign({ page: id, pageLabel: label }, f))
    for (const f of out.borders ?? []) findings.push(Object.assign({ page: id, pageLabel: label }, f))
    checked++
  }

  const report = { baseUrl, at: new Date().toISOString(), pagesChecked: checked, findings }
  fs.writeFileSync(path.join(outDir, 'contrast-report.json'), JSON.stringify(report, null, 2))
  const lines = []
  if (findings.length === 0) lines.push('Semua pasangan warna ter-render memenuhi ambang (teks >= 4.5:1, non-teks >= 3:1).')
  for (const f of findings) {
    lines.push(`[${f.page}] ${f.kind === 'border' ? 'batas kontrol' : 'teks'} ${f.ratio}:1 (butuh ${f.need}:1) .${f.cls} "${f.text || f.tag}" fg=${f.fg} bg=${f.bg}${f.size ? ' size=' + f.size + 'px w=' + f.weight : ''}`)
  }
  fs.writeFileSync(path.join(outDir, 'contrast-report.txt'), lines.join('\n') + '\n', 'utf8')
  console.log(lines.join('\n'))
  console.log(`\nHalaman diperiksa: ${checked}/${VIEWS.length} · temuan: ${findings.length}`)
  app.exit(findings.length ? 1 : 0)
}

app.whenReady().then(run).catch((e) => { console.error(e); app.exit(2) })
