// Tool analisis data lokal (deterministik, tanpa model). Dipakai oleh eksekutor misi.
import { decodeText, parseXlsx } from './extract.mjs'

export const TABULAR_EXTS = new Set(['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx'])
const MAX_ROWS = 200_000

export class ToolError extends Error {
  /** @param {'input_invalid'|'parse_error'|'tool_error'|'verification_failed'} cls */
  constructor(cls, message) { super(message); this.class = cls }
}

/* ------------------------------ CSV ------------------------------ */

export function detectDelimiter(text, ext) {
  if (ext === 'tsv') return '\t'
  const head = text.split(/\r?\n/).slice(0, 5).join('\n')
  const counts = [',', ';', '\t', '|'].map((d) => [d, head.split(d).length - 1])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

export function parseCsv(text, delim) {
  const rows = []
  let row = [], field = '', inQ = false, i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue } inQ = false; i++; continue }
      field += ch; i++; continue
    }
    if (ch === '"' && field === '') { inQ = true; i++; continue }
    if (ch === delim) { row.push(field); field = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''; i++
      if (!(row.length === 1 && row[0] === '')) rows.push(row)
      row = []
      if (rows.length > MAX_ROWS + 1) throw new ToolError('input_invalid', `Data melebihi ${MAX_ROWS} baris.`)
      continue
    }
    field += ch; i++
  }
  if (inQ) throw new ToolError('parse_error', 'CSV tidak valid: tanda kutip tidak ditutup.')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/* ------------------------------ load ------------------------------ */

function normalizeHeader(cells) {
  const seen = new Map()
  return cells.map((c, i) => {
    let name = String(c ?? '').trim() || `kolom_${i + 1}`
    const k = seen.get(name) ?? 0
    seen.set(name, k + 1)
    return k ? `${name}_${k + 1}` : name
  })
}

/** @returns {{columns: string[], rows: string[][], sheet?: string}} baris data TANPA header */
export function loadTable({ ext, bytes }) {
  if (!TABULAR_EXTS.has(ext)) throw new ToolError('input_invalid', `Format .${ext} bukan data tabular yang didukung (csv, tsv, json, jsonl, xlsx).`)
  let grid
  let sheet
  if (ext === 'xlsx') {
    let tables
    try { ({ tables } = parseXlsx(bytes)) } catch (e) { throw new ToolError('parse_error', `XLSX tidak dapat dibaca: ${e.message}`) }
    const t = tables.find((x) => x.rows.some((r) => r.some((c) => c !== '')))
    if (!t) throw new ToolError('input_invalid', 'Semua lembar kerja kosong.')
    sheet = t.name
    grid = t.rows.filter((r) => r.length && r.some((c) => c !== ''))
  } else {
    const { text } = decodeText(bytes)
    if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') {
      let data
      try { data = ext === 'json' ? JSON.parse(text) : text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)) } catch (e) { throw new ToolError('parse_error', `JSON tidak valid: ${e.message}`) }
      if (!Array.isArray(data)) { const arr = data && typeof data === 'object' ? Object.values(data).find((v) => Array.isArray(v)) : null; if (arr) data = arr }
      if (!Array.isArray(data) || data.length === 0 || !data.every((o) => o && typeof o === 'object' && !Array.isArray(o))) throw new ToolError('input_invalid', 'JSON harus berupa array objek (atau objek berisi satu array objek).')
      if (data.length > MAX_ROWS) throw new ToolError('input_invalid', `Data melebihi ${MAX_ROWS} baris.`)
      const keys = [...new Set(data.flatMap((o) => Object.keys(o)))]
      grid = [keys, ...data.map((o) => keys.map((k) => (o[k] == null ? '' : typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k]))))]
    } else grid = parseCsv(text, detectDelimiter(text, ext))
  }
  if (grid.length < 2) throw new ToolError('input_invalid', 'Data harus memiliki minimal satu baris header dan satu baris data.')
  const columns = normalizeHeader(grid[0])
  const rows = grid.slice(1, MAX_ROWS + 1).map((r) => columns.map((_c, i) => String(r[i] ?? '')))
  return { columns, rows, sheet }
}

/* ------------------------------ profil ------------------------------ */

export function parseNum(v) {
  const s = String(v).trim()
  if (s === '') return null
  if (/^-?\d+(\.\d+)?$/.test(s) || /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) { const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? n : null }
  return null
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s)

export function profileTable(t) {
  const seenRows = new Set()
  let duplicates = 0
  for (const r of t.rows) { const k = JSON.stringify(r); if (seenRows.has(k)) duplicates++; else seenRows.add(k) }
  const columns = t.columns.map((name, ci) => {
    const vals = t.rows.map((r) => r[ci])
    const nonEmpty = vals.filter((v) => v.trim() !== '')
    const nums = nonEmpty.map(parseNum)
    const numeric = nonEmpty.length > 0 && nums.filter((x) => x !== null).length / nonEmpty.length >= 0.95
    const col = { name, nonNull: nonEmpty.length, nulls: vals.length - nonEmpty.length, unique: new Set(nonEmpty).size }
    if (numeric) {
      const xs = nums.filter((x) => x !== null).sort((a, b) => a - b)
      const sum = xs.reduce((a, b) => a + b, 0)
      const mid = Math.floor(xs.length / 2)
      Object.assign(col, { type: xs.every(Number.isInteger) ? 'integer' : 'number', min: xs[0], max: xs.at(-1), sum, mean: sum / xs.length, median: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2, nonNumeric: nonEmpty.length - xs.length })
    } else if (nonEmpty.length > 0 && nonEmpty.every(isDate)) {
      const s = [...nonEmpty].sort()
      Object.assign(col, { type: 'date', min: s[0], max: s.at(-1) })
    } else {
      const freq = new Map()
      for (const v of nonEmpty) freq.set(v, (freq.get(v) ?? 0) + 1)
      Object.assign(col, { type: 'text', top: [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([value, count]) => ({ value, count })) })
    }
    return col
  })
  return { rowCount: t.rows.length, columnCount: t.columns.length, duplicateRows: duplicates, sheet: t.sheet ?? null, columns }
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6))
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function renderReport({ goal, file, profile, generatedAt }) {
  const L = []
  L.push(`# Laporan Analisis Data`, '', `**Tujuan misi:** ${goal}`, '', `- File sumber: ${file.name}`, `- SHA-256 sumber: \`${file.sha256}\``, `- Dibuat: ${new Date(generatedAt).toISOString()}`)
  if (profile.sheet) L.push(`- Lembar kerja dianalisis: ${profile.sheet}`)
  L.push('', '## Ringkasan', '', `Jumlah baris data: ${profile.rowCount}`, `Jumlah kolom: ${profile.columnCount}`, `Baris duplikat persis: ${profile.duplicateRows}`, '')
  L.push('## Kolom', '', '| Kolom | Tipe | Terisi | Kosong | Unik |', '| --- | --- | ---: | ---: | ---: |')
  for (const c of profile.columns) L.push(`| ${cell(c.name)} | ${c.type} | ${c.nonNull} | ${c.nulls} | ${c.unique} |`)
  const nums = profile.columns.filter((c) => c.type === 'integer' || c.type === 'number')
  if (nums.length) {
    L.push('', '## Statistik numerik', '', '| Kolom | Min | Maks | Rata-rata | Median | Total |', '| --- | ---: | ---: | ---: | ---: | ---: |')
    for (const c of nums) L.push(`| ${cell(c.name)} | ${fmt(c.min)} | ${fmt(c.max)} | ${fmt(c.mean)} | ${fmt(c.median)} | ${fmt(c.sum)} |`)
  }
  const texts = profile.columns.filter((c) => c.type === 'text' && c.top?.length)
  if (texts.length) {
    L.push('', '## Nilai teratas (kolom teks)', '')
    for (const c of texts) L.push(`- **${cell(c.name)}**: ${c.top.map((t) => `${cell(t.value)} (${t.count})`).join(', ')}`)
  }
  const issues = profile.columns.filter((c) => profile.rowCount && c.nulls / profile.rowCount > 0.2)
  L.push('', '## Catatan kualitas data', '')
  if (!issues.length && !profile.duplicateRows) L.push('- Tidak ada masalah kualitas yang melewati ambang (kolom >20% kosong atau baris duplikat).')
  for (const c of issues) L.push(`- Kolom "${cell(c.name)}" ${Math.round((c.nulls / profile.rowCount) * 100)}% kosong.`)
  if (profile.duplicateRows) L.push(`- Terdapat ${profile.duplicateRows} baris duplikat persis.`)
  L.push('', '_Dihasilkan oleh tool lokal deterministik `data.profile` (bukan oleh model AI). Angka dihitung dari data mentah._', '')
  return L.join('\n')
}

/* ------------------------------ verifikasi independen ------------------------------ */

/** Hitung baris data dengan implementasi TERPISAH dari parser (mesin status / hitung elemen), untuk dibandingkan. */
export function independentRowCount(ext, bytes) {
  if (ext === 'xlsx') {
    const { tables } = parseXlsx(bytes)
    const t = tables.find((x) => x.rows.some((r) => r.some((c) => c !== '')))
    return t ? t.rows.filter((r) => r.length && r.some((c) => c !== '')).length - 1 : 0
  }
  const { text } = decodeText(bytes)
  if (ext === 'json') { let d = JSON.parse(text); if (!Array.isArray(d)) d = Object.values(d).find(Array.isArray); return d.length }
  if (ext === 'jsonl' || ext === 'ndjson') return text.split(/\r?\n/).filter((l) => l.trim()).length
  // CSV/TSV: hitung terminator rekaman di luar tanda kutip
  let inQ = false, records = 0, hasData = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQ = !inQ
    else if (!inQ && (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n'))) { if (hasData) records++; hasData = false }
    else if (ch !== '\r') hasData = true
  }
  if (hasData) records++
  return records - 1
}

/** Hitung ulang min/maks/total per kolom numerik langsung dari data mentah. */
export function recomputeNumericStats(table) {
  const out = {}
  table.columns.forEach((name, ci) => {
    const xs = []
    let nonEmpty = 0
    for (const r of table.rows) { const v = r[ci]; if (v.trim() === '') continue; nonEmpty++; const x = parseNum(v); if (x !== null) xs.push(x) }
    if (nonEmpty > 0 && xs.length / nonEmpty >= 0.95) {
      let mn = Infinity, mx = -Infinity, sum = 0
      for (const x of xs) { if (x < mn) mn = x; if (x > mx) mx = x; sum += x }
      out[name] = { min: mn, max: mx, sum }
    }
  })
  return out
}
