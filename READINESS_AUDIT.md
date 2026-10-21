# Laporan Audit Kesiapan Rilis — Dudu AI Agent OS v0.6.2

Tanggal: 22 Oktober 2026 · Ruang lingkup: Phase 1–10 (audit implementasi, bukti E2E, failure recovery, validasi provider, kesiapan Linux/macOS, CI, keamanan, perbaikan, laporan).

Semua angka di bawah **dari eksekusi nyata pada lingkungan ini** (Windows 10 x64, Node 24.22, Electron 44.7.2). Yang tidak dijalankan ditandai eksplisit.

---

## A. Ringkasan eksekutif

- **Kesiapan Windows v0.6.2: TERBUKTI.** Build, instalasi senyap, startup, smoke 51/51, dan kompatibilitas upgrade 0.5.0 → 0.6.1 semuanya dijalankan dan lulus.
- **Mesin eksekusi misi terbukti nyata** (12 tahap E2E dengan artefak di disk, `execId`, evidence kriteria, dan log), **bukan** klaim.
- **Tidak ada blocker P0 pada kode.** Dua celah cakupan tes ditutup sesi ini (kegagalan menulis artefak; provider HTTP 5xx) dan kosakata status uji provider diperjelas (passed/failed/unverified/skipped/blocked).
- **Kesiapan lintas platform BELUM terbentuk:** runtime Linux belum pernah dijalankan, artefak macOS belum dibuat, CI belum pernah dieksekusi. Keigaian ini adalah batas lingkungan, bukan kode.
- **Keputusan: READY WITH LIMITATIONS** — siap untuk rilis Windows yang sudah diverifikasi; belum siap sebagai rilis lintas platform.

---

## B. Status komponen inti

Status dipakai apa adanya: *Implemented and tested* · *Implemented but not fully verified* · *Partially implemented* · *Mock/simulated* · *Not implemented* · *Blocked*.

| Komponen | Implementasi aktual | Bukti | Kekurangan | Prioritas |
|---|---|---|---|---|
| Mission lifecycle | `server/missions.mjs`: draft → queued → running → completed/failed/needs_attention/cancelled; transisi divalidasi (hanya Draft yang dapat disetujui, 409 bila salah state) | `tests/missions.test.mjs` (16 tes), smoke 51/51 | Hanya 1 template (analisis data tabular) | P2 |
| Task lifecycle | 5 langkah (`input.validate`→`data.load`→`data.profile`→`report.write`→`verify.criteria`) dengan `attempts[]` berisi `execId`, `startedAt`, `finishedAt`, `ok`, `error`, `class` | E2E run (execId nyata per langkah) | Tidak ada task terpisah dari misi | P3 |
| Tool registry | `server/capability-registry.mjs`: 1 registry untuk tool/skill/connector/plugin/MCP/workflow + 14 referensi eksternal; status dihitung dari store/validasi/probe/audit | `tests/capability-registry.test.mjs` (12), `tests/capability-ui.test.tsx` (3) | Referensi eksternal **tidak bisa dijalankan** (memang dirancang) | — |
| Execution adapters | MCP tool (JSON-RPC in-process), plugin (in-process, butuh konfirmasi), connector webhook (HTTP), workflow internal | `tests/integrations.test.mjs` (14) | Plugin = kode lokal tanpa sandbox | P2 |
| Permission & approval | Misi: `approval.status` wajib `approved` sebelum eksekusi; `policy` = {requiresApproval, writeScope, network:false, destructive:false}; registry: efek samping wajib `confirm:true` (409 `confirmation_required`), referensi eksternal 409 `reference_only`, non-runnable 409 `not_runnable` | `missions.mjs` (approve/retry/cancel), `capability-registry.mjs:993-998` | Izin belum granular per kapabilitas (hanya konfirmasi manual) | P2 |
| Persistent storage | `dataDir/missions/*.json` (tulis atomik tmp+rename, mode 0600), `dataDir/artifacts/<id>/`, `dataDir/files/<uuid>/` (0700), `providers.json` (0600) | `missions.mjs:46-53`, `files.mjs:26-59`, `credentials.mjs` | Tidak ada migrasi skema (belum perlu) | P3 |
| Resume | `retry()` hanya untuk `needs_attention` + `retryable`; langkah s1–s3 diulang, s4–s5 dilewati bila sudah selesai (retry parsial) | Tes "tool_error persisten → retry manual setelah diperbaiki" | Misi `running` yang mati saat restart dipulihkan ke `needs_attention` (bukan auto-resume) — disengaja | P3 |
| Cancellation | `cancel()` kooperatif antar-langkah → `state: 'cancelled'`, tanpa `failure`; cancel di luar running/antre → 409 | 2 tes cancel | Tidak ada preemption (langkah berjalan diselesaikan) | P3 |
| Error classification | `input_invalid`/`parse_error` → failed (tanpa retry); `verification_failed` → needs_attention (tanpa retry); `tool_error` → retry otomatis maks 1× lalu needs_attention (retryable) | 6 tes kegagalan | — | — |
| Retry policy | `maxAutoRetries=1`, hanya untuk `tool_error`, hanya idempoten (lokal). Percobaan tercatat di `attempts[]` | Tes "retry otomatis tepat 1 kali" | Retry tidak pernah otomatis untuk operasi eksternal | P2 |
| Acceptance criteria | 5 kriteria tetap (ac1–ac5) ditetapkan saat misi dibuat, **sebelum** eksekusi, masing-masing dengan `evidence` + `checkedAt` | E2E run | Kriteria statis (belumdinamis per tujuan) | P2 |
| Verification engine | `stepVerify` membaca ulang artefak dari disk, mencocokkan SHA-256, menghitung ulang jumlah baris dengan implementasi terpisah (`independentRowCount`) dan statistik dari data mentah (`recomputeNumericStats`) | E2E run: 5/5 passed dengan evidence konkret | Tidak ada verifikasi untuk kapabilitas non-misi | P2 |
| Artifact storage | `artifacts/<missionId>/report.md` + `profile.json` (+ `evidence/*.json`); akses **hanya lewat allowlist** (`artifactPath`/`evidencePath` mencarikan nama di record) | Tes "artefak hanya dari allowlist; ID tidak valid ditolak" | — | — |
| Execution history | `steps[].attempts[]` (execId, waktu, hasil) + `m.log[]` (level, pesan, waktu) | E2E run | Log tidak berindeks per menjalankan ulang | P3 |
| Audit events | `capability-audit.jsonl` (append, mode 0600) + `redact()` (kunci/rahasia → `[REDACTED]`, batas kedalaman & panjang) | `capability-registry.mjs:50-80,526-551` | Audit kapabilitas saja; aksi misi tidak masuk audit JSONL | P2 |
| Provider adapters | `server/providers.mjs` (OpenAI-compatible) + `server/gateway.mjs` (routing, budget, fallback, usage) + `server/routing.mjs` | `tests/gateway.test.mjs` (27) | **Uji live belum pernah dilakukan** (tanpa kunci API) | P1 |
| Frontend↔backend | 16 rute; `src/lib/api.ts` klien terpusat; header `X-Dudu-Client` untuk semua mutasi (403 tanpa itu) | 251 tes, audit UI 16×6, smoke 51/51 | — | — |

---

## C. Bukti end-to-end execution (12 tahap, dijalankan nyata)

Misi nyata: "Analisis data penjualan dan tulis laporan" atas `penjualan.csv` (4 baris, 3 kolom).

| # | Tahap | Bukti nyata |
|---|---|---|
| 1 | Instruksi diterima | `file sumber: penjualan.csv da80388f-…` |
| 2 | Mission dibuat | `d1ee571e-…` · `state: draft` · `planner: rule-based` |
| 3 | Acceptance criteria ditetapkan | 5 kriteria: `ac1…ac5` (ditetapkan **saat dibuat**, sebelum eksekusi) |
| 4 | Policy & izin diperiksa | `{requiresApproval:true, writeScope:"artifacts misi ini saja", network:false, destructive:false, maxAutoRetries:1}`; approval `pending` |
| 5 | Approval + eksekusi | `approval=approved` → 5 langkah jalan (execId nyata) |
| 6 | Tool benar-benar dijalankan | `s1 input.validate` (exec fe73970e, 7 ms, sha sumber), `s2 data.load` (0ad47f51, rows 4), `s3 data.profile` (90c61ddd), `s4 report.write` (053b90fe), `s5 verify.criteria` (84930835, passed 5) |
| 7 | Hasil disimpan | artefak `report.md` (1002 B, sha 75a21951…) + `profile.json` (1253 B, sha 51e9172d…) |
| 8 | Artefak benar-benar di disk | `report.md exists=true bytes=1002`, `profile.json exists=true bytes=1253` |
| 9 | Artefak divalidasi | ac1 "sha256 cocok" · ac2 "hitung-ulang=4, laporan=4, profile.json=4" · ac3 "3 kolom ditemukan" · ac4 "2 kolom numerik cocok" · ac5 "4/4 langkah selesai dengan ID eksekusi" |
| 10 | Status dari hasil aktual | `completed` · `failure: null` |
| 11 | Evidence tersimpan | 5/5 kriteria punya `evidence` + `checkedAt`; 0 bukti kapabilitas (tidak ada kapabilitas yang dijalankan) |
| 12 | Hasil diserahkan | 8 baris log eksekusi + `report.md` (isi: SHA-256 sumber, jumlah baris/kolom, ringkasan, tabel, path artefak) |

> Teks jawaban LLM **tidak dipakai** sebagai bukti: mission ini tidak menyentuh LLM sama sekali (planner berbasis aturan, tool lokal deterministik). Buktinya adalah file di disk, hash, dan angka yang dihitung ulang.

---

## D. Hasil failure recovery

| Skenario | Status yang dihasilkan | Bukti |
|---|---|---|
| Tool error (file sumber dihapus) | `failed`, `input_invalid`, **tidak** retryable | Tes misi |
| Tool error (CSV rusak) | `failed`, `parse_error` | Tes misi |
| Tool error sementara | retry otomatis **tepat 1×** → berhasil, percobaan tercatat | Tes misi |
| Tool error persisten | `needs_attention` (retryable) → retry manual berhasil setelah diperbaiki | Tes misi |
| Output tool tidak valid (respons non-JSON) | HTTP 502 `provider_request_error` (bukan 200) | `smoke:provider` |
| Provider 401 / 429 / 503 | HTTP 502 + pesan penyebab, kredensial tidak bocor | `smoke:provider` (4 mock lokal) |
| Provider timeout / jaringan mati | HTTP 502, pesan koneksi | `smoke:provider` |
| Artefak gagal ditulis (**tambahan sesi ini**) | `needs_attention`, `tool_error`, retryable; `artifacts: []` (tidak ada artefak diklaim sukses); 2 percobaan tercatat; **tidak ada** kriteria yang dianggap lulus | Tes misi baru (16 tes) |
| Artefak dirusak setelah ditulis | `needs_attention`, `verification_failed`, tidak retryable; ac1/ac2 gagal dengan bukti hash | Tes misi |
| Acceptance criterion gagal | `ac.status='failed'` + `evidence` menjelaskan | Tes misi + E2E |
| Misi dibatalkan | `cancelled` tanpa `failure`; langkah berjalan diselesaikan | 2 tes cancel |
| Restart saat misi berjalan | `running`/`queued` → `needs_attention` (retryable) + log "terdeteksi misi terputus" | Tes misi |
| Halaman mati saat restart | `queued/running` tidak pernah tampil selamanya | `recoverStale()` |

**Tidak ada operasi eksternal non-idempoten yang diulang otomatis** (retry hanya untuk `tool_error` lokal).

---

## E. Hasil validasi provider

`npm run smoke:provider` → **8 passed · 0 failed · 3 unverified · 0 skipped · 0 blocked** (exit 0).

| Skenario | Status | Catatan |
|---|---|---|
| Tanpa kredensial: `/api/capabilities` → `configured=false` | PASSED | — |
| Tanpa kredensial: `/api/chat` → 501 `provider_not_configured` | PASSED | tanpa panggilan keluar |
| 401 (kunci ditolak) | PASSED | HTTP 502 + "invalid api key"; **kunci tidak bocor** |
| 429 (rate limit) | PASSED | HTTP 502 + "rate limited" |
| 503 (5xx) | PASSED | HTTP 502 + "upstream unavailable" |
| Respons non-JSON | PASSED | HTTP 502, bukan 200 |
| Jaringan mati / timeout | PASSED | HTTP 502 + pesan koneksi |
| Chat completion (live) | **UNVERIFIED** | butuh `DUDU_PROVIDER_API_KEY` — tidak ada permintaan nyata |
| Vision (live) | **UNVERIFIED** | butuh kunci + `DUDU_VISION_MODEL` |
| Speech-to-text (live) | **UNVERIFIED** | butuh kunci + `DUDU_STT_MODEL` |

> Skenario live memakai **mock lokal** (127.0.0.1) untuk jalur error — mock **bukan** pengujian integrasi nyata, dan tidak pernah dihitung sebagai "provider aktif". Status `unverified` tidak pernah diubah menjadi `passed`; hanya `FAILED` yang menentukan exit code non-zero.

---

## F. Status Linux & macOS yang sebenarnya

| Aspek | Linux | macOS |
|---|---|---|
| Build di lingkungan ini | ⚠️ hanya **direktori aplikasi** (`release/linux-unpacked`); `.deb` butuh `fpm` (Ruby), AppImage butuh symlink (`EPERM` di Windows) | ❌ electron-builder: "Build for macOS is supported only on macOS" |
| Artefak | ✅ `Dudu-AI-0.6.2-linux-x64-portable.tar.gz` (0755 terverifikasi), `…-Linux-x64.zip`, `…-source.zip` | ❌ belum ada |
| Izin eksekusi | ✅ `-rwxr-xr-x … dudu-ai` (dibuktikan `tar -tvf`) | n/a |
| Instalasi | ❌ belum (tidak ada mesin Linux) | ❌ |
| Startup | ❌ belum | ❌ |
| API & storage | ❌ belum | ❌ |
| Penghentian aplikasi | ❌ belum | ❌ |
| Artefak & log | ❌ belum | ❌ |
| Dependensi sistem | `.deb` akan menarik GTK3/NSS/libnotify (perlu dikonfirmasi di Linux) | notarization/Developer ID belum ada |
| CI | ✅ job `linux` (ubuntu-24.04): build + smoke (xvfb) + audit UI + portabel 0755 + paket | ✅ job `macos` (macos-14): build + smoke opsional + paket; smoke/audit UI `continue-on-error` (sinyal terbaik, bukan gerbang) |

**Rencana uji runtime Linux** (saat mesin/CI Linux tersedia): ekstraksi → `chmod`/verifikasi mode → `./dudu-ai` (startup) → `GET /api/health` & `/api/capabilities` → buat misi + approve (artefak & log) → tutup aplikasi (data persists di `~/.config/Dudu AI`) → buka lagi (data masih ada) → uninstall/`dpkg -r` → pastikan data pengguna tetap.

---

## G. Status CI/CD

`.github/workflows/build.yml` (5 job: test, linux, windows, macos, release) — **belum pernah dijalankan** (belum ada remote GitHub).

| Job | Isi | Perintah benar-benar ada di package.json? |
|---|---|---|
| test | `npm ci` → `npm run verify` → `npm run smoke:provider` (tanpa kredensial) → `npm run verify:ui` (xvfb) | ✅ semua ada |
| linux | `npm ci` → `npm run dist:linux` → smoke (xvfb) → portabel 0755 → `package-release.mjs linux` → upload | ✅ |
| windows | `npm ci` → `npm run dist:win` → smoke → `npm run verify:ui` → paket → upload | ✅ |
| macos | `npm ci` → `npm run dist:mac` → smoke (opsional) → verify:ui (opsional) → paket → upload | ✅ |
| release | unduh artefak → GitHub Release **draft** (hanya saat tag `v*`) | ✅ |

- **Tanpa secret di workflow** (diverifikasi: tidak ada `secrets.*`), dan tidak ada credential provider yang dipakai di CI → skenario live provider tetap `UNVERIFIED` di CI.
- `npm ci` dipakai (install reproducible dari `package-lock.json`); Node 22 (workflow) ≥ `engines.node >= 20`.
- Release hanya发生在 pada tag `v*` dan **`draft: true`** (tidak ada publish otomatis).

---

## H. Perubahan berkas & alasannya

| Berkas | Alasan |
|---|---|
| `tests/missions.test.mjs` | Menutup celah: kegagalan **menulis artefak** → `needs_attention`, artefak tidak diklaim sukses, retry terbatas |
| `scripts/provider-smoke.mjs` | Menambah skenario provider **5xx**; kosakata status jadi passed/failed/unverified/skipped/blocked; `unverified` tidak pernah jadi `passed` |
| `.github/workflows/build.yml` | Menjalankan `smoke:provider` & `verify:ui` di CI; memverifikasi mode 0755 paket portabel Linux |
| `release/SHA256SUMS-0.6.2.txt` + paket sumber | Paket sumber diregenerasi agar memuat skrip terbaru |

---

## I. Hasil tes (perintah & exit code aktual)

| Perintah | Exit | Hasil |
|---|---|---|
| `npm run typecheck` | 0 | 0 error |
| `npm test` | 0 | **252 tes / 23 file, 252 lulus** |
| `npm run build` | 0 | bundle 301,68 kB (gzip 91,89 kB) |
| `npm run verify` | **0** | typecheck + tes + build |
| `npm run verify:ui` | **0** | responsif 16×6: 0 temuan · kontras: 0 temuan |
| `npm run smoke:provider` | **0** | 8 passed · 0 failed · 3 unverified |
| `node scripts/smoke-desktop.mjs` (biner 0.6.2) | 0 | 51/51 |
| `node scripts/upgrade-check.cjs` (0.5.0 → 0.6.1) | 0 | LOLUS |
| `node scripts/verify-asar.mjs` | 0 | versi & fitur 0.6.2 ada, tanpa kunci API literal |
| `tar -tvf …portable.tar.gz` | 0 | `dudu-ai` mode 0755 |

---

## J. Known limitations

1. **Runtime Linux & macOS belum pernah dijalankan** — semua artefak non-Windows belum diuji eksekusi.
2. **Provider live belum terverifikasi** (3 skenario unverified) — tidak ada kredensial asli di lingkungan ini.
3. **CI belum pernah dijalankan** — konfigurasi tervalidasi (YAML + perintah), tetapi belum ada bukti eksekusi di GitHub.
4. Satu template misi saja (analisis data tabular); planner berbasis aturan, bukan LLM.
5. Plugin berjalan **in-process** (kode lokal pengguna) tanpa sandbox.
6. Audit event hanya untuk kapabilitas; aksi misi belum masuk `capability-audit.jsonl`.
7. Timeline Pusat Eksekusi masih polling (1–15 s) — belum ada SSE.
8. Paket belum ditandatangani (Windows & macOS) — SmartScreen/Gatekeeper memperingatkan.

---

## K. Temuan keamanan

| Area | Status | Bukti |
|---|---|---|
| Kunci API | Server-side saja; snapshot publik hanya sufiks 4 karakter; `providers.json` mode 0600; tidak pernah masuk bundle/asar | `credentials.mjs:11,63`, `verify-asar.mjs`, smoke "Pengaturan tidak menampilkan kunci API" |
| Redaksi log/audit | Kunci/rahasia/Bearer → `[REDACTED]`; batas kedalaman & panjang | `capability-registry.mjs:62-80` |
| Env & file lokal | `.env`/`dudu.env` di luar repo & gitignored | `.gitignore`, scan 113 file sumber → 0 rahasia |
| Validasi path | ID file/misi UUID-valid; nama berkas **tidak pernah** jadi path disk (disimpan per-UUID); akses artefak hanya lewat allowlist | `files.mjs:27,40`, `missions.mjs:44,116-128` |
| Terminal/proses | MCP di-spawn **tanpa shell**, dengan timeout + kill; perintah berasal dari konfigurasi pengguna | `mcp.mjs:58-77` |
| Permission enforcement | Misi butuh approval; efek samping kapabilitas butuh `confirm:true`; referensi eksternal & non-runnable ditolak 409 | `missions.mjs`, `capability-registry.mjs:993-998` |
| Request jaringan keluar | Hanya ke provider/konfigurasi milik pengguna; status & alasan dicatat | `gateway.mjs`, `connectors.mjs` |
| Anti-CSRF | Semua request non-GET wajib header `X-Dudu-Client` (403) | `api.mjs:97` |
| Logging | Tidak memuat isi file/kunci; error dipotong 200–400 karakter | `api.mjs`, `capability-registry.mjs` |
| Akses artefak | Hanya nama yang tercatat di record misi | tes "artefak hanya dari allowlist" |
| Dependensi | **0 dependensi baru**; `npm audit` tidak dijalankan di lingkungan ini (tidak ada akses registry) | `package.json` |

**Catatan jujur:** "paket tidak mengandung literal API key" **bukan** bukti keamanan menyeluruh — yang diuji adalah tidak adanya kebocoran kunci, jalur penyimpanan, danBbb红线 kontrol. Audit keamanan penuh (threat model, fuzzing, dependency audit) belum dilakukan.

---

## L. Rekomendasi tahap berikutnya

1. Jalankan `npm run dist:linux` + smoke di Ubuntu (atau job CI) → lengkapi matriks runtime Linux.
2. Jalankan build & smoke macOS di runner macos-14 → lengkapi matriks runtime macOS; tambahkan Developer ID + notarization sebelum publikasi.
3. Jalankan `npm run smoke:provider` dengan kunci asli (chat/vision/STT) → ubah 3 skenario `unverified` menjadi `passed` **hanya** bila respons nyata terverifikasi.
4. Tetapkan remote Git & jalankan CI (tanpa membuat tag/push tanpa izin) → bukti reproducibility.
5. Masukkan aksi misi ke `capability-audit.jsonl` (jejak audit lintas kapabilitas & misi) dan pertimbangkan SSE untuk timeline.

---

## M. Keputusan kesiapan

### **READY WITH LIMITATIONS**

- **Windows v0.6.2: siap untuk rilis terverifikasi** — build ✓, artefak ✓, instalasi senyap ✓, startup ✓, smoke 51/51 ✓, upgrade 0.5.0→0.6.1 ✓, data pengguna aman saat uninstall ✓, tidak ada secret dalam paket ✓.
- **Kesiapan lintas platform belum terbentuk**: runtime Linux belum dijalankan, artefak macOS belum dibuat, CI belum dieksekusi, provider live belum diverifikasi. Rilis ini **hanya boleh diklaim untuk Windows**, dan catatan rilis harus menyatakan batas tersebut apa adanya.
- Tidak ada blocker P0 pada kode setelah perbaikan sesi ini (kegagalan tulis artefak & provider 5xx ditutup dengan tes).
