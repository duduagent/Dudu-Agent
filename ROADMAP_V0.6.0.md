# Roadmap v0.6.0 — Unified Capability & Execution Architecture

> **Status: v0.6.0 DIRILIS pada 21 Oktober 2026** dengan cakupan TAHAP 0–4 (sebagian). Rincian artefak per platform ada di [PACKAGING.md](PACKAGING.md) dan `release/SHA256SUMS-0.6.0.txt`. **TAHAP 5–7 tetap Planned** — versi ini tidak mengklaim seluruh roadmap selesai.

Status per tahap diisi berdasarkan **bukti yang benar-benar dijalankan** (kode + tes + build), bukan rencana saja.
Kosakata status: Implemented · Tested · Partially implemented · Mock/simulation · Planned · Blocked.

Prinsip yang dipegang: **satu** Mission Execution Engine (tidak ada mesin kedua), **satu** Capability Registry, dan tidak ada status yang diklaim tanpa keadaan backend.

---

## TAHAP 0 — Baseline Audit — **Selesai (Tested)**

| Item | Hasil |
|---|---|
| Root proyek | `C:\Users\LENOVO\Documents\Default Project` (bukan git repo → semua perubahan file lokal, belum di-commit) |
| Stack | Node ≥20, TypeScript + Vite (frontend), Express-free HTTP server (`server/*.mjs`), Electron 44 (desktop), Vitest |
| Entry point | `src/main.tsx` → `src/App.tsx`; backend `server/api.mjs` (dipakai bersama dev server & proses Electron) |
| Penyimpanan | `<userData>/data/{files,kb,missions,artifacts}` + `capability-state.json`, `capability-audit.jsonl` |
| Mission Engine | `server/missions.mjs` — 5 langkah, 5 kriteria penerimaan, retry terbatas, pemulihan saat restart |
| Tool Registry | `server/capability-registry.mjs` + `/api/capability-registry` |
| Provider | Gateway terpusat (`server/gateway.mjs`), free-first, kontrak lama `/api/chat` dipertahankan |
| Baseline test | `npm run verify` lulus: 223 tes/19 file (sebelum increment 0.6.0), typecheck bersih, build produksi sukses |

## TAHAP 1 — Core Reliability — **Selesai (Tested)**

- Status misi `cancelled` + pembatalan kooperatif di antara langkah (`POST /api/missions/:id/cancel`).
- Pemulihan misi terputus (`queued/running` → `needs_attention` + retryable) dipertahankan.
- Klasifikasi kegagalan tetap: `input_invalid`/`parse_error` → failed (tanpa retry), `tool_error` → retry otomatis maks 1× lalu needs_attention, `verification_failed` → needs_attention non-retryable.
- Bukti: `tests/missions.test.mjs` (15), `tests/api.test.mjs` (9).

## TAHAP 2 — Capability Registry — **Selesai (Tested, v0.5.0 + UI v0.6.0)**

- Registry agregatif dengan status turunan, adapter validasi/run, policy `confirm:true` untuk operasi berdampak, audit append-only.
- Hanya MCP lokal, plugin aktif, dan webhook ber-URL yang runnable; referensi eksternal selalu `reference_only` dan tidak bisa dijalankan.
- **UI (v0.6.0):** kapabilitas yang `runnable` bisa dijalankan dari konteks misi (Misi & Tugas) dan hasilnya dilampirkan sebagai bukti; `runnable: false` tidak ditampilkan.
- Bukti: `tests/capability-registry.test.mjs` (12), `tests/capability-ui.test.tsx` (3), `tests/pages.test.tsx` (20), `CAPABILITY_*.md`.

## TAHAP 3 — Verification — **Selesai (Tested) untuk alur yang dipilih**

- Acceptance criteria dievaluasi oleh kode (bukan LLM): baca ulang artefak dari disk, bandingkan SHA-256, hitung ulang baris dengan implementasi terpisah, hitung ulang statistik dari data mentah.
- Evidence direkam per kriteria; bukti kapabilitas dapat dilampirkan ke misi (`attachEvidence`).
- Evidence kini **terlihat di UI** (panel "Bukti kapabilitas" di detail misi) — Implemented + Tested (`pages.test.tsx`: tautan unduh ke `/api/missions/:id/evidence/:name`, isi `capabilityId`, status misi tetap Draft).
- Batas jujur: hanya satu template misi (analisis data); kriteria manual ditandai eksplisit.

## TAHAP 4 — UX Integration — **Selesai sebagian (Tested)** → *lanjutan v0.6.1*

| Item | Status |
|---|---|
| Chat → Misi (satu arah, untuk alur analisis data) | Implemented + Tested |
| Misi: status, kriteria, langkah, artefak, log eksekusi | Implemented + Tested (sebelum v0.6.0) |
| Panel bukti kapabilitas di detail misi | Implemented + Tested |
| **Timeline eksekusi hidup** (Pusat Eksekusi) | **Implemented + Tested (v0.6.1)** — polling state server, stempel waktu & durasi nyata, pembatalan, tanpa persentase karangan |
| **Pusat "butuh perhatian"** (Pusat Eksekusi) | **Implemented + Tested (v0.6.1)** — approval tertunda, gagal yang bisa diulang, perlu tinjauan manusia, integrasi belum terkonfigurasi; semua dari state server |
| Needs-attention center lintas halaman | Implemented di Pusat Eksekusi (bukan sidebar) |
| Dashboard analitik usage/biaya | **Planned** — gateway sudah mencatat routing, belum ada UI agregasi |
| Notifikasi/pengingat event untuk menugaskan | **Planned** — butuh mekanisme event server (belum ada SSE) |

## TAHAP 5 — Memory & Skills — **Selesai sebagian (sebagian implisit, v0.5.0)**

- Memory: catatan eksplisit pengguna (aktif → masuk system prompt). Memori otomatis/persistent lintas misi: **tidak ada**.
- Knowledge: BM25 leksikal dengan sitasi sumber (halaman/slide/sheet) — **bukan** embedding semantik (dilyshakan).
- Skills: kustom bersifat instruksi saja (maks 5 aktif), tanpa eksekusi; registry memuat status reference-only untuk WorkBuddy/Hermes/OpenClaw.

## TAHAP 6 — Connectors & Automation — **Sebagian (Tested) / sebagian Blocked**

- Webhook connector, plugin lokal, MCP stdio (server + tool nyata), CLI: nyata dan diuji.
- Blocked: MCP HTTP/remote, OAuth provider nyata (butuh aplikasi terdaftar), browser automation, terminal eksekusi umum (allowlist), sandbox plugin, enkripsi kredensial at-rest.

## TAHAP 7 — Advanced Workflows — **Planned**

- Scheduler persisten (timezone, anti-duplikat, policy) — belum ada; `setInterval` frontend **tidak** dipakai sebagai scheduler produksi.
- Multi-agent / agent factory — belum ada; sengaja ditunda sampai runtime & verifikasi stabil.
- Biaya & kontrol sumber daya per misi — belum ada.

---

## Definition of Done untuk rilis 0.6.0

1. Seluruh item "Selesai (Tested)" di atas tetap lulus (`npm run verify`) — **TERPENUHI**: 229 tes/19 file, exit 0.
2. Timeline eksekusi live + pusat needs-attention selesai (Tahap 4) — **BELUM** (ditunda ke rilis berikutnya).
3. Uji provider AI nyata (chat/vision/STT) dengan kunci asli — **Blocked** (butuh kredensial pengguna).
4. Build Windows + smoke diulang pada biner versi 0.6.0 — **TERPENUHI**: installer (dipasang senyap → smoke 51/51 → uninstall bersih), portable (smoke 51/51), unpacked (smoke 51/51).
5. Paket Linux/macOS — **TERPENUHI untuk Linux** (direktori aplikasi + tarball portabel, asar terverifikasi, **belum dijalankan di Linux**) dan **TERPENUHI untuk macOS** (konfigurasi build + job CI `macos-14`; artefak harus dibangun di mesin macOS).
6. Laporan A–K diperbarui — lihat `TEST_REPORT.md` dan `CHANGELOG.md`.

Status saat ini: **v0.6.0 rilis dengan cakupan TAHAP 0–4 (sebagian)**. Increment yang sudah masuk: TAHAP 1, TAHAP 2 (+UI), TAHAP 3 (+UI), TAHAP 4 (Chat → Misi, bukti kapabilitas, runner kapabilitas). TAHAP 5–7 masih Planned.
