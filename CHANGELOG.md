# Changelog — Dudu AI

Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/). Versi memakai SemVer.
Status fitur memakai kosakata yang jujur: **Implemented** · **Tested** · **Partially implemented** · **Mock / simulation** · **Planned** · **Blocked**.

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
