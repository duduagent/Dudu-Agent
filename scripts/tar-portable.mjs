// Membuat arsip tar.gz portabel Linux DENGAN bit izin POSIX yang benar.
// bsdtar di Windows tidak bisa menyimpan mode eksekusi, sehingga arsip hasil tar biasa
// membuat pengguna wajib `chmod +x dudu-ai` secara manual. Penulis tar di bawah
// menulis header ustar dengan mode 0755 untuk berkas eksekutable dan 0644 untuk lainnya.
//
// Pakai: node scripts/tar-portable.mjs <folder> <keluaran.tar.gz> [nama-eksekutable...]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const [, , srcDir, outFile, ...execNames] = process.argv
if (!srcDir || !outFile) { console.error('Pakai: node scripts/tar-portable.mjs <folder> <keluaran.tar.gz> [exec...]'); process.exit(2) }

const EXEC = new Set(execNames)
const isExec = (rel) => EXEC.has(rel) || /(^|\/)(dudu-ai|chrome-sandbox|chrome_crashpad_handler)$/.test(rel)

const BLOCK = 512
function header(rel, size, mode, type, mtime) {
  const buf = Buffer.alloc(BLOCK)
  const put = (str, off, len) => { buf.write(str.slice(0, len - 1), off, 'utf8') }
  put(rel, 0, 100)
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii')   // mode
  buf.write('0000000\0', 108, 'ascii')                                 // uid
  buf.write('0000000\0', 116, 'ascii')                                 // gid
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii')  // size
  buf.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 'ascii')  // mtime
  buf.write('        ', 148, 'ascii')                                   // checksum placeholder
  buf.write(type, 156, 'ascii')                                        // typeflag
  buf.write('ustar\0', 257, 'ascii')
  buf.write('00', 263, 'ascii')
  buf.write('root', 265, 'ascii')
  buf.write('root', 297, 'ascii')
  let sum = 0
  for (const b of buf) sum += b
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return buf
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(base, full).split(path.sep).join('/')
    if (entry.isDirectory()) { out.push({ rel, dir: true }); walk(full, base, out) }
    else if (entry.isFile()) out.push({ rel, file: true, full, size: fs.statSync(full).size })
  }
  return out
}

const items = walk(srcDir)
const mtime = Math.floor(Date.now() / 1000)
const chunks = []
for (const it of items) {
  if (it.dir) {
    chunks.push(header(it.rel + '/', 0, 0o755, '5', mtime))
    continue
  }
  const mode = isExec(it.rel) ? 0o755 : 0o644
  chunks.push(header(it.rel, it.size, mode, '0', mtime))
  const data = fs.readFileSync(it.full)
  chunks.push(data)
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK
  if (pad) chunks.push(Buffer.alloc(pad))
}
chunks.push(Buffer.alloc(BLOCK * 2))  // penanda akhir arsip

const tar = Buffer.concat(chunks)
fs.writeFileSync(outFile, zlib.gzipSync(tar, { level: 9 }))
const execCount = items.filter((i) => i.file && isExec(i.rel)).length
console.log(`${outFile} — ${items.length} entri, ${execCount} berkas dengan mode 0755, ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB`)
