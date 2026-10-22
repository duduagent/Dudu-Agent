# Dudu Public Landing Page v1

Landing page pemasaran **publik** untuk Dudu AI Workforce & Agent OS. Berdiri sendiri sebagai situs
statis di `landing/` — **tidak** berada di dalam aplikasi internal, dan tidak mengubah routing, backend
misi, permission, approval, maupun audit.

## Mengapa terpisah (keputusan arsitektur)

| Opsi | Penilaian |
|---|---|
| Route di dalam frontend aplikasi | **Ditolak** — aplikasi internal tidak punya router (perpindahan berbasis `useState`), `dist/`-nya adalah entry point Electron (`dudu://app`), dan satu `index.html` tidak dapat gestionar meta SEO per halaman. Menaruh halaman pemasaran di sana juga akan memorable ke dalam paket desktop. |
| Aplikasi web publik terpisah (`landing/`) | **Dipilih** — nol perubahan pada aplikasi internal, batas keamanan jelas (halaman statis tanpa akses API/data), dapat di-hosting di mana saja sebagai berkas statis, dan mudah dirawat (HTML + CSS + JS kecil, tanpa build step, tanpa dependensi baru). |

## Isi

```
landing/
├── index.html              halaman (semantik, SEO, OG, aksesibel)
├── assets/landing.css      gaya (token disalin dari UI_DESIGN_SYSTEM.md)
├── assets/landing.js       interaksi: nav mobile, reveal, formulir waiting list
├── assets/img/             screenshot NYATA + ikon + OG image
├── docs/                   salinan README.md & SECURITY_NOTES.md (tautan footer benar-benar bekerja;
│                           salinan — segarkan bila dokumen asli berubah)
├── robots.txt              percakapan perayapan
└── sitemap.xml             peta situs (base URL = placeholder, lihat "Sebelum publikasi")
```

## Menjalankan pratinjau

```bash
npm run landing:dev            # server statis lokal → http://127.0.0.1:4173/
npm run landing:check          # validasi tautan/aset/klaim/kontras (exit 0 bila wajib lulus)
npm run landing:check:strict   # sama, tetapi gagal bila masih ada blocker publikasi
```

## Formulir waiting list

- Formulir melakukan `POST /api/waiting-list` pada **origin yang sama** dan mengirim header
  `X-Dudu-Client` (aturan anti-CSRF yang sama seperti API lain).
- Data disimpan **di folder data instance Dudu** yang menerima pendaftaran (`waiting-list.json`, mode 0600
  di POSIX). Tidak ada endpoint pembacaan daftar — alamat email tidak pernah dibocorkan lewat API.
- Bila endpoint tidak terjangkau, formulir menampilkan **pesan jujur** ("the waiting-list API could not be
  reached…") — tidak ada pesan sukses karangan.
- Preview statis (`landing:dev`) **tidak** melayani API; jalankan API Dudu juga (atau gunakan reverse
  proxy) bila ingin menguji alur submit end-to-end.

## Sebelum publikasi (blocker yang harus diselesaikan)

`npm run landing:check` melaporkan hal-hal berikut sebagai **BLOCKER PUBLIKASI** (hanya terlihat bila
`--strict` dijalankan):

1. **Domain resmi belum ditetapkan.** `sitemap.xml` dan `robots.txt` memakai placeholder
   `REPLACE-WITH-OFFICIAL-DOMAIN`. Ganti dengan domain resmi, lalu jalankan ulang
   `npm run landing:check:strict`.
2. **Canonical URL belum ditambahkan** (sengaja tidak ada sekarang) — tambahkan
   `<link rel="canonical" href="https://<domain>/">` setelah domain disahkan.
3. **Hosting/penyajian** belum ada; landing page adalah berkas statis yang perlu diunggah ke host
   (GitHub Pages, Netlify, Cloudflare Pages, atau server sendiri).

Tidak ada domain, alamat kontak, atau URL repositori yang dikarang di halaman ini.

## Yang tidak diklaim (sengaja)

Landing page **tidak** menampilkan: harga, testimoni, jumlah pengguna, statistik keberhasilan, klaim ROI,
tautan unduhan langsung ke berkas rilis, status mobile yang belum ada, atau klaim keamanan
("tamper-proof", "tersertifikasi"). Status kanal mengikuti bukti aktual:

| Kanal | Status di halaman | Bukti |
|---|---|---|
| Web App | Available — self-hosted | `server/chat-server.mjs` + Vite; tidak ada URL publik |
| Desktop Windows | Available | build, instalasi senyap, smoke 51/51, upgrade 0.5.0 → 0.6.4 |
| Desktop Linux | Partial | tarball 0755 terbuild; **belum dijalankan** di Linux; `.deb`/AppImage butuh Linux |
| Desktop macOS | Not built here | hanya bisa dibangun di macOS; job CI tersedia; belum ditandatangani |
| Mobile Android/iOS | Planned — not released | tidak ada paket mobile, tidak ada kode mobile, tidak ada listing toko |

Pemeriksaan otomatis (`npm run landing:check`) menegakkan hal-hal di atas: tautan unduhan palsu, tautan
eksternal ke domain karangan, analitik pihak ketiga, cookie, dan klaim tanpa penyangkal akan **gagal**.

## Aset

- Screenshot berasal dari build lokal (dihasilkan `scripts/ui-audit.cjs`) — **nyata**, bukan mock-up.
- Ikon: `build/icon.svg` + `build/icon.png` (aset repo yang sama dipakai aplikasi desktop).
- OG image: `assets/img/og-image.png` (1440×900, screenshot asli).
