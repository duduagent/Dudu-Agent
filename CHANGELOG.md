# Changelog — Dudu AI

Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/). Versi memakai SemVer.
Status fitur memakai kosakata yang jujur: **Implemented** · **Tested** · **Partially implemented** · **Mock / simulation** · **Planned** · **Blocked**.

## [0.6.4] — 2026-10-22 — RILIS

> Cakupan: **Reliability, Audit Visibility, dan Security Validation**. Tidak ada perubahan kontrak yang
> merusak: endpoint audit lama masih ada (tambah filter & halaman), field baru pada event bersifat opsional,
> dan store misi tidak berubah format (tanpa migrasi).
> Rincian skema event, integritas jejak, izin, approval, dan batas yang masih terbuka: [SECURITY_NOTES.md](SECURITY_NOTES.md).

### Added
- **Jejak audit di UI** (`src/components/AuditTrail.tsx`): panel "Jejak Audit" di **Misi & Tugas → detail misi**
  (jejak misi itu) dan di **Pusat Eksekusi** (jejak global dengan **filter misi**). Menampilkan waktu, jenis
  tindakan, aktor/komponen, hasil, dan referensi langkah/eksekusi/kapabilitas/korelasi. Hasil `denied`,
  `failed`, `succeeded`, dan `unverified` memakai badge berbeda. Filter: misi, jenis event, hasil, rentang waktu.
  Pagination 25 event per muat + "Muat lebih banyak". Kondisi kosong/loading/error ditangani; event lama
  diberi label "sebelum v0.6.3".
  - Aturan tampilan: `detail` **tidak** ditampilkan mentah — hanya kunci **daftar putih** dengan nilai
    dipotong; `args`/`result`/`output` tidak pernah dirender; aktor `system`/`local` ditampilkan apa adanya
    (tidak diklaim sebagai identitas manusia); data diambil dari **API server**, bukan berkas langsung.
- **Kontrak API audit** (dokumentasi di SECURITY_NOTES §1.5): `GET /api/capability-registry/audit` kini mendukung
  `limit`/`offset` (halaman, terbaru lebih dulu) + `outcome`/`actor`/`since`/`until`; baru
  `GET /api/missions/:id/audit` (jejak per misi) dan `GET /api/audit/integrity` (verifikasi rantai + daftar berkas).
  Respons: `{ events, count, total, limit, offset, hasMore, file }`.
- **Integritas jejak** (`server/execution-audit.mjs`): **rantai hash** per event (`prevHash` + `hash`, SHA-256 atas
  bentuk kanonik event) dengan verifikasi `ok`/`brokenAt`/`reason`; **rotasi** berbasis ukuran (8 MiB, 3 arsip)
  dengan batas retensi; `hashEvent`/`canonicalJson`/`normalizeEvent` diekspor untuk pengujian.
- **Validasi artefak rilis**: `scripts/verify-release.mjs` + `npm run verify:release` — memeriksa ASAR hasil
  build secara nyata: berkas runtime wajib (termasuk modul audit & izin), tidak ada tes/src/.env/source-map/skrip
  yang bocor, hanya dependensi produksi, fitur rilis benar-benar ada, dan tidak ada kunci API literal.
  Artefak yang tidak dibangun dilaporkan "TIDAK DIBANGUN" (exit 5), tidak dikarang.
- **Audit dependensi produksi**: `npm run audit:prod` (`npm audit --omit=dev`) — dijalankan di CI.
- Tes regresi baru: `tests/audit-trail.test.mjs` (29 tes) + `tests/audit-trail-ui.test.tsx` (9 tes).

### Fixed
- **Approval dicatat setelah permission diberikan** → bila audit wajib gagal, permission sempat diberikan tanpa
  jejak. Kini event approval ditulis **lebih dulu**: audit gagal ⇒ **permission tidak diberikan** (fail-closed).
- **Field `error` ditulis mentah** ke jejak audit (bisa memuat kunci/token dari pesan provider) → kini diredaksi
  saat menulis; dan **seluruh event disanitasi lagi saat dibaca** (termasuk event legacy).
- **Dua instance audit menulis ke berkas yang sama** (misi + registry) → rantai hash jadi tidak konsisten;
  kini `createApi()` memakai **satu** instance bersama.
- **Idempotency key ditandai sebelum penulisan** → event bisa hilang diam-diam bila penulisan gagal; kini
  ditandai **setelah** penulisan berhasil.
- **`GET /api/missions/:id/audit` memfilter `correlationId` secara default** → event tanpa korelasi (mis. event
  capability lama) hilang dari jejak misi; filter tersebut kini hanya berlaku bila diminta.

### Verified
- `npm run verify` = **PASS** (typecheck 0 error · `check:imports` OK 13 modul ESM native · **307 tes / 26 file** · build produksi).
- `npm run verify:ui` = LOLOS (responsif 16×6 **0 temuan** · kontras ter-render **0 temuan**).
- `npm run smoke:provider` = 8 passed · 0 failed · 3 unverified (butuh kredensial asli).
- `npm audit --omit=dev` = **0 kerentanan** (exit 0). `npm audit` penuh = 14 kerentanan **dev toolchain** saja
  (tidak ikut ke paket; perbaikannya breaking → tidak diperbaiki otomatis, didokumentasikan).
- `npm run verify:release` terhadap artefak 0.6.3 = **menangkap 6 kegagalan** (fitur v0.6.4 belum ada di artefak
  lama) → skrip validasi terbukti punya gigi, bukan sekadar lulus.

---

## [0.6.3] — 2026-10-22 — RILIS

> Cakupan: **Unified Execution Audit** + **Granular Permission Model** + **Approval terikat tindakan**. Tidak ada perubahan kontrak API yang merusak konsumen lama: endpoint & route baru bersifat aditif, dan **store misi tidak berubah format** (field baru opsional → tidak ada migrasi).
> Rincian skema event, izin yang benar-benar ditegakkan, dan batas yang masih terbuka: [SECURITY_NOTES.md](SECURITY_NOTES.md).

### Fixed
- **Aplikasi terpaket gagal start** setelah penambahan audit: `redact` terdeklarasi ganda di `capability-registry.mjs` (fungsi lokal + re-export) → modul gagal dimuat oleh ESM native Node/Electron, sementara vitest/esbuild **mentoleransinya** sehingga tes tetap hijau. Fungsi lokal dihapus (satu implementasi di `server/execution-audit.mjs`).
- **Celah hijau palsu ditutup**: `npm run check:imports` (baru, ikut `npm run verify`) memuat 13 modul server dengan **ESM native Node** — menangkap kesalahan linking yang tidak terlihat oleh vitest.

### Added
- **Unified Execution Audit** (`server/execution-audit.mjs`): satu jejak append-only (`capability-audit.jsonl`, mode 0600) untuk aktivitas **misi** dan eksekusi **kapabilitas**, dengan skema seragam: `eventId`, `at`/`ts`, `eventType`, `missionId`, `taskId`, `execId`, `capabilityId`, `actor`, `outcome`, `correlationId`, `idempotencyKey`, `detail` (disamarkan). 19 jenis event (`mission.created` … `permission.denied`). Field yang tidak diketahui bernilai `null`, tidak dikarang.
- **Granular Permission Model** (`server/permissions.mjs`): 8 izin berbasis operasi nyata (`file:read`, `file:write`, `process:exec`, `network:out`, `credential:use`, `side-effect:external`, `plugin:exec`, `mcp:exec`) + `enforce()` yang dipakai **di batas eksekusi** (bukan hanya di UI). Izin jaringan/efek samping/credential hanya diberikan bila konfigurasi nyata ada **dan** konfirmasi eksplisit diberikan. Penolakan → `403 permission_denied` + event `permission.denied`, tindakan tidak dijalankan.
- **Approval terikat tindakan**: `POST /api/missions/:id/approvals` (minta), `POST …/approvals/:id` (setuju/tolak), `GET …/approvals`. Approval memuat `capabilityId`, `operation`, `target`, `paramsDigest`, `status`, `expiresAt`, dan **dipakai sekali** (`consumed`). Persetujuan umum atas misi **bukan** izin tanpa batas. Approval rencana misi juga terikat digest rencana → perubahan material menuntut persetujuan baru.
- **Fail-closed audit**: `mission.approved`, `mission.started`, dan `tool.execution_started` ditulis sebagai kontrol keamanan — bila audit tak bisa ditulis, **tindakan berisiko tidak dijalankan** (API menjawab `500 audit_unavailable`).
- **Filter jejak audit** per misi / event type / correlation id: `GET /api/capability-registry/audit?missionId=…&eventType=…`.
- **UI approval** di runner kapabilitas (Misi & Tugas): tombol "Jalankan" meminta persetujuan khusus bila belum ada, lalu "Setujui tindakan"/"Tolak" untuk memutuskan.
- `tests/execution-audit.test.mjs` — **17 tes regresi** untuk 14 skenario yang diminta (event misi, alasan aman, attempt retry, redaksi kredensial, penolakan izin di backend, approval tidak valid/kedaluwarsa/scope berubah, fail-closed audit, konsistensi store, cancellation bukan keberhasilan, verification failure ≠ completed, anti-duplikasi, kompatibilitas data lama).

### Changed
- `server/missions.mjs` kini memancarkan event untuk seluruh siklus hidup (created → approval_requested → approved → started → task/tool → artifact → verification → completed/failed/needs_attention/cancelled) dan memvalidasi scope approval sebelum eksekusi.
- `server/capability-registry.mjs` memakai audit terpadu + gerbang izin; **bentuk event lama** (`action`, `outcome`, `capabilityId`, `at`, `args`) tetap ditulis agar konsumen lama tidak rusak.
- Versi paket → **0.6.3**.

### Verified
- `npm run verify` = **PASS** (typecheck 0 error · **269 tes / 24 file** · build produksi).
- `npm run verify:ui` = LOLOS (responsif 16×6 + kontras ter-render, 0 temuan).
- `npm run smoke:provider` = 8 passed · 0 failed · 3 unverified (butuh kredensial asli).
- Smoke biner desktop 0.6.3: **51/51 lulus**.
- Kompatibilitas data lama: misi tanpa `scope`/`approvals`/`correlationId` tetap disetujui & dijalankan; event audit legasi tetap terbaca.

---

## [0.6.2] — 2026-10-22 — RILIS

> Cakupan: **release readiness & execution reliability**. Tidak ada perubahan kontrak API, tidak ada fitur baru yang mengubah perilaku pengguna, dan tidak ada perubahan skema penyimpanan.
>
> **Artefak:** `release/SHA256SUMS-0.6.2.txt` · Windows (Setup + Portable + ZIP) · Linux (tarball portabel + ZIP) · sumber (ZIP).
> **Status platform:** Windows dibangun & diuji (install senyap, upgrade 0.5.0→0.6.1 teruji, smoke 51/51). Linux: hanya direktori aplikasi + tarball portabel **dengan bit izin 0755 yang benar** (dulu pengguna wajib `chmod +x`); `.deb`/AppImage & seluruh runtime Linux masih harus dibangun/dijalankan di Linux. macOS: konfigurasi + job CI `macos-14` siap, **artefak belum ada** (harus dibangun di macOS).

### Added
- **Repositori Git diinisialisasi** (branch `main`, commit awal berisi seluruh aplikasi + dokumentasi + CI; 128 file). `.gitignore` diperketat: `release/`, `node_modules/`, `dist/`, `*.pem/key/pfx/p12/crt/cer`, `.env*` (kecuali `.env.example`), `dudu.env`, `ui-audit*/`, `ui-contrast/`. `.gitattributes`Menormalkan akhir baris (LF di repo, CRLF saat checkout di Windows) karena repo juga dibangun di Linux/macOS. **Tidak ada tag, tidak ada remote, tidak ada push** (remote URL perlu ditetapkan pemilik).
- **`scripts/verify-ui.mjs`** (`npm run verify:ui`) — menyalakan API + dev server sendiri, menjalankan audit responsif **dan** audit kontras ter-render, lalu mematikannya. Mengubah audit visual dari "manual" menjadi bagian workflow otomatis.
- **`scripts/provider-smoke.mjs`** (`npm run smoke:provider`) — prosedur uji provider: tanpa kredensial, jalur kesalahan (401/429/non-JSON) terhadap **mock lokal**, jaringan gagal/timeout, dan uji live (chat/vision/STT) **hanya** bila kredensial asli tersedia. Kredensial tidak pernah dicetak; skenario live tanpa kredensial dilaporkan **UNVERIFIED**, bukan "lolos".
- **`scripts/tar-portable.mjs`** — penulis arsip tar ustar dengan **mode POSIX benar** (0755 untuk `dudu-ai`, `chrome-sandbox`, `chrome_crashpad_handler`; 0644 untuk lainnya), menutup celah "wajib chmod +x" pada paket portabel Linux.
- **`scripts/contrast-audit.cjs`** — audit kontras komponen **ter-render** (fg/bg efektif, ambang 4.5:1 teks & 3:1 non-teks, kontrol nonaktif dikecualikan).
- **`scripts/upgrade-check.cjs`** — uji kompatibilitas upgrade (pasang versi lama → data pengguna → pasang versi baru di atasnya → pastikan data, startup, smoke, dan uninstall tetap benar).
- **Tes regresi UI** (`tests/ui-regression.test.tsx`, 10 tes): kontrak token kontras di `styles.css` (tombol utama ≥4.5:1, emas terang dilarang menjadi warna teks, batas kontrol ≥3:1, batas `!important`), perilaku CLI "Salin" (umpan balik hanya setelah berhasil, tidak ada umpan balik bila clipboard ditolak), status connector yang jujur (scaffold tanpa tombol uji koneksi), keadaan kosong misi tanpa persentase karangan, badge Pusat Eksekusi dari registry nyata, dan tidak ada aksi navigasi yang terduplikasi.
- **Tes polling adaptif** (`tests/execution-polling.test.tsx`, 5 tes): tidak ada request bertumpuk, berhenti saat misi terminal, backoff + indikator koneksi saat gagal, berhenti saat tab tersembunyi & lanjut saat aktif, serta timer/request dibatalkan saat komponen dilepas.

### Changed
- **Polling Pusat Eksekusi jadi adaptif** (`ExecutionCenterPage.tsx`): satu siklus hidup per tampilan, penjaga anti-tumpang-tindih, `AbortController` untuk membatalkan request usang, jeda 1–15 detik (melambat saat jaringan sering gagal), **berhenti saat tab tersembunyi** dan lanjut segera saat aktif kembali, berhenti total saat misi selesai, dan refresh segera setelah aksi pengguna.
- **Indikator koneksi/stale kini selalu terlihat** — sebelumnya notifikasi galat hanya tampil bila ada data sukses, sehingga koneksi mati tampak seperti "kosong".
- Tombol "Buka Tools & Integrations" di Pusat Eksekusi menjadi **satu per grup** (sebelumnya diulang di setiap kartu).

### Fixed
- Jebakan build `EPERM` pada `release/` didokumentasikan: dev server Vite yang berjalan mengunci folder tersebut; build wajib dijalankan tanpa dev server aktif.

### Verified
- `npm run verify` = **PASS** (typecheck 0 error · **251 tes / 23 file** · build produksi).
- `npm run verify:ui` = **LOLOS** (audit responsif 16 rute × 6 lebar: 0 temuan · audit kontras ter-render: 0 temuan).
- `npm run smoke:provider` = **7 lolos · 3 belum terverifikasi (butuh kredensial asli) · 0 gagal**.
- Smoke biner desktop 0.6.2: **51/51 lulus** · kompatibilitas upgrade 0.5.0 → 0.6.1: **LOLUS**.
- Backup penuh workspace sebelum inisialisasi Git: `C:\Users\LENOVO\Documents\dudu-backup-2026-10-21` (3,7 GB).

---

## [0.6.1] — 2026-10-21 — RILIS

> Cakupan 0.6.1: **visual QA & accessibility hardening** atas UI 0.6.0 + **Pusat Eksekusi** (timeline hidup & pusat "butuh perhatian"). Rilis 0.6.0 sendiri tidak berubah; paket di `release/` dibangun ulang karena UI dan kode server ikut berubah.
>
> **Artefak rilis (hash di `release/SHA256SUMS-0.6.1.txt`):**
> `Dudu-AI-Setup-0.6.1-x64.exe` · `Dudu-AI-Portable-0.6.1-x64.exe` · `Dudu-AI-0.6.1-Windows-x64.zip` · `Dudu-AI-0.6.1-Windows-x64-Setup.zip` · `Dudu-AI-0.6.1-linux-x64-portable.tar.gz` · `Dudu-AI-0.6.1-Linux-x64.zip` · `Dudu-AI-0.6.1-source.zip`.
> **Status platform:** Windows dibangun & diuji (install senyap, upgrade dari 0.5.0, smoke 51/51). Linux: hanya direktori aplikasi + tarball portabel (belum dijalankan di Linux; `.deb`/AppImage harus dibangun di Linux). macOS: konfigurasi + job CI siap, **artefak belum ada** (harus dibangun di macOS).

### Added
- **Pusat Eksekusi** (rute baru `execution`, menu "Pusat Eksekusi"):
  - **Timeline eksekusi hidup** — langkah, status, stempel waktu mulai/selesai, durasi, jumlah percobaan, `execId`, kelas error, dan status kriteria penerimaan; pembatalan saat berjalan; tombol segarkan manual + polling tiap 1,2 detik selama misi belum selesai.
  - **Pusat "butuh perhatian"** — misi menunggu persetujuan, misi gagal yang bisa diulang, misi yang perlu ditinjau manusia, dan integrasi yang belum terkonfigurasi (dari registry), masing-masing dengan aksi nyata dan tautan ke layar terkait.
  - Sumber kebenaran tetap **state server** (`GET /api/missions/:id`): tidak ada persentase karangan, tidak ada identitas agen rekaan, tidak ada event duplikat.
- **`scripts/contrast-audit.cjs`** — audit kontras pada komponen **ter-render** (bukan hanya token): menghitung fg/bg efektif tiap elemen ber-teks + batas kontrol form, ambang 4.5:1 (teks normal) / 3:1 (teks besar & non-teks), dengan pengecualian kontrol nonaktif.
- **`scripts/upgrade-check.cjs`** — uji kompatibilitas upgrade: pasang versi lama → buat data pengguna → pasang versi baru di atasnya → pastikan data, startup, dan smoke test tetap utuh; uninstall tidak menghapus data.
- **`api.getMission()`** (klien) untuk polling satu misi.

### Fixed
- **Kontras tombol emas** — teks putih di atas isian emas `#9C7016` hanya 4.43:1 (gagal AA untuk label 13px). Isian tombol kini `--gold-btn #8A6212` → **5.47:1** (AA). Emas terang tetap hanya untuk border/aksen.
- **Batas kontrol form** — `1.36:1` → **3.16:1** (`--line-ctl #9A9079`) agar kontrol form memenuhi WCAG 1.4.11 (non-teks 3:1).
- **Teks emas pada latar terang** (avatar, badge sumber, tautan, label langkah, prompt CLI) — `--gold-deep` → `--gold-ink`, karena rasio 4.1–4.43:1 gagal ambang 4.5:1. Ditemukan oleh audit kontras ter-render, **bukan** oleh pemeriksaan token.
- **Cincin fokus** — border fokus input kini `--gold-deep` (4.43:1, ≥3:1 untuk indikator non-teks).
- **Duplikasi teks** — Misi: "satu template" & alur appear dua kali; keadaan kosong misi melayang di luar panel. Akun & OAuth: redirect URI & instruksi provider terduplikasi di blok Google dan GitHub.
- **Kartu skill** — baris "Di mana:" kini rata bawah (`margin-top:auto`) agar sejajar antar kartu.

### Verified
- `npm run typecheck` 0 error · `npm test` **236 tes / 21 file** (3 tes baru untuk Pusat Eksekusi) · `npm run build` sukses · `npm run verify` exit 0.
- Audit kontras ter-render: **0 temuan** di 16 halaman (sebelum perbaikan: 7 kombinasi gagal).
- Audit responsif: **0 temuan overflow** di **96 kombinasi** (16 rute × 6 lebar).
- Smoke biner desktop 0.6.1: **51/51 lulus**; kompatibilitas upgrade 0.5.0 → 0.6.1 **LOLUS** (data pengguna utuh, startup OK, smoke 51/51 pada biner ter-upgrade, uninstall aman).

---

## [0.6.0] — 2026-10-21 — RILIS

> **Cakupan rilis ini:** TAHAP 0 (baseline audit), TAHAP 1 (core reliability: pembatalan misi), TAHAP 2 (registry + UI kapabilitas dari konteks misi), TAHAP 3 (panel bukti kapabilitas), dan TAHAP 4 **sebagian** (jembatan Chat → Misi). **TAHAP 5 (memory persisten & skills), TAHAP 6 (connector/otomatisasi lanjutan), dan TAHAP 7 (scheduler, multi-agent) BELUM diimplementasikan** — rinciannya di [ROADMAP_V0.6.0.md](ROADMAP_V0.6.0.md). Rilis ini tidak mengklaim seluruh ruang lingkup v0.6.0 selesai.

### Changed
- **UI/UX overhaul menyeluruh (v0.6.0)**: satu design system baru (token warna/-tipografi/spasi/radius/elevasi/kontrol, komponen `.panel`/`.card`/`.field`/`.notice`/`.pill`/`.card-grid`/`.kv`/`.toolbar`/`.stat`), seluruh 15 halaman dirapikan (Input Data, Knowledge Base, MCP, CLI, Plugin, Connector, Skill, Settings/Gateway, Akun & OAuth, Files, Memory, Tools, Workforce, Misi, Chat), aturan CSS duplikat/bertentangan dibersihkan (`--paper` tak terdefinisi, `.card` & `.badge` ganda), dan kontras warna diukur (lihat [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md)). (Implemented + Tested)
- **Mission Execution Engine — pembatalan kooperatif.** Status baru `cancelled`; `POST /api/missions/:id/cancel` menghentikan eksekusi **di antara langkah** (langkah yang sedang berjalan diselesaikan dulu, tidak dimatikan paksa). Misi selesai/draft/ditolak → `409 not_cancellable`. Misi yang dibatalkan tetap tanpa `failure` dan artefak yang sudah ditulis tidak dihapus. (Implemented + Tested)
- **Mission Execution Engine — pemulihan saat restart.** Misi `queued/running` yang tertinggal (aplikasi ditutup) dipulihkan sebagai `needs_attention` dengan `retryable: true` — perilaku ini dipertahankan dan masih berlaku. (Implemented + Tested)

### Added
- **Chat → Misi (jembatan satu arah).** Di composer, ketika ada tepat satu lampiran tabular berstatus *ready* dan teks composer ≥ 5 karakter, tombol **"Jadikan Misi Analisis Data"** membuat misi lewat `POST /api/missions` yang sama — **bukan** mesin eksekusi kedua. Misi lahir sebagai **Draft** dan menunggu persetujuan; tidak ada klaim bahwa model menganalisis data. Banner hasil jujur + tombol "Buka Misi & Tugas" (navigasi ke halaman Misi & Tugas). (Implemented + Tested)
- **Jalankan kapabilitas dari konteks misi (UI).** Halaman Misi & Tugas kini menampilkan daftar kapabilitas yang benar-benar *runnable* (dari Unified Capability Registry) dengan input argumen yang diwajibkan oleh skema, dan **kotak persetujuan eksplisit** untuk kapabilitas ber-efek samping (`sideEffects ≠ none` → `confirm: true`). Hasil sukses dilampirkan sebagai bukti ke misi; status misi dan kriteria penerimaan **tidak** disentuh. (Implemented + Tested)
- **Panel "Bukti kapabilitas" di detail misi.** Menampilkan bukti yang dilampirkan ke misi (nama, `capabilityId`, ukuran, SHA-256, waktu, status ok/gagal) dengan tautan unduh dari `GET /api/missions/:id/evidence/:name`. (Implemented + Tested)
- **Dokumentasi v0.6.0**: `ROADMAP_V0.6.0.md` (tahap + status), `CHANGELOG.md` (file ini), `UI_DESIGN_SYSTEM.md` (token, komponen, breakpoint, cara audit), pembaruan `TEST_REPORT.md`, `PACKAGING.md` (versi 0.6.0), `README.md` (unduhan).
- **Perkakas rilis**: `scripts/package-release.mjs` (ZIP + SHA256SUMS per platform, menolak mengarang artefak), `scripts/verify-asar.mjs` (memeriksa isi `app.asar`: versi, fitur 0.6.0, dan tidak adanya kunci API literal), `npm run dist:mac`, job CI `macos-14`, konfigurasi build macOS (dmg + zip, x64 & arm64, tanpa penandatanganan).
- **Perkakas audit UI**: `scripts/ui-audit.cjs` (15 halaman × 6 lebar viewport = 90 kombinasi; mengukur overflow halaman & elemen meluber + menyimpan screenshot) dan `scripts/contrast-check.mjs` (rasio kontras WCAG untuk kandidat warna token).

### Tests
- `tests/missions.test.mjs`: 13 → **15** tes (2 tes baru: pembatalan kooperatif dengan file store "lambat" untuk titik pembatalan deterministik; penolakan pembatalan di luar `running/queued`).
- `tests/api.test.mjs`: +1 assert (rute cancel: 409 untuk misi selesai, 400 untuk ID tidak valid).
- `tests/pages.test.tsx`: 16 → **20** tes (2 tes jembatan Chat → Misi, 1 tes panel bukti kapabilitas, 1 tes menjalankan kapabilitas dari UI — seluruhnya di jsdom **terhadap server API nyata**).
- `tests/packaging.test.mjs` (baru): **4** tes — aturan pencocokan artefak rilis terikat versi (regresi nyata: paket 0.6.0 sempat memuat installer 0.3.0).
- Total: 223 → **233** tes / 20 file; `npm run verify` (typecheck + test + build) = **PASS**; tes sempat flaky karena timeout 1 dtk saat suite paralel — timeout dinaikkan ke 8 dtk, bukan assertion yang diturunkan.

### Release artifacts (v0.6.0)
| Platform | Installer | Portable | Dibangun di sini? | Diuji? |
|---|---|---|---|---|
| Windows x64 | `Dudu-AI-Setup-0.6.0-x64.exe` | `Dudu-AI-Portable-0.6.0-x64.exe` | **Ya** (native) | **Ya** — smoke **51/51** pada `win-unpacked`, pada hasil instalasi senyap, dan pada `.exe` portable; uninstall exit 0 |
| Linux x64 | `dudu-ai_0.6.0_amd64.deb` *(belum ada)* | `Dudu-AI-0.6.0-x86_64.AppImage` *(belum ada)*; tersedia `Dudu-AI-0.6.0-linux-x64-portable.tar.gz` | **Sebagian** — direktori aplikasi Linux ter-build di Windows; `.deb` butuh `fpm` (Ruby) dan AppImage butuh symlink (EPERM di Windows tanpa privilege) | Struktur asar terverifikasi berisi kode 0.6.0 & tanpa kunci API; **belum dijalankan di Linux** |
| macOS (x64 + arm64) | `Dudu-AI-0.6.0-{x64,arm64}.dmg` *(belum ada)* | `Dudu-AI-Portable-0.6.0-{x64,arm64}.zip` *(belum ada)* | **Tidak** — electron-builder: "Build for macOS is supported only on macOS" | Konfigurasi build + job CI `macos-14` siap; **belum ada artefak** |
| Sumber (semua OS) | — | `Dudu-AI-0.6.0-source.zip` | Ya | Isi diperiksa (tanpa `node_modules`) |

Hash lengkap: `release/SHA256SUMS-0.6.0.txt`. Detail aturan main: [PACKAGING.md](PACKAGING.md).

### Verified
- `npm run verify` = PASS (**233 tes / 20 file**, typecheck 0 error, build produksi sukses).
- Build Windows native: `npm run dist:win` exit 0 → installer + portable (belum ditandatangani).
- Smoke test biner sungguhan (CDP): **51/51** pada tiga biner (unpacked, hasil instalasi senyap, portable); uninstall exit 0 dan berkas aplikasi terhapus.
- `app.asar` diverifikasi berisi kode 0.6.0 (pembatalan misi, jembatan Chat→Misi, panel bukti, runner kapabilitas) dan **tanpa** kunci API literal (`node scripts/verify-asar.mjs`).
- Rilis v0.5.0 **tidak diubah** — hash pada `release/SHA256SUMS-0.5.0.txt` tetap cocok.

### Not changed (sengaja)
- Kontrak `/api/chat` lama, gateway multi-provider, routing free-first, penyimpanan pengguna, dan seluruh modul sidebar lain **tidak** diubah. Tidak ada dependensi baru. Tidak ada klaim fitur baru yang belum punya implementasi.

---

## [0.5.0] — 2026-10-21

Rilis Windows (installer + portable + dokumentasi) dengan SHA-256 di `release/SHA256SUMS-0.5.0.txt`.

### Added
- **Unified Capability Registry** (`/api/capability-registry`): agregasi Tool/Skill/Connector/Plugin/MCP + referensi eksternal WorkBuddy/Hermes/OpenClaw, status turunan dari keadaan nyata, adapter validasi & run, audit `capability-audit.jsonl`, state persisten `capability-state.json`.
- **Integrasi registry ke UI** di halaman Tools, Skill, Connector, Plugin, MCP (`CapabilityCatalog.tsx`).
- **Bukti kapabilitas pada misi**: `attachEvidence` / `evidencePath` → `artifacts/<missionId>/evidence/`.
- Lima dokumen kapabilitas: `CAPABILITY_INVENTORY.md`, `CAPABILITY_COMPATIBILITY_MATRIX.md`, `CAPABILITY_ARCHITECTURE.md`, `CAPABILITY_SECURITY.md`, `CAPABILITY_ROADMAP.md`.
- Isolasi profil uji/portable lewat env `DUDU_USER_DATA`.

### Verified
- `npm run verify` = PASS (223 tes / 19 file), build produksi berhasil.
- Smoke test biner Windows (`release\win-unpacked\Dudu AI.exe`): **51/51 lulus**.
- Blokir: provider AI/OAuth/model nyata belum diuji (tanpa kunci API nyata) — dilaporkan sebagai `IMPLEMENTED_NOT_LIVE_TESTED`; WorkBuddy proprietary (referensi baca-saja); Hermes/OpenClaw hanya snapshot dokumentasi.
