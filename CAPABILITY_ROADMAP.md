# CAPABILITY ROADMAP — Dudu AI

**Versi saat ini:** 0.5.0 (21 Oktober 2026)  
**Prinsip:** setiap item hanya boleh naik status bila ada bukti nyata (kode + tes + probe/audit). Tidak ada tanggal yang dijanjikan tanpa kapasitas uji.

---

## 1. P0 — Selesai di v0.5.0

| Item | Bukti | Status |
|---|---|---|
| Unified Capability Registry | `server/capability-registry.mjs`, `/api/capability-registry` | Implemented, tested |
| Agregasi store nyata (skill/plugin/connector/MCP/misi) | 24 entri Dudu dari store asli | Implemented, tested |
| Referensi eksternal WorkBuddy/Hermes/OpenClaw | 14 entri + dokumentasi resmi | Reference-only |
| Validasi nyata per jenis | manifest, URL, MCP call, stdio probe | Implemented, tested |
| Permission gate + konfirmasi | `confirm:true`, 409 untuk efek samping | Implemented, tested |
| Audit tanpa rahasia | `capability-audit.jsonl` | Implemented, tested |
| Persistensi status | `capability-state.json` | Implemented, tested |
| Bukti kapabilitas di misi | `attachEvidence`, `/evidence/:name` | Implemented, tested |
| UI katalog terpadu | `CapabilityCatalog.tsx` | Implemented, tested |
| Perbaikan tata letak Connector/Plugin/MCP/CLI | kartu + form + code block | Implemented |
| Perbaikan kartu provider Settings | `.provider-card` full-width actions | Implemented |
| 5 dokumen kapabilitas | file ini + 4 lainnya | Selesai |

---

## 2. P1 — Berikutnya (adapter aman)

### 2.1 Impor skill `SKILL.md` sebagai teks — P1

**Tujuan:** membaca frontmatter + isi `SKILL.md` dari file yang dipilih pengguna, menampilkan pratinjau, lalu menyimpannya sebagai skill kustom bila disetujui.

**Cakupan:**
- Parser YAML frontmatter minimal (`name`, `description`, `category`).
- Validasi panjang (≤4000 karakter tersimpan; ≤800 efektif saat aktif).
- Deteksi dan **tolak** referensi skrip/aset; hanya teks yang diimpor.
- Pratinjau + konfirmasi eksplisit sebelum menyimpan.
- Tidak ada eksekusi kode.

**Kriteria terima:**
- Skill eksternal yang diimpor muncul sebagai skill kustom Dudu.
- Tidak ada file/script yang ditulis ke disk selain instruksi teks.
- Tes: frontmatter valid, YAML rusak, instruksi terlalu panjang, percobaan path traversal.

**Status:** belum diimplementasikan.

### 2.2 Klien MCP HTTP read-only — P1

**Cakupan:**
- Transport HTTP JSON-RPC.
- Timeout, batas ukuran respons, allowlist domain.
- Tanpa OAuth pada tahap pertama.
- Tool call hanya untuk tool yang diizinkan pengguna per server.
- Audit argumen ter-redact.

**Kriteria terima:**
- Handshake HTTP nyata ke server uji lokal.
- Kegagalan jaringan/timeout dilaporkan `ok:false`.
- Tidak ada tool call otomatis.

**Status:** belum diimplementasikan. Stdio probe sudah ada.

### 2.3 Connector OAuth read-only (BYO) — P1

**Cakupan:**
- Satu provider per iterasi (mis. GitHub read-only).
- OAuth authorization code + PKCE; client secret server-side.
- Scope minimal; token refresh; revokasi.
- Uji live dengan akun nyata sebelum status `Connected`.

**Kriteria terima:**
- Tidak ada token di DOM.
- `Connected` hanya setelah request API nyata berhasil.
- Kegagalan OAuth tidak pernah ditampilkan sebagai sukses.

**Status:** belum diimplementasikan. Connector OAuth WorkBuddy tetap referensi.

### 2.4 Gating/allowlist skill — P1

**Cakupan:**
- `requiresEnv`, `requiresConfig`, `requiresBinary` (deklaratif).
- Skill tidak aktif bila prasyarat tidak terpenuhi; alasan ditampilkan.
- Allowlist per konteks (chat/misi).

**Status:** belum diimplementasikan. Saat ini hanya batas jumlah aktif + panjang instruksi.

---

## 3. P2 — Menengah

| Item | Alasan | Risiko | Prasyarat |
|---|---|---|---|
| Registry skill lokal + checksum | Distribusi tanpa marketplace | supply chain | tanda tangan/verifikasi |
| Katalog plugin berlabel sumber | Meniru pola Hermes | tinggi | sandbox + review manual |
| Scheduler tugas terjadwal | Otomasi | sedang | antrean persisten + idempotensi |
| Audit rotasi/retensi | Operasional jangka panjang | rendah | kebijakan ukuran |
| Enkripsi kredensial at rest | Perlindungan tambahan | rendah | DPAPI/Keychain/libsecret |
| Rate limit eksekusi | Mencegah penyalahgunaan | rendah | middleware |
| Allowlist domain webhook | SSRF terbatas | sedang | parser URL + resolusi DNS |

---

## 4. P3 — Eksperimental / kemungkinan tidak diadopsi

| Item | Keputusan awal |
|---|---|
| Plugin runtime OpenClaw | **Tidak diadopsi** — arsitektur dan risiko berbeda |
| Built-in exec/browser | **Tidak diadopsi** — melanggar batas keamanan Dudu |
| Gateway channel messaging | **Tidak diadopsi** — bukan produk yang sama |
| ClawHub otomatis | **Tidak diadopsi** tanpa verifikasi tanda tangan |
| Marketplace WorkBuddy | **Tidak diadopsi** — proprietary + tidak ada API publik |
| Agent LLM otonom | Ditunda; perencana misi tetap deterministik |
| Sandbox penuh | Dipertimbangkan bila plugin eksternal dibuka |

---

## 5. Non-goals (tegas)

- Menjadi pengganti WorkBuddy/Hermes/OpenClaw.
- Menjalankan installer/kode eksternal secara otomatis.
- Mengklaim kompatibilitas biner tanpa uji.
- Menambah menu top-level baru yang berlebihan.
- Mengubah kontrak `/api/chat` legacy.
- Membuat execution engine kedua.

---

## 6. Rencana verifikasi setiap rilis

1. `npm run typecheck`.
2. `npm test` — seluruh suite; target saat ini 223 tes.
3. `npm run build`.
4. Uji manual UI: Tools, Skill, Connector, Plugin, MCP, Settings.
5. Uji live terpisah (tidak masuk CI tanpa kredensial): provider AI, OAuth, webhook nyata.
6. Perbarui `CAPABILITY_INVENTORY.md` bila jumlah/status berubah.
7. Tidak menaikkan status `Connected`/`Operational` tanpa bukti probe/eksekusi.

---

## 7. Definisi “selesai” untuk kapabilitas baru

Sebuah kapabilitas hanya boleh dianggap selesai bila:

- [ ] Ada implementasi server yang dapat dipanggil.
- [ ] Ada status yang diturunkan dari kondisi nyata.
- [ ] Ada izin + efek samping + tingkat risiko yang dideklarasikan.
- [ ] Ada konfirmasi bila berefek samping.
- [ ] Ada audit + redaksi rahasia.
- [ ] Ada tes sukses **dan** tes gagal.
- [ ] UI menampilkan status tanpa menaikkannya.
- [ ] Dokumentasi menyebut batasan uji live.
