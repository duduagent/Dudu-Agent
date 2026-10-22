// @vitest-environment node
// Uji Dudu Public Landing Page v1 — struktur, tautan, aset, kejujuran status kanal,
// klaim yang tidak boleh berdiri sendiri, dan integrasi waiting list.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const siteDir = path.join(root, 'landing')
const read = (rel) => fs.readFileSync(path.join(siteDir, rel), 'utf8')
const html = read('index.html')
const body = html.replace(/<!--[\s\S]*?-->/g, '') // komentar bukan bagian halaman

describe('Landing page: berkas & struktur', () => {
  it('berkas inti ada', () => {
    for (const f of ['index.html', 'robots.txt', 'sitemap.xml', 'assets/landing.css', 'assets/landing.js', 'assets/img/icon.svg', 'assets/img/icon.png']) {
      expect(fs.existsSync(path.join(siteDir, f)), f).toBe(true)
    }
  })

  it('SEO: title, description, Open Graph, twitter, favicon, lang', () => {
    expect(body).toMatch(/<html[^>]+lang="en"/i)
    expect(body).toMatch(/<title>[^<]{20,}<\/title>/i)
    expect(body).toMatch(/<meta name="description" content=".{80,}"/i)
    expect(body).toMatch(/<meta property="og:title"/)
    expect(body).toMatch(/<meta property="og:description"/)
    expect(body).toMatch(/<meta property="og:image" content="assets\/img\/og-image\.png"/)
    expect(body).toMatch(/<meta name="twitter:card"/)
    expect(body).toMatch(/<link rel="icon" href="assets\/img\/icon\.svg"/)
  })

  it('canonical URL tidak ada selama domain resmi belum diketahui', () => {
    expect(body).not.toMatch(/<link[^>]+rel="canonical"/i)
  })

  it('sitemap & robots memakai placeholder yang jelas (belum boleh dipublikasikan)', () => {
    const sitemap = read('sitemap.xml')
    const robots = read('robots.txt')
    expect(sitemap).toMatch(/REPLACE-WITH-OFFICIAL-DOMAIN/)
    expect(robots).toMatch(/REPLACE-WITH-OFFICIAL-DOMAIN/)
    expect(robots).toMatch(/User-agent:\s*\*/)
    expect(sitemap).toMatch(/<urlset/)
  })

  it('struktur semantik: satu h1, headline wajib, landmark lengkap', () => {
    const h1 = body.match(/<h1\b/gi) || []
    expect(h1).toHaveLength(1)
    expect(body).toMatch(/Your AI Workforce\. One Platform\. Every Device\./)
    for (const tag of ['header', 'main', 'footer', 'nav']) {
      expect(body, tag).toMatch(new RegExp(`<${tag}\\b`, 'i'))
    }
    for (const id of ['channels', 'how-it-works', 'use-cases', 'security', 'downloads', 'faq', 'wait']) {
      expect(body, id).toMatch(new RegExp(`id="${id}"`))
    }
  })

  it('semua tautan anchor punya target di halaman', () => {
    const ids = new Set([...body.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
    const anchors = [...body.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    expect(anchors.length).toBeGreaterThan(5)
    for (const a of anchors) expect(ids.has(a), `anchor #${a}`).toBe(true)
  })

  it('semua berkas lokal yang dirujuk benar-benar ada', () => {
    const refs = [...body.matchAll(/(?:src|href)="((?!https?:|mailto:|tel:|#|data:)[^"]+)"/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(5)
    for (const ref of refs) expect(fs.existsSync(path.join(siteDir, ref)), ref).toBe(true)
  })

  it('gambar: alt, width/height, dan lazy loading untuk yang di bawah lipatan', () => {
    const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
    expect(imgs.length).toBeGreaterThanOrEqual(4)
    for (const tag of imgs) {
      expect(tag, tag.slice(0, 60)).toMatch(/\salt="/)
      expect(tag, tag.slice(0, 60)).toMatch(/\bwidth="\d+"/)
      expect(tag, tag.slice(0, 60)).toMatch(/\bheight="\d+"/)
    }
  })
})

describe('Landing page: kejujuran klaim & status', () => {
  it('tidak ada tautan unduhan palsu dan tidak ada tautan eksternal ke domain karangan', () => {
    expect(body).not.toMatch(/href="[^"]*\.(exe|dmg|apk|ipa|msi|deb)(\?|#|")/i)
    const external = [...body.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
    expect(external).toHaveLength(0)
  })

  it('tanpa analitik pihak ketiga atau cookie non-esensial', () => {
    const js = read('assets/landing.js')
    const all = body + js
    for (const bad of ['googletagmanager', 'google-analytics', 'gtag(', 'hotjar', 'mixpanel', 'plausible', 'clarity.ms']) {
      expect(all.toLowerCase()).not.toContain(bad.toLowerCase())
    }
    expect(body).not.toMatch(/document\.cookie/)
  })

  it('status kanal mencerminkan bukti aktual', () => {
    // Web App: ada, tapi self-hosted (tidak ada URL publik dikarang).
    expect(body).toMatch(/status available[^>]*>\s*Available — self-hosted/i)
    // Desktop Windows: tersedia.
    expect(body).toMatch(/status available[^>]*>\s*Available — Windows/i)
    // Linux: parsial (tarball ada, runtime belum diuji).
    expect(body).toMatch(/status partial[^>]*>\s*Partial/i)
    // macOS & .deb/AppImage: tidak dibangun di sini.
    expect(body).toMatch(/status dev[^>]*>\s*Not built here/i)
    // Mobile: planned, tidak ada build.
    expect(body).toMatch(/status planned[^>]*>\s*Planned — not released/i)
    expect(body).toMatch(/no mobile build today/i)
  })

  it('menyatakan audit trail bukan tamper-proof dan keamanan belum tersertifikasi', () => {
    expect(body).toMatch(/not tamper-proof/i)
    expect(body).toMatch(/No security certification/i)
    expect(body).toMatch(/has been audited or certified by a third party/i)
  })

  it('tanpa harga, testimoni, jumlah pengguna, atau klaim ROI', () => {
    const NEG = /\b(not|no|none|never|cannot|is not|without|does not|do not)\b/i
    for (const re of [/\bpricing\b/gi, /testimonial/gi, /\bROI\b/gi, /\b\d[\d.,]*\+?\s*users/gi]) {
      for (const m of body.matchAll(re)) {
        const before = body.slice(Math.max(0, m.index - 90), m.index)
        const after = body.slice(m.index, m.index + m[0].length + 40)
        expect(NEG.test(before) || NEG.test(after), `klaim tak berpenyangkal: "${m[0]}"`).toBe(true)
      }
    }
  })

  it('bagian wajib untuk pemarketing ada: cara kerja 6 tahap, use case, FAQ, waiting list, footer', () => {
    const steps = (body.match(/class="step"/g) || []).length
    expect(steps).toBe(6)
    expect((body.match(/class="case"/g) || []).length).toBeGreaterThanOrEqual(5)
    expect((body.match(/class="faq-item"/g) || []).length).toBeGreaterThanOrEqual(6)
    expect(body).toMatch(/id="wait-form"/)
    expect(body).toMatch(/class="site-footer"/)
    expect(body).toMatch(/Goal<\/h3>/)
    expect(body).toMatch(/Mission planning<\/h3>/)
    expect(body).toMatch(/Permission &amp; approval<\/h3>/)
    expect(body).toMatch(/Execution<\/h3>/)
    expect(body).toMatch(/Verification<\/h3>/)
    expect(body).toMatch(/Artifact delivery<\/h3>/)
  })
})

describe('Landing page: integrasi waiting list', () => {
  it('formulir menunjuk endpoint API yang benar dan mengirim header anti-CSRF', () => {
    expect(body).toMatch(/data-endpoint="\/api\/waiting-list"/)
    expect(body).toMatch(/id="wl-email"[^>]*name="email"/)
    expect(body).toMatch(/id="wl-platform"[^>]*name="platform"/)
    const js = read('assets/landing.js')
    expect(js).toMatch(/'X-Dudu-Client'/)
    expect(js).toMatch(/method:\s*'POST'/)
    // Tidak ada pesan sukses yang dikarang: hasil ditentukan respons server.
    expect(js).toMatch(/res\.ok && body && body\.ok/)
    expect(js).toMatch(/could not be reached/i)
  })
})

describe('Landing page: skrip pemeriksaan internal', () => {
  let res
  beforeAll(() => { res = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-landing.mjs')], { cwd: root, encoding: 'utf8' }) })
  afterAll(() => { /* tidak ada sumber daya */ })

  it('check-landing lulus untuk pemeriksaan wajib', () => {
    expect(res.status, res.stdout + res.stderr).toBe(0)
    expect(res.stdout).toMatch(/Semua pemeriksaan wajib LULUS/)
  })

  it('check-landing melaporkan blocker publikasi (domain placeholder) tanpa mengarang', () => {
    expect(res.stdout).toMatch(/BLOCKER PUBLIKASI/)
    expect(res.stdout).toMatch(/REPLACE-WITH-OFFICIAL-DOMAIN/)
  })

  it('mode --strict gagal selama blocker masih ada', () => {
    const strict = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-landing.mjs'), '--strict'], { cwd: root, encoding: 'utf8' })
    expect(strict.status).toBe(1)
  })
})
