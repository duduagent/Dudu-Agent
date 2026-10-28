// Hitung rasio kontras WCAG untuk pasangan warna yang BENAR-BENAR dipakai komponen ter-render.
//
// Aturan WCAG yang dibedakan di sini:
//  - Teks normal            → minimal 4.5:1
//  - Teks besar (>=24px, atau >=18.66px bold) → minimal 3:1
//  - Komponen non-teks (batas input, cincin fokus, indikator) → minimal 3:1 (WCAG 1.4.11)
//
// Pakai: node scripts/contrast-check.mjs
const hexToRgb = (h) => {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const l1 = lum(hexToRgb(a)), l2 = lum(hexToRgb(b))
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
const r2 = (n) => Math.round(n * 100) / 100

const WHITE = '#FFFFFF'

console.log('== 1. TOMBOL EMAS (teks putih di atas isian) — butuh 4.5:1 untuk label 13px ==')
for (const c of ['#C79A42', '#B98B33', '#A9781F', '#9C7016', '#8A6212', '#7E5A10']) {
  const r = ratio(WHITE, c)
  console.log(`  ${c}  putih/teks = ${r2(r)}  ${r >= 4.5 ? 'LOLOS AA' : r >= 3 ? 'hanya teks besar' : 'GAGAL'}`)
}

console.log('\n== 2. BATAS KONTROL FORM (non-teks → butuh 3:1 terhadap latar) ==')
for (const c of ['#E1DDD2', '#D3CDBD', '#C4BDA9', '#B5AC95', '#A79D84', '#9A9079', '#8C8270']) {
  const r = ratio(c, WHITE)
  console.log(`  ${c}  terhadap putih = ${r2(r)}  ${r >= 3 ? 'LOLOS 3:1' : 'belum 3:1'}`)
}

console.log('\n== 3. CINCIN FOKUS / GARIS AKTIF (non-teks → 3:1) ==')
for (const c of ['#D6B36A', '#9C7016', '#8A6212']) {
  console.log(`  ${c}  terhadap putih = ${r2(ratio(c, WHITE))}`)
}

console.log('\n== 4. PASANGAN TEKS KOMPONEN (target >= 4.5:1) ==')
const PAIRS = [
  ['tombol emas (putih di atas isian)', WHITE, '#8A6212'],
  ['tombol emas (lama, untuk perbandingan)', WHITE, '#9C7016'],
  ['tombol sekunder (ink2 di atas putih)', '#4F4F4F', WHITE],
  ['tombol bahaya (err di atas putih)', '#B3402F', WHITE],
  ['tautan (gold-ink di atas putih)', '#8A6212', WHITE],
  ['badge tersedia (ok di atas ok-bg)', '#2E7D4F', '#F1F7F2'],
  ['badge perlu perhatian (warn di atas warn-bg)', '#8A5A12', '#FBF6E9'],
  ['badge gagal (err di atas err-bg)', '#B3402F', '#FBF1EF'],
  ['badge netral (ink2 di atas smoke)', '#4F4F4F', '#F4F3EF'],
  ['notifikasi info (gold-ink di atas gold-wash)', '#8A6212', '#FDF8EC'],
  ['teks meta (ink3 di atas putih)', '#6E6E6E', WHITE],
  ['teks meta di atas ivory', '#6E6E6E', '#FCFBF8'],
  ['placeholder (ink3 di atas putih)', '#6E6E6E', WHITE],
  ['teks utama di atas panel', '#171717', WHITE],
  ['nav aktif (ink di atas cream)', '#171717', '#F7F4ED'],
  ['helper field (ink2 di atas putih)', '#4F4F4F', WHITE],
]
let fail = 0
for (const [name, fg, bg] of PAIRS) {
  const r = ratio(fg, bg)
  const ok = r >= 4.5
  if (!ok) fail++
  console.log(`  ${ok ? 'LOLOS' : 'GAGAL'}  ${r2(r).toString().padStart(5)}  ${name}`)
}
console.log(`\n  ${fail} pasangan gagal ambang 4.5:1`)
console.log('\n== 5. KONTROL NONAKTIF (dikecualikan WCAG 1.4.3) ==')
console.log('  opacity .45 → kontras turunan; WCAG mengecualikan kontrol nonaktif dari syarat kontras teks.')
console.log('  tetap dipakai opacity, bukan warna lain, agar terlihat "tidak aktif".')
