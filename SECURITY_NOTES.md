# Catatan Keamanan & Operasional — Dudu AI Agent OS v0.6.4

Dokumen ini menjelaskan **apa yang benar-benar ditegakkan** di kode, batasnya, dan bagaimana operated.
Tidak ada klaim keamanan menyeluruh: yang diuji adalah mekanisme yang tercantum di bawah (dengan tes regresi), bukan threat model lengkap.

> **v0.6.4** menambah: jejak audit dapat dilihat di UI, integritas jejak (rantai hash + rotasi), redaksi
> dua arah, dan kontrak API audit yang ber halaman. Ringkasan perubahan: [CHANGELOG.md](CHANGELOG.md) §0.6.4.

## 0. Ringkasan perubahan v0.6.4 (apa yang berubah & apa yang TIDAK)

| Area | Sebelum (0.6.3) | Sekarang (0.6.4) |
|---|---|---|
| Jejak audit | hanya bisa dibaca lewat `GET /api/capability-registry/audit` (tanpa filter hasil/waktu, tanpa halaman) | **UI jejak audit** (Misi & Tugas + Pusat Eksekusi), filter misi/jenis/hasil/waktu, halaman 25 event + "Muat lebih banyak" |
| Redaksi | saat menulis saja; field `error` ditulis mentah; event legacy dibaca apa adanya | **dua arah**: saat menulis (args/error/detail) **dan** saat membaca (termasuk event legacy) |
| Integritas | tidak ada | **rantai hash** (`prevHash`/`hash`) + verifikasi + **rotasi** berbasis ukuran |
| Approval | dicatat **setelah** permission diberikan | dicatat **sebelum** permission diberikan → bila audit gagal, **permission tidak diberikan** |
| Writer audit | dua instance (misi + registry) bisa menulis ke berkas yang sama | **satu instance** dipakai bersama (rantai hash butuh writer tunggal) |
| Idempotensi | kunci ditandai "terpakai" **sebelum** penulisan → event bisa hilang diam-diam | ditandai **setelah** penulisan berhasil |
| Packaging | verifikasi manual | `npm run verify:release` (ASAR) + `npm run audit:prod` (dependensi produksi), keduanya di CI |
| Permission | 8 izin, ditegakkan di batas eksekusi | **tidak berubah** — `process:exec` tetap tidak aktif |

## 1. Unified Execution Audit

### 1.1 Skema event

Satu jejak append-only: `capability-audit.jsonl` (mode 0600, di folder data pengguna). Event misi dan event
kapabilitas sekarang memakai **skema yang sama**; event lama (tanpa `eventType`) tetap terbaca.

| Field | Arti | Aturan |
|---|---|---|
| `eventId` | UUID unik per event | selalu diisi |
| `at` | timestamp ISO 8601 | selalu diisi |
| `ts` | epoch ms | untuk pengurutan |
| `eventType` | `<objek>.<aksi>` | selalu diisi pada event baru |
| `missionId` | misi terkait | `null` bila tidak terkait |
| `taskId` | id langkah (s1…s5) | `null` bila tidak terkait |
| `execId` | id eksekusi percobaan | membedakan attempt |
| `capabilityId` | kapabilitas yang dipakai | `null` bila tidak terkait |
| `actor` | siapa/komponen | `user` / `system` / alamat email sesi / `local` |
| `outcome` | hasil | `requested` / `succeeded` / `failed` / `denied` / `cancelled` / `rejected` / `unverified` |
| `correlationId` | benang satu misi | dipakai untuk menyaring seluruh jejak misi |
| `idempotencyKey` | kunci anti-duplikasi | opsional |
| `prevHash` / `hash` | rantai integritas (v0.6.4) | diisi pada event baru; `null` pada event legacy |
| `legacy` | penanda event lama (v0.6.4) | `true` bila event tidak punya `eventType` |
| `detail` | rincian aman | **selalu disamarkan** |

Field yang tidak diketahui bernilai `null` — **tidak dikarang**. Menambah `null` berarti "tidak tercatat", bukan menebak.

### 1.2 Jenis event

`mission.created` · `mission.approval_requested` · `mission.approved` · `mission.rejected` ·
`mission.started` · `mission.cancel_requested` · `mission.cancelled` · `task.started` ·
`tool.execution_started` · `tool.execution_succeeded` · `tool.execution_failed` · `tool.retry_scheduled` ·
`artifact.created` · `verification.passed` · `verification.failed` · `mission.completed` ·
`mission.failed` · `mission.needs_attention` · `capability.validated` · `permission.denied` · `approval.expired`

### 1.3 Aturan pencatatan

- **Fail-closed untuk kontrol keamanan**: `mission.approved`, `mission.started`, `tool.execution_started`,
  dan `tool.execution_started` (kapabilitas) ditulis dengan `appendCritical()`. Bila penulisan gagal,
  tindakan berisiko **tidak dijalankan** dan API menjawab `500 audit_unavailable`.
  **v0.6.4**: pada v0.6.3 approval misi dicatat *setelah* permission diberikan; kini event approval ditulis
  **lebih dulu** — bila audit gagal, permission **tidak diberikan sama sekali** (fail-closed, bukan
  "disetujui tapi tak tercatat").
- **Best-effort untuk event informatif** (mis. `artifact.created`, `mission.completed`): kegagalan tidak
  menggagalkan operasi, tetapi status store tetap merupakan sumber kebenaran.
- **Anti-duplikasi**: `idempotencyKey` yang sama dalam jendela 60 detik tidak ditulis dua kali. Percobaan
  (retry) memakai `execId` berbeda → history attempt dapat dibedakan, bukan event kembar.
  **v0.6.4**: kunci baru ditandai "terpakai" **setelah** penulisan berhasil — pada 0.6.3 penulisan yang gagal
  tetap menandai kunci sehingga percobaan berikutnya dalam 60 detik bisa membuat event hilang diam-diam.
- **Redaksi (dua arah)**: kunci `secret|token|password|api_key|authorization|cookie|credential` → `[REDACTED]`;
  string `Bearer …` dan `sk-…` disamarkan; kedalaman & panjang dibatasi. Isi file pengguna **tidak pernah**
  ditulis penuh — hanya ringkasan (nama, ukuran, SHA-256, MIME).
  **v0.6.4**: field `error` yang sebelumnya ditulis mentah kini diredaksi, dan **semua event yang dibaca
  disanitasi lagi** (termasuk event legacy yang ditulis sebelum aturan ini ada) — pertahanan lapis kedua.

### 1.4 Integritas jejak (v0.6.4)

- **Rantai hash**: tiap event memuat `prevHash` (hash event sebelumnya) dan `hash` sendiri:
  `hash = sha256(prevHash + "\n" + canonicalJson(event tanpa field hash))`. Verifikasi
  (`GET /api/audit/integrity`) menelusuri berkas dan melaporkan `ok` / `brokenAt` / `reason`.
- **Deteksi, bukan prevention**: rantai ini **mendeteksi** perubahan isi event yang sudah tertulis.
  Ia **tidak mencegah** penyerang yang dapat menulis ulang **seluruh** berkas — rantai baru yang sah bisa
  dibangun. Tidak ada tanda tangan dan tidak ada pengelolaan kunci, jadi jejak **tidak boleh diklaim tamper-proof**.
- **Rotasi**: saat berkas aktif melewati 8 MiB, isinya digeser ke `capability-audit.1.jsonl` … `.3.jsonl`
  (3 generasi arsip; yang lebih lama dihapus). Rotasi **memulai rantai baru** (berkas lama tetap utuh
  sebagai arsip). Ukuran dan jumlah generasi dapat dikonfigurasi.
- **Disk penuh**: `appendFile` gagal → `append()` melaporkan `{ ok: false }` (event informatif boleh hilang,
  status store tetap benar) dan `appendCritical()` melempar `AuditError` → **tindakan berisiko dibatalkan**.
- **Writer tunggal**: rantai hash menuntut satu penulis per berkas. `createApi()` kini membuat **satu**
  instance audit yang dipakai bersama oleh misi dan registry (pada 0.6.3 keduanya membuat instance sendiri).

### 1.5 Membaca jejak (kontrak API v0.6.4)

```
GET /api/capability-registry/audit?limit=50&offset=0&missionId=&eventType=&outcome=&actor=&correlationId=&since=&until=
GET /api/missions/:id/audit?limit=50&offset=0&eventType=&outcome=&since=&until=
GET /api/audit/integrity
```

- **`limit`** (1–500, default 50) · **`offset`** (0–5000) → halaman; `hasMore` menandai masih ada halaman lain.
- **Urutan**: **terbaru lebih dulu**.
- **Respons**: `{ events, count, total, limit, offset, hasMore, file }`; `count` = `total` = jumlah event
  yang cocok dengan filter (bukan jumlah per halaman).
- **Filter**: `missionId`, `eventType`, `outcome`, `actor`, `correlationId`, `since`/`until` (epoch ms).
- **Tidak ada endpoint mutasi jejak** — jejak hanya bisa dibaca, bukan ditulis dari luar.
- `GET /api/missions/:id/audit` **tidak** memfilter `correlationId` secara default: event yang tidak membawa
  korelasi (mis. event capability lama) tetap milik misi tersebut dan harus terlihat.

### 1.6 Jejak audit di UI (v0.6.4)

Tersedia di **Misi & Tugas → detail misi** (jejak misi tersebut) dan **Pusat Eksekusi** (jejak global dengan
filter misi). Yang ditampilkan: waktu, jenis tindakan, aktor/komponen, hasil, referensi langkah/eksekusi/
kapabilitas/korelasi, dan ringkasan detail. Hasil `denied` / `failed` / `succeeded` / `unverified` memakai
badge berbeda. Indikator integritas rantai ditampilkan apa adanya ("Rantai hash utuh" / "TERPUTUS di baris N").

Aturan tampilan (tegak):
- Data diambil dari **API server** — frontend tidak pernah membaca berkas audit langsung.
- `detail` **tidak** ditampilkan mentah: hanya kunci dari **daftar putih**, nilai dipotong; `args`,
  `result`, dan `output` **tidak pernah** dirender.
- Aktor ditampilkan apa adanya: `system` → "sistem", `local` → "lokal (tanpa sesi)". Tidak diklaim sebagai
  identitas manusia.
- Event lama diberi label "sebelum v0.6.3" dan tidak dipalsukan menjadi event baru.
- Tidak ada event/status karangan: UI hanya menampilkan apa yang tercatat server.

### 1.7 Yang TIDAK dijamin

- Audit bukan sumber kebenaran status misi — **mission store** yang menentukan state. Kegagalan audit pada
  event informatif tidak mengubah state.
- Rantai hash **tidak** mencegah penulisan ulang menyeluruh (lihat §1.4) dan tidak ada tanda tangan.
- Rotasi berarti history jejak yang lama dipindahkan ke arsip (3 generasi) lalu dihapus — retensi terbatas.
- Tidak ada Policies/role per pengguna pada jejak audit; `actor` hanyalah apa yang tercatat saat menulis.
- `process:exec` tetap nonaktif: tidak ada adapter yang memakainya, jadi tidak ada yang bisa diklaim berlaku.

## 2. Granular Permission Model

Izin didefinisikan dari **operasi nyata** adapter (`server/permissions.mjs`):

| Izin | Arti | Diberikan ketika |
|---|---|---|
| `file:read` | membaca berkas lokal | tool MCP lokal, plugin, workflow |
| `file:write` | menulis berkas lokal | workflow misi |
| `process:exec` | menjalankan proses lokal | (dicadangkan; belum ada adapter yang memakainya) |
| `network:out` | request keluar | connector `live` saja |
| `credential:use` | memakai credential tersimpan | connector dengan secret/token yang **terisi nyata** |
| `side-effect:external` | efek samping pada sistem luar | connector `live` + `confirm: true` |
| `plugin:exec` | menjalankan kode plugin | plugin **aktif** |
| `mcp:exec` | menjalankan tool MCP | tool MCP lokal terdaftar |

**Penegakan ada di batas eksekusi** (`server/capability-registry.mjs` → `enforce()`), bukan hanya di UI.
Izin yang tidak diberikan → `403 permission_denied` + event `permission.denied`, dan **tindakan tidak dijalankan**.

Default aman: `network:out` / `side-effect:external` / `credential:use` **tidak** diberikan hanya karena
kapabilitas ada — perlu konfigurasi nyata (connector live & terisi) **dan** konfirmasi eksplisit.

> Batasan jujur: model ini belum membedakan "izin untuk alat tertentu" per pengguna/rol, dan belum
> memakai capability-based (OS) — hanya allowlist berbasis operasi di level aplikasi.

## 3. Approval terikat tindakan

Dua lapis:

1. **Approval rencana misi** — `m.approval.scope = { kind: 'mission-plan', digest }`, digest = SHA-256 dari
   {template, fileId, langkah+alat}. Bila rencana berubah material → `409 approval_scope_mismatch`.
2. **Approval tindakan** — untuk menjalankan kapabilitas di dalam misi. Record approval memuat
   `capabilityId`, `operation`, `target`, `paramsDigest` (digest parameter), `status`, `expiresAt`.
   - Tanpa approval → `409 approval_required`.
   - Kedaluwarsa → `403 approval_expired`.
   - Parameter berubah material → `409 approval_scope_mismatch`.
   - Dipakai sekali → status `consumed`; tindakan berikutnya butuh approval baru.

Endpoint (semua mutations butuh header `X-Dudu-Client`):

```
POST /api/missions/:id/approvals                      { capabilityId, operation, target, args, ttlMs }
POST /api/missions/:id/approvals/:approvalId           { decision: 'approved' | 'rejected', ttlMs }
GET  /api/missions/:id/approvals
POST /api/missions/:id/capabilities/:capId/run         { args, confirm }
```

Persetujuan umum atas misi **bukan** izin tanpa batas: setiap tindakan di luar rencana memerlukan
persetujuan sendiri.

### Kompatibilitas

- Misi yang dibuat sebelum v0.6.3 tidak punya `scope`, `approvals`, maupun `correlationId` → tetap dapat
  disetujui & dijalankan (approval lama dihormati). Field baru bersifat opsional; format penyimpanan
  tidak diubah, sehingga **tidak ada migrasi** dan data pengguna lama tetap terbaca.
- Bentuk event audit lama (`action`, `outcome`, `capabilityId`, `at`) tetap ditulis agar konsumen lama tidak rusak.

## 4. Operasional

| Topik | Status |
|---|---|
| Fail-closed audit | `mission.approved`/`started`/`tool.execution_started` → `500 audit_unavailable` bila audit gagal |
| Urutan fail-closed approval | event approval ditulis **sebelum** permission diberikan → audit gagal berarti permission tidak diberikan |
| Retry | maksimum 1× dan hanya untuk `tool_error` lokal (idempoten); operasi eksternal tidak diulang otomatis |
| Error classification | `input_invalid`/`parse_error` → failed · `verification_failed` → needs_attention · `tool_error` → needs_attention (retryable) · `audit_unavailable` → needs_attention |
| Anti-CSRF | semua request non-GET wajib `X-Dudu-Client` (403) |
| Path | ID UUID tervalidasi; nama berkas tidak pernah jadi path disk; artefak hanya lewat allowlist |
| Proses | MCP di-spawn tanpa shell + timeout + kill |
| Rahasia | server-side saja; UI hanya sufiks 4 karakter; `providers.json` mode 0600 |
| Jejak audit | append-only, 0600, di `%APPDATA%\Dudu AI\data\capability-audit.jsonl` (Windows) / `~/.config/Dudu AI/data/…`; rotasi 8 MiB + 3 arsip |

## 5. Pemeriksaan otomatis

| Pemeriksaan | Perintah | Cakupan |
|---|---|---|
| Type-check + tes + build | `npm run verify` | 307 tes / 26 file |
| Impor ESM native | `npm run check:imports` | 13 modul server dimuat ESM native Node (menangkap export ganda yang lolos di vitest) |
| Audit dependensi produksi | `npm run audit:prod` | `npm audit --omit=dev` — hanya yang benar-benar ikut paket |
| Validasi artefak rilis | `npm run verify:release` | ASAR: berkas wajib, tanpa tes/src/.env/source-map, hanya dependensi produksi, fitur rilis ada, tanpa kunci API literal |
| Audit UI | `npm run verify:ui` | responsif 16 rute × 6 lebar + kontras ter-render |
| Uji provider | `npm run smoke:provider` | jalur error (mock lokal) + status live (unverified bila tanpa kunci) |
| Smoke biner | `node scripts/smoke-desktop.mjs <biner>` | 51 pemeriksaan pada aplikasi terpaket |
| Upgrade | `node scripts/upgrade-check.cjs <lama> <baru>` | kompatibilitas data & uninstall |

## 6. Batas yang masih terbuka

- Jejak audit **tidak ditandatangani** dan rantai hash **tidak mencegah** penulisan ulang menyeluruh
  (§1.4) — deteksi perubahan, bukan prevention.
- Rotasi membatasi retensi (3 arsip); history yang lebih lama hilang.
- Izin belum per-peran/per-pengguna; belum ada audit approval terpisah (siapa menyetujui apa) di luar event.
- Jejak audit **belum tampil di CLI** (UI sudah).
- Provider live belum diverifikasi (butuh kunci asli).
- Runtime Linux/macOS belum diverifikasi.
- `npm audit` (**termasuk dev dependency**) masih melaporkan **14 kerentanan** di toolchain pengembangan
  (vitest/tinypool/vite/esbuild, electron-builder → sprintf-js). Semuanya **tidak ikut ke paket** — asar hanya
  berisi `fflate` + `unpdf` (dependensi produksi, **0 kerentanan**). Perbaikannya menuntut upgrade mayor
  (vitest 2→5, vite 5→8) atau downgrade electron-builder, yang berisiko merusak suite tes yang sudah terverifikasi;
  karena itu **tidak** dilakukan otomatis pada fase ini. Lihat §7.

## 7. Hasil audit dependensi (22 Oktober 2026, nyata)

| Cakupan | Exit | Hasil |
|---|---|---|
| `npm audit --omit=dev` (produksi — ikut paket) | **0** | **0 kerentanan** |
| `npm audit` (prod + dev) | 1 | **14 kerentanan**: 11 moderate, 1 high, 2 critical — seluruhnya di **dev toolchain** |

Rincian yang dilaporkan `npm audit`: `@vitest/mocker` (path traversal/code injection saat mok manual),
`tinypool` (prototype pollution → RCE di environment worker test), `esbuild` (dev server mengizinkan
request lintas situs), `vite`/`vite-node` (bergantung pada esbuild), `sprintf-js` (DoS via presisi tak
terbatas, lewat `roarr` → `global-agent` → `@electron/get` → `electron-builder`).

**Penilaian dampak** (bukan asumsi):
- Tidak satupun paket tersebut berada di `app.asar`. Isi asar terverifikasi: `node_modules/fflate` dan
  `node_modules/unpdf` saja. Jadi pengguna akhir tidak menerima kode tersebut.
- Vektor yang tersisa bagi pengguna lokal: `npm run dev` (Vite dev server) — server dev hanya bind ke loopback.
- Perbaikan otomatis (`npm audit fix --force`) akan memasang vitest 5 / vite 8 / electron-builder 26.5.0 —
  perubahan mayor yang tidak diuji dan berisiko merusak 307 tes yang sudah lulus. Karena itu **tidak**
  dijalankan; `npm run audit:prod` теперь menjaga dependensi produksi tetap bersih di CI.
