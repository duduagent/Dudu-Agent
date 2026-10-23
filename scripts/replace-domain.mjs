// Ganti placeholder domain & email ke nilai riil (single-source replacement).
//
// Pakai:
//   node scripts/replace-domain.mjs --domain <domain> [--email <email>] \
//       [--path-sert <path>] [--path-key <path>] [--path-landing <path>
//
// Catatan: nilai domain/email WAJIB via CLI arg — tidak boleh dikarang di dalam skrip.
// Skrip ini mengganti token tunggal dari deploy/domain.example.json (atau literal string)
// di semua berkas terdaftar, agar tidak ada sisa placeholder yang tersisa.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(name)
  if (i === -1 || i + 1 >= args.length) {
    console.error(`ERROR: argumen wajib hilang: ${name}`)
    process.exit(2)
  }
  return args[i + 1]
}

const domain = getArg('--domain')
const email = getArg('--email') || null
const pathServ = getArg('--path-sert') || null
const pathKey = getArg('--path-key') || null
const pathLanding = getArg('--path-landing') || null

const TOKENS = {
  domain: { from: 'REPLACE-WITH-OFFICIAL-DOMAIN', to: domain },
  email: { from: 'REPLACE-WITH-OFFICIAL-EMAIL', to: email },
}

const apply = (rel, replacements) => {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    console.error(`Berkas tidak ditemukan: ${rel}`)
    return false
  }
  let s = fs.readFileSync(full, 'utf8')
  let changed = false
  for (const r of replacements) {
    if (r.from && r.to && s.includes(r.from)) {
      s = s.split(r.from).join(r.to)
      changed = true
    }
  }
  if (changed) fs.writeFileSync(full, s, 'utf8')
  console.log(`${changed ? 'DIUBAH  ' : 'TIDAK ADA'}\t${rel}`)
  return changed
}

let ok = true
ok = apply('landing/sitemap.xml', [TOKENS.domain]) && ok
ok = apply('landing/robots.txt', [TOKENS.domain]) && ok
ok = apply('landing/index.html', [TOKENS.domain, TOKENS.email]) && ok
ok = apply('package.json', [TOKENS.domain]) && ok
ok = apply('electron-builder.yml', email ? [TOKENS.email] : []) && ok
ok = apply('deploy/nginx/dudu-landing.conf', [{ from: '<DOMAIN>', to: domain }, ...(pathServ ? [{ from: '<PATH_SERT>', to: pathServ }] : []), ...(pathKey ? [{ from: '<PATH_KEY>', to: pathKey }] : []), ...(pathLanding ? [{ from: '<PATH_LANDING>', to: pathLanding }] : [])]) && ok

console.log(ok ? '\nSelesai. Jalankan ulang validasi:\n  npm run landing:check:strict\n  npm run proxy:check -- --strict' : '\nAda berkas yang gagal diproses — periksa di atas.')
process.exit(ok ? 0 : 1)
