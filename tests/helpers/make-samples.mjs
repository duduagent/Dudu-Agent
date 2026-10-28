// Membuat berkas sampel NYATA (docx/xlsx/pptx/odt/ods/pdf/png/zip) langsung di memori untuk tes.
import { zipSync, strToU8 } from 'fflate'

const z = (files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))))
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export const makeDocx = (paras, table) => z({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('')}` +
    (table ? `<w:tbl>${table.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>` : '') + '</w:body></w:document>',
})

export const makePptx = (slides) => z(Object.fromEntries(slides.map((s, i) => [`ppt/slides/slide${i + 1}.xml`, `<p:sld>${s.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('')}</p:sld>`])))

/** rows: array of arrays; angka ditulis sebagai angka, teks lewat sharedStrings */
export const makeXlsx = (rows, sheetName = 'Penjualan') => {
  const shared = []
  const col = (i) => String.fromCharCode(65 + i)
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === '' || v == null) return ''
    if (typeof v === 'number') return `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`
    let k = shared.indexOf(v); if (k < 0) { shared.push(v); k = shared.length - 1 }
    return `<c r="${col(ci)}${ri + 1}" t="s"><v>${k}</v></c>`
  }).join('')}</row>`).join('')
  return z({
    'xl/workbook.xml': `<workbook xmlns:r="r"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
  })
}

export const makeOdt = (paras) => z({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': `<office:document-content>${paras.map((p) => `<text:p>${esc(p)}</text:p>`).join('')}</office:document-content>` })
export const makeOds = (rows, name = 'Data') => z({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': `<office:document-content><table:table table:name="${name}">${rows.map((r) => `<table:table-row>${r.map((c) => `<table:table-cell><text:p>${esc(String(c))}</text:p></table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table></office:document-content>` })

/** PDF teks minimal yang valid, dengan tabel xref dihitung benar. pages: array string. */
export const makePdf = (pages) => {
  const objs = []
  const add = (s) => { objs.push(s); return objs.length }
  const catalog = add('')
  const pagesObj = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  for (const t of pages) {
    const stream = `BT /F1 14 Tf 72 720 Td (${t.replace(/[()\\]/g, '\\$&')}) Tj ET`
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const p = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)
    kids.push(`${p} 0 R`)
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** PNG 1x1 valid (ukuran dapat dibaca dari header). */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
export const makeZip = (files) => z(files)
