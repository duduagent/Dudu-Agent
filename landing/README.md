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

1. **Domain resmi belum ditetapkan.** `sitemap.xml`, `robots.txt`, dan meta `og:image`/`twitter:image`
   memakai placeholder `REPLACE-WITH-OFFICIAL-DOMAIN`. Ganti dengan domain resmi, lalu jalankan ulang
   `npm run landing:check:strict`.
2. **Canonical URL belum ditambahkan** (sengaja tidak ada sekarang) — tambahkan
   `<link rel="canonical" href="https://<domain>/">` setelah domain disahkan.
3. **Hosting/penyajian** belum ada; landing page adalah berkas statis yang perlu diunggah ke host
   (GitHub Pages, Netlify, Cloudflare Pages, atau server sendiri).

Tidak ada domain, alamat kontak, atau URL repositori yang dikarang di halaman ini.

> Daftar perubahan domain yang persis, konfigurasi reverse proxy (nginx) beserta prosedur uji yang
> wajib dijalankan sebelum produksi, dan SOP operator (privasi, retensi, penghapusan, insiden):
> **[deploy/README.md](../deploy/README.md)** dan **[deploy/OPERATOR-SOP.md](../deploy/OPERATOR-SOP.md)**.

## Konfigurasi deployment minimum (TAHAP 3 audit)

### A. Hosting landing page (statis)

- Unggah **isi folder `landing/`** apa adanya ke host statis. Tidak ada build step; `index.html` adalah
  entry point. Header penting:

  | Header | Nilai | Alasan |
  |---|---|---|
  | `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` | Tidak ada skrip pihak ketiga; `form-action 'self'` melarang exfiltrasi form ke origin lain |
  | `X-Content-Type-Options` | `nosniff` | Mencegah sniffing tipe konten |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` | Tidak mengirim path ke pihak ketiga |
  | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (setelah HTTPS aktif) | Memaksa HTTPS |
  | `Cache-Control` | `public, max-age=3600` untuk HTML · `max-age=31536000, immutable` untuk `assets/img/` | aset ber-hash bisa di-cache lama |

- Arahkan `robots.txt` & `sitemap.xml` ke domain yang sama. Jangan meng-index subdomain pratinjau.

### B. Domain & HTTPS

- Domain resmi + sertifikat TLS (Let's Encrypt / managed). Landing **harus** HTTPS; tanpa itu, alamat email
  yang dikirim form dapat dicuri di jaringan.
- Setelah domain ada: ganti `REPLACE-WITH-OFFICIAL-DOMAIN` di `sitemap.xml` & `robots.txt`, tambahkan
  canonical, lalu `npm run landing:check:strict` **harus** lulus.

### C. Backend waiting list (reverse proxy)

Endpoint-nya adalah `POST /api/waiting-list` pada **API Dudu** (`server/chat-server.mjs`, loopback saja).
Pola deployment yang benar:

```
Publik → HTTPS (reverse proxy) → http://127.0.0.1:8787   (Dudu API, hanya loopback)
Landing (statis) ── POST /api/waiting-list ──► origin yang sama
```

Aturan wajib:

1. **Jangan membuka port Dudu (8787) langsung ke internet.** API itu tidak melakukan autentikasi
   (mode lokal) — Reverse proxy yang memegang otentikasi, TLS, dan rate limit per-IP.
2. **Formulir harus same-origin** (landing di-host pada origin yang sama dengan API lewat proxy yang
   meneruskan `/api/*`). If tidak, browser akan melakukan preflight dan **ditolak** — itu memang perilaku
   yang diinginkan (CORS tidak diaktifkan, dan `X-Dudu-Client` adalah header khusus yang memaksa preflight).
3. **Jangan mengaktifkan CORS** di sisi Dudu. Header `Access-Control-Allow-Origin` tidak boleh di-set untuk
   origin mana pun; cukup layani lewat reverse proxy bila perlu, dan tetap/whitelist origin landing.
4. **Pembatasan laju berlapis**:
   - Di aplikasi (app): batas global bawaan **60 pendaftaran/menit per instance** (`maxPerMinute`) → `429`.
   - Di reverse proxy: `limit_req` per-IP (mis. nginx `limit_req_zone $binary_remote_addr zone=wl:10m rate=10r/m;`)
     → per-IP yang benar, tanpa mempercayai `X-Forwarded-For` dari klien.
5. **Batas request**: transport HTTP membatasi body non-unggah **256 KB** (`MAX_BODY_BYTES`); isi waiting
   list sendiri dibatasi 500 karakter catatan dan 254 karakter email.
6. **Perlakuan kegagalan**: bila API tidak terjangkau, formulir menampilkan pesan jujur (bukan sukses
   karangan). Pemantau cukup menghitung `429`/`5xx` pada `/api/waiting-list`.

Contoh nginx (ilustrasi, **belum** diuji di lingkungan ini):

```nginx
location /api/waiting-list {
  limit_req zone=wl burst=5 nodelay;
  proxy_pass http://127.0.0.1:8787;
  proxy_set_header X-Dudu-Client 1;          # header anti-CSRF yang diwajibkan API
  proxy_set_header X-Real-IP $remote_addr;   # untuk log; JANGAN dipercaya dari klien
  client_max_body_size 16k;
}
location / {
  root /srv/dudu-landing;                     # isi folder landing/
  try_files $uri /index.html;
}
```

### D. Penyimpanan, retensi, backup, akses

- Berkas: `<dataDir>/waiting-list.json` — mode **0600 di POSIX** (chmod eksplisit setelah tulis).
  **Di Windows mode POSIX tidak berlaku**; keamanan relying pada ACL per-user `%APPDATA%\<app>\data`
  (folder profil pengguna, bukan bersama).
- Tidak ada endpoint pembacaan daftar → alamat email tidak bocor lewat API. Operator membaca berkas
  langsung (juga tersedia `store.summary()` / `store.remove(email)` untuk penghapusan).
- **Retensi**: tentukan kebijakan sendiri (mis. hapus entri yang sudah lewat 12 bulan). Hapus per entri
  dengan `remove(email)`; hapus seluruh berkas bila instance di-reset. Berkas rusak otomatis **diprahkan**
  sebagai `waiting-list.json.corrupt-<timestamp>.json` (tidak hilang diam-diam) — periksa folder itu
  bila daftar tiba-tiba kosong.
- **Backup**: salin `waiting-list.json` (berkas kecil, plaintext) ke penyimpanan privat. Karena berisi
  alamat email, perlakukan sebagai data pribadi: akses terbatas, enkripsi saat transit & saat disimpan.
- **Akses**: berkas hanya dibaca oleh akun pengguna OS yang menjalankan instance tersebut.

### E. Logging

- API **tidak** mencatat email, catatan, atau payload pendaftaran: `server/api.mjs` hanya mencatat
  `method`, `path`, `kode error`, dan pesan terpotong 200 karakter. Jangan tambahkan logging payload.
- Reverse proxy: log **tanpa** query string/body dan tanpa header `Authorization`; ikut menganonimkan IP
  bila retensi log panjang.
- Jangan pernah menulis `waiting-list.json` ke log aggregator atau CI.

### F. Yang TIDAK dilakukan (dengan sengaja)

- Tidak ada analytics pihak ketiga, cookie, atau pixel pada landing page.
- Tidak ada domain/URL/kredensial fiktif; tidak ada tautan unduhan yang belum ada.
- Tidak ada pengiriman email otomatis: produk belum punya mailing system, jadi formulir memakai
  bahasa yang jujur ("a human contacts you").

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
