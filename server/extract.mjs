// Klasifikasi dan ekstraksi isi file. Semua fungsi murni (tanpa I/O disk) agar mudah diuji.
// Isi file TIDAK PERNAH dieksekusi; arsip tidak diekstrak ke disk (hanya dibaca di memori dengan batas).
import { unzipSync } from 'fflate'

export const MAX_TEXT_CHARS = 2_000_000
const MAX_ZIP_ENTRIES = 5000
const MAX_ZIP_TOTAL = 200 * 1024 * 1024 // total ukuran terdekompresi (anti zip-bomb)
const MAX_XML_ENTRY = 30 * 1024 * 1024

const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'sh', 'bash', 'ps1', 'sql', 'lua', 'r', 'tex', 'vue', 'svelte'])
const DATA_EXTS = new Set(['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx', 'ods'])
const OFFICE_EXTS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'weba'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v'])
export const BLOCKED_EXTS = new Set(['exe', 'dll', 'msi', 'com', 'scr', 'pif', 'app', 'dmg', 'apk', 'bat', 'cmd', 'vbs', 'lnk', 'jar'])

const MIME = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/mp4', zip: 'application/zip',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', xml: 'application/xml', md: 'text/markdown', html: 'text/html',
}

export const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name)); return m ? m[1].toLowerCase() : '' }

/** Nama aman untuk tampilan: tanpa path, tanpa karakter kontrol, panjang terbatas. Tidak pernah dipakai sebagai nama file di disk. */
export function sanitizeName(raw) {
  let n = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '/').split('/').pop().trim()
  n = n.replace(/^\.+/, '').slice(0, 180)
  return n || 'tanpa-nama'
}

const startsWith = (b, sig, off = 0) => sig.every((v, i) => b[off + i] === v)

/** Cek tanda tangan (magic bytes) untuk format yang bisa diverifikasi; null = tidak bisa dicek. */
export function magicOk(ext, b) {
  if (b.length < 4) return ext === 'txt' || TEXT_EXTS.has(ext) ? true : null
  switch (ext) {
    case 'pdf': return startsWith(b, [0x25, 0x50, 0x44, 0x46])
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47])
    case 'jpg': case 'jpeg': return startsWith(b, [0xff, 0xd8, 0xff])
    case 'gif': return startsWith(b, [0x47, 0x49, 0x46, 0x38])
    case 'webp': return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)
    case 'zip': case 'docx': case 'xlsx': case 'pptx': case 'odt': case 'ods': case 'odp': return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])
    case 'wav': return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x41, 0x56, 0x45], 8)
    case 'mp4': case 'm4a': case 'mov': case 'm4v': return startsWith(b, [0x66, 0x74, 0x79, 0x70], 4)
    default: return null
  }
}

const looksText = (b) => { const n = Math.min(b.length, 8192); for (let i = 0; i < n; i++) if (b[i] === 0) return false; return true }

/** @returns {{category: 'document'|'image'|'audio'|'video'|'data'|'archive'|'code'|'other', ext: string, mime: string, kind: string}} */
export function classify(name, bytes) {
  const ext = extOf(name)
  const mime = MIME[ext] || (TEXT_EXTS.has(ext) ? 'text/plain' : 'application/octet-stream')
  let category = 'other'
  let kind = 'unknown'
  if (ext === 'pdf') { category = 'document'; kind = 'pdf' }
  else if (OFFICE_EXTS.has(ext)) { category = DATA_EXTS.has(ext) ? 'data' : 'document'; kind = ext }
  else if (ext === 'rtf') { category = 'document'; kind = 'rtf' }
  else if (['csv', 'tsv', 'json', 'jsonl', 'ndjson'].includes(ext)) { category = 'data'; kind = 'text' }
  else if (['html', 'htm'].includes(ext)) { category = 'document'; kind = 'html' }
  else if (['txt', 'md', 'markdown', 'rst', 'log'].includes(ext)) { category = 'document'; kind = 'text' }
  else if (TEXT_EXTS.has(ext)) { category = 'code'; kind = 'text' }
  else if (IMAGE_EXTS.has(ext)) { category = 'image'; kind = ext === 'svg' ? 'svg' : 'image' }
  else if (AUDIO_EXTS.has(ext)) { category = 'audio'; kind = 'audio' }
  else if (VIDEO_EXTS.has(ext)) { category = 'video'; kind = 'video' }
  else if (ext === 'zip') { category = 'archive'; kind = 'zip' }
  else if (looksText(bytes)) { category = 'code'; kind = 'text' }
  return { category, ext, mime, kind }
}

/* ------------------------------ util teks ------------------------------ */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''
    }
    return ENT[e] ?? m
  })
}
const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, ''))

export function decodeText(bytes) {
  const b = Buffer.from(bytes)
  if (b[0] === 0xff && b[1] === 0xfe) return { text: b.subarray(2).toString('utf16le'), note: 'UTF-16 LE' }
  if (b[0] === 0xfe && b[1] === 0xff) { const sw = Buffer.from(b.subarray(2)); sw.swap16(); return { text: sw.toString('utf16le'), note: 'UTF-16 BE' } }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^\uFEFF/, '') } } catch {
    return { text: new TextDecoder('windows-1252').decode(b), note: 'Bukan UTF-8 valid; didekode sebagai Windows-1252.' }
  }
}

const cap = (text) => text.length > MAX_TEXT_CHARS ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true } : { text, truncated: false }

/* ------------------------------ ZIP aman ------------------------------ */

function unzipSelected(bytes, wanted) {
  let count = 0
  let total = 0
  return unzipSync(new Uint8Array(bytes), {
    filter(f) {
      count++
      total += f.originalSize
      if (count > MAX_ZIP_ENTRIES) throw new Error('Arsip memiliki terlalu banyak entri.')
      if (total > MAX_ZIP_TOTAL) throw new Error('Ukuran terdekompresi arsip melebihi batas (kemungkinan zip bomb).')
      return wanted(f.name) && f.originalSize <= MAX_XML_ENTRY
    },
  })
}
const entryText = (files, name) => files[name] ? Buffer.from(files[name]).toString('utf8') : null

export function listZip(bytes) {
  const entries = []
  let count = 0
  let total = 0
  const warnings = []
  unzipSync(new Uint8Array(bytes), {
    filter(f) {
      count++
      total += f.originalSize
      if (count > MAX_ZIP_ENTRIES) throw new Error('Arsip memiliki terlalu banyak entri.')
      if (total > MAX_ZIP_TOTAL) throw new Error('Ukuran terdekompresi arsip melebihi batas (kemungkinan zip bomb).')
      const unsafe = /(^|\/)\.\.(\/|$)/.test(f.name) || f.name.startsWith('/') || /^[A-Za-z]:/.test(f.name)
      if (unsafe) warnings.push(`Entri dengan path berbahaya diabaikan: ${f.name.slice(0, 80)}`)
      else if (entries.length < 500) entries.push({ name: f.name.replace(/[\u0000-\u001f]/g, ''), size: f.originalSize })
      return false // tidak ada isi yang didekompresi
    },
  })
  return { entries, count, total, warnings }
}

/* ------------------------------ Office / ODF ------------------------------ */

function extractDocx(bytes) {
  const files = unzipSelected(bytes, (n) => n === 'word/document.xml')
  const xml = entryText(files, 'word/document.xml')
  if (!xml) throw new Error('word/document.xml tidak ditemukan.')
  const paraText = (p) => {
    const s = p.replace(/<w:tab\s*\/>/g, '<w:t>\t</w:t>').replace(/<w:br\s*\/>/g, '<w:t>\n</w:t>')
    return decodeEntities((s.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? []).map((x) => x.replace(/<[^>]*>/g, '')).join(''))
  }
  const out = []
  let tables = 0
  for (const block of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    if (block.startsWith('<w:tbl>')) {
      tables++
      for (const row of block.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paraText).join(' ').trim())
        out.push('| ' + cells.join(' | ') + ' |')
      }
      out.push('')
    } else {
      const t = paraText(block)
      out.push(t)
    }
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), method: 'docx-xml', note: tables ? `${tables} tabel dipertahankan sebagai baris Markdown.` : undefined }
}

function extractPptx(bytes) {
  const files = unzipSelected(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  const names = Object.keys(files).sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1]) - parseInt(b.match(/(\d+)\.xml$/)[1]))
  if (!names.length) throw new Error('Tidak ada slide ditemukan.')
  const out = []
  names.forEach((n, i) => {
    out.push(`[Slide ${i + 1}]`)
    for (const p of Buffer.from(files[n]).toString('utf8').match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) ?? []) {
      const t = decodeEntities((p.match(/<a:t>[\s\S]*?<\/a:t>|<a:t [^>]*>[\s\S]*?<\/a:t>/g) ?? []).map((x) => x.replace(/<[^>]*>/g, '')).join(''))
      if (t.trim()) out.push(t)
    }
    out.push('')
  })
  return { text: out.join('\n').trim(), pages: names.length, method: 'pptx-xml' }
}

const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

/** @returns {{tables: Array<{name: string, rows: string[][]}>}} */
export function parseXlsx(bytes) {
  const files = unzipSelected(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n))
  const wb = entryText(files, 'xl/workbook.xml')
  if (!wb) throw new Error('xl/workbook.xml tidak ditemukan.')
  const rels = {}
  for (const m of (entryText(files, 'xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1]; const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1]
    if (id && t) rels[id] = t.replace(/^\/?(xl\/)?/, 'xl/')
  }
  const shared = []
  for (const si of (entryText(files, 'xl/sharedStrings.xml') ?? '').match(/<si>[\s\S]*?<\/si>|<si\/>/g) ?? []) {
    shared.push(decodeEntities((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((x) => x.replace(/<[^>]*>/g, '')).join('')))
  }
  const tables = []
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeEntities(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet')
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1]
    const target = rid && rels[rid]
    const xml = target && entryText(files, target)
    if (!xml) continue
    const rows = []
    for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const rIdx = parseInt(/\br="(\d+)"/.exec(rowXml)?.[1] ?? '0', 10) - 1
      const cells = []
      for (const c of rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c)?.[1]
        const type = /\bt="([^"]+)"/.exec(c)?.[1]
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1]
        let val = ''
        if (type === 's' && v != null) val = shared[parseInt(v, 10)] ?? ''
        else if (type === 'inlineStr') val = decodeEntities((c.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((x) => x.replace(/<[^>]*>/g, '')).join(''))
        else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
        else if (v != null) val = decodeEntities(v)
        const ci = ref ? colIndex(ref) : cells.length
        if (ci < 16384) { while (cells.length < ci) cells.push(''); cells[ci] = val }
      }
      const at = rIdx >= 0 && rIdx < 1_048_576 ? rIdx : rows.length
      while (rows.length < at && rows.length < 200_000) rows.push([])
      rows[at] = cells
      if (rows.length >= 200_000) break
    }
    tables.push({ name, rows })
  }
  if (!tables.length) throw new Error('Tidak ada lembar kerja yang dapat dibaca.')
  return { tables }
}

const csvEscape = (v) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v

function extractXlsx(bytes) {
  const { tables } = parseXlsx(bytes)
  const out = []
  for (const t of tables) {
    out.push(`## Sheet: ${t.name}`)
    for (const r of t.rows) out.push(r.map(csvEscape).join(','))
    out.push('')
  }
  return { text: out.join('\n').trim(), method: 'xlsx-xml', pages: tables.length, note: `${tables.length} lembar kerja. Nilai formula = hasil tersimpan di berkas; tanggal tampil sebagai angka serial.` }
}

function extractOdf(bytes, ext) {
  const files = unzipSelected(bytes, (n) => n === 'content.xml')
  const xml = entryText(files, 'content.xml')
  if (!xml) throw new Error('content.xml tidak ditemukan.')
  const inline = (s) => decodeEntities(s.replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, c) => ' '.repeat(Math.min(Number(c) || 1, 50))).replace(/<text:tab\s*\/>/g, '\t').replace(/<text:line-break\s*\/>/g, '\n').replace(/<[^>]*>/g, ''))
  const out = []
  let slideNo = 0
  const body = xml.replace(/<table:table\b[^>]*?table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g, (_m, name, inner) => {
    const lines = [`## ${ext === 'ods' ? 'Sheet' : 'Tabel'}: ${decodeEntities(name)}`]
    for (const row of inner.match(/<table:table-row\b[\s\S]*?<\/table:table-row>/g) ?? []) {
      const cells = []
      for (const c of row.match(/<table:table-cell\b[^>]*?(?:\/>|>[\s\S]*?<\/table:table-cell>)/g) ?? []) {
        const rep = Math.min(parseInt(/number-columns-repeated="(\d+)"/.exec(c)?.[1] ?? '1', 10), 50)
        const val = (c.match(/<text:p\b[\s\S]*?<\/text:p>/g) ?? []).map(inline).join(' ')
        for (let i = 0; i < rep; i++) cells.push(val)
      }
      while (cells.length && cells.at(-1) === '') cells.pop()
      if (cells.length) lines.push(cells.map(csvEscape).join(','))
    }
    return `\n@@TABLE${out.push(lines.join('\n')) - 1}@@\n`
  })
  const withSlides = ext === 'odp' ? body.replace(/<presentation:notes\b[\s\S]*?<\/presentation:notes>/g, '').replace(/<draw:page\b[^>]*>/g, () => `\n\n[Slide ${++slideNo}]\n`) : body
  const text = withSlides.replace(/<(text:p|text:h)\b[\s\S]*?<\/\1>/g, (p) => `\n${inline(p)}\n`).replace(/<[^>]*>/g, '').replace(/@@TABLE(\d+)@@/g, (_m, i) => out[Number(i)])
  return { text: decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim(), method: `odf-xml(${ext})`, pages: slideNo || undefined }
}

/* ------------------------------ RTF / HTML ------------------------------ */

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'generator', 'themedata',
  'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
  'fldinst', 'object', 'filetbl', 'private', 'wgrffmtfilter', 'pgptbl', 'mmathPr', 'defchp', 'defpap'])

/** Tokenizer RTF yang melacak kedalaman grup: destinasi non-teks (font/warna/gaya/gambar/daftar) dilewati. */
function extractRtf(bytes) {
  const s = Buffer.from(bytes).toString('latin1')
  if (!s.startsWith('{\\rtf')) throw new Error('Bukan berkas RTF yang valid.')
  const out = []
  const stack = []
  let skip = false, uc = 1, skipChars = 0
  let i = 0
  const cp1252 = new TextDecoder('windows-1252')
  while (i < s.length) {
    const ch = s[i]
    if (ch === '{') { stack.push({ skip, uc }); i++; continue }
    if (ch === '}') { const t = stack.pop(); if (t) ({ skip, uc } = t); i++; continue }
    if (ch === '\\') {
      const n = s[i + 1]
      if (n === '\\' || n === '{' || n === '}') { if (!skip && skipChars === 0) out.push(n); else if (skipChars) skipChars--; i += 2; continue }
      if (n === '*') { skip = true; i += 2; continue }
      if (n === "'") { const hex = s.substr(i + 2, 2); if (!skip) { if (skipChars) skipChars--; else out.push(cp1252.decode(Uint8Array.of(parseInt(hex, 16) || 63))) } i += 4; continue }
      if (n === '~') { if (!skip) out.push(' '); i += 2; continue }
      if (n === '-' || n === '_') { i += 2; continue }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40))
      if (!m) { i += 2; continue }
      const word = m[1], param = m[2] === undefined ? null : parseInt(m[2], 10)
      i += m[0].length
      if (RTF_SKIP.has(word)) { skip = true; continue }
      if (word === 'uc' && param !== null) { uc = param; continue }
      if (skip) continue
      if (word === 'u' && param !== null) { out.push(String.fromCharCode(param < 0 ? param + 65536 : param)); skipChars = uc; continue }
      if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out.push('\n')
      else if (word === 'tab') out.push('\t')
      else if (word === 'cell') out.push(' | ')
      else if (word === 'row') out.push('\n')
      else if (word === 'emdash') out.push('—')
      else if (word === 'endash') out.push('–')
      else if (word === 'bullet') out.push('•')
      continue
    }
    if (ch === '\r' || ch === '\n') { i++; continue }
    if (!skip) { if (skipChars) skipChars--; else out.push(ch) }
    i++
  }
  const text = out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, method: 'rtf-tokenizer', note: 'RTF: teks dan tabel sederhana dipertahankan; gaya dan gambar diabaikan.' }
}

function extractHtml(bytes) {
  const { text } = decodeText(bytes)
  const t = text.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
  return { text: stripTags(t).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), method: 'html-strip', note: 'Skrip dan gaya dibuang; HTML tidak pernah dirender.' }
}

/* ------------------------------ PDF ------------------------------ */

async function extractPdf(bytes) {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const work = (async () => {
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    return { totalPages, pages: Array.isArray(text) ? text : [String(text)] }
  })()
  let timer
  const timeout = new Promise((_r, rej) => { timer = setTimeout(() => rej(new Error('Ekstraksi PDF melebihi 45 detik.')), 45_000) })
  try {
    const { totalPages, pages } = await Promise.race([work, timeout])
    const chars = pages.reduce((n, p) => n + p.trim().length, 0)
    if (chars < 20) return { empty: true, pages: totalPages, method: 'pdfjs', note: 'PDF tidak memiliki lapisan teks (kemungkinan hasil pindaian). OCR belum tersedia di aplikasi ini.' }
    return { text: pages.map((p, i) => `[Halaman ${i + 1}]\n${p.trim()}`).join('\n\n'), pages: totalPages, method: 'pdfjs' }
  } finally { clearTimeout(timer) }
}

/* ------------------------------ ukuran gambar ------------------------------ */

export function imageSize(b, ext) {
  try {
    if (ext === 'png' && b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (ext === 'gif' && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue }
        const m = b[i + 1]
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
        i += 2 + b.readUInt16BE(i + 2)
      }
    }
    if (ext === 'webp' && b.length >= 30) {
      const fmt = b.toString('ascii', 12, 16)
      if (fmt === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
      if (fmt === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
      if (fmt === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 } }
    }
  } catch { /* header tidak lengkap */ }
  return undefined
}

/* ------------------------------ entry point ------------------------------ */

/**
 * @returns {Promise<{state: 'extracted'|'unsupported'|'failed'|'not_applicable', method?: string, text?: string, pages?: number, truncated?: boolean, note?: string, warnings?: string[]}>}
 */
export async function extractContent({ ext, category, kind }, bytes) {
  try {
    let r
    if (kind === 'text') {
      const d = decodeText(bytes)
      r = { text: d.text, method: 'text', note: d.note }
      if (ext === 'json') { try { JSON.parse(d.text) } catch { r.note = [r.note, 'JSON tidak valid; teks mentah tetap dapat dibaca.'].filter(Boolean).join(' ') } }
    }
    else if (kind === 'pdf') {
      r = await extractPdf(bytes)
      if (r.empty) return { state: 'unsupported', method: r.method, pages: r.pages, note: r.note }
    }
    else if (kind === 'docx') r = extractDocx(bytes)
    else if (kind === 'pptx') r = extractPptx(bytes)
    else if (kind === 'xlsx') r = extractXlsx(bytes)
    else if (['odt', 'ods', 'odp'].includes(kind)) r = extractOdf(bytes, kind)
    else if (kind === 'rtf') r = extractRtf(bytes)
    else if (kind === 'html') r = extractHtml(bytes)
    else if (kind === 'zip') {
      const z = listZip(bytes)
      const lines = z.entries.map((e) => `${e.name} (${e.size} B)`)
      r = { text: `Arsip ZIP: ${z.count} entri, ${z.total} B terdekompresi.\n${lines.join('\n')}`, method: 'zip-list', warnings: z.warnings,
        note: 'Hanya daftar entri yang dibaca; isi arsip tidak diekstrak ke disk dan tidak dianalisis.' }
    }
    else if (category === 'image') return { state: 'not_applicable', note: kind === 'svg' ? 'SVG disimpan sebagai data dan tidak pernah dirender; tidak dapat dikirim ke model gambar.' : 'Gambar: perlu model vision untuk dipahami.' }
    else if (category === 'audio') return { state: 'unsupported', note: 'Audio perlu layanan transkripsi (DUDU_STT_MODEL) untuk dapat dipahami.' }
    else if (category === 'video') return { state: 'unsupported', note: 'Pemrosesan video (ekstraksi frame + transkripsi audio) belum diimplementasikan. File hanya disimpan.' }
    else return { state: 'unsupported', note: 'Format ini disimpan tetapi isinya tidak dapat dibaca oleh Dudu.' }

    const sample = (r.text ?? '').slice(0, 20000)
    const ctrl = (sample.match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length
    if (sample.length && ctrl / sample.length > 0.02) return { state: 'failed', method: r.method, note: 'Hasil ekstraksi tampak rusak (banyak karakter kontrol); isi tidak dikirim ke model.' }
    const c = cap(r.text ?? '')
    return { state: 'extracted', method: r.method, text: c.text, pages: r.pages, truncated: c.truncated, note: r.note, warnings: r.warnings }
  } catch (e) {
    return { state: 'failed', note: `Ekstraksi gagal: ${String(e?.message || e).slice(0, 200)}` }
  }
}
