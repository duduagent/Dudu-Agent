# Laporan Audit, Implementasi & Verifikasi — Dudu AI

> **Status terbaru — 21 Oktober 2026, rilis v0.6.1: PASS.** `npm run verify` lulus: typecheck 0 error, **236 tes / 21 file**, build produksi. Audit responsif **0 temuan overflow** di 96 kombinasi (16 rute × 6 lebar) · audit kontras ter-render **0 temuan** di 16 rute · smoke biner desktop **51/51** · kompatibilitas upgrade 0.5.0 → 0.6.1 **LOLUS** (data pengguna utuh, uninstall aman). Rilis v0.6.1 menambah **Pusat Eksekusi** (timeline eksekusi hidup + pusat "butuh perhatian") dan hardening kontras/warna (§13). Rincian: [PACKAGING.md](PACKAGING.md), [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md), [ROADMAP_V0.6.0.md](ROADMAP_V0.6.0.md), [CHANGELOG.md](CHANGELOG.md). Hash: `release/SHA256SUMS-0.6.1.txt`.
>
> Status v0.6.0 (21 Oktober 2026): PASS — 233 tes/20 file, smoke 51/51, Windows + tarball Linux + paket sumber. Increment 0.6.0 menambah: pembatalan kooperatif misi (`cancelled`), jembatan Chat → Misi, panel bukti kapabilitas, menjalankan kapabilitas dari konteks misi, dan perkakas pengemasan rilis (§11).
>
> Status v0.5.0 (21 Oktober 2026): PASS — 223 tes/19 file, smoke test biner Windows terpaket 51/51. Bagian di bawah adalah catatan historis v0.2.0 dan dipertahankan sebagai jejak audit; angka 167 tes/15 file bukan kondisi saat ini. Rincian kapabilitas v0.5.0 ada di [CAPABILITY_INVENTORY.md](CAPABILITY_INVENTORY.md).

Status: **PASS** = diverifikasi · **PARTIAL** = sebagian berfungsi · **BLOCKED** = terhalang dependensi/layanan eksternal tertentu · **NOT RUN** = belum diuji.
Lingkungan: Ubuntu 24.04 container x86_64, Node 22.22, Electron 44.7, electron-builder 26, wine 9.0 (hanya build Windows), LibreOffice/python-docx/openpyxl/python-pptx/reportlab (hanya untuk membuat fixture).

## 1. Temuan audit awal (sebelum mengubah apa pun)
- **Premis prompt tidak cocok dengan workspace.** Laporan "Workbuddy" (14 file tes, 181 tes, API upload, ekstraksi, 17 smoke HTTP) **tidak** menggambarkan kode ini. Workspace awal: 7 file tes / 56 tes (direproduksi lulus), dan **tidak ada** kode upload, lampiran, ekstraksi, RAG, vision, maupun misi. Laporan lama diperlakukan sebagai tidak terbukti.
- Status nyata sidebar: Chat berfungsi. **"Misi & Tugas" ternyata menampilkan modul Reminder** (bukan misi). Enam menu lain placeholder jujur. Halaman non-chat **tidak punya tombol buka sidebar** (jalan buntu di layar sempit). Panel kanan berisi tiga klaim statis ("misi direncanakan", "Milestone F", "belum ada tool") yang menjadi keliru begitu fitur ada. Tombol mic sudah nonaktif dengan keterangan jujur; tidak ada tombol lampiran.
- Pada baseline tidak ada kegagalan tes yang tersisa.

## 2. Keputusan arsitektur
- Backend dipisah menjadi modul tanpa transport (`server/api.mjs` + `files`, `extract`, `knowledge`, `missions`, `data-tools`, `chat-api`), dipakai bersama oleh server HTTP dev (`127.0.0.1`) dan proses utama Electron (skema `dudu://app`, **tanpa port TCP**). Kontrak `/api/chat` lama tidak berubah; field baru (`fileIds`, `useKnowledge`, `attachments`, `sources`) bersifat opsional dan hanya muncul bila dipakai.
- Penyimpanan: `<userData>/data/{files,kb,missions,artifacts}`; ID acak (UUID); nama dari pengguna **tidak pernah** menjadi path disk; tulis atomik.
- Dependensi baru: hanya `fflate` (ZIP/Office) dan `unpdf` (PDF). Tidak ada vector DB, OCR, atau ffmpeg yang dibundel.
- Retrieval: **BM25 leksikal** (bukan embedding). Perencana misi: **berbasis aturan** (bukan LLM).
- Vision/STT aktif **hanya** bila `DUDU_VISION_MODEL` / `DUDU_STT_MODEL` diatur eksplisit; tidak ada tebakan model dan tidak ada penggantian provider diam-diam.

## 3. Status per fase
| Area | Status | Bukti / catatan |
|---|---|---|
| Sidebar: 9 menu, navigasi, status aktif | **PASS** | `pages.test.tsx` (jsdom↔server nyata) + smoke pada app terpaket |
| Sidebar: collapsible desktop, overlay mobile, keyboard | **PASS** | `layout.test.tsx` (+3 regresi), smoke 800 px & 390 px × 8 halaman tanpa overflow, tombol menu di semua halaman |
| Halaman: Files, Knowledge Base, Misi, Workforce, Tools, Memory, Pengaturan | **PASS** | data nyata; state loading/empty/error/retry diuji |
| Memory | **PARTIAL** | hanya catatan **eksplisit** buatan pengguna (CRUD, masuk system prompt bila aktif). Memori otomatis: **tidak ada** |
| Workforce | **PARTIAL** | hanya mendaftar 1 pelaksana lokal nyata; agen LLM otonom/adapter eksternal dinyatakan "Belum diimplementasikan" |
| Composer: menu lampiran, multi-file, pratinjau, hapus, drag-drop, paste, dari Files, Enter/Shift+Enter | **PASS** | `attachments-ui.test.tsx` (16), smoke dengan `<input type=file>` asli |
| Composer: progress unggahan | **PARTIAL** | persen nyata hanya bila transport mengirim event; di desktop (`dudu://`) **tidak ada event progress** (terukur) → UI memakai indikator tak-tentu, tanpa persen palsu |
| Composer: pembatalan unggahan | **PASS (jsdom)** / **NOT RUN (desktop)** | abort XHR + tidak menyimpan file diuji di jsdom; belum diuji pada app terpaket |
| Composer: kamera, rekam mikrofon | **BLOCKED / tidak diimplementasikan** | tidak ditampilkan sebagai tersedia; mic tetap nonaktif dengan alasan |
| Dokumen: TXT/MD/CSV/JSON/XML/YAML/log/kode, DOCX, XLSX, PPTX, ODT/ODS/ODP, RTF, HTML, PDF teks, ZIP (daftar) | **PASS** | diuji terhadap berkas dari software independen (`real-fixtures.test.mjs`) dan dalam `app.asar` |
| PDF pindaian / OCR | **BLOCKED** | OCR tidak diimplementasikan; dilaporkan jujur "tidak dapat dibaca", tidak pernah dilabeli sukses |
| Gambar → vision | **PARTIAL** | pipeline (base64 `image_url`, model & kunci terpisah) diverifikasi lewat perekam payload; **panggilan ke model vision sungguhan: NOT RUN** (tanpa kunci) |
| Audio → transkripsi | **PARTIAL** | pemanggilan `/audio/transcriptions`, cache transkrip, dan kegagalan diuji dengan provider palsu; **layanan nyata: NOT RUN** |
| Video | **tidak diimplementasikan** | hanya disimpan; dinyatakan di UI |
| Data terstruktur (CSV/TSV/JSON/JSONL/XLSX) | **PASS** | parser + profil, nilai diketahui |
| Pelaporan tahap file (dipilih → diunggah → tersimpan → terbaca → siap → dianalisis/gagal) | **PASS** | chip & pesan; "dianalisis" hanya bila isi benar-benar dikirim dan balasan sukses |
| Knowledge Base: ingest, chunking+overlap, indeks persisten, retrieval, sitasi (hal./slide/sheet), sinkronisasi hapus, indeks rusak | **PASS** (leksikal) | `knowledge.test.mjs`, `chat-attachments.test.mjs`, smoke |
| Embedding / pencarian semantik | **tidak diimplementasikan** | UI menyatakan "bukan embedding semantik" |
| RAG end-to-end dengan LLM nyata | **NOT RUN** | payload ke model terbukti memuat konteks `[S#]`; jawaban model nyata tidak diuji |
| Misi end-to-end (1 template: analisis data) | **PASS** | lihat §6 |
| Keamanan (§7) | **PASS** untuk butir yang diuji | lihat §5 |
| Build Linux (AppImage + deb) dan smoke app terpaket | **PASS** | §4 |
| Build Windows | **PASS (build)** · **NOT RUN (dijalankan)** | belum ditandatangani; belum pernah dijalankan di Windows |
| GitHub Actions | **NOT RUN** | hanya sintaks YAML |

## 4. Perintah dan hasil
| Perintah | Hasil |
|---|---|
| `npm ci` (dari ekstraksi ZIP bersih) | PASS |
| `npm run typecheck` | PASS (0 error) |
| `npm test` | **PASS — 15 file tes ditemukan di disk, 15 dieksekusi; 167 tes, 167 lulus, 0 dilewati** |
| `npm run build` | PASS |
| `npm run dist:linux` | PASS → AppImage ≈123 MB, .deb ≈98 MB |
| `npm run dist:win` (Linux + wine) | PASS (build) → Setup ≈102 MB, Portable ≈102 MB; **tidak ditandatangani** (cert 0 byte, diperiksa `pefile`) |
| `node scripts/smoke-desktop.mjs` — AppImage final | **PASS 51/51** |
| idem — `.deb` terpasang di `/opt` (hash `app.asar` terpasang = hasil build) | **PASS 51/51** |
| Lint | tidak tersedia (tidak ada konfigurasi ESLint) |

Rincian tes: api 9 · app-resilience 3 · attachments-ui 16 · chat-api 15 · chat-attachments 17 · composer 8 · desktop-helpers 14 · files-extract 20 · knowledge 9 · layout 6 · missions 13 · pages 16 · real-fixtures 8 · reminders 4 · storage 9. Hanya keluaran non-kosong: peringatan pdf.js "Indexing all PDF objects" pada tes PDF korup yang disengaja.

## 5. Bug nyata yang ditemukan dan diperbaiki (dengan regresi)
| Bug | Cara ditemukan |
|---|---|
| **RTF dari LibreOffice menghasilkan sampah biner berstatus "extracted"** → akan disuntikkan ke model | berkas asli; ditulis ulang sebagai tokenizer RTF + pengaman "teks penuh karakter kontrol = rusak" |
| ODP tanpa penanda slide (halaman catatan ikut terhitung); tabel ODT berlabel "Sheet" | berkas asli LibreOffice |
| Transkrip audio yang sah dibuang karena memeriksa status ekstraksi lama | tes chat dengan STT |
| Anggaran konteks lampiran dihabiskan oleh pesan **lama**; lampiran terbaru bisa tak terbaca | review; kini dialokasikan terbaru→lama |
| Respons `/api/capabilities` bentuk salah → UI crash (layar putih) | tes lama gagal setelah perubahan; kini divalidasi |
| `chunkText`: sisa overlap menjadi chunk duplikat pada pergantian halaman | sanity check |
| `URL.origin` Node = `"null"` untuk skema `dudu://` → app menolak dirinya sendiri | tes helper |
| CSP unduhan (`sandbox`) tertimpa CSP aplikasi | smoke pada app terpaket |
| Panel kanan: teks stale ("direncanakan", "Milestone F", "belum ada tool") | tes; kini data nyata |
| Halaman non-chat tanpa tombol sidebar; overlay sidebar menutupi konten saat layar menyempit | audit + screenshot; diperbaiki + 3 tes |
| **Overflow horizontal saat panel kanan ditutup di desktop** (`.sr-only` absolut lolos dari `overflow:hidden`; CSS asli) | smoke responsif pada app terpaket |
| Progress unggahan "0%" menyesatkan di desktop | smoke: event progress = 0 pada `dudu://` |

Uji mutasi: verifikasi misi sengaja dirusak → tes tamper gagal (membuktikan tes bermakna).

## 6. Bukti eksekusi misi (template "analisis data")
Alur: tujuan → misi **Draft** dengan 5 kriteria penerimaan eksplisit + 5 langkah → **persetujuan manusia** → Queued → Running → eksekusi tool lokal (`input.validate`, `data.load`, `data.profile`, `report.write`, `verify.criteria`) → artefak `report.md`+`profile.json` (ukuran, SHA-256) → verifikasi **independen** (baca ulang dari disk; hitung-ulang baris dengan implementasi terpisah; hitung-ulang min/maks/total dari data mentah) → Completed. Tiap langkah: ID eksekusi, stempel waktu, percobaan. Kegagalan diklasifikasi (`input_invalid`/`parse_error` → Failed; `tool_error` → retry otomatis maks. 1× lalu Needs Attention retryable; `verification_failed` → Needs Attention, tidak retryable). Misi terputus saat app ditutup dipulihkan sebagai Needs Attention. Diuji: `missions.test.mjs` (13), UI (`pages.test.tsx`), dan pada app terpaket (kriteria "lulus" 5/5, bukti "hitung-ulang=4, laporan=4, profile.json=4", artefak terunduh dengan header attachment+sandbox).
**Batas jujur:** perencana berbasis aturan; satu template; bukan agen LLM; tidak ada coding-agent/integrasi eksternal.

## 7. Keamanan (diperiksa)
Model Electron tidak dilemahkan (sandbox, contextIsolation, tanpa Node/IPC, CSP ketat, izin hanya notifikasi). Baru diverifikasi: nama file tidak menjadi path (traversal), ID divalidasi, executable & ekstensi palsu ditolak (magic bytes), batas ukuran (server + klien), zip bomb & path berbahaya di ZIP (tanpa ekstraksi ke disk), HTML/SVG tidak pernah dirender inline, unduhan `attachment` + `nosniff` + CSP `sandbox`, anti-CSRF header kustom pada semua request yang mengubah data, `/api/chat` wajib JSON, server dev hanya loopback, log tidak memuat isi file/kunci, indeks/misi/metadata rusak tidak membuat crash, object URL di-revoke. **Tidak diaudit:** pembersihan file `*.tmp` sisa bila proses mati tepat saat menulis; isolasi data antar-percakapan di sisi server (file bersifat global per perangkat, tidak per percakapan).

## 8. Koreksi atas klaim saya sebelumnya
Pada laporan rilis 0.1.0 saya menyebut smoke test AppImage "29/29". Setelah ditemukan bahwa `SIGTERM` pada pembungkus AppImage **tidak mematikan proses Electron** (terbukti: DevTools masih menjawab), sesi "buka ulang" pada pengujian AppImage itu kemungkinan tersambung ke instance lama — bukti pembukaan ulang untuk AppImage **tidak sahih**; untuk `.deb`/folder unpacked (biner dijalankan langsung) tetap sahih. Skrip kini menjalankan tiap sesi dalam grup proses sendiri, mematikan seluruh grup, dan **menggagalkan** sesi bila instance sebelumnya masih menjawab. AppImage 0.2.0 diuji ulang dengan skrip ini: 51/51.

## 9. Belum diuji / keterbatasan
- **Provider AI sungguhan** (chat, vision, STT, RAG dengan jawaban model): NOT RUN — tanpa kredensial. Hanya provider palsu yang merekam payload.
- **Windows asli**: installer/portable/uninstall/SmartScreen/notifikasi — NOT RUN. Uji installer di wine tidak konklusif (lihat PACKAGING.md).
- Pembatalan unggahan pada app terpaket; distro Linux selain Ubuntu 24.04; arm64; layar fisik/sentuh (diuji lewat CDP + Xvfb).
- Tidak ada: OCR, video, kamera, mikrofon, embedding, agen LLM, integrasi pihak ketiga.

## 10. Langkah berikutnya yang disarankan
1) Uji vision/STT/chat dengan kunci nyata (set `DUDU_VISION_MODEL`, `DUDU_STT_MODEL`). 2) Jalankan CI di runner Windows asli dan uji installer. 3) OCR (mis. tesseract.js) untuk PDF pindaian. 4) Embedding + hybrid retrieval bila provider mendukung. 5) Planner berbantuan LLM dengan kebijakan persetujuan yang sama. 6) Scoping file per percakapan bila diperlukan.

## 11. Increment v0.6.0 (WIP) — bukti eksekusi baru

Perintah yang benar-benar dijalankan di workspace ini (Windows, PowerShell):

| Perintah | Exit code | Hasil |
|---|---|---|
| `npm run typecheck` | 0 | 0 error TypeScript |
| `npm test` (sebelum increment) | 0 | 223 tes / 19 file lulus |
| `npm test -- --run tests/missions.test.mjs tests/api.test.mjs` | 0 | 24 tes lulus (2 tes pembatalan baru) |
| `npm test -- --run tests/pages.test.tsx -t "Chat → Misi"` | 0 | 2 tes jembatan lulus (jsdom ↔ server API nyata) |
| `npm run verify` (typecheck + test + build) | 0 | **233 tes / 20 file lulus**, build produksi `dist/` sukses (JS 301,68 kB / gzip 91,89 kB) |
| `vitest run --reporter=json` (dua kali berturut-turut, paralel penuh) | 0 | 228/228 lulus kedua kali — tes baru tidak flaky setelah timeout dilonggarkan ke 8 dtk (unggahan lewat XHR palsu bisa lambat saat suite paralel) |

Rincian tes: api 9 · app-resilience 3 · attachments-ui 16 · capability-registry 12 · capability-ui 3 · chat-api 15 · chat-attachments 17 · composer 8 · desktop-helpers 14 · files-extract 20 · gateway 27 · integrations 14 · knowledge 9 · layout 6 · missions 15 · pages 20 · **packaging 4** · real-fixtures 8 · reminders 4 · storage 9 = **233 tes / 20 file**. (Baris "Rincian tes" di §4 adalah angka historis v0.2.0 dan sengaja dibiarkan sebagai jejak audit.)

### 11.1 Pembatalan kooperatif misi (Tested)
- `POST /api/missions/:id/cancel` → 200 dengan misi; 409 `not_cancellable` bila status bukan `running`/`queued`; 400 untuk ID tidak valid.
- Titik pembatalan berada **di antara langkah**: langkah yang sedang berjalan diselesaikan, langkah berikutnya tidak dijalankan → `state: 'cancelled'`, `failure: null`.
- Bukti tes: `tests/missions.test.mjs` — file store "lambat" memberi titik pembatalan deterministik; diasersikan bahwa `s1` = `done`, `s2` = `pending`, state akhir `cancelled`.
- Batas jujur: pembatalan **tidak** mematikan langkah yang sedang berjalan (tidak ada preemption); UI menampilkan tombol batal hanya saat status `running`/`queued`, dan eksekusi misi saat ini sinkron per permintaan sehingga jendela batal pada UI sempit.

### 11.2 Jembatan Chat → Misi (Tested)
- Alur nyata di UI: lampirkan `sales.csv` (siap) → tulis tujuan di composer → klik **"Jadikan Misi Analisis Data"** → `POST /api/missions` → misi lahir **Draft** (menunggu persetujuan) → banner jujur + tombol "Buka Misi & Tugas" → halaman Misi & Tugas menampilkan status `Draft` dari server.
- Bukti tes: `tests/pages.test.tsx` (jsdom + `installBackend`, yaitu server API **nyata**); diverifikasi juga sisi server (`GET /api/missions` → 1 misi, `state: 'draft'`, `fileName: 'sales.csv'`, goal sesuai).
- Jaminan: tidak ada pesan chat palsu yang mengaku model menganalisis data; lampiran non-tabular **tidak** menampilkan tombol; tujuan < 5 karakter tidak mengirim POST apa pun.

### 11.3 Panel bukti kapabilitas (Tested)
- Detail misi menampilkan `m.evidence` (nama, `capabilityId`, ukuran, SHA-256, waktu, ok/gagal) + unduh dari `GET /api/missions/:id/evidence/:name`.
- Bukti: route + attach diuji di `tests/capability-registry.test.mjs`; **panel UI diuji di `tests/pages.test.tsx`** — bagian "Bukti kapabilitas" tampil, tautan Unduh mengarah ke `/api/missions/:id/evidence/:name`, `capabilityId` terlihat, dan status misi tetap `Draft` (bukti tidak boleh diam-diam menuntaskan misi).

### 11.4 Menjalankan kapabilitas dari konteks misi (Tested)
- Halaman Misi & Tugas memuat daftar kapabilitas yang benar-benar `runnable` dari Unified Capability Registry (pada instalasi bersih: `kb_search`, `kb_stats`, `file_list`). Kapabilitas `runnable: false` (mis. workflow misi, referensi eksternal WorkBuddy/Hermes/OpenClaw) **tidak** ditampilkan.
- Argumen wajib diambil dari `inputSchema` kapabilitas (mis. `kb_search` → `query`); argumen kosong ditolak dengan pesan jelas tanpa memanggil server.
- Kapabilitas dengan `sideEffects ≠ none` memerlukan **kotak persetujuan eksplisit** sebelum tombol "Jalankan" aktif (memetakan aturan `confirm: true` di server).
- Bukti tes (`tests/pages.test.tsx`): klik "Jalankan" pada `kb_stats` → pesan "Berhasil dalam N ms — bukti dilampirkan: …", panel bukti muncul, status misi tetap `Draft`, dan kelima kriteria penerimaan tetap "belum diperiksa".
- Perbaikan yang menyertainya: `MissionDetail` di-*remount* setiap `updatedAt` berubah sehingga pesan hasil run langsung hilang; key diganti menjadi `current.id` agar state lokal UI tidak hilang (detail tetap merender dari props).

### 11.5 Bukti desktop rilis v0.6.0 (Windows asli)

| Bukti | Hasil |
|---|---|
| `npm run dist:win` (NSIS + portable, native) | exit 0 → `Dudu-AI-Setup-0.6.0-x64.exe` (103.415.582 B) + `Dudu-AI-Portable-0.6.0-x64.exe` (103.169.025 B) |
| Smoke `release/win-unpacked/Dudu AI.exe` | **51/51 lulus**, exit 0 |
| **Instalasi senyap** `Setup.exe /S /D=<temp>` | exit 0, berkas `Dudu AI.exe` terbentuk di folder tujuan |
| **Smoke aplikasi hasil instalasi** | **51/51 lulus**, exit 0 → gap v0.5.0 ("installer belum pernah dipasang") **tertutup** |
| **Uninstall senyap** `Uninstall.exe /S` | exit 0, berkas aplikasi terhapus (data pengguna di `%APPDATA%\Dudu AI` **tidak** dihapus, sesuai `deleteAppDataOnUninstall: false`) |
| Smoke `.exe` portable (ekstrak & jalankan) | **51/51 lulus**, exit 0 |
| Verifikasi isi `app.asar` (`scripts/verify-asar.mjs`) | versi 0.6.0, pembatalan misi, jembatan Chat→Misi, panel bukti, runner kapabilitas **OK**; tidak ada kunci API literal |

Isi smoke (51 pemeriksaan) mencakup alur misi nyata di app terpaket (Draft → persetujuan → Selesai, 5 kriteria "lulus" berbukti, artefak terunduh dengan `attachment` + CSP `sandbox`), Lampiran DOCX/PDF, anti-CSRF 403, unggah executable 415, nol overflow horizontal di 800 px & 390 px pada 8 halaman, tidak ada kunci API di bundle, tidak ada request eksternal.

### 11.6 Bukti paket lintas platform & batasnya

| Platform | Hasil di mesin ini (Windows 10 x64, bukan admin, tanpa Docker/WSL) |
|---|---|
| **Windows x64** | Installer + portable **dibangun & diuji** (lihat §11.5); ZIP `Dudu-AI-0.6.0-Windows-x64.zip` + varian installer-saja + `SHA256SUMS-0.6.0-Windows.txt` |
| **Linux x64** | Direktori aplikasi **dibangun** (`release/linux-unpacked`: binari `dudu-ai` 228 MB, `app.asar` 3,3 MB, locales) → dipaket jadi `Dudu-AI-0.6.0-linux-x64-portable.tar.gz` (121.351.828 B) + `Dudu-AI-0.6.0-Linux-x64.zip`. **`asar` diverifikasi** (kode 0.6.0 + tanpa kunci API). **Belum dijalankan di Linux.** `.deb` gagal: `spawn fpm ENOENT` (butuh Ruby `fpm`). AppImage gagal: `EPERM … symlink` (butuh Linux/symlink privilege) |
| **macOS x64 + arm64** | **Tidak dapat dibangun di Windows** — electron-builder: *"Build for macOS is supported only on macOS"*. Konfigurasi `mac:` (dmg + zip, x64 & arm64, unsigned) dan job CI `macos-14` sudah disiapkan. **Belum ada artefak macOS.** |
| Sumber | `Dudu-AI-0.6.0-source.zip` (580.785 B) — untuk membangun sendiri di Linux/macOS (`npm ci && npm run dist:linux` / `dist:mac`) |

Skrip `scripts/package-release.mjs` (baru) membuat ZIP + hash per platform dan **menolak mengarang artefak**: yang tidak ada dilaporkan "TIDAK DIBANGUN" dan tidak masuk ZIP/daftar hash (kode keluar 5). Aturan pencocokannya terikat versi — regresi nyata (paket 0.6.0 sempat memuat installer 0.3.0) kini ditutup oleh `tests/packaging.test.mjs` (4 tes).

Hash lengkap (7 artefak: 2 exe Windows, 2 ZIP Windows, tarball + ZIP Linux, ZIP sumber) ada di **`release/SHA256SUMS-0.6.0.txt`**; hash per platform ada di `SHA256SUMS-0.6.0-{Windows,Linux,source}.txt` (juga disertakan di dalam masing-masing ZIP). Hash sengaja **tidak** disalin ke dalam dokumen di sini: nilai hash ZIP berubah setiap kali ZIP dibuat ulang, sehingga menyalinnya ke dalam dokumen pasti menimbulkan ketidaksesuaian.

## 13. v0.6.1 — Visual QA, release hardening & Execution Center

### 13.1 Pemeriksaan yang dijalankan (hasil aktual)

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Type-check | `npm run typecheck` | **0 error** (exit 0) |
| Tes unit + integrasi + UI | `npm test` | **236 tes / 21 file, 236 lulus, 0 gagal** (exit 0) |
| Build produksi | `npm run build` | sukses (JS 301,68 kB / gzip 91,89 kB) |
| Verifikasi gabungan | `npm run verify` | **exit 0** |
| Audit responsif (16 rute × 6 lebar) | `scripts/ui-audit.cjs` | **0 temuan overflow dari 96 kombinasi** + screenshot per kombinasi |
| Audit kontras komponen ter-render (16 rute) | `scripts/contrast-audit.cjs` | **0 temuan** (teks ≥4.5:1, non-teks ≥3:1) |
| Kontras token | `scripts/contrast-check.mjs` | semua pasangan ≥ ambang; emas terang tak lagi dipakai untuk teks |
| Smoke biner desktop 0.6.1 | `scripts/smoke-desktop.mjs` | **51/51 lulus** (exit 0) |
| Kompatibilitas upgrade 0.5.0 → 0.6.1 | `scripts/upgrade-check.cjs` | **LOLUS**: install 0.5.0 → data pengguna → install 0.6.1 di atasnya → data utuh, startup OK, **smoke 51/51 pada biner ter-upgrade**, uninstall tidak menghapus data |
| Isi paket terpasang | `scripts/verify-asar.mjs` | versi 0.6.1 + fitur 0.6.1 ada, **tanpa kunci API literal** |

### 13.2 Masalah visual yang ditemukan & diperbaiki

| Prioritas | Temuan (terlihat di render nyata) | Perbaikan |
|---|---|---|
| **P1** | Tombol emas: teks putih di atas isian `#9C7016` = **4.43:1** → gagal AA untuk label 13px | Token baru `--gold-btn #8A6212` → **5.47:1** (AA); semua tombol/terkirim emas memakai token itu |
| **P1** | Batas kontrol form `#E1DDD2` = **1.36:1** → gagal WCAG 1.4.11 (non-teks ≥3:1) | Token `--line-ctl #9A9079` → **3.16:1**; fokus memakai `--gold-deep` (4.43:1) |
| **P1** | Teks emas pada avatar, badge sumber, tautan, label langkah, prompt CLI: **4.10–4.43:1** (ditemukan audit ter-render, **bukan** oleh cek token) | Semua teks emas → `--gold-ink #8A6212` (5.47:1) |
| **P2** | Halaman Misi: kalimat "satu template…" & alur kerja tampil **dua kali**; keadaan kosong melayang di luar panel | Duplikasi dihapus; keadaan kosong jadi panel "Daftar misi" yang konsisten |
| **P2** | Akun & OAuth: redirect URI + instruksi provider terduplikasi di blok Google **dan** GitHub | Redirect URI dipindah ke subjudul panel; tiap blok hanya memuat langkah provider-nya |
| **P2** | Pusat Eksekusi: tombol "Buka Tools & Integrations" diulang 5× (semua ke halaman sama) | Aksi menjadi satu per grup |
| **P2** | Kartu skill: baris "Di mana:" tidak sejajar antar kartu | `margin-top:auto` → rata bawah |
| **P3** | Kutip teks tidak konsisten (straight vs typographic) | Dibakukan ke “ ” pada teks UI |

### 13.3 Pusat Eksekusi (vertikal pertama yang selesai)

**Arsitektur — yang sudah ada vs yang benar-benar ditambahkan:**

| Kebutuhan | Status sebelum | Solusi v0.6.1 | Perlu backend? |
|---|---|---|---|
| State misi per langkah + stempel waktu | **Sudah ada** (`steps[].attempts[]`: `startedAt`, `finishedAt`, `execId`, `ok`, `error`, `class`, `attempt`; `log[]`) | Ditampilkan apa adanya | Tidak |
| Status live selama eksekusi | Sudah ada di server (persist tiap transisi langkah) | **Polling** `GET /api/missions/:id` tiap 1,2 detik selama misi belum terminal | Tidak |
| Streaming/SSE | Tidak ada | Tidak ditambahkan (memakai polling) — **disebutkan terbuka** | Tidak |
| Misiyg perlu approval / gagal / perlu ditinjau | Sudah ada di state misi | Dikelompokkan dengan aksi nyata | Tidak |
| Integrasi belum terkonfigurasi | Sudah ada di registry (`status.availability`) | Ditampilkan dari registry, bukan daftar manual | Tidak |
| Identitas agen & persentase | **Tidak ada** | **Tidak dikarang** — hanya "3 dari 5 langkah selesai" | — |
| Notifikasi/pengingat event | Tidak ada | **Planned** (butuh event server) | Ya, nanti |

**Perilaku penting:** tombol "Setujui & jalankan" sengaja **tidak** awaits POST-nya — eksekusi berjalan di server sementara UI mem-poll state nyata, sehingga timeline benar-benar hidup. Kegagalan approve terlihat sebagai state misi (gagal/needs attention), bukan spinner palsu.

**Bukti:** `tests/execution-center.test.tsx` (3 tes, stabil 3× berturut-turut): misi Draft tampil sebagai "menunggu persetujuan" dengan aksi nyata; menjalankan misi menampilkan timeline dengan nama tool & stempel waktu **dari server** dan berakhir "Selesai" (5 dari 5 langkah) tanpa persentase; butir konfigurasi diambil dari registry nyata (bukan daftar manual).

### 13.4 Status rilis per platform (dibedakan dengan sengaja)

| Platform | Build | Artefak | Instalasi | Startup | Smoke inti | Catatan |
|---|---|---|---|---|---|---|
| **Windows x64** | ✅ exit 0 | ✅ Setup + Portable + 2 ZIP | ✅ dipasang senyap, **upgrade dari 0.5.0** diuji | ✅ | ✅ **51/51** | Native Windows 10 x64, tanpa sertifikat (belum ditandatangani) |
| **Linux x64** | ⚠️ sebagian | ✅ direktori aplikasi + tarball portabel + ZIP sumber | ❌ | ❌ | ❌ | `.deb` butuh `fpm` (Ruby), AppImage butuh symlink → keduanya harus dibangun di Linux; tarball **belum pernah dijalankan** di Linux |
| **macOS x64/arm64** | ❌ | ❌ | ❌ | ❌ | ❌ | electron-builder menolak build mac dari Windows; konfigurasi + job CI `macos-14` siap, artefak harus dibuat di macOS |
| Sumber (semua OS) | ✅ | ✅ ZIP sumber | — | — | — | `npm ci && npm run dist:linux` / `dist:mac` |

> Tidak ada klaim runtime macOS/Linux. Satu-satunya verifikasi runtime adalah Windows (biner, instalasi senyap, upgrade, dan smoke 51/51).

### 13.5 Risiko & isu yang tersisa

1. **Paket macOS & `.deb`/AppImage belum ada** — harus dibangun di OS masing-masing (CI sudah disiapkan).
2. **Tarball Linux belum dijalankan** di Linux; bitmap izin eksekusi tidak dapat disimpan dari Windows → perlu `chmod +x dudu-ai`.
3. **Jebakan build `EPERM` pada `release/`** — dev server Vite yang berjalan mengunci folder tersebut; build wajib dijalankan tanpa dev server aktif.
4. **Polling 1,2 detik** terasa untukEksekusi sangat singkat; belum ada SSE. Event server (untuk notifikasi) masih planned.
5. **Uji provider AI nyata** tetap NOT RUN (tanpa kunci API asli).
6. Berkas `.cjs` di lingkungan ini **tidak boleh** diawali `#`/shebang (Node menafsirkan sebagai ESM) — memengaruhi skrip audit baru.

---

## 12. UI/UX overhaul v0.6.0 — bukti
| Pemeriksaan | Alat | Hasil |
|---|---|---|
| Audit responsif 15 halaman × 6 lebar (1440/1280/1024/768/390/360) = **90 kombinasi** | `scripts/ui-audit.cjs` (Electron + CDP, mengukur `scrollWidth` vs `clientWidth` per elemen + screenshot PNG) | **0 temuan overflow** (sebelum overhaul: 1 elemen meluber di 360px + halaman-halaman submenu sempat gagal dinavigasi) |
| Rasio kontras token warna | `scripts/contrast-check.mjs` | `--ink3` 5.10:1, `--ink-2` 6.90:1, `--gold-ink` 5.47:1, `--ok/warn/err` 5.05/5.91/5.69 — semuanya ≥ AA 4.5:1; emas terang lama `#C79A42` (2.58:1) tidak lagi dipakai untuk teks/isian |
| Build produksi + typecheck | `npm run build` | 0 error TS, bundle JS 301,68 kB (gzip 91,89 kB) |
| Tes regresi UI & backend | `npm test` | **233 tes / 20 file lulus** (termasuk tes UI yang/jsdom ↔ server nyata: halaman, lampiran, kapabilitas, misi, Chat→Misi) |
| Biner desktop | `scripts/smoke-desktop.mjs` | 51/51 lulus pada build 0.6.0 (§11.5) |

### 12.1 Apa yang diubah (ringkas)
- **Design system**: token lengkap (warna, tipografi, spasi, radius, elevasi, tinggi kontrol, fokus, gerak) + komponen kanonik `.panel`, `.card`, `.field`, `.notice`, `.pill`, `.card-grid`, `.kv`, `.toolbar`, `.stat`, `.cmd-row`, `.empty-state`. Aturan CSS lama yang duplikat/bertentangan dibersihkan (`.card` & `.badge` sempat didefinisikan dua kali; `--paper` dipakai tapi tidak pernah didefinisikan).
- **15 halaman** dirapikan: Input Data (kartu dokumen + editor besar + toolbar hitung karakter + panel uji terpisah), Knowledge Base (indeks/tambah/uji sebagai panel), MCP (grid tool responsif, panel server eksternal, catatan keamanan), CLI (referensi perintah terkelompok + tombol Salin), Plugin (terpasang vs referensi eksternal), Connector (grid + status jujur + Rahasia tersamar), Skill, Settings (Provider, Gateway 1–4, Batas & penyimpanan), Akun & OAuth, Files, Memory, Tools, Workforce, Misi, Chat.
- **Aksesibilitas**: label selalu terlihat, focus ring konsisten, `aria-label` pada tombol ikon, `role="status"`/`alert` pada umpan balik, target sentuh ≥ 30px, `prefers-reduced-motion` dihormati.
- **Yang tidak berubah**: kontrak API, logika bisnis, penyimpanan, autentikasi, integrasi, dan seluruh status yang dilaporkan server.

### 12.2 Catatan jujur
- Tiga tes backend sempat gagal **saat suite berjalan paralel dengan dev server + audit Electron aktif**; dijalankan ulang tanpa beban (dan thrice berturut-turut) → 233/233 lulus. Kegagalan itu beban, bukan regresi — tetapi tidak ada pengulangan otomatis di luar kondisi ini.
- Screenshot audit diambil dengan jendela Electron dibuat terlihat sesaat (tanpa fokus) karena jendela tersembunyi tidak selalu melukis ulang → `capturePage` bisa menangkap frame lama.
- Audit memverifikasi **overflow & konsistensi struktural**, bukanirmware estetika; penilaian visual tetap perlu mata manusia (screenshot tersedia di `ui-audit-after/`).

### 11.7 Yang TIDAK dilakukan pada increment ini- Tidak ada mesin eksekusi kedua; kontrak `/api/chat` lama, gateway, routing free-first, dan seluruh modul sidebar lain tidak diubah.
- Tidak ada dependensi baru.
- **Tidak ada** rilis/ZIP Linux `.deb`/AppImage dan **tidak ada** artefak macOS (harus dibangun di OS masing-masing; CI sudah disiapkan). Rilis Windows 0.6.0 + tarball Linux + paket sumber tersedia.
- Tidak ada uji provider AI nyata (butuh kunci API asli), tidak ada scheduler/multi-agent, tidak ada OCR/embedding, tidak ada MCP HTTP — semuanya masih di luar jangkauan increment ini.
