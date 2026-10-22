# CAPABILITY SECURITY — Dudu AI v0.5.0

**Model ancaman:** pengguna lokal yang memasang plugin/connector/MCP server sendiri, serta paket skill/plugin eksternal yang belum dipercaya.  
**Prinsip:** least privilege deklaratif, konfirmasi eksplisit untuk efek samping, rahasia tidak pernah ke frontend, audit tanpa rahasia, dan tidak ada eksekusi otomatis kode pihak ketiga.

---

## 1. Batas kepercayaan

| Zona | Kepercayaan | Isi |
|---|---|---|
| Renderer (React) | Tidak dipercaya untuk rahasia | Hanya suffix kunci, status, metadata; tidak ada kunci penuh |
| Server API lokal | Dipercaya | Menyimpan kredensial, menjalankan adapter, menulis audit |
| Store kapabilitas | Dipercaya sesuai domain | `skills`, `plugins`, `connectors`, `mcp`, misi |
| Plugin lokal | **Kode pengguna, risiko tinggi** | Berjalan in-process; bisa membaca filesystem yang dapat diakses proses |
| MCP server eksternal | **Tidak dipercaya** | Hanya di-probe; proses di-spawn tanpa shell |
| Webhook | **Tujuan eksternal** | Request keluar membawa secret header; bisa gagal/timeout |
| Referensi WorkBuddy/Hermes/OpenClaw | **Tidak dipercaya / hanya dokumentasi** | Tidak dieksekusi, tidak diunduh, tidak dipasang |

---

## 2. Izin dan efek samping

| Kapabilitas | Izin deklaratif | Efek samping | Risiko | Konfirmasi |
|---|---|---|---|---|
| MCP tool lokal (`kb_search`, `kb_stats`, `file_list`) | `kb:read`, `files:read` | none | rendah | tidak |
| Tool misi | `files:read`, `artifacts:write/read` | none | rendah | persetujuan misi |
| Skill instruksi | `chat:system-prompt` | none | rendah | aktivasi skill |
| Plugin lokal | `filesystem:plugin-dir`, `code:local`, `process:in-process` | local_code | **tinggi** | **wajib** |
| Connector webhook | `network:outbound`, `secret:webhook` | network | sedang | **wajib** |
| MCP server probe | `process:spawn` | local_process | tinggi | hanya lewat validasi |
| Connector email/GitHub | — | none (scaffold) | rendah | tidak ada eksekusi |
| Referensi eksternal | — | none | — | tidak dapat dijalankan |

Izin ini **dideklarasikan dan ditampilkan**, bukan ditegakkan oleh sandbox. Plugin tetap dapat melakukan lebih dari yang tercantum karena berjalan in-process. Ini batasan yang diakui, bukan klaim keamanan berlebihan.

---

## 3. Kontrol yang diterapkan

### 3.1 Rahasia

- Kunci provider disimpan server-side di `providers.json` (mode `0600`, penulisan atomik). **Tidak dienkripsi at rest**; perlindungan bergantung pada izin file dan keamanan akun OS.
- UI hanya menerima suffix 4 karakter + status (`keySuffix`), tidak pernah kunci penuh.
- Field connector bertipe secret dikembalikan sebagai `{ set: true, value: null }`; UI menampilkan “tersimpan (rahasia)”.
- Argumen MCP server di registry di-redact sebelum dikirim ke UI.
- Audit dan `capability-state.json` menyamarkan kunci `secret|token|password|api_key|authorization|cookie`, string `Bearer ...`, dan membatasi kedalaman/ukuran.
- Hasil plugin tidak disimpan penuh; hanya preview 300 karakter yang di-redact.

### 3.2 Anti-CSRF dan transport

- Semua request mutasi (`POST`/`PUT`/`DELETE`) wajib header `X-Dudu-Client: 1`; tanpa itu → `403 forbidden`.
- Server development dan Electron mengikat ke `127.0.0.1`, bukan `0.0.0.0`.
- CSP ketat di Electron; navigasi keluar dicegat dan dibuka di browser sistem.
- Context isolation + sandbox Electron; tanpa Node integration.

### 3.3 Eksekusi plugin

- Plugin hanya berjalan bila:
  1. folder + `manifest.json` valid,
  2. entry `.mjs` berada **di dalam** folder plugin (path traversal ditolak),
  3. plugin diaktifkan pengguna,
  4. request menyertakan `confirm:true`.
- Manifest dibaca sebagai JSON; **kode tidak diimpor saat validasi**.
- Error eksekusi dikembalikan apa adanya; tidak pernah diubah menjadi “sukses”.
- Timeout eksekusi 30 detik; namun proses Node tidak dapat dibunuh paksa karena plugin berjalan in-process.

### 3.4 MCP eksternal

- Proses di-spawn dengan `shell: false`; command + args eksplisit.
- Handshake `initialize → notifications/initialized → tools/list` dengan timeout 10 detik.
- Hanya probe; **tool server eksternal belum dipanggil**.
- stderr/stdout parsial dipotong 200 karakter pada pesan error.
- Server yang didaftarkan tetap tersimpan sampai pengguna menghapusnya.

### 3.5 Webhook

- Hanya `http:`/`https:` yang diterima.
- Request `POST` JSON dengan timeout 30 detik saat dijalankan lewat registry.
- Header `x-dudu-secret` hanya dikirim bila secret diisi.
- Kegagalan HTTP dilaporkan sebagai `ok:false` + status/error.
- Tidak ada retry otomatis.

### 3.6 Supply chain / proyek eksternal

- Tidak ada unduhan/pemasangan otomatis dari ClawHub, marketplace, npm, atau git.
- Tidak ada installer/script eksternal yang dijalankan.
- Tidak ada kode WorkBuddy/Hermes/OpenClaw yang disalin.
- Lisensi dicantumkan di metadata: WorkBuddy proprietary; Hermes/OpenClaw MIT + URL repo.
- Referensi hanya berisi fakta dokumentasi dan URL resmi; tidak ada klaim kompatibilitas biner.

### 3.7 Audit

- `capability-audit.jsonl` append-only, mode `0600`.
- Mencatat: waktu, ID, aksi (`validate`/`run`), hasil, aktor, durasi, efek samping, flag konfirmasi, argumen ter-redact, error.
- `capability-state.json` menyimpan status terakhir untuk ditampilkan; juga mode `0600`.
- Audit tidak dapat diubah dari UI.

---

## 4. Yang belum ada (jangan diklaim)

| Kontrol | Status |
|---|---|
| Sandbox proses/container untuk plugin | **Belum ada** |
| Tanda tangan manifest/plugin | **Belum ada** |
| Enkripsi kredensial at rest | **Belum ada** (hanya mode 0600) |
| Rotasi/retensi audit | **Belum ada** |
| Rate limiting eksekusi | **Belum ada** |
| OAuth connector pihak ketiga | **Belum ada** |
| Pemanggilan tool MCP eksternal | **Belum ada** |
| Multi-user isolation | **Belum ada** (single-user lokal) |
| Sandbox jaringan untuk webhook | **Belum ada** (hanya validasi URL) |

---

## 5. Uji keamanan yang ada

`tests/capability-registry.test.mjs` memverifikasi:

1. Referensi eksternal → 409 `reference_only`, tidak dieksekusi.
2. Plugin divalidasi tanpa mengimpor kode (plugin sengaja melempar error saat run; validasi tetap lulus).
3. Entry path di luar folder plugin ditolak.
4. Manifest rusak → `unavailable` + validasi `failed`.
5. Eksekusi plugin tanpa `confirm:true` → 409.
6. Webhook tanpa `confirm:true` → 409; dengan konfirmasi → request nyata + header secret.
7. Argumen rahasia tidak muncul di state/audit.
8. Connector scaffold tidak dapat dijalankan.
9. Skill instruksi tidak dapat dijalankan langsung.
10. `kb_search` tanpa query → 400 `missing_args` (tidak menebak argumen).
11. Bukti misi ditulis dengan SHA-256; acceptance/artefak tidak berubah.
12. Status/audit bertahan setelah API dibuat ulang.

`tests/capability-ui.test.tsx` memverifikasi referensi eksternal tidak memiliki tombol “Jalankan sekarang”.

---

## 6. Rekomendasi sebelum produksi luas

1. Pindahkan plugin ke proses/container terpisah dengan izin eksplisit dan batas memori/CPU.
2. Enkripsi kredensial at rest dengan kunci turunan OS (mis. DPAPI di Windows, Keychain di macOS, libsecret di Linux).
3. Tambahkan rotasi audit + ukuran maksimum.
4. Tambahkan allowlist domain webhook.
5. Tambahkan rate limit per kapabilitas.
6. Tanda tangani manifest plugin dan verifikasi checksum.
7. Untuk MCP HTTP: OAuth server-side, scope minimal, allowlist tool, audit argumen.

---

## 7. Kesimpulan

Dudu v0.5.0 menerapkan kontrol yang **nyata dan teruji** untuk konfirmasi, redaksi rahasia, path traversal, anti-CSRF, audit, dan pemisahan referensi eksternal. Namun plugin masih berjalan in-process tanpa sandbox, dan kredensial belum dienkripsi at rest. Kedua hal ini harus diselesaikan sebelum membuka marketplace atau plugin pihak ketiga.
