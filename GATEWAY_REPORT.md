# Laporan Gateway AI Multi-Provider — Dudu AI v0.3.0 → v0.3.1

Tanggal: 20 Oktober 2026 (v0.3.0) · Revisi v0.3.1: 21 Oktober 2026 · Basis kode: penerusan v0.2.0 (zip `Dudu-AI-Project-v0.2.0.zip`) + implementasi baru "Master Execution Prompt".
Prinsip yang dipakai sepanjang pekerjaan: **tidak ada yang dikarang** — status, harga, kuota, dan pemakaian hanya dilaporkan bila ada sumbernya; yang tidak diketahui tetap bertanda `unknown`/`NONE`.

---

## A. Ringkasan

Diterapkan **Gateway AI** sebagai satu-satunya jalur pemanggilan LLM di Dudu: routing mode (`FREE_ONLY | FREE_FIRST | BEST_VALUE | BEST_QUALITY | MANUAL | ROTATE`), katalog model dari endpoint resmi provider (di-cache), kredensial server-side tersimpan aman, ekonomi token, ledger pemakaian dengan provenance, anggaran berbayar bulanan, fallback terkendali, dan UI Pengaturan untuk semuanya. Kontrak lama `/api/chat` (`content/model/attachments/sources`) tetap utuh; jalur chat 167 tes lama tetap lulus tanpa perubahan perilaku legacy. **Provider belum satu pun diuji live dengan kunci asli** (tidak ada kunci tersedia) — semua pengujian memakai mock `fetch` yang meniru respons provider; itu dinyatakan jujur di semua tempat.

**Revisi v0.3.1 (permintaan pengguna):**
1. **Mode `ROTATE` (perputaran otomatis)** — bila semua kunci provider terisi, gateway memutar pemilihan antar provider/model yang cocok untuk kategori task yang sama; gratis/lokal selalu didahulukan sebelum berbayar agar token hemat; kursor rotasi tersimpan per kategori di `rotation-state.json` (persisten antar-restart). Anggaran berbayar tetap dijaga.
2. **Pengaturan → Gateway AI: pilihan Otomatis vs Manual yang eksplisit** — tombol radio "Otomatis (per task — direkomendasikan)" vs "Manual (satu model tetap)". Otomatis memilih mode routing (termasuk `ROTATE`); Manual memilih **provider dulu, lalu model dari katalog provider itu** (termasuk opsi `env` konfigurasi lama).
3. **Perbaikan gate 501** — sebelumnya chat menolak dengan "butuh DUDU_PROVIDER_API_KEY" meski kunci gateway (mis. OpenRouter) sudah aktif. Sekarang: kunci gateway aktif cukup; 501 hanya bila tidak ada satu pun provider aktif, dengan pesan yang mengarah ke Pengaturan → Gateway AI.
4. **Auto-warm katalog** — begitu kunci disimpan (dan sebelum routing), katalog model provider aktif dimuat otomatis (maks 1× per 60 detik per provider, gagal jaringan tidak pernah menggagalkan simpan kunci/chat) sehingga chat langsung jalan tanpa tebakan model.


## B. File yang berubah/ditambah

| File | Perubahan |
|---|---|
| `server/errors.mjs` | BARU — `DuduError`, `ProviderConfigError`, `ProviderRequestError`, `PolicyError`, `errorToBody` |
| `server/providers.mjs` | Registri 6 provider + adapter `testConnection/listModels/chat`; OpenRouter memakai normalisasi pricing resmi (`normalizeOpenRouterModel`); Gemini `generateContent`; Ollama `/api/tags` + chat OpenAI-compat; `custom` wajib baseUrl; `envAdapter` untuk konfigurasi legacy |
| `server/credentials.mjs` | BARU — `providers.json` (mode 0600, tulis atomik), snapshot tanpa kunci (suffix 4 char) |
| `server/models-catalog.mjs` | BARU — katalog per provider dari endpoint resmi, cache `models-cache.json` TTL 6 jam |
| `server/routing.mjs` | BARU — `classifyTask` (heuristik, tanpa LLM), `selectModel` 5 mode, `nextFallback` (budget/tier-aware), `CLASS_MAX_TOKENS` |
| `server/usage.mjs` | BARU — ledger `usage.json` max 5000 rekaman, provenance `PROVIDER_REPORTED`/`ESTIMATED` & `PROVIDER_REPORTED_COST`/`COMPUTED_FROM_CATALOG_PRICING`/`NONE`, ringkasan + budget + alert |
| `server/gateway.mjs` | BARU — `createGateway`: settings, guard budget, pemanggilan adapter, fallback, pencatatan usage, `testProvider` |
| `server/api.mjs` | Endpoint baru: `/api/gateway/providers[/id|/id/key|/id/test|/id/models]`, `/api/gateway/models`, `/api/gateway/settings` GET/PUT, `/api/usage`; semua non-GET wajib header `x-dudu-client` |
| `server/chat-api.mjs` | `/api/chat` bercabang: jalur gateway (default) + jalur legacy vision eksplisit (byte-identik, `CLASS_MAX_TOKENS` hanya di jalur gateway); request menerima `mode`/`modelRef` opsional |
| `src/lib/types.ts`, `src/lib/provider.ts`, `src/lib/api.ts` | Tipe `ModelRoute/UsageInfo/CostInfo`, `sendChat` kirim `mode/modelRef`, klien gateway + usage |
| `src/components/Chat.tsx` | Chip rute (provider/model/tier + catatan estimasi token) per pesan assistant |
| `src/components/pages/InfoPages.tsx` | Pengaturan → Gateway AI: kelola kunci/aktif/uji koneksi/muat katalog per provider, mode routing + anggaran + fallback, ringkasan pemakaian & peringatan |
| `tests/gateway.test.mjs` | BARU — 24 tes gateway |
| `package.json` | 0.2.0 → 0.3.0. `README.md` diperbarui |

## C. Status provider

Semua status adalah keadaan **sebelum rilis**, setelah pengujian otomatis dengan mock:

| Provider | Status | Keterangan |
|---|---|---|
| OpenRouter | `IMPLEMENTED_NOT_LIVE_TESTED` | Satu-satunya provider dengan metadata harga resmi di katalog (`/api/v1/models`); tier free/paid dari pricing asli; cost `PROVIDER_REPORTED` bila respons memuat `usage.cost` |
| Groq | `IMPLEMENTED_NOT_LIVE_TESTED` | OpenAI-compat; katalognya tidak memuat harga → tier `unknown` (jujur) |
| NVIDIA NIM | `IMPLEMENTED_NOT_LIVE_TESTED` | OpenAI-compat; harga dari katalog `unknown` |
| Google Gemini | `IMPLEMENTED_NOT_LIVE_TESTED` | `generateContent` + `usageMetadata`; tier `unknown` |
| Ollama (lokal) | `IMPLEMENTED_NOT_LIVE_TESTED` | `/api/tags` (deteksi) + chat OpenAI-compat; tier `local`, biaya API 0 |
| Custom (OpenAI-compat) | `IMPLEMENTED_NOT_LIVE_TESTED` | wajib baseUrl; http hanya loopback |
| 9Router | `BLOCKED_BY_CONFIGURATION` (integrasi via `custom`) | ✓ Verified via situs resmi (fetch api.9router.com, 20 Okt 2026): OpenAI-compatible di `http://localhost:20128/v1`, punya tier FREE. Integrasi: set provider `custom` baseUrl ke endpoint 9Router. Tidak bisa diuji live: layanannya berjalan di mesin pengguna + butuh koneksi providernya sendiri |
| FreeLLM | `BLOCKED_BY_CONFIGURATION` | Tidak ada endpoint kanonik yang bisa diverifikasi dari sumber yang saya miliki; tidak dikarang. Bila protokol OpenAI-compat → pakai provider `custom` (tier `unknown`, jujur) |
| env (legacy DUDU_*) | aktif sebagai pseudo-provider, tier `unknown` | Kontrak v0.2.0 tetap berjalan (167 tes lama lulus) |

`VERIFIED_LIVE`: **tidak ada** (tidak ada kunci API asli selama pengembangan).

## D. Bukti pemilihan model otonom

Dari `tests/gateway.test.mjs` (semua lulus):
- `classifyTask` menentukan kategori tanpa panggilan LLM (`coding`/`data-analysis`/`writing`/`vision`/`general_chat`).
- `FREE_ONLY`: hanya kandidat free/local yang dipilih; saat hanya ada berbayar → error `no_free_model` (HTTP 409) dan **fetch provider tidak pernah dipanggil** (assert `expect(fakeFetch).not.toHaveBeenCalled()`).
- `FREE_FIRST`: kandidat gratis menang; eskalasi ke berbayar hanya bila tidak ada gratis yang memenuhi kebutuhan (mis. vision) dan **selalu membawa `escalationReason`**.
- Guard budget: anggaran habis → kandidat paid diblokir; FREE_FIRST tetap memakai kandidat gratis; MANUAL ke model paid → `budget_exceeded` (HTTP 402).
- `MANUAL`: model pilihan pengguna tidak pernah ditukar diam-diam; error provider (.mock 429) diteruskan apa adanya (`provider_request_error`), URL tepat `https://legacy.test/v1/chat/completions`.
- Fallback terkendali: kandidat pertama gagal 500 → kandidat kedua dipakai, `route.fallback` mencatat rantainya, usage tercatat pada model yang benar-benar menjawab.

## E. Ekonomi token — kejujuran

- Batas output per kategori tugas (`CLASS_MAX_TOKENS`) ditetapkan sebagai `max_tokens` **hanya di jalur gateway**, dengan contoh nyata di mock: `body.max_tokens > 0`.
- Token provider yang melaporkan usage → `PROVIDER_REPORTED` (tes: input 10/output 5 persis seperti mock).
- Yang tidak dilaporkan → estimasi lokal **dilabeli** `ESTIMATED` (chars/4) dan chip UI menyatakan "pemakaian token = estimasi lokal, bukan angka provider".
- Cost: `PROVIDER_REPORTED_COST` > `COMPUTED_FROM_CATALOG_PRICING` (aproksimasi) > `NONE`; tier `local` (Ollama) = 0 USD biaya API.
- **Tidak ada** klaim kuota gratis tersisa/jatah harian — data semacam itu tidak pernah diambil dari provider mana pun.

## F. Pemakaian, anggaran & peringatan

- Dasar data: hanya rekaman yang benar-benar terjadi (ledger, retensi 5000).
- Ringkasan periode bulan berjalan (UTC) per provider/model; token dipisah aktual vs estimasi.
- Anggaran paid bulanan (USD): 0 = `unset` (memantau, bukan menghalangi); habis → state `exceeded` → permintaan berbayar diblokir kebijakan.
- Alert hanya dari fakta tercatat: `budget_exceeded/critical/warn`, `rate_limit` (429 dalam chain), `paid_escalation`, `usage_estimated`, `provider_failures`.

## G. Integrasi dengan modul lama

- **Chat**: default lewat gateway; respons tetap mengandung `content/model/attachments/sources` + tambahan baru (`route/usage/cost`). Tes kontrak lama `chat-attachments` (17 tes) lulus tanpa diubah kecuali menerima field tambahan.
- **Vision legacy**: bila `DUDU_VISION_MODEL` diatur, jalur langsung v0.2.0 dipakai **byte-identik** (dijaga: URL persis `https://v.test/api/chat/completions`, header `Bearer k-vis` — dijaga oleh tes lama).
- **Misi (Mission Engine)**: tetap deterministik berbasis aturan (tanpa LLM) — tidak ada integrasi LLM yang dikarang; dinyatakan di UI Workforce.
- **Kredensial**: lama via dudu.env tetap berfungsi sebagai provider "env" di gateway.

## H. Keamanan

- Kunci API hanya di server (`providers.json`, mode 0600, tulis atomik via rename). Snapshot/menu/UI tidak pernah memuat kunci — hanya suffix 4 karakter, status, baseUrl; diuji (`expect(JSON.stringify(snap)).not.toContain(...)`) dan endpoint.
- Kunci env legacy (`RAHASIA-123` pada tes) tidak pernah muncul di DOM (assert `document.body.innerHTML`).
- `validateBaseUrl`: https untuk jaringan; http hanya loopback; tanpa userinfo/fragment/query — memitigasi SSRF/miskonfigurasi; endpoint metadata cloud (169.254.x.x) ditolak.
- Anti-CSRF (header `x-dudu-client`) berlaku pada semua endpoint gateway yang mengubah data.

## I. Hasil pengujian

Perintah & hasil aktual (Windows, Node v24.21.0):

```
npm test        → Test Files 16 passed (16) · Tests 194 passed (194)
                  (167 tes v0.2.0 + 27 tes gateway baru, termasuk 3 tes baru v0.3.1:
                   rotasi ROTATE melingkar tanpa menyentuh model berbayar, chat 200 via
                   gateway tanpa DUDU_PROVIDER_API_KEY dengan auto-warm katalog, dan
                   chat 501 dengan pesan arahan Gateway AI bila tak ada provider aktif)
npm run verify  → tsc --noEmit OK · vitest 194/194 OK · vite build OK
                  EXITCODE=0
```

Cakupan tes gateway baru (`tests/gateway.test.mjs`, 24 tes): klasifikasi task, 5 mode routing, budget, `nextFallback` + batas `maxFallbacks`, `validateBaseUrl` (SSRF/miskonfigurasi), snapshot kredensial tanpa kunci, kunci pendek ditolak, normalisasi katalog OpenRouter (free/paid/unknown) + cache disk, endpoint daftar provider/POST kunci/uji koneksi 401/katalog/PUT settings (mode salah → 400), ringkasan usage + alert, `/api/chat` jalur gateway (route+usage+cost, kontrak lama utuh), `gateway.complete` end-to-end (free-first, no-usage → ESTIMATED, FREE_ONLY menolak paid + tidak memanggil fetch, budget, fallback chain, MANUAL env tidak ditukar).

Batas pengujian: **tidak ada uji jaringan live**; semua fetch provider dimock. Desktop (`electron/main.mjs`) memakai `createApi` yang sama dan tidak butuh perubahan (dipastikan lewat import `MAX_BODY_BYTES` & pengujian suite desktop yang lulus).

## J. Keterbatasan

1. Tidak ada kunci API asli → semua 6 provider berstatus `IMPLEMENTED_NOT_LIVE_TESTED`; perilaku di lapangan (rate limit, format edge-case, kuota) belum dibuktikan.
2. Katalog hanya OpenRouter yang membawa harga; Groq/NVIDIA/Gemini → tier `unknown` (tidak pernah diklaim gratis; cost `NONE` bila tidak ada harga katalog). Perbaikan ideal: tabel harga resmi per provider di kemudian hari.
3. FreeLLM tidak dapat diverifikasi (tanpa endpoint kanonik sumber yang saya miliki); 9Router hanya bisa dipakai via provider `custom` saat layanannya berjalan di mesin pengguna.
4. Routing model bersifat heuristik (kata kunci/panjang pesan) — bukan model classifier; kompleksitas tinggi hanya mendorong keputusan konteks besar.
5. `selectModel` mengurutkan kandidat dengan skor sederhana, bukan benchmark kualitas sesungguhnya; `BEST_QUALITY` memprioritaskan paid, bukan benchmark terukur.
6. Usage ledger satu file JSON — cocok untuk lokal desktop, belum untuk deployment multi-pengguna.
7. Estimasi token chars/4 kasar; label `ESTIMATED` selalu tampil agar tidak disalahpahami sebagai angka provider.

## K. Langkah berikutnya (disarankan, berurutan)

1. Uji live bertahap dengan kunci milik sendiri: OpenRouter (paling terbukti datanya) → Groq → Gemini → Ollama lokal → NVIDIA, catat tier/cost aktual vs yang dilaporkan.
2. Uji 9Router via `custom` (`http://localhost:20128/v1`) dan harga `FreeLLM` bila endpoint resminya diketahui.
3. Tambah tabel harga resmi Groq/NVIDIA/Gemini (dari sumber resmi, dengan tanggal pengambilan) agar budget & cost tidak lagi `unknown`.
4. Rilis katalog eksplisit per model + tombol "Pilih model" di composer ( MANUAL per pesan, bukan hanya global).
5. Streaming respons di jalur gateway (saat ini buffer penuh; legacy vision juga non-stream).

## L. Verdict rilis

**BETA_CANDIDATE** — untuk rilis publik dalam bentuk "beta": jalur legacy & kontrak lama teruji penuh (194/194), arsitektur gateway utuh dan jujur terhadap data yang tidak diketahui, tetapi belum ada satu pun bukti live terhadap provider sungguhan. Tidak layak disebut `PRODUCTION_STABLE` sampai minimal OpenRouter + satu provider free/lolos diuji live dan idenpotensi budget terbukti di lapangan.
