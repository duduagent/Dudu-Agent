# Laporan Audit Kesiapan Rilis — Dudu AI Agent OS v0.6.3

Tanggal: 22 Oktober 2026 · Ruang lingkup: Phase 1–10 (audit implementasi, bukti E2E, failure recovery, validasi provider, kesiapan Linux/macOS, CI, keamanan, perbaikan, laporan) **+ Fase Unified Execution Audit & Granular Permission (v0.6.3)**.

Semua angka di bawah **dari eksekusi nyata pada lingkungan ini** (Windows 10 x64, Node 24.22, Electron 44.7.2). Yang tidak dijalankan ditandai eksplisit.

> Dokumen akuan dalam bentuk apa adanya: `SECURITY_NOTES.md` (skema event, izin yang benar-benar ditegakkan, mekanisme approval, batas yang masih terbuka).

---

## A. Ringkasan eksekutif

- **Kesiapan Windows v0.6.2: TERBUKTI.** Build, instalasi senyap, startup, smoke 51/51, dan kompatibilitas upgrade 0.5.0 → 0.6.1 semuanya dijalankan dan lulus.
- **Mesin eksekusi misi terbukti nyata** (12 tahap E2E dengan artefak di disk, `execId`, evidence kriteria, dan log), **bukan** klaim.
- **Tidak ada blocker P0 pada kode.** Dua celah cakupan tes ditutup sesi ini (kegagalan menulis artefak; provider HTTP 5xx) dan kosakata status uji provider diperjelas (passed/failed/unverified/skipped/blocked).
- **Fase v0.6.3 — Unified Execution Audit & Granular Permission: TERBUKTI via tes.** Jejak audit terpadu untuk misi + kapabilitas (19 jenis event, skema seragam), 8 izin berbasis operasi nyata yang ditegakkan **di batas eksekusi**, dan approval yang **terikat tindakan** (kapabilitas + operasi + target + digest parameter + masa berlaku + sekali pakai). 17 tes regresi baru.
- **Celah "hijau palsu" ditemukan & ditutup:** `redact` terdeklarasi ganda membuat aplikasi **terpaket gagal start** sementara 269 tes tetap hijau (vitest/esbuild mentoleransi linking ESM yang Node/Electron tolak). Diperbaiki + ditutup oleh `npm run check:imports` (ESM native Node) yang kini ikut `npm run verify`.
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
| Permission & approval | **v0.6.3**: `server/permissions.mjs` — 8 izin berbasis operasi nyata (`file:read`, `file:write`, `process:exec`, `network:out`, `credential:use`, `side-effect:external`, `plugin:exec`, `mcp:exec`) + `enforce()` yang dijalankan **di batas eksekusi** (`capability-registry.mjs` → `run()`); penolakan → 403 `permission_denied` + event `permission.denied`, tindakan tidak dijalankan. Approval **terikat tindakan** (`m.approvals[]`: capabilityId + operation + target + paramsDigest + status + expiresAt, sekali pakai) + approval rencana misi terikat digest rencana | `tests/execution-audit.test.mjs` (17 tes), `tests/capability-registry.test.mjs` (12) | Izin masih allowlist level aplikasi (bukan capability-based OS, belum per-peran); `process:exec` dicadangkan tanpa adapter pemakainya | P2 |
| Persistent storage | `dataDir/missions/*.json` (tulis atomik tmp+rename, mode 0600), `dataDir/artifacts/<id>/`, `dataDir/files/<uuid>/` (0700), `providers.json` (0600) | `missions.mjs:46-53`, `files.mjs:26-59`, `credentials.mjs` | Field baru pada record misi bersifat **opsional** → **tanpa migrasi**, data lama tetap terbaca (diuji) | P3 |
| Resume | `retry()` hanya untuk `needs_attention` + `retryable`; langkah s1–s3 diulang, s4–s5 dilewati bila sudah selesai (retry parsial) | Tes "tool_error persisten → retry manual setelah diperbaiki" | Misi `running` yang mati saat restart dipulihkan ke `needs_attention` (bukan auto-resume) — disengaja | P3 |
| Cancellation | `cancel()` kooperatif antar-langkah → `state: 'cancelled'`, tanpa `failure`; cancel di luar running/antre → 409 | 2 tes cancel | Tidak ada preemption (langkah berjalan diselesaikan) | P3 |
| Error classification | `input_invalid`/`parse_error` → failed (tanpa retry); `verification_failed` → needs_attention (tanpa retry); `tool_error` → retry otomatis maks 1× lalu needs_attention (retryable) | 6 tes kegagalan | — | — |
| Retry policy | `maxAutoRetries=1`, hanya untuk `tool_error`, hanya idempoten (lokal). Percobaan tercatat di `attempts[]` | Tes "retry otomatis tepat 1 kali" | Retry tidak pernah otomatis untuk operasi eksternal | P2 |
| Acceptance criteria | 5 kriteria tetap (ac1–ac5) ditetapkan saat misi dibuat, **sebelum** eksekusi, masing-masing dengan `evidence` + `checkedAt` | E2E run | Kriteria statis (belumdinamis per tujuan) | P2 |
| Verification engine | `stepVerify` membaca ulang artefak dari disk, mencocokkan SHA-256, menghitung ulang jumlah baris dengan implementasi terpisah (`independentRowCount`) dan statistik dari data mentah (`recomputeNumericStats`) | E2E run: 5/5 passed dengan evidence konkret | Tidak ada verifikasi untuk kapabilitas non-misi | P2 |
| Artifact storage | `artifacts/<missionId>/report.md` + `profile.json` (+ `evidence/*.json`); akses **hanya lewat allowlist** (`artifactPath`/`evidencePath` mencarikan nama di record) | Tes "artefak hanya dari allowlist; ID tidak valid ditolak" | — | — |
| Execution history | `steps[].attempts[]` (execId, waktu, hasil) + `m.log[]` (level, pesan, waktu) | E2E run | Log tidak berindeks per menjalankan ulang | P3 |
| Audit events | **v0.6.3**: `server/execution-audit.mjs` — **satu** jejak append-only `capability-audit.jsonl` (0600) untuk **misi + kapabilitas**; skema seragam (`eventId`, `at`/`ts`, `eventType`, `missionId`, `taskId`, `execId`, `capabilityId`, `actor`, `outcome`, `correlationId`, `idempotencyKey`, `detail` ter-redaksi); 19 jenis event (`mission.created` … `permission.denied`); fail-closed (`appendCritical`) untuk `mission.approved`/`mission.started`/`tool.execution_started`; anti-duplikasi via `idempotencyKey` | `tests/execution-audit.test.mjs` (17 tes), `tests/capability-registry.test.mjs` (bentuk event lama tetap terbaca) | Tidak ada penandatanganan/rotasi jejak; retensi belum diatur | P2 |
| Provider adapters | `server/providers.mjs` (OpenAI-compatible) + `server/gateway.mjs` (routing, budget, fallback, usage) + `server/routing.mjs` | `tests/gateway.test.mjs` (27) | **Uji live belum pernah dilakukan** (tanpa kunci API) | P1 |
| Frontend↔backend | 16 rute; `src/lib/api.ts` klien terpusat; header `X-Dudu-Client` untuk semua mutasi (403 tanpa itu); **v0.6.3**: UI approval tindakan di runner kapabilitas (Misi & Tugas) | 269 tes, audit UI 16×6, smoke 51/51 | Jejak audit misi belum punya tampilan UI (API sudah mendukung filter `missionId`) | — |

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
- Release hanya terjadi pada tag `v*` dan **`draft: true`** (tidak ada publish otomatis).

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

### v0.6.2 (baseline, tidak berubah oleh fase ini)

| Perintah | Exit | Hasil |
|---|---|---|
| `npm run typecheck` | 0 | 0 error |
| `npm test` | 0 | **252 tes / 23 file, 252 lulus** |
| `npm run build` | 0 | bundle 301,68 kB (gzip 91,89 kB) |
| `npm run verify:ui` | **0** | responsif 16×6: 0 temuan · kontras: 0 temuan |
| `npm run smoke:provider` | **0** | 8 passed · 0 failed · 3 unverified |
| `node scripts/smoke-desktop.mjs` (biner 0.6.2) | 0 | 51/51 |
| `node scripts/upgrade-check.cjs` (0.5.0 → 0.6.1) | 0 | LOLUS |
| `node scripts/verify-asar.mjs` | 0 | versi & fitur 0.6.2 ada, tanpa kunci API literal |
| `tar -tvf …portable.tar.gz` | 0 | `dudu-ai` mode 0755 |

### v0.6.3 (fase Unified Execution Audit & Granular Permission)

| Perintah | Exit | Hasil |
|---|---|---|
| `npm run typecheck` | 0 | 0 error |
| `npm run check:imports` **(baru)** | 0 | 13 modul server dimuat **ESM native Node** → `IMPORT_OK` |
| `npm test` | 0 | **269 tes / 24 file, 269 lulus** (dari 252/23; +17 tes regresi baru) |
| `npm run build` | 0 | bundle 334,89 kB (gzip 98,38 kB) |
| `npm run verify` | **0** | typecheck + check:imports + tes + build |
| `npm run verify:ui` | **0** | responsif 16×6: 0 temuan · kontras ter-render: 0 temuan |
| `npm run smoke:provider` | **0** | 8 passed · 0 failed · 3 unverified · 0 skipped · 0 blocked |
| `node scripts/smoke-desktop.mjs` (biner 0.6.3) | 0 | 51/51 |
| `node scripts/upgrade-check.cjs` (0.5.0 → 0.6.3) | 0 | LOLUS (data lama tetap terbaca) |
| `node scripts/verify-asar.mjs` | 0 | versi & fitur 0.6.3 ada, tanpa kunci API literal |
| `tar -tvf …portable.tar.gz` | 0 | `dudu-ai` mode 0755 |

---

## J. Known limitations

1. **Runtime Linux & macOS belum pernah dijalankan** — semua artefak non-Windows belum diuji eksekusi.
2. **Provider live belum terverifikasi** (3 skenario unverified) — tidak ada kredensial asli di lingkungan ini.
3. **CI belum pernah dijalankan** — konfigurasi tervalidasi (YAML + perintah), tetapi belum ada bukti eksekusi di GitHub.
4. Satu template misi saja (analisis data tabular); planner berbasis aturan, bukan LLM.
5. Plugin berjalan **in-process** (kode lokal pengguna) tanpa sandbox.
6. Timeline Pusat Eksekusi masih polling (1–15 s) — belum ada SSE.
7. Paket belum ditandatangani (Windows & macOS) — SmartScreen/Gatekeeper memperingatkan.
8. **Jejak audit belum ditandatangani/di-rotasi** — siapa pun yang bisa menulis ke folder data dapat menyunting `capability-audit.jsonl`; retensi belum diatur.
9. **Model izin masih level aplikasi** — allowlist berbasis operasi, bukan capability-based OS; belum ada peran/pengguna berbeda; `process:exec` dicadangkan tetapi belum ada adapter yang memakainya.
10. **Jejak audit misi belum tampil di UI** — API mendukung filter `missionId`/`eventType`/`correlationId`, tetapi belum ada panel tampilan.
11. **UI/CLI belum menampilkan siapa menyetujui apa** selain event audit (approval tercatat di jejak, bukan di layar ringkas).
12. **Celah hijau palsu masih mungkin di area lain** — `check:imports` menutup linking ESM server; jalur pemaketan/asar lain belum diaudit otomatis.

---

## K. Temuan keamanan

| Area | Status | Bukti |
|---|---|---|
| Kunci API | Server-side saja; snapshot publik hanya sufiks 4 karakter; `providers.json` mode 0600; tidak pernah masuk bundle/asar | `credentials.mjs:11,63`, `verify-asar.mjs`, smoke "Pengaturan tidak menampilkan kunci API" |
| Redaksi log/audit | Kunci/rahasia/Bearer → `[REDACTED]`; batas kedalaman & panjang; **satu** implementasi di `server/execution-audit.mjs` | `execution-audit.mjs:49`, tes redaksi |
| Env & file lokal | `.env`/`dudu.env` di luar repo & gitignored | `.gitignore`, scan 113 file sumber → 0 rahasia |
| Validasi path | ID file/misi UUID-valid; nama berkas **tidak pernah** jadi path disk (disimpan per-UUID); akses artefak hanya lewat allowlist | `files.mjs:27,40`, `missions.mjs:44,116-128` |
| Terminal/proses | MCP di-spawn **tanpa shell**, dengan timeout + kill; perintah berasal dari konfigurasi pengguna | `mcp.mjs:58-77` |
| Permission enforcement | **v0.6.3**: `enforce()` di `capability-registry.mjs` → `run()`; 8 izin; penolakan → 403 + event `permission.denied`; **tindakan tidak dijalankan** | `permissions.mjs`, `tests/execution-audit.test.mjs` |
| Default aman | `network:out` / `side-effect:external` / `credential:use` hanya diberikan bila **konfigurasi nyata** ada (connector live & field terisi) **dan** `confirm:true` | `grantedPermissionsFor()` + tes |
| Approval terikat tindakan | Misi: `approval.status` + `approval.scope.digest` (rencana); tindakan: `capabilityId`+`operation`+`target`+`paramsDigest`+`expiresAt`, **sekali pakai** (`consumed`) | `missions.mjs`, 4 endpoint approval, tes approval |
| Fail-closed audit | `mission.approved` / `mission.started` / `tool.execution_started` ditulis lewat `appendCritical()` → bila gagal, **tindakan berisiko tidak dijalankan** (500 `audit_unavailable`) | `execution-audit.mjs`, tes fail-closed |
| Anti-duplikasi event | `idempotencyKey` (jendela 60 dtk) + `execId` per attempt → percobaan dapat dibedakan, event tidak kembar | tes idempotency |
| Request jaringan keluar | Hanya ke provider/konfigurasi milik pengguna; status & alasan dicatat | `gateway.mjs`, `connectors.mjs` |
| Anti-CSRF | Semua request non-GET wajib header `X-Dudu-Client` (403) | `api.mjs:97` |
| Logging | Tidak memuat isi file/kunci; error dipotong 200–400 karakter | `api.mjs`, `capability-registry.mjs` |
| Akses artefak | Hanya nama yang tercatat di record misi | tes "artefak hanya dari allowlist" |
| Dependensi | **0 dependensi baru**; `npm audit` tidak dijalankan di lingkungan ini (tidak ada akses registry) | `package.json` |

---

## L. Fase Unified Execution Audit & Granular Permission (v0.6.3)

### L.1 Temuan awal (dari audit repositori aktual, bukan dari asumsi)

| # | Temuan | Bukti | Dampak |
|---|---|---|---|
| 1 | `POST /api/missions/:id/capabilities/:capId/run` **tidak pernah memeriksa approval misi** | `api.mjs:377-386` (sebelum perubahan) | Persetujuan umum atas misi menjadi izin tanpa batas untuk semua tindakan |
| 2 | Audit JSONL hanya mencatat **kapabilitas**; aktivitas misi tidak masuk jejak | `capability-registry.mjs` (sebelum perubahan) | Tidak bisa menjawab "siapa/komponen apa yang melakukan apa" |
| 3 | Izin hanya berupa `sideEffects !== 'none' → confirm:true` | `capability-registry.mjs:993-998` | Tidak granular; tidak bisa ditunjukkan izin mana yang dievaluasi |
| 4 | Event audit tidak punya identitas/korelasi | bentuk event lama `{at, capabilityId, action, outcome}` | Perattempt/permisi tidak dapat dibedakan |
| 5 | Penulisan audit adalah best-effort tanpa kebijakan fail-closed | `appendAudit` lama | Kontrol keamanan bisa gagal diam-diam |

### L.2 Akar masalah

Arsitektur memisahkan "catat jejak" dari "kontrol keamanan": audit adalah efek samping, bukan gerbang.
Persetujuan juga hanya berstatus (`approval.status`), tanpa **cakupan** — sehingga tidak bisa membedakan
"izin menjalankan alat A dengan parameter X" dari "izin menjalankan apa saja".

### L.3 Desain yang dipilih (minimum, tanpa membangun ulang Mission Engine)

1. **Satu modul audit** `server/execution-audit.mjs` → `append()` (best-effort), `appendCritical()` (fail-closed),
   `read({missionId, eventType, correlationId})`, `redact()`, `fileSummary()`. Satu penulis berkas.
2. **Satu modul izin** `server/permissions.mjs` → 8 izin kanonik, `requiredPermissionsFor(entry)`,
   `grantedPermissionsFor(entry, {confirm})`, `enforce()`. Default aman: izin jaringan/efek samping/credential
   hanya diberikan bila **konfigurasi nyata** ada.
3. **Approval dua lapis**: approval **rencana** (digest langkah+alat+file) dan approval **tindakan**
   (kapabilitas+operasi+target+digest parameter+masa berlaku+sekali pakai).
4. **Mission store tetap sumber kebenaran status**; audit adalah jejak, bukan state.

### L.4 Berkas yang berubah

| Berkas | Perubahan | Jenis |
|---|---|---|
| `server/execution-audit.mjs` | **Baru** — skema event seragam + fail-closed + dedupe + redaksi | Implementasi nyata |
| `server/permissions.mjs` | **Baru** — 8 izin + `enforce()` + `digestOf()` | Implementasi nyata |
| `server/capability-registry.mjs` | Pakai audit terpadu; `enforce()` di `run()`; event unified + field legacy | Implementasi nyata |
| `server/missions.mjs` | Event siklus hidup; scope approval; `requestApproval`/`decideApproval`/`findValidApproval`/`consumeApproval` | Implementasi nyata |
| `server/api.mjs` | 4 endpoint approval (+1 GET daftar);egerbang approval pada run kapabilitas dalam misi; pemetaan error `PermissionError`/`AuditError`; filter audit | Implementasi nyata |
| `src/lib/api.ts` | Tipe `MissionApproval` + 3 klien approval + filter audit | Implementasi nyata |
| `src/components/pages/MissionsPage.tsx` | UI "Setujui tindakan"/"Tolak" di runner kapabilitas | Implementasi nyata |
| `src/styles.css` | Gaya `.cap-approval` | Implementasi nyata |
| `tests/execution-audit.test.mjs` | **Baru** — 17 tes regresi (14 skenario diminta) | Implementasi nyata |
| `tests/capability-registry.test.mjs`, `tests/pages.test.tsx` | Disesuaikan ke alur approval (assertion diperketat, bukan dilonggarkan) | Implementasi nyata |
| `scripts/check-server-imports.mjs` | **Baru** — muat 13 modul server dengan ESM native Node | Implementasi nyata |
| `package.json` | `check:imports` + `verify` memuatnya; versi → 0.6.3 | Implementasi nyata |
| `SECURITY_NOTES.md` | **Baru** — skema event, izin nyata, approval, batas | Dokumentasi |

### L.5 Skema event audit (field yang dipakai)

`eventId` · `at` (ISO) · `ts` (epoch ms) · `eventType` · `missionId` · `taskId` · `execId` · `capabilityId` ·
`actor` · `outcome` · `correlationId` · `idempotencyKey` · `detail` (ter-redaksi) — + field legacy
(`action`, `args`, `durationMs`, `sideEffects`, `confirm`, `error`) agar konsumen lama tidak rusak.

Jenis event: `mission.created` · `mission.approval_requested` · `mission.approved` · `mission.rejected` ·
`mission.started` · `mission.cancel_requested` · `mission.cancelled` · `task.started` ·
`tool.execution_started` · `tool.execution_succeeded` · `tool.execution_failed` · `tool.retry_scheduled` ·
`artifact.created` · `verification.passed` · `verification.failed` · `mission.completed` ·
`mission.failed` · `mission.needs_attention` · `capability.validated` · `permission.denied` · `approval.expired`

Field yang tidak diketahui bernilai `null` — **tidak dikarang**. Isi file pengguna tidak pernah ditulis penuh
(hanya nama/ukuran/SHA-256/MIME).

### L.6 Izin yang benar-benar ditegakkan (dan yang TIDAK)

| Izin | Ditegakkan? | Diberikan ketika |
|---|---|---|
| `file:read` | ✅ | tool MCP lokal, plugin, workflow |
| `file:write` | ✅ | workflow misi |
| `process:exec` | ⛔ dicadangkan | **tidak ada adapter yang memakainya** — tidak diklaim berlaku |
| `network:out` | ✅ | connector `live` saja |
| `credential:use` | ✅ | connector dengan field secret/token **terisi nyata** |
| `side-effect:external` | ✅ | connector `live` + `confirm:true` |
| `plugin:exec` | ✅ | plugin **aktif** |
| `mcp:exec` | ✅ | tool MCP lokal terdaftar |

Penegakan terjadi di `capability-registry.run()` → `enforce()` → `403 permission_denied` + event
`permission.denied`, **tindakan tidak dijalankan**. Tidak ada izin yang dilonggarkan dari kondisi sebelumnya.

### L.7 Mekanisme approval

| Situasi | Hasil |
|---|---|
| Run kapabilitas dalam misi tanpa approval | `409 approval_required` (+ event `mission.approval_requested` saat diminta) |
| Approval kedaluwarsa | `403 approval_expired` |
| Parameter berubah material | `409 approval_scope_mismatch` |
| Approval ditolak eksplisit | approval berstatus `rejected` → run tetap `409`; event `mission.rejected` |
| Approval dipakai | status `consumed` (tersimpan) → run berikutnya butuh approval baru |
| Rencana misi berubah setelah approval | `409 approval_scope_mismatch` (scope = digest rencana) |
| Misi lama (tanpa scope) | **tetap dihormati** (kompatibilitas), field baru bersifat opsional |

### L.8 Tes yang ditambahkan (17, di `tests/execution-audit.test.mjs`)

1. Event misi lengkap & berurutan (created → … → completed) + satu `correlationId` per misi.
2. Event kegagalan memuat alasan aman; `verification.failed` ≠ `mission.completed`.
3. Retry → `tool.retry_scheduled` + `execId` berbeda per attempt.
4. Kredensial tidak pernah bocor (apiKey/Bearer → `[REDACTED]`).
5. Permission ditolak di backend & tidak ada request keluar.
6. Approval tidak valid ditolak (409).
7. Approval kedaluwarsa ditolak (403).
8. Perubahan parameter material membatalkan approval (409).
9. Fail-closed: approve gagal saat audit tak bisa ditulis → misi **tidak** dieksekusi.
10. Status mission store tetap konsisten dengan event.
11. Cancellation tidak dicatat sebagai keberhasilan.
12. Verification failure tidak menghasilkan `mission.completed`.
13. Anti-duplikasi (`idempotencyKey`).
14. Kompatibilitas: misi legasi & event audit legasi tetap bekerja.
+ filter jejak per misi, `digestOf` stabil.

### L.9 Perintah yang benar-benar dijalankan & hasilnya

| Perintah | Exit | Hasil |
|---|---|---|
| `npm run typecheck` | 0 | 0 error |
| `npm run check:imports` | 0 | `IMPORT_OK` — 13 modul server dimuat ESM native Node |
| `npm test` | 0 | 269 tes / 24 file, 269 lulus |
| `npm run build` | 0 | bundle 334,89 kB (gzip 98,38 kB) |
| `npm run verify` | 0 | typecheck + check:imports + tes + build |
| `npm run verify:ui` | 0 | 0 temuan (responsif & kontras ter-render) |
| `npm run smoke:provider` | 0 | 8 passed · 0 failed · 3 unverified |
| `node scripts/smoke-desktop.mjs` (biner 0.6.3) | 0 | **51/51** |
| `node scripts/upgrade-check.cjs` (0.5.0 → 0.6.3) | 0 | LOLUS |
| `node scripts/verify-asar.mjs` (asar 0.6.3) | 0 | SEMUA PEMERIKSAAN LULUS |

### L.10 Simulasi / mock / belum diverifikasi (dipisahkan agar tidak tertukar)

- **Mock**: `smoke:provider` memakai mock lokal 127.0.0.1 untuk jalur error → **bukan** integrasi provider nyata.
- **UNVERIFIED**: chat/vision/STT live (3 skenario) — butuh kredensial asli; tidak ada permintaan nyata yang dilakukan.
- **UNVERIFIED**: runtime Linux & macOS — belum pernah dijalankan (tidak ada mesin/CI).
- **UNVERIFIED**: CI GitHub — workflow tervalidasi (YAML + seluruh perintah ada), belum dieksekusi.
- **Real (terbukti)**: seluruh event audit, gerbang izin, approval, fail-closed, kompatibilitas data — diuji di
  lingkungan ini dengan tes integrasi nyata (bukan pemeriksaan teks sumber).

### L.11 Risiko keamanan yang belum ditangani

1. Jejak audit **tidak ditandatangani** dan **tidak di-rotasi** → bisa disunting di disk.
2. Izin belum per-peran/per-pengguna; `process:exec` belum terpakai.
3. Plugin tetap in-process (tanpa sandbox) — `plugin:exec` hanya menandai, tidak membatasi.
4. Jejak audit belum ditampilkan di UI.
5. `npm audit`/dependency audit belum dijalankan di lingkungan ini (0 dependensi baru, tetapi ini bukan bukti).

---

## M. Rekomendasi tahap berikutnya

1. Jalankan `npm run dist:linux` + smoke di Ubuntu (atau job CI) → lengkapi matriks runtime Linux.
2. Jalankan build & smoke macOS di runner macos-14 → lengkapi matriks runtime macOS; tambahkan Developer ID + notarization sebelum publikasi.
3. Jalankan `npm run smoke:provider` dengan kunci asli (chat/vision/STT) → ubah 3 skenario `unverified` menjadi `passed` **hanya** bila respons nyata terverifikasi.
4. Tetapkan remote Git & jalankan CI (tanpa membuat tag/push tanpa izin) → bukti reproducibility.
5. **Tambahkan penandatanganan/rotasi jejak audit** (hash chain per event) dan panel tampilan jejak misi di UI.
6. **Pertimbangkan SSE** untuk timeline Pusat Eksekusi (menggantikan polling 1–15 s).

---

## N. Keputusan kesiapan

### **READY WITH LIMITATIONS**

- **Windows v0.6.3: siap untuk rilis terverifikasi** — build ✓, artefak ✓, instalasi senyap ✓, startup ✓, smoke 51/51 ✓, upgrade 0.5.0→0.6.3 ✓, data pengguna aman saat uninstall ✓, tidak ada secret dalam paket ✓.
- **Fase v0.6.3 terbukti lewat tes**: jejak audit terpadu (19 jenis event, fail-closed, anti-duplikasi, redaksi), gerbang izin di batas eksekusi (8 izin), approval terikat tindakan (scope + masa berlaku + sekali pakai) — 269 tes / 24 file lulus, aplikasi terpaket terverifikasi 51/51.
- **Kesiapan lintas platform belum terbentuk**: runtime Linux belum dijalankan, artefak macOS belum dibuat, CI belum dieksekusi, provider live belum diverifikasi. Rilis ini **hanya boleh diklaim untuk Windows**, dan catatan rilis harus menyatakan batas tersebut apa adanya.
- Tidak ada blocker P0 pada kode setelah perbaikan sesi ini (kegagalan tulis artefak, provider 5xx, dan duplikasi ekspor `redact` ditutup dengan tes/ pemeriksaan otomatis).
