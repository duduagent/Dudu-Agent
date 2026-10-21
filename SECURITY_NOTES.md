# Catatan Keamanan & Operasional — Dudu AI Agent OS v0.6.3

Dokumen ini menjelaskan **apa yang benar-benar ditegakkan** di kode, batasnya, dan bagaimana operated.
Tidak ada klaim keamanan menyeluruh: yang diuji adalah mekanisme yang tercantum di bawah (dengan tes regresi), bukan threat model lengkap.

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
| `outcome` | hasil | `requested` / `succeeded` / `failed` / `denied` / `cancelled` |
| `correlationId` | benang satu misi | dipakai untuk menyaring seluruh jejak misi |
| `idempotencyKey` | kunci anti-duplikasi | opsional |
| `detail` | rincian aman | **selalu disamarkan** |

Field yang tidak diketahui bernilai `null` — **tidak dikarang**.

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
- **Best-effort untuk event informatif** (mis. `artifact.created`, `mission.completed`): kegagalan tidak
  menggagalkan operasi, tetapi status store tetap merupakan sumber kebenaran.
- **Anti-duplikasi**: `idempotencyKey` yang sama dalam jendela 60 detik tidak ditulis dua kali. Percobaan
  (retry) memakai `execId` berbeda → history attempt dapat dibedakan, bukan event kembar.
- **Redaksi**: kunci `secret|token|password|api_key|authorization|cookie|credential` → `[REDACTED]`;
  string `Bearer …` dan `sk-…` disamarkan; kedalaman & panjang dibatasi. Isi file pengguna **tidak pernah**
  ditulis penuh — hanya ringkasan (nama, ukuran, SHA-256, MIME).

### 1.4 Membaca jejak

```
GET /api/capability-registry/audit?limit=200&missionId=<id>&eventType=<type>&correlationId=<id>
```

### 1.5 Yang TIDAK dijamin

- Audit bukan sumber kebenaran status misi — **mission store** yang menentukan state. Kegagalan audit pada
  event informatif tidak mengubah state.
- Jejak audit tidak pernah dihapus/rotasi otomatis; retensi belum diatur.
- Tidak ada tanda tangan kriptografis pada event → jejak bisa disunting oleh siapa pun yang bisa menulis ke
  folder data (game lokal, perlindungan terhadap manipulasi belum ada).

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
| Retry | maksimum 1× dan hanya untuk `tool_error` lokal (idempoten); operasi eksternal tidak diulang otomatis |
| Error classification | `input_invalid`/`parse_error` → failed · `verification_failed` → needs_attention · `tool_error` → needs_attention (retryable) · `audit_unavailable` → needs_attention |
| Anti-CSRF | semua request non-GET wajib `X-Dudu-Client` (403) |
| Path | ID UUID tervalidasi; nama berkas tidak pernah jadi path disk; artefak hanya lewat allowlist |
| Proses | MCP di-spawn tanpa shell + timeout + kill |
| Rahasia | server-side saja; UI hanya sufiks 4 karakter; `providers.json` mode 0600 |
| Jejak audit | append-only, 0600, di `%APPDATA%\Dudu AI\data\capability-audit.jsonl` (Windows) / `~/.config/Dudu AI/data/…` |

## 5. Pemeriksaan otomatis

| Pemeriksaan | Perintah | Cakupan |
|---|---|---|
| Type-check + tes + build | `npm run verify` | 269 tes / 24 file |
| Audit UI | `npm run verify:ui` | responsif 16 rute × 6 lebar + kontras ter-render |
| Uji provider | `npm run smoke:provider` | jalur error (mock lokal) + status live (unverified bila tanpa kunci) |
| Smoke biner | `node scripts/smoke-desktop.mjs <biner>` | 51 pemeriksaan pada aplikasi terpaket |
| Upgrade | `node scripts/upgrade-check.cjs <lama> <baru>` | kompatibilitas data & uninstall |

## 6. Batas yang masih terbuka

- Tidak ada penandatanganan event audit (jejak bisa disunting di disk).
- Tidak ada rotasi/retensi jejak audit.
- Izin belum per-peran/per-pengguna; belum ada audit approval (siapa menyetujui apa) di luar event.
- CLI/UI belum menampilkan jejak audit misi (API sudah mendukung filter `missionId`).
- Provider live belum diverifikasi (butuh kunci asli).
- Runtime Linux/macOS belum diverifikasi.
