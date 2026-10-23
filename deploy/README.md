# Deployment Dudu AI — landing page + endpoint daftar tunggu

Status dokumen: **konfigurasi ada, belum dijalankan di lingkungan mana pun.**
Nginx/Docker/WSL **tidak tersedia** di mesin pengembangan ini, jadi konfigurasi reverse proxy
**belum pernah diuji dengan proxy sungguhan**. Yang **sudah** terverifikasi di lingkungan ini:
arsitektur same-origin end-to-end (landing → proxy → API → berkas) memakai proksi uji yang
menerjemahkan kebijakan yang sama, ditambah validator statis konfigurasi.

| Komponen | Berkas | Status pengujian |
|---|---|---|
| Landing page (statis) | `landing/` | **VERIFIED** — `npm run landing:check` (tautan/aset/klaim/kontras) + audit responsif 6 lebar |
| Reverse proxy (nginx) | `deploy/nginx/dudu-landing.conf` | **NOT VERIFIED** — nginx tidak tersedia di mesin ini; hanya divalidasi secara statis (`npm run proxy:check`) |
| TLS / sertifikat | — | **NOT VERIFIED** — tidak ada domain maupun sertifikat di lingkungan ini |
| Batas laju per-IP | nginx `limit_req_zone` | **NOT VERIFIED di nginx**; logika yang sama **TERVERIFIED** di `tests/landing-proxy-e2e.test.mjs` |
| Endpoint daftar tunggu | `server/waiting-list.mjs` + `POST /api/waiting-list` | **VERIFIED** — 20 tes + probe 14 skenario + e2e lewat proksi uji |

---

## 1. Sumber konfigurasi domain tunggal (single-source)

Domain dan email placeholder **harus** berasal dari satu sumber konfigurasi:

**`deploy/domain.example.json`** — berkas ini mendokumentasikan semua token yang perlu diganti.
Berkas ini **selalu** pakai placeholder (`REPLACE-WITH-OFFICIAL-DOMAIN` / `REPLACE-WITH-OFFICIAL-EMAIL`)
karena tidak ada domain resmi yang tersedia.

| Token | Digunakan di | Keterangan |
|---|---|---|
| `REPLACE-WITH-OFFICIAL-DOMAIN` | `landing/sitemap.xml`, `landing/robots.txt`, `landing/index.html` (og:image, twitter:image), `package.json` (`homepage`), `deploy/nginx/dudu-landing.conf` (`<DOMAIN>`) | host utama |
| `REPLACE-WITH-OFFICIAL-EMAIL` | `electron-builder.yml` (`linux.maintainer`) | kontak pemelihara paket .deb |
| `<DOMAIN>`, `<PATH_SERT>`, `<PATH_KEY>`, `<PATH_LANDING>` | `deploy/nginx/dudu-landing.conf` | konfigurasi nginx & TLS (ganti bersamaan) |

### Cara menukar domain (setelah domain resmi ditentukan dan dibeli)

**JANGAN** mengganti satu per satu berkas dengan tangan — semua token diganti dari
`deploy/domain.example.json` agar konsisten.

```bash
# 1. Edit berkas sumber (satu-satunya tempat mengatur domain)
vim deploy/domain.example.json      # → ganti nilai ke domain resmi, hapus .example jadi domain.json

# 2. Jalankan penggantian massal (skrip akan mengganti token di SEMUA berkas di atas)
node scripts/replace-domain.mjs     # → mengganti REPLACE-WITH-OFFICIAL-* + <DOMAIN>/<PATH_*>

# 3. Verifikasi konsistensi
npm run landing:check:strict        # exit 0 (tidak ada placeholder tersisa)
npm run proxy:check -- --strict     # exit 0 (tidak ada placeholder tersisa)

# 4. Deploy
scp -r landing/*  user@host:<PATH_LANDING>/
sudo cp deploy/nginx/dudu-landing.conf /etc/nginx/sites-available/
# isi <PATH_SERT>/<PATH_KEY> dari sertifikat CA (Let's Encrypt)
```

Catatan: berkas `deploy/domain.example.json` **tidak** berisi nilai domain asli — berkas ini
template saja. Berkas konfigurasi dengan nilai domain sebenarnya (`deploy/domain.json`) **tidak boleh
di-commit** dan **tidak pernah** dibuat di sini (tidak ada domain yang dibeli, tidak ada akun
registrar).

---

## 2. Yang WAJIB ada sebelum konfigurasi ini dipakai

| Placeholder | Ganti dengan | Contoh |
|---|---|---|
| `<DOMAIN>` | domain resmi | `dudu.example` (milik Anda) |
| `<PATH_SERT>` | sertifikat TLS | `/etc/letsencrypt/live/<domain>/fullchain.pem` |
| `<PATH_KEY>` | kunci privat TLS | `/etc/letsencrypt/live/<domain>/privkey.pem` |
| `<PATH_LANDING>` | folder landing yang diunggah | `/srv/dudu-landing` |

> `npm run proxy:check -- --strict` gagal selama ada placeholder — itu memang perilaku yang diinginkan.

## 2. Daftar perubahan domain (TAHAP 5)

Satu token dipakai di tiga tempat agar penggantian cukup sekali:

| Berkas | Yang diubah |
|---|---|
| `landing/sitemap.xml` | semua `https://REPLACE-WITH-OFFICIAL-DOMAIN/…` → domain resmi |
| `landing/robots.txt` | baris `Sitemap:` → domain resmi |
| `landing/index.html` | `og:image` + `twitter:image` → domain resmi (sudah memakai token yang sama) |
| `landing/index.html` | **tambahkan** `<link rel="canonical" href="https://<domain>/">` di `<head>` (sengaja tidak ada sekarang) |

Setelah diganti:

```bash
npm run landing:check:strict   # WAJIB exit 0
npm run proxy:check -- --strict # WAJIB exit 0
```

## 3. Arsitektur (same-origin, tanpa CORS)

```
Peramban ──HTTPS──► reverse proxy (TLS, rate limit, header keamanan)
                          ├── /                 → berkas statis landing/ (dari <PATH_LANDING>)
                          └── /api/waiting-list → http://127.0.0.1:8787  (Dudu API, loopback)
                                                 └── waiting-list.json (folder data instance)
```

- **Tanpa CORS**: formulir memakai origin yang sama, jadi tidak ada `Access-Control-Allow-Origin`.
  Browser mengirim preflight untuk header `X-Dudu-Client`; karena tidak ada header CORS, request
  lintas-origin **ditolak** — itu perilaku yang diinginkan.
- **Hanya satu endpoint API yang diekspos.** API Dudu tidak punya autentikasi (mode lokal), jadi
  `location /api/ { return 404; }` mencegah `/api/missions`, `/api/capability-registry`, dst. terungkap.
- **Port API (8787) tidak boleh dibuka ke internet**; proxy adalah satu-satunya pintu masuk.

## 4. Kebijakan yang diterapkan (dan di mana diverifikasi)

| Kebijakan | nginx | Diperiksa oleh | Terverifikasi di |
|---|---|---|---|
| TLS + HSTS + redirect HTTP→HTTPS | ✓ | `proxy:check` | **NOT VERIFIED** (butuh domain+sertifikat) |
| API hanya via loopback | `proxy_pass http://127.0.0.1:8787` | `proxy:check` | statis saja |
| Hanya `POST /api/waiting-list` | `limit_except POST { deny all; }` | `proxy:check` | e2e proksi uji (405 untuk GET) |
| Batas ukuran body | `client_max_body_size 16k` | `proxy:check` | e2e proksi uji (413) + API (413) |
| Rate limit per-IP | `limit_req_zone $binary_remote_addr` | `proxy:check` | e2e proksi uji (429) |
| Timeout + backend mati | `proxy_*_timeout`, `proxy_intercept_errors` | `proxy:check` | e2e proksi uji (503) |
| Header keamanan landing | `add_header …` | `proxy:check` | statis saja |
| `X-Dudu-Client` disetel proxy | `proxy_set_header` | `proxy:check` | e2e proksi uji |
| XFF klien tidak dipercaya | tidak ada `real_ip_header X-Forwarded-For` | `proxy:check` | statis saja |

## 5. Prosedur pengujian yang WAJIB dijalankan sebelum produksi

Tidak ada di bawah yang sudah dilakukan — jalankan di lingkungan staging:

```bash
# 0. Backup & instance uji
cp deploy/nginx/dudu-landing.conf /etc/nginx/sites-available/dudu-landing.conf
#   ganti placeholder, symlink ke sites-enabled, lalu:
nginx -t                                  # 1. sintaks konfigurasi

# 2. TLS
#    sertifikat dari CA (Let's Encrypt dsb) → isi <PATH_SERT>/<PATH_KEY>
curl -I https://<domain>/                 # 2. harus 200 + header HSTS
curl -I http://<domain>/                  # 3. harus 301 ke https

# 4. Header keamanan
curl -sI https://<domain>/ | grep -Ei 'strict-transport|content-security|x-frame|nosniff|referrer'

# 5. Formulir (POST dari origin yang sama)
curl -sS -X POST https://<domain>/api/waiting-list \
  -H 'content-type: application/json' -H 'x-dudu-client: 1' \
  -d '{"email":"uji@example.invalid","platform":"web"}'      # 5. harus {"ok":true,...}

# 6. Endpoint lain TIDAK boleh bocor
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/missions   # 6. harus 404
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/capability-registry # 7. 404

# 7. Metode lain
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/waiting-list  # 8. harus 405

# 8. Batas laju per-IP (20 permintaan cepat dari satu IP → sebagian 429)
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://<domain>/api/waiting-list \
    -H 'content-type: application/json' -H 'x-dudu-client: 1' \
    -d "{\"email\":\"rate$i@example.invalid\"}"
done; echo        # 9. harus memuat 429

# 9. Body besar
dd if=/dev/zero bs=1M count=1 2>/dev/null | curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://<domain>/api/waiting-list -H 'content-type: application/json' \
  -H 'x-dudu-client: 1' --data-binary @-                     # 10. harus 413

# 10. Backend mati → halaman 503 sendiri
systemctl stop dudu-api; curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/waiting-list ... # 11. 503
systemctl start dudu-api

# 11. Log tidak boleh memuat email
grep -R 'example.invalid' /var/log/nginx/ | wc -l            # 12. harus 0
```

## 6. Yang TIDAK boleh dilakukan

- Jangan menyalin konfigurasi ini ke produksi tanpa menjalankan prosedur di atas.
- Jangan mengaktifkan CORS "agar bisa diakses dari domain lain" — tetap same-origin.
- Jangan mempercayai `X-Forwarded-For` dari klien (bisa dipalsukan) — pakai `$remote_addr`.
- Jangan membuka port 8787 ke internet.
- Jangan mengaktifkan API Dudu penuh lewat proxy (tanpa autentikasi).
- Jangan menulis email ke log proxy maupun log aplikasi.

## 7. Keputusan peluncuran & daftar gate

Keputusan domain/hosting/privasi/rilis + **release gates** (16 gate dengan status jujur) ada di
**[deploy/LAUNCH_DECISIONS.md](LAUNCH_DECISIONS.md)**. Dokumen itu adalah tempat pemilik produk
menetapkan keputusan; dokumen ini (README) berisi konfigurasi & prosedur teknisnya.

## 8. Perintah bantu

```bash
npm run proxy:check           # validasi statis konfigurasi (wajib lulus)
npm run proxy:check -- --strict  # + gagal bila placeholder belum diganti
npm run landing:check         # tautan/aset/klaim/kontras landing
npm run landing:check:strict  # + gagal bila domain belum diganti
node scripts/probe-waiting-list.mjs   # 14 skenario integrasi waiting list (data sintetis)
npm test -- --run tests/landing-proxy-e2e.test.mjs   # e2e lewat proksi uji
```
