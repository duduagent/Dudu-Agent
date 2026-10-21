# CAPABILITY INVENTORY — Dudu AI Workforce & Agent OS

**Versi:** 0.5.0  
**Tanggal audit:** 21 Oktober 2026  
**Cakupan:** Dudu AI (kode aplikasi), WorkBuddy, Hermes Agent, OpenClaw.  
**Sifat dokumen:** inventaris berbasis kode dan dokumentasi resmi. Bukan klaim pemasangan atau uji live.

---

## 1. Arti status (dipakai konsisten di seluruh aplikasi)

| Status | Arti | Bukti yang diperlukan |
|---|---|---|
| **Implemented** | Kode benar-benar ada dan dijalankan oleh Dudu | Modul + route + tes |
| **Configured** | Konfigurasi wajib sudah tersimpan | File/store konfigurasi, field terisi |
| **Connected** | Koneksi keluar benar-benar berhasil | Hasil tes jaringan/ handshake terakhir |
| **Operational** | Bisa dipakai untuk tugas nyata | Implemented + Configured + Connected |
| **Tested** | Diuji dan hasilnya dicatat | Tes otomatis atau audit eksekusi |
| **Scaffold** | Hanya kerangka konfigurasi/form | Tidak ada adapter eksekusi |
| **Not implemented** | Belum ada kode | Tidak ada route/adapter |
| **Incompatible** | Sengaja tidak diadopsi | Alasan keamanan/arsitektur |
| **Unverified** | Belum cukup bukti | Tidak ada probe/tes |
| **Unavailable** | Tidak bisa dipakai saat ini | Error/konfigurasi hilang |
| **Reference-only** | Hanya dokumentasi eksternal | URL resmi + fakta audit |

Status di UI berasal dari server (`/api/capability-registry`), bukan teks statis di frontend.

---

## 2. Hasil audit Dudu (kode sendiri)

### 2.1 Modul yang diaudit

| Modul | Isi nyata | Bukti |
|---|---|---|
| `server/missions.mjs` | Mission Execution Engine 5 langkah: validasi input → muat data → profil → tulis laporan → verifikasi independen. Kriteria penerimaan dihitung ulang dari data mentah. | `tests/missions.test.mjs`, `tests/pages.test.tsx` |
| `server/skills.mjs` | 12 skill bawaan + skill kustom instruksi. Maks. 5 aktif, instruksi efektif ≤800 karakter, penyimpanan ≤4000 karakter. | `tests/api.test.mjs`, `tests/pages.test.tsx` |
| `server/plugins.mjs` | Plugin lokal:`plugins/<id>/manifest.json` + entry `.mjs`; opt-in; error apa adanya. | `tests/integrations.test.mjs` |
| `server/connectors.mjs` | 3 connector: webhook live; email SMTP dan GitHub repo hanya kerangka. Secret dimask. | `tests/integrations.test.mjs`, `tests/capability-registry.test.mjs` |
| `server/mcp.mjs` | Server MCP lokal JSON-RPC 2.0 + klien stdio untuk handshake `initialize → tools/list` dengan timeout. | `tests/integrations.test.mjs` |
| `server/gateway.mjs`, `routing.mjs`, `providers.mjs` | Gateway multi-provider, routing hemat, kredensial server-side, katalog model. | `tests/gateway.test.mjs` (27 tes) |
| `server/api.mjs` | Router tunggal; `/api/chat` legacy dipertahankan; registry baru bersifat aditif. | `tests/api.test.mjs`, `tests/chat-api.test.mjs` |

### 2.2 Inventaris kapabilitas Dudu (instalasi bersih)

Angka diambil langsung dari registry pada 21 Oktober 2026:

| Kategori | Jumlah | Keterangan |
|---|---:|---|
| Skill | 16 | 12 bawaan + 4 referensi eksternal |
| Tool internal | 6 | 5 langkah misi + 1 referensi eksternal |
| Workflow | 2 | 1 misi analisis data + 1 referensi eksternal |
| MCP tool | 3 | `kb_search`, `kb_stats`, `file_list` |
| Connector | 4 | 3 Dudu + 1 referensi |
| Plugin | 2 | 2 referensi (belum ada plugin lokal terpasang) |
| MCP server | 1 | 1 referensi |
| Lainnya | 4 | agent, scheduler, channel, security (semua referensi) |
| **Total** | **38** | 24 Dudu + 14 referensi eksternal |

Ringkasan status:

| Dimensi | Sebaran |
|---|---|
| Implementasi | 22 implemented, 2 scaffold, 14 reference-only |
| Ketersediaan | 19 available, 3 needs_configuration, 2 unavailable, 14 unverified |
| Runnable langsung | **3** (tiga MCP tool lokal) |
| Referensi eksternal | **14** |

> `webhook` menjadi runnable **hanya setelah URL diisi**. Plugin lokal menjadi runnable **hanya setelah dipasang dan diaktifkan**. Angka 3 adalah kondisi instalasi bersih, bukan klaim bahwa seluruh kapabilitas bisa dieksekusi.

### 2.3 Yang sengaja TIDAK ada

- Shell/eksekusi perintah bebas.
- Browser otomatis atau scraping.
- Marketplace plugin/skill online dengan instalasi otomatis.
- Scheduler/cron persisten.
- Channel messaging (WhatsApp/Telegram/Discord).
- OAuth connector pihak ketiga.
- Sandbox proses untuk plugin.
- Embedding semantik, OCR, video, kamera/mikrofon.
- Agent LLM otonom; perencana misi tetap deterministik.

Semua ketiadaan ini ditampilkan di UI sebagai “belum tersedia”, bukan disembunyikan.

---

## 3. Hasil audit proyek eksternal

### 3.1 WorkBuddy (Tencent)

| Aspek | Temuan |
|---|---|
| Lisensi | Proprietary; kode sumber tidak tersedia publik. |
| Kekuatan | Skill Marketplace dengan pemeriksaan keamanan, Connector OAuth (GitHub/GitLab/Jira/Confluence/Drive/Gmail/Notion/Slack), Expert Center (persona/tim), hasil tugas sebagai artefak. |
| Yang diadopsi | Pola UI katalog: hero, kategori, pencarian, kartu expert/skill, filter sumber. |
| Yang TIDAK diadopsi | Kode, aset, merek, installer, marketplace, connector OAuth. |
| Status di Dudu | `reference_only` untuk 4 entri; tidak ada impor. |

Dokumentasi: `https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market` (dan halaman Connector, Expert-Center, Results).

### 3.2 Hermes Agent (Nous Research)

| Aspek | Temuan |
|---|---|
| Lisensi | MIT. |
| Kekuatan | Skills `SKILL.md` (standar agentskills.io, pemuatan progresif), MCP stdio + HTTP/OAuth, Plugin Catalog dengan label Official/Verified/Community, cron/subagents. |
| Yang diadopsi | Konsep instruksi teks yang dapat diperiksa; pemetaan MCP; ide katalog plugin berlabel sumber. |
| Yang TIDAK diadopsi | Runtime plugin, format manifest, scheduler, kode apa pun. |
| Status di Dudu | `reference_only` untuk 4 entri. |

Dokumentasi: `https://hermes-agent.nousresearch.com/docs/user-guide/features/skills`, `.../mcp`, `.../plugins`. Repo: `https://github.com/NousResearch/hermes-agent` (MIT).

### 3.3 OpenClaw

| Aspek | Temuan |
|---|---|
| Lisensi | MIT. |
| Kekuatan | Skills `SKILL.md` + frontmatter YAML, gating env/config/binary, allowlist agent, ClawHub, plugin runtime, built-in tools, gateway channel, dokumentasi sandbox. |
| Yang diadopsi | Gagasan gating/allowlist dan pemisahan tool vs skill vs plugin; inspirasi kebijakan keamanan. |
| Yang TIDAK diadopsi | Exec/browser, gateway channel, plugin runtime, ClawHub, sandbox (belum ada). |
| Status di Dudu | `reference_only` untuk 6 entri; 3 di antaranya `incompatible` secara sengaja. |

Dokumentasi: `https://docs.openclaw.ai/tools/skills`, `/tools/creating-skills`, `/plugins`, `/tools`, `/gateway/security`, `/gateway/sandboxing`. Repo: `https://github.com/openclaw/openclaw` (MIT).

---

## 4. Pemetaan kapabilitas lintas proyek

| Kapabilitas | Dudu | WorkBuddy | Hermes | OpenClaw |
|---|---|---|---|---|
| Instruksi skill | Skill kustom (teks) | Skill Marketplace | `SKILL.md` | `SKILL.md` + gating |
| Tool lokal | Misi + MCP | Tool internal | Tools/toolsets | Built-in tools |
| Plugin | Manifest lokal | Tidak dipublikasikan | Plugin catalog | Plugin runtime |
| MCP | Server lokal + probe stdio | Tidak dipublikasikan | stdio + HTTP/OAuth | Terdokumentasi |
| Connector | Webhook live; 2 kerangka | OAuth connectors | Integrasi via plugin/MCP | Channel gateway |
| Agent/persona | Belum ada | Expert Center | Subagents | Agent harness |
| Penjadwalan | Belum ada | Task automation | Cron | Cron/heartbeat |
| Artefak | Artefak misi + verifikasi | Hasil tugas | Ada | Ada |
| Marketplace | Belum ada | Ya | Plugin catalog | ClawHub |

Detail kompatibilitas dan prioritas ada di [CAPABILITY_COMPATIBILITY_MATRIX.md](CAPABILITY_COMPATIBILITY_MATRIX.md).

---

## 5. Bukti pengujian

- `tests/capability-registry.test.mjs` — 12 tes: agregasi, ID unik, filter, validasi nyata, referensi eksternal, konfirmasi, eksekusi plugin/webhook/MCP, redaksi audit, persistensi, bukti misi.
- `tests/capability-ui.test.tsx` — 3 tes: katalog di Tools, filter sumber + detail dokumentasi, katalog referensi di Skill/Connector/Plugin.
- Total suite: **223 tes / 19 file, semuanya lulus** (21 Oktober 2026).
- `npm run verify`: typecheck + tes + build produksi.
- Smoke test biner Windows terpaket: **51/51 lulus** (21 Oktober 2026), termasuk pemulihan data setelah buka ulang, unggah DOCX/PDF asli, Knowledge Base, misi 5 langkah, unduhan artefak, responsif 800/390 px, dan isolasi profil melalui `DUDU_USER_DATA`.

---

## 6. Batasan audit

1. **Tidak ada uji live provider AI/OAuth** karena tidak ada kunci API atau aplikasi OAuth terdaftar dalam proses rilis ini. Statusnya `IMPLEMENTED_NOT_LIVE_TESTED`.
2. **WorkBuddy proprietary**: tidak ada kode sumber; seluruh klaim berasal dari dokumentasi publik.
3. **Hermes/OpenClaw**: yang diverifikasi adalah dokumentasi publik, bukan instalasi runtime mereka.
4. **Registry bukan marketplace**: tidak mengunduh, memasang, atau menandatangani paket eksternal.
5. Audit dokumentasi eksternal dibekukan pada `2026-10-21`; dokumentasi pihak ketiga dapat berubah.
