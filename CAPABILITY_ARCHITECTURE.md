# CAPABILITY ARCHITECTURE — Dudu AI v0.5.0

**Tujuan:** satu katalog kapabilitas yang membaca store nyata, satu mesin eksekusi misi, dan jalur audit yang tidak mengarang status.

---

## 1. Prinsip arsitektur

1. **Satu sumber kebenaran per domain** — skill dari `skills.mjs`, plugin dari `plugins.mjs`, connector dari `connectors.mjs`, MCP dari `mcp.mjs`, tool misi dari `missions.mjs`. Registry hanya **mengagregasi**, bukan menyalin data.
2. **Tidak ada execution engine kedua** — eksekusi misi tetap di `MissionExecutionEngine` (`server/missions.mjs`). Registry tidak menjalankan langkah misi; ia hanya mengeksekusi kapabilitas mandiri (MCP tool lokal, plugin aktif, webhook).
3. **Status dari bukti** — status dihitung dari file manifest, konfigurasi, hasil probe, hasil validasi, dan audit. Frontend tidak menaikkan status.
4. **Referensi eksternal bukan kapabilitas** — 14 entri WorkBuddy/Hermes/OpenClaw hanya metadata + dokumentasi; `runnable=false`.
5. **Aditif** — semua route dan field baru tidak mengubah kontrak `/api/chat` legacy maupun pipeline misi.

---

## 2. Diagram komponen

```
┌──────────────────────────────────────────────────────────────────┐
│ React UI                                                         │
│  Tools & Integrations → CapabilityCatalog                        │
│  Skill / Connector / Plugin / MCP → katalog referensi             │
│  (filter sumber, status, pencarian, detail, validasi, run)       │
└──────────────────────────────┬───────────────────────────────────┘
                               │ /api/capability-registry...
┌──────────────────────────────▼───────────────────────────────────┐
│ server/api.mjs (router tunggal)                                  │
│  GET  /api/capability-registry          (list + filter + summary)│
│  GET  /api/capability-registry/audit    (append-only JSONL)      │
│  GET  /api/capability-registry/:id      (detail)                 │
│  POST /api/capability-registry/:id/validate                      │
│  POST /api/capability-registry/:id/run                           │
│  POST /api/missions/:id/capabilities/:cap/run                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────┐
│ server/capability-registry.mjs                                   │
│  aggregator + status derivation + validation adapters + runner   │
│  audit: capability-audit.jsonl                                   │
│  state: capability-state.json (validasi/eksekusi terakhir)       │
└───────┬───────────────┬───────────────┬───────────────┬──────────┘
        │               │               │               │
   skills.mjs      plugins.mjs     connectors.mjs     mcp.mjs
   (builtin+custom) (manifest+entry) (webhook/SMTP/repo) (tools+stdio)
        │
   missions.mjs
   MissionExecutionEngine (5 langkah, tidak diubah)
   + attachEvidence() / evidencePath()
```

---

## 3. Model data entri

Setiap entri memiliki:

```js
{
  id, name, description, category, categoryLabel,
  kind, sourceProject, sourceLabel, sourceType,
  version, license, sourceCode, compatibility, priority,
  duduEquivalent, facts[], docs[], tags[],
  runtime, entryPoint, runnable,
  sideEffects: 'none' | 'network' | 'local_process' | 'local_code',
  permissions[], risk: 'low' | 'medium' | 'high',
  status: {
    implementation: 'implemented' | 'scaffold' | 'not_implemented' | 'reference_only',
    configuration: 'configured' | 'unconfigured' | 'not_required',
    connection: 'connected' | 'disconnected' | 'not_tested' | 'not_applicable',
    execution: 'succeeded' | 'failed' | 'not_run',
    availability: 'available' | 'needs_configuration' | 'disabled' | 'unavailable' | 'unverified',
    compatibility: 'native' | 'adapter_required' | 'unverified' | 'incompatible'
  },
  lastValidatedAt, lastValidation, lastExecutionAt, lastExecution, lastError,
  meta
}
```

### 3.1 Aturan penurunan status

| Sumber | Aturan |
|---|---|
| Skill bawaan | `available` bila flag fitur aktif; jika butuh provider → `needs_configuration` |
| Skill kustom | `available`; `enabled` menentukan pemakaian prompt, bukan status ketersediaan |
| Plugin | manifest/entry valid → `available` (jika aktif) atau `disabled`; rusak → `unavailable` |
| Connector live | field wajib terisi → `available`; tes terakhir ok → `connection=connected` |
| Connector scaffold | `implementation=scaffold`, `availability=unavailable`, `runnable=false` |
| MCP tool lokal | `available`, `runnable=true` |
| MCP server | `not_tested` sampai probe; probe ok → `connected/available`; gagal → `disconnected/unavailable` |
| Tool/workflow misi | `implemented/available`, `runnable=false` (hanya lewat misi) |
| Referensi eksternal | `reference_only/unverified`, `runnable=false` |

`lastValidation` dan `lastExecution` di-overlay dari `capability-state.json`. Status `execution` **tidak** berubah karena validasi; hanya karena eksekusi nyata.

---

## 4. Alur validasi

```
UI → POST /api/capability-registry/:id/validate
   → registry.validate(id)
      ├─ referensi eksternal → verdict=not_applicable (tanpa kode)
      ├─ skill → cek store, panjang instruksi, batas aktif
      ├─ plugin → baca manifest.json; cek name/entry/path; stat file
      │            (TIDAK import/menjalankan kode)
      ├─ connector → cek field + URL; live/ scaffold
      ├─ MCP tool → panggil tool dengan argumen aman
      ├─ MCP server → handshake stdio nyata (timeout 10 dtk)
      └─ tool/workflow → cek pipeline misi
   → simpan lastValidation + audit event
```

Validasi plugin **tidak pernah** mengimpor entry `.mjs`. Ini diuji dengan plugin yang sengaja melempar error saat `run`.

---

## 5. Alur eksekusi + konfirmasi

```
POST /api/capability-registry/:id/run { args, confirm }
  ├─ tolak reference-only (409)
  ├─ tolak non-runnable (409)
  ├─ validasi argumen objek + ukuran (8 KB)
  ├─ jika sideEffects ≠ none dan confirm ≠ true → 409 confirmation_required
  ├─ adapter:
  │   ├─ MCP tool lokal → tool.run(args), timeout 30 dtk
  │   ├─ plugin → plugins.runTool(id,args) [in-process, high risk]
  │   └─ connector → connectors.test(id) [network]
  ├─ catat lastExecution (args di-redact, preview di-redact)
  ├─ append capability-audit.jsonl (args di-redact)
  └─ 200 { capability, ok, result, error, durationMs, at }
```

Kegagalan plugin/connector dikembalikan `ok:false` + `error` apa adanya, bukan dibungkus “sukses”. Error klien (konfirmasi, argumen, non-runnable) tetap HTTP 4xx.

### 5.1 Matriks konfirmasi

| Jenis | Efek samping | `confirm:true` |
|---|---|---|
| MCP tool baca | none | tidak perlu |
| Plugin | local_code | **wajib** |
| Webhook | network | **wajib** |
| MCP server probe | local_process | hanya lewat validasi (bukan run) |

---

## 6. Integrasi misi (aditif)

`server/missions.mjs` mendapat:

- `attachEvidence(id, { capabilityId, ok, result, actor })`
  - menulis `artifacts/<missionId>/evidence/evidence-<ts>-<slug>.json`
  - menghitung SHA-256
  - menambah `mission.evidence[]`
  - menulis log misi
  - **tidak** mengubah `acceptance`, `artifacts`, atau state pipeline
- `evidencePath(id, name)` untuk unduhan aman.

Route:

```
POST /api/missions/:missionId/capabilities/:capabilityId/run
GET  /api/missions/:missionId/evidence/:name
```

Bukti dijalankan **setelah** misi dibuat dan tidak sedang berjalan. Ini memungkinkan misi mengumpulkan bukti kapabilitas tambahan tanpa mengacaukan verifikasi 5 langkah.

---

## 7. Audit & persistensi

| File | Isi | Perlindungan |
|---|---|---|
| `capability-audit.jsonl` | append-only: waktu, capabilityId, action, outcome, actor, durasi, sideEffects, confirm, args ter-redact, error | mode `0600`; tanpa isi rahasia |
| `capability-state.json` | validasi/eksekusi terakhir per ID | mode `0600`; tulisan atomik (tmp + rename) |
| `plugins-state.json` | enabled per plugin | store lama |
| `connectors.json` | konfigurasi connector (secret dimask saat dibaca UI) | mode `0600` |

Redaksi:
- Kunci `secret|token|password|api_key|authorization|cookie` → `[REDACTED]`.
- String `Bearer ...` → `Bearer [REDACTED]`.
- Maksimum 50 item/objek, kedalaman 6, string 2000 karakter.
- Audit **tidak** menyimpan hasil penuh; hanya preview 300 karakter yang juga di-redact.

---

## 8. Frontend

- `src/components/pages/CapabilityCatalog.tsx` — katalog terpadu:
  - filter teks, sumber, ketersediaan, “bisa dijalankan”
  - kartu status + badge implementasi/kompatibilitas/risiko
  - panel detail: status grid, izin, dokumentasi, fakta, hasil validasi
  - argumen JSON + tombol validasi/jalankan; konfirmasi browser untuk efek samping
  - tidak ada tombol “jalankan” untuk referensi eksternal
- Ditempatkan di:
  - **Tools & Integrations** (semua kategori)
  - **Skill** (referensi skill)
  - **Connector** (referensi connector)
  - **Plugin** (referensi plugin)
  - **MCP** (referensi MCP)
- Kontrak legacy `ToolsPage` (heading, baris status) dipertahankan; katalog bersifat tambahan.

---

## 9. Batasan arsitektur

1. Plugin berjalan **in-process**; belum ada sandbox. Karena itu plugin berisiko tinggi dan tidak ada marketplace.
2. MCP eksternal hanya **probe**; tool server eksternal belum dipanggil.
3. Tidak ada scheduler; misi dan eksekusi hanya dipicu pengguna.
4. Audit append-only tanpa rotasi; untuk penggunaan jangka panjang perlu kebijakan retensi.
5. State validasi disimpan per instalasi, bukan per pengguna; aplikasi ini single-user lokal.
6. Semua uji provider eksternal memakai mock; tidak ada kredensial nyata dalam rilis.
