# Keputusan Peluncuran & Rencana — Dudu AI (Landing Page + Waiting List)

Status dokumen: **rencana, belum ada yang dieksekusi.** Tidak ada deployment, pembelian domain,
akun layanan, kredensial produksi, tag, push, atau release yang dibuat.

Semua keputusan yang membutuhkan pemilik produk ditandai **`DECISION REQUIRED`**. Angka, nama, dan
identitas yang tidak dapat diverifikasi **tidak dikarang** di sini.

Dokumen ini adalah companions dari `deploy/README.md` (konfigurasi & prosedur uji) dan
`deploy/OPERATOR-SOP.md` (SOP harian) — keduanya tetap acuan teknis.

---

## 1. Ringkasan status (per 22 Oktober 2026)

| Komponen | Status | Bukti |
|---|---|---|
| Landing page (statis) | **Siap secara teknis**, belum tayang | `npm run landing:check` exit 0; audit responsif 6 lebar (fase sebelumnya) |
| Endpoint waiting list | **Siap secara teknis**, belum dipakai publik | 353 tes/29 file; probe 14/14; e2e proksi 7/7 |
| Konfigurasi reverse proxy | **Ada, belum pernah dijalankan** | `npm run proxy:check` exit 0 (statis); nginx tidak tersedia di mesin dev |
| Domain | **Belum ada** | `landing:check:strict` & `proxy:check:strict` **gagal (exit 1)** — sengaja |
| TLS | **Belum ada** | tidak ada sertifikat/domain |
| Hosting | **Belum ada** | tidak ada host/instance yang dikonfigurasi |
| Kebijakan privasi/retensi | **Belum diputuskan** | `deploy/OPERATOR-SOP.md` — semua item `DECISION REQUIRED` |

---

## 2. Keputusan domain (`DECISION REQUIRED`)

### 2.1 Kriteria pemilihan

| Kriteria | Kenapa | Bobot |
|---|---|---|
| **Ketersediaan** (bisa didaftarkan) | tanpa ini tidak ada yang bisa_ge launched | wajib |
| **Panjang & keterbacaan** | dipakai di URL, email, dan QR | tinggi |
| **Tidak menyesatkan** (tidak mirip domain lain/merk lain) | hindari kebingungan & phishing | tinggi |
| **Umum & mudah diketik** (tanpa tanda hubung/angka) | mengurangi salah ketik, enak dibaca lisan | sedang |
| **Bisa dipakai untuk email domain** (SPF/DKIM/MX) | kontak resmi kemungkinan email | sedang |
| **Hindari negara/ekstensi yang memicu filter** | mengurangi masuk spam | sedang |
| **Tidak beririsan dengan repo/hosting/akun lain** |ADO pisahkan kebocoran | sedang |
| **Hak atas nama & masa depan** | nama bisa diubah, jangan pakai nama pribadi | rendah |

### 2.2 Kandidat

**Tidak ada kandidat yang diverifikasi.** Pemeriksaan ketersediaan membutuhkan registrar
(Whois/RDAP) dan **tidak dilakukan**: tidak ada akses registrar, tidak ada domain yang dibeli, dan
menebak nama kandidat lalu mengeceknya bukan bagian dari fase ini.

Status: **`DECISION REQUIRED`** — pemilik produk memilih kandidat, lalu menjalankan pemeriksaan
ketersediaan di registrar (tidak ada akun yang dibuat di sini).

Prosedur yang harus dijalankan pemilik produk (bukan oleh agen):

1. Buat daftar 3–5 kandidat yang memenuhi kriteria di atas.
2. Periksa ketersediaan di registrar (Whois/RDAP) — catat hasilnya.
3. Periksa **marka nama**: apakah nama itu sudah dipakai produk/merk lain yang terlihat?
4. Pastikan tidak sudah dipakai oleh akun email/organisasi milik pemilik sendiri.
5. Catat kandidat terpilih + tanggal pemeriksaan di dokumen ini (status `VERIFIED`).

### 2.3 Placeholder yang harus diganti bersama domain

| Letak | Nilai sekarang | Catatan |
|---|---|---|
| `package.json` → `homepage` | `https://example.com/dudu-ai` | **placeholder** (bukan domain nyata) |
| `electron-builder.yml` → `linux.maintainer` | `Dudu AI <dudu-ai@example.com>` | **placeholder** |
| `landing/sitemap.xml`, `landing/robots.txt` | `REPLACE-WITH-OFFICIAL-DOMAIN` | token tunggal, 3 berkas |
| `landing/index.html` → `og:image`, `twitter:image` | token yang sama | 2 meta |
| `landing/index.html` → canonical | **tidak ada** | ditambahkan setelah domain disahkan |
| `deploy/nginx/dudu-landing.conf` | `<DOMAIN>`, `<PATH_SERT>`, `<PATH_KEY>`, `<PATH_LANDING>` | 4 placeholder |

### 2.4 Record DNS yang diperlukan

| Jenis | Nilai | Catatan |
|---|---|---|
| `A` / `AAAA` | IP host statis landing | atau `CNAME` ke penyedia statis |
| `CNAME www` | domain utama (opsional) | pilih **satu** host utama; jangan dua-duanya replying |
| `TXT` (SPF) | `v=spf1 -all` (hanya bila email dikirim dari domain) | **hanya** bila mailing akan dipakai; sekarang tidak ada mailing |
| `TXT` (DKIM) | dari penyedia email | hanya bila email dikirim |
| `MX` | tidak wajib | tidak ada sistem email; kontak boleh memakai alamat email lain |
| `CAA` | `issue letsencrypt.org` | membatasi CA yang boleh menerbitkan sertifikat |

> Rekomendasi: **jangan** daftarkan MX/SPF/DKIM dulu bila contacted lewat email pribadi/alamat lain —
> minimize jejak & permukaan.

### 2.5 Rencana HTTPS & pembaruan sertifikat

1. Sertifikat dari CA (Let's Encrypt recommended) — issuance butuh domain sudah resolve ke host.
2. ACME HTTP-01: tambah `location ^~ /.well-known/acme-challenge/` di blok HTTP (port 80) yang
   meneruskan ke webroot ACME, **tidak** ke API.
3. Pasang sertifikat di `<PATH_SERT>`/`<PATH_KEY>` (nginx reload, bukan restart).
4. Perpanjangan otomatis (certbot/renewal hook `nginx -s reload`), masa 90 hari.
5. Alarm: sertifikat yang tinggal <14 hari → notifikasi (belum ada mekanisme → `DECISION REQUIRED`).
6. Uji: `curl -I https://<domain>/` (200 + HSTS), `http://` → 301, `openssl s_client` (chain & masa berlaku).

### 2.6 Konsekuensi perubahan domain

| Artefak | Yang harus diubah | Kenapa |
|---|---|---|
| `landing/index.html` | canonical, `og:url`, `og:image`, `twitter:image` | URL absolut harus host yang benar |
| `landing/sitemap.xml` | semua `<loc>` | host |
| `landing/robots.txt` | baris `Sitemap:` | host |
| `deploy/nginx/dudu-landing.conf` | `<DOMAIN>`, `server_name`, `<PATH_SERT>`, `<PATH_KEY>` | TLS & routing |
| `package.json` | `homepage` | metadata paket |
| `electron-builder.yml` | `linux.maintainer` | metadata paket .deb |
| Dokumen (`README.md`, `PACKAGING.md`, `deploy/*`) | referensi domain | konsistensi |

> `npm run landing:check` & `npm run proxy:check` **memverifikasi konsistensi host** antar
> sitemap/robots/OG — jadi domain yang terisi di sebagian berkas akan tertangkap.

---

## 3. Rancangan hosting

### 3.1 Dua komponen, dua batas kepercayaan berbeda

| | **A. Hosting statis landing page** | **B. Backend waiting list (proxy + API)** |
|---|---|---|
| Isi | HTML/CSS/JS/gambar statis | Endpoint + penyimpanan daftar |
| Menan>data | **tidak ada PII** (formulir hanya mengirim ke origin B) | **berisi alamat email** |
| Akses jaringan | publik (HTTPS) | publik **hanya** lewat proxy; API hanya loopback |
| Bentuk | host statis (shared hosting/CDN) | host/VM khusus |
| Risiko utama | disalahartikan sebagai "sudah tayang" | kebocoran daftar email |
| Perlakuan | failed on CORS (form ke origin lain diblokir browser) | backup terenkripsi, akses terbatas |

### 3.2 Alur data

```
Peramban (HTTPS)
   │  GET /                 → host statis (landing page)
   │  POST /api/waiting-list → host proxy (TLS, rate limit, body limit)
   │                            │  loopback
   │                            ▼
   │                        API Dudu (127.0.0.1:8787)  →  waiting-list.json (folder data)
   ▼
respons HTML / JSON
```

- Tidak ada CORS: formulir **wajib** same-origin (host statis & proxy pada domain yang sama, atau
  proxy yang juga menyajikan landing page).
- `X-Dudu-Client` adalah header khusus → lintas-origin memicu preflight → ditolak browser (memachines).
- Header anti-CSRF API tetap berlaku; proxy yang menyetelnya.

### 3.3 Port: yang boleh & yang tidak

| Port | Service | Ekspos ke internet? |
|---|---|---|
| 80 | proxy (HTTP → redirect) | **Ya** (hanya redirect) |
| 443 | proxy (TLS) | **Ya** |
| 8787 | API Dudu (`chat-server.mjs`) | **TIDAK** — loopback saja |
| 8787 | desktop app | tidak memakai TCP (`dudu://app` in-process) |
| 9222/9243 | DevTools/inspection | **TIDAK** |

### 3.4 Pembatasan per-IP

| Lapis | Batas | frequented | Kenapa di sini |
|---|---|---|---|
| Proxy | `limit_req_zone $binary_remote_addr` (mis. 10r/m, burst 5) |Ya | alamat klien asli; tidak mempercayai XFF |
| API | 60/menit per instance (global) | Ya | protects file & CPU; per-IP mustahil (proxy seen as single client) |
| Total efektif | ~10/menit per IP | | proxy yang ketat |

### 3.5 Request besar, timeout, backend mati

| Situasi | Perlakuan | Diverifikasi |
|---|---|---|
| Body > 16 KB (proxy) / > 8 KB (API) | 413, tidak diparse | **VERIFIED** (e2e + tes API) |
| Timeout (3/10/10 s) | proxy_cut → 503 | e2e (proksi uji) |
| Backend mati | 503 + `Retry-After` + halaman sendiri | e2e (proksi uji) |
| Backend lambat | timeout → 503 | **NOT VERIFIED** di nginx |
| Rate limit | 429 | **VERIFIED** (e2e) |

### 3.6 Backup, pemulihan, pemantauan

| Aspek | Rencana | Status |
|---|---|---|
| Backup | salin `waiting-list.json` (+ `*.corrupt-*`) ke penyimpanan privat **terenkripsi** | prosedur ada, keputusan retensi `DECISION REQUIRED` |
| Pemulihan | lihat `deploy/OPERATOR-SOP.md` §7 (berkas rusak diprahkan) | **VERIFIED** (probe skenario 10) |
| Pemantauan | hitung 429/5xx pada `/api/waiting-list`; alarm bila > X/menit | **NOT IMPLEMENTED** |
| Health check | `GET /api/health` (API) — **jangan** diekspos publik | endpoint ada, belum dipakai proxy |

### 3.7 Risiko: waiting list di mesin yang sama dengan runtime desktop Dudu

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **API Dudu tanpa autentikasi** | siapa pun yang bisa mencapai 8787 bisa memanggil seluruh `/api/*` | **Jangan** paparkan 8787; proxy hanya meneruskan 1 endpoint |
| **Folder data bersama** | pengguna desktop di mesin itu bisa membaca `waiting-list.json` | **Host terpisah** untuk waiting list (rekomendasi), atau akun OS khusus |
| **Resource bersama** | desktop & waiting list saling memperebutkan CPU/RAM | host terpisah; atau minimal OS-isolation |
| **Sertifikat & domain bersama** | kompromi salah satu servernya menjerat yang lain | pisahkan reverse proxy & sertifikat per host |
| **DNS/sertifikat bocor** | daftar email bocor | backup terenkripsi; akses log terbatas |

> **Rekomendasi tegas:** jalankan waiting list pada **host/VM terpisah** dari mesin yang dipakai
> mengunduh/menjalankan desktop app. Alasannya bukan sekadar kerapian — API Dudu tidak punya autentikasi.

---

## 4. Privasi & keputusan operator (ringkasan)

Detail lengkap: `deploy/OPERATOR-SOP.md`. Tabel keputusan:

| Item | Status | Catatan |
|---|---|---|
| Tujuan pengumpulan | **Ditetapkan** | hubsungi saat rilis terverifikasi / beta mobile; bukan untuk buletin/penjualan |
| Data yang dikumpulkan | **Ditetapkan** | email (wajib), platform (wajib), role (opsional), note (opsional) |
| Prinsip minimisasi | **Ditetapkan** | tidak ada nama/HP/alamat/pembayaran |
| **Kebijakan retensi email** | `DECISION REQUIRED` | usulan: hapus entri > 12 bulan |
| **Apakah `note` perlu** | `DECISION REQUIRED` | usulan: boleh dikumpulkan, tetapi dihapus setelah 30 hari |
| **PIC operasional** | `DECISION REQUIRED` | nama/role belum ditetapkan |
| **PIC insiden** | `DECISION REQUIRED` | |
| **Alamat kontak resmi** | `DECISION REQUIRED` | tidak ada alamat publik saat ini; landing page menyatakan ini jujur |
| **Tenggat respons penghapusan** | `DECISION REQUIRED` | usulan: 30 hari kalender |
| **Backup & retensi backup** | `DECISION REQUIRED` | usulan: 1 salinan terenkripsi, retensi 3 bulan |
| **Prosedur insiden data** | **Ditetapkan** (prosedur) | `deploy/OPERATOR-SOP.md` §8 |
| Logging tanpa email | **Ditetapkan & diverifikasi** | API & proxy tidak mencatat email (tes e2e) |
| Otorisasi hapus entri | **Ditetapkan** (alat) | `store.remove(email)`; tanpa endpoint publik |
| Halaman operator | **NOT IMPLEMENTED** (disengaja) | akses lewat berkas |

---

## 5. Rencana rilis berikutnya (tanpa menerbitkannya)

### 5.1 Pendekatan distribusi: **bersama**

| Opsi | Penilaian |
|---|---|
| Landing page & endpoint waiting list dalam **satu** rilis | **Dipilih** — landing page memanggil `/api/waiting-list`; bilaSatuEuroIndependent dan backend belum ada, formulir gagal. Satu rilis = satu version Consistent |
| Landing page smith independent dari backend | Formulir akan gagal di host yang tidak punya backend → UX buruk & klaim tidak jujur |

**Konsekuensi:** landing page **tidak boleh** tayang sebelum versi backend yang memuat
`POST /api/waiting-list` sudah ada di host yang melayani domain tersebut.

### 5.2 Pencegahan landing page menunjuk endpoint yang belum tersedia

| Mekanisme | Status |
|---|---|
| Landing page **menyatakan** status (Web App self-hosted, mobile planned) | ada |
| Formulir menampilkan **pesan jujur** bila endpoint tak terjangkau | ada (diuji: e2e "backend mati") |
| Versi backend dicatat di halaman (mis. "v0.6.4") | **belum** →nusantara tambahin "minimum version" |
| Halaman menampilkan versi API yang berjalan | **NOT IMPLEMENTED** (opsional; `GET /api/health` ada tapi jangan diekspos) |

### 5.3 Verifikasi paket, checksum, isi artefak

| Pemeriksaan | Perintah | Status |
|---|---|---|
| Isi paket (ASAR: berkas wajib, tanpa bocoran, hanya dependensi produksi, fitur rilis ada, tanpa kunci API) | `npm run verify:release` | ada (dijalankan tiap rilis) |
| Checksum | `release/SHA256SUMS-<versi>.txt` + per-platform | ada (dihasilkan `scripts/package-release.mjs`) |
| Pemeriksaan impor ESM native | `npm run check:imports` | ada |
| Audit dependensi produksi | `npm run audit:prod` | ada |
| Konfigurasi proxy | `npm run proxy:check` | ada |
| Validasi landing | `npm run landing:check` | ada |

### 5.4 Pengujian upgrade & regresi

- `npm run verify` (typecheck + imports + 353 tes + build) — wajib hijau.
- `node scripts/upgrade-check.cjs <setup-lama> <setup-baru>` — upgrade dari rilis sebelumnya, data utuh.
- `node scripts/smoke-desktop.mjs` — 51 pemeriksaan pada biner terpaket.
- `npm run probe:waiting-list` + `tests/landing-proxy-e2e.test.mjs` — waiting list.
- **v0.6.4 tetap artefak historis**: tidak dibangun ulang, hash tidak berubah (terverifikasi 7/7).

### 5.5 Prosedur rollback

| Situasi | Aksi |
|---|---|
| Landing page bermasalah | kembalikan berkas statis ke versi sebelumnya (host statis) — tanpa menyentuh backend |
| Endpoint waiting list bermasalah | nonaktifkan blok `location = /api/waiting-list` di proxy (halaman statis tetap hidup) + kurangi `maxPerMinute` |
| API bermasalah | `systemctl stop` API → proxy menjawab 503 dengan pesan sendiri |
| Rilis baru bermasalah | pasang versi rilis sebelumnya (installer/portable), kembalikan folder data, kembalikan konfigurasi proxy |
| DNS bermasalah | turunkan TTL sebelum perubahan; kembalikan record A/CNAME |

> Rollback **tidak boleh** menghapus `waiting-list.json` (data pendaftar).

### 5.6 Syarat sebelum membuat tag/release

1. Semua release gates (§6) berstatus PASS, atau ada yang disetujui eksplisit.
2. `npm run verify` hijau; `verify:release` hijau untuk artefak kandidat.
3. `landing:check:strict` & `proxy:check:strict` hijau (domain & placeholder sudah diganti).
4. Prosedur rollback diuji minimal sekali (di staging).
5. Keputusan domain, retensi, PIC, kontak sudah tercatat (§2, §4).
6. Nomor versi baru diputuskan pemilik produk — **belum ada nomor yang dicadangkan di fase ini**
   (`0.6.4` tetap artefak historis; tidak ada versi berikutnya yang dipublikasikan).

---

## 6. Release gates

Status: `PASS` (terbukti di lingkungan ini) · `FAIL` (terbukti gagal) · `NOT VERIFIED` (butuh
pengujian nyata yang belum dijalankan) · `DECISION REQUIRED` (butuh keputusan pemilik produk).

| # | Gate | Status | Bukti / cara memverifikasi |
|---|---|---|---|
| 1 | Domain resmi dipilih & DNS terverifikasi | **DECISION REQUIRED** | §2; belum ada domain, tidak ada pemeriksaan ketersediaan |
| 2 | HTTPS/TLS diuji di lingkungan nyata | **NOT VERIFIED** | tidak ada domain/sertifikat; perlu `curl -I https://<domain>/` + `openssl s_client` |
| 3 | Nginx dijalankan & konfigurasi tervalidasi | **NOT VERIFIED** | `npm run proxy:check` exit 0 (statis); nginx tidak tersedia → perlu `nginx -t` + uji staging |
| 4 | API internal tidak terekspos ke publik | **NOT VERIFIED** (desain) | desain: proxy hanya meneruskan 1 endpoint, `/api/*` lain 404, port 8787 loopback. Perlu diuji di staging: `curl /api/missions` → 404 |
| 5 | Pembatasan per-IP terbukti bekerja | **NOT VERIFIED** (nginx) | logika terverifikasi di e2e (429); perlu `limit_req` nginx diuji |
| 6 | Formulir berhasil dari peramban sampai penyimpanan | **NOT VERIFIED** (peramban+TLS) | e2e terverifikasi via proksi uji; jalur peramban nyata belum diuji |
| 7 | Backend mati → kegagalan aman | **PASS** (arsitektur) | e2e "backend mati → 503" ✓; API "storage gagal → 503" ✓ |
| 8 | Tidak ada kebocoran email di respons/log | **PASS** | tes respons seragam (tanpa email) ✓; e2e "log proxy tidak memuat email" ✓; API tidak mencatat payload ✓ |
| 9 | SOP operator & kebijakan retensi disetujui | **DECISION REQUIRED** | `deploy/OPERATOR-SOP.md` ada; 6 item menunggu keputusan |
| 10 | Validator strict domain & proxy lulus | **FAIL** (sesuai harapan) | `landing:check:strict` exit 1 & `proxy:check:strict` exit 1 — placeholder belum diganti |
| 11 | Tes regresi & verifikasi paket lulus | **PASS** | `npm run verify` exit 0 (353 tes/29 file, 2× berturut-turut) · `verify:release` exit 0 untuk artefak 0.6.4 |
| 12 | Prosedur rollback tersedia | **NOT VERIFIED** | tertulis di §5.5; belum pernah dipraktikkan |
| 13 | Waitlist API tetap aman (validasi, rate limit, anti-paralel, anti-CSRF) | **PASS** | probe 14/14 + 20 tes waiting list |
| 14 | Tidak ada dependensi baru / audit dependensi produksi bersih | **PASS** | `npm audit --omit=dev` → 0 kerentanan; deps tetap `fflate`+`unpdf` |
| 15 | Landing page tidak mengklaim yang belum ada | **PASS** | `landing:check` (klaim tanpa penyangkal, status kanal, tanpa tautan palsu) |
| 16 | Versi & artefak historis utuh | **PASS** | versi `0.6.4`; hash 0.6.4 cocok 7/7 |

**Ringkasan gate:** PASS 7 · FAIL 1 (gate strict — memang begitu sampai domain ada) · NOT VERIFIED 6 ·
DECISION REQUIRED 2.

> Gate #10 berstatus FAIL **secara sengaja**: validator tidak boleh dibuat lulus sebelum domain resmi
> ada. Itu adalah mekanisme kontrol, bukan cacat.

---

## 7. Risiko produksi yang masih terbuka (berurutan prioritas)

| # | Risiko | Dampak | Mitigasi | Pemilik |
|---|---|---|---|---|
| 1 | Domain/hosting belum ada → landing page bisa **tayang tanpa backend** (formulir gagal) | UX buruk & klaim tidak jujur | gate #1, #6, #10 | Pemilik produk |
| 2 | API Dudu **tidak punya autentikasi**; salah konfigurasi proxy membocorkan seluruh `/api` | kebocoran data pengguna aplikasi | gate #4; `location /api/ { return 404; }`; **jangan** buka 8787 | Teknik (proxy) |
| 3 | Host yang sama dengan runtime desktop → folder daftar bisa dibaca akun lain | kebocoran daftar email | §3.7: host terpisah | Pemilik produk |
| 4 | Nginx/TLS belum pernah dijalankan | kegagalan saattico | staging + prosedur `deploy/README.md` §5 | Teknik |
| 5 | Kebijakan retensi/PIC/kontak belum diputuskan | data menumpuk tanpa batas & tanpa jalur permintaan | §4 (DECISION REQUIRED) | Pemilik produk |
| 6 | Tidak ada pemantauan/alert (429, 5xx, sertifikat) | masalah tak terdeteksi | health check + alarm (belum ada) | Teknik + Pemilik |
| 7 | Landing page & backend bisa versinya berbeda (landing tayang, backend lama) | formulir gagal | gate #10 & §5.2 | Teknik |
| 8 | Backup daftar belum punya kebijakan | kehilangan data saat insiden | §4 | Pemilik produk |

---

## 8. Satu langkah berikutnya yang paling penting

**Pilih dan daftarkan domain resmi (keputusan pemilik produk), lalu ganti placeholder di tiga
berkas (`sitemap.xml`, `robots.txt`, `index.html` + canonical) dan di konfigurasi proxy — dan pastikan
`npm run landing:check:strict` serta `npm run proxy:check:strict` berubah dari gagal menjadi lulus.**

Semua kemacetan lain (TLS, nginx, rate limit nyata) bergantung pada adanya domain, sedangkan
kebijakan privasi (retensi, PIC, kontak) bisa diputuskan paralel tanpa menunggu domain.
