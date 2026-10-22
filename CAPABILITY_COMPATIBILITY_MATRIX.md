# CAPABILITY COMPATIBILITY MATRIX — Dudu AI v0.5.0

**Tanggal:** 21 Oktober 2026  
**Sumber:** audit dokumentasi resmi + kode Dudu.  
**Aturan:** `compatible` tidak sama dengan `installed`. Semua entri eksternal berstatus **reference-only** dan tidak dijalankan.

---

## 1. Definisi kompatibilitas

| Nilai | Arti | Tindakan Dudu |
|---|---|---|
| `native` | Dudu sudah memiliki kemampuan setara dengan implementasinya sendiri | Tidak perlu impor |
| `adapter_required` | Konsep dapat diadopsi, tetapi format/runtime berbeda | Perlu adapter + review keamanan |
| `unverified` | Dokumentasi belum cukup untuk menyimpulkan format | Riset lanjutan; jangan klaim kompatibel |
| `incompatible` | Bertentangan dengan batas keamanan/arsitektur Dudu | Sengaja tidak diadopsi |

Prioritas: **P1** = berikutnya, **P2** = menengah, **P3** = eksperimental/tidak dijanjikan.

---

## 2. Matriks referensi eksternal (14 entri)

| ID | Kapabilitas eksternal | Dudu saat ini | Kompatibilitas | Prioritas | Risiko | Dapat dijalankan |
|---|---|---|---|---|---|---|
| `workbuddy.skill.marketplace` | Skill Marketplace + pemeriksaan keamanan | Skill kustom instruksi (maks. 5 aktif) | `adapter_required` | P2 | sedang | Tidak |
| `workbuddy.connector.oauth` | Connector OAuth populer | Webhook live; email/GitHub kerangka | `adapter_required` | P1 | tinggi | Tidak |
| `workbuddy.agent.expert-center` | Expert/persona + tim | Belum ada agent template | `adapter_required` | P2 | rendah | Tidak |
| `workbuddy.result.artifacts` | Hasil tugas sebagai artefak | Artefak misi + verifikasi independen | `native` | P3 | rendah | Tidak |
| `hermes.skill.skillmd` | `SKILL.md` agentskills.io | Skill kustom teks | `adapter_required` | P1 | sedang | Tidak |
| `hermes.mcp.stdio_http` | MCP stdio + HTTP/OAuth | Server lokal + probe stdio | `adapter_required` | P1 | tinggi | Tidak |
| `hermes.plugin.catalog` | Plugin catalog berlabel sumber | Plugin lokal manifest sendiri | `unverified` | P3 | tinggi | Tidak |
| `hermes.scheduler.cron` | Cron/tugas terjadwal | Belum ada scheduler | `incompatible` | P2 | sedang | Tidak |
| `openclaw.skill.skillmd` | `SKILL.md` + gating/allowlist | Skill kustom tanpa gating | `adapter_required` | P1 | sedang | Tidak |
| `openclaw.plugin.runtime` | Plugin runtime + marketplace | Plugin lokal opt-in | `incompatible` | P3 | tinggi | Tidak |
| `openclaw.tool.builtin` | Exec/fs/browser/web/messaging | Tool baca lokal + misi | `incompatible` | P3 | tinggi | Tidak |
| `openclaw.channel.gateway` | Gateway channel chat | Chat desktop lokal | `incompatible` | P3 | tinggi | Tidak |
| `openclaw.registry.clawhub` | Registry skill | Belum ada registry | `adapter_required` | P2 | tinggi | Tidak |
| `openclaw.security.policy` | Tool policy + sandbox | Konfirmasi + audit; tanpa sandbox | `adapter_required` | P1 | tinggi | Tidak |

> `native` pada `workbuddy.result.artifacts` berarti Dudu sudah punya padanan fungsional (artefak misi), bukan bahwa kode WorkBuddy dipakai.

---

## 3. Matriks kapabilitas Dudu

### 3.1 Yang benar-benar dieksekusi

| Kapabilitas | Jenis | Izin | Efek samping | Konfirmasi | Status |
|---|---|---|---|---|---|
| `dudu.mcp.tool.kb_search` | MCP tool | `kb:read` | none | Tidak | Implemented, available, tested |
| `dudu.mcp.tool.kb_stats` | MCP tool | `kb:read` | none | Tidak | Implemented, available, tested |
| `dudu.mcp.tool.file_list` | MCP tool | `files:read` | none | Tidak | Implemented, available, tested |
| `dudu.connector.webhook` | Connector | `network:outbound`, `secret:webhook` | network | **Ya** | Implemented; butuh URL + tes |
| `dudu.plugin.<id>` | Plugin | `filesystem:plugin-dir`, `code:local`, `process:in-process` | local_code | **Ya** | Implemented; butuh plugin terpasang + aktif |

### 3.2 Yang tidak dieksekusi langsung

| Kapabilitas | Alasan | Cara memakai |
|---|---|---|
| 12 skill bawaan | Hanya instruksi/penunjuk fitur | Otomatis di system prompt chat |
| Skill kustom | Hanya teks instruksi | Aktifkan (maks. 5), lalu chat |
| 5 tool misi | Dijalankan Mission Execution Engine | Buat + setujui misi |
| Workflow analisis data | Orkestrasi 5 langkah | Misi & Tugas |
| MCP server eksternal | Hanya probe handshake | Uji handshake; tool belum dipanggil |
| Email SMTP, GitHub repo | Scaffold | Konfigurasi saja; tidak ada request keluar |
| 14 referensi eksternal | Dokumentasi | Dibaca; tidak dipasang/dijalankan |

---

## 4. Kesenjangan yang harus ditutup sebelum adopsi

### 4.1 Skill `SKILL.md` (Hermes/OpenClaw) — P1

**Yang sudah cocok:** instruksi teks, kategori, aktivasi eksplisit, batas panjang.

**Belum ada:**
- Parser frontmatter YAML.
- Validasi nama/description.
- Gating env/config/binary.
- Allowlist per agent.
- Pemuatan progresif.
- Resource/skrip pendamping (sengaja tidak dieksekusi).

**Syarat adopsi:** impor sebagai teks setelah ditampilkan ke pengguna; tolak skrip/aset; batas 800 karakter efektif; tidak ada eksekusi otomatis.

### 4.2 MCP HTTP/OAuth (Hermes) — P1

Dudu baru melakukan handshake stdio dan belum memanggil tool server eksternal. Adopsi HTTP membutuhkan:
- Klien HTTP JSON-RPC dengan timeout.
- Manajemen OAuth (authorization code + refresh) server-side.
- Allowlist tool dan redaksi argumen.
- Audit setiap pemanggilan.

### 4.3 Connector OAuth (WorkBuddy) — P1

Belum ada alur OAuth pihak ketiga. Adopsi read-only membutuhkan:
- Aplikasi OAuth terdaftar per pengguna (BYO).
- Penyimpanan token terenkripsi server-side.
- Scope minimal, refresh token, revokasi.
- Uji live dengan akun nyata (belum dilakukan).

### 4.4 Plugin/sandbox (OpenClaw, Hermes) — P3

Plugin Dudu saat ini berjalan **in-process** dengan izin penuh. Sebelum marketplace/plugin eksternal:
- Tanda tangan manifest + checksum.
- Sandbox proses/container.
- Izin deklaratif per plugin.
- Review kode dan tombol persetujuan eksplisit.
- Batas waktu dan memori.

### 4.5 Scheduler/channel (Hermes/OpenClaw/WorkBuddy) — P2/P3

Sengaja ditunda: membutuhkan antrean persisten, idempotensi, kebijakan retry, dan kontrol pengguna. Tidak boleh berjalan diam-diam.

---

## 5. Bukti

- Registry: `server/capability-registry.mjs` (`EXTERNAL_REFERENCES`).
- Tes: `tests/capability-registry.test.mjs` (ID unik, referensi tidak runnable, kompatibilitas).
- UI: `src/components/pages/CapabilityCatalog.tsx` menampilkan badge kompatibilitas + dokumentasi.
- Audit dokumentasi: 21 Oktober 2026.

---

## 6. Kesimpulan

Tidak ada satu pun kapabilitas eksternal yang **dipasang, dijalankan, atau diklaim kompatibel secara biner**. Yang diadopsi adalah pola arsitektur dan UI. Tiga kapabilitas Dudu yang dapat dieksekusi langsung adalah tiga MCP tool lokal; webhook dan plugin menjadi runnable hanya setelah dikonfigurasi/dipasang oleh pengguna.
