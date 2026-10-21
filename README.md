# Dudu AI

Aplikasi asisten AI (React 18 + TypeScript + Vite) yang tersedia sebagai **aplikasi desktop Windows dan Linux** (Electron) serta mode web untuk development.

## Fitur yang benar-benar ada (v0.6.0)
- **Gateway AI multi-provider** (baru di v0.3.0): semua panggilan LLM melewati satu gateway server (`server/gateway.mjs`). Provider resmi di registri: **OpenRouter, Groq, NVIDIA NIM, Google Gemini, Ollama (lokal), Endpoint custom (OpenAI-compatible)**; di atas itu, konfigurasi lama `DUDU_*` tetap dipakai sebagai provider "env".
  - **Routing otomatis hemat**: klasifikasi tugas heuristik tanpa panggilan LLM, lalu pemilihan model per mode — `FREE_ONLY` (gratis/lokal saja), `FREE_FIRST` (gratis dulu, berbayar hanya bila perlu, dengan alasan tercatat), `BEST_VALUE`, `BEST_QUALITY`, `MANUAL` (pilihan Anda, tidak pernah ditukar), dan `ROTATE` (perputaran otomatis antar provider/model yang cocok per kategori tugas — gratis/lokal selalu didahulukan, kursor bergilir tersimpan di `rotation-state.json`, cocok bila SEMUA kunci provider terisi agar pemakaian menyebar dan token hemat). Fallback antar-model terbatas dan setiap lompatan dicatat. Bila tidak ada `DUDU_PROVIDER_API_KEY`, chat tetap jalan selama ada kunci gateway aktif — katalog model di-warm otomatis (maks 1×/60 detik per provider), dan tampilan Pengaturan memisahkan pilihan model **Otomatis vs Manual** secara eksplisit.
  - **Metadata resmi, bukan tebakan**: tier gratis/berbayar diambil dari katalog resmi provider (OpenRouter: pricing 0 = gratis; Groq/NVIDIA/Gemini: tier `unknown` — jujur, tidak diklaim gratis; Ollama: `local`).
  - **Ekonomi token**: batas output default per kategori tugas; estimasi token lokal dilabeli `ESTIMATED`, token asli dilabeli `PROVIDER_REPORTED`; biaya berbayar dihitung dari harga katalog (aproksimasi, dilabeli) atau dilaporkan provider. Tidak ada angka kuota/biaya yang dikarang.
  - **Penyimpanan kredensial server-side**: `providers.json` (mode 0600); UI hanya melihat suffix 4 karakter + status; kunci tidak pernah muncul di DOM.
  - **Pemakaian & anggaran**: ledger `usage.json` per provider/model + status anggaran berbayar bulanan (USD) + peringatan; digabungkan ke routing (anggaran habis → model berbayar diblokir, kandidat gratis tetap jalan).
  - UI: **Pengaturan → Gateway AI** (kelola kunci, uji koneksi, muat katalog, pilih mode routing/anggaran) dan chip rute (provider/model/tier) di tiap balasan chat.
- **Akun & Integrasi (v0.4.0)** — semua jujur terhadap batasnya:  - **Akun di perangkat**: daftar/masuk email + kata sandi (hash scrypt + salt, sesi token server-side) di **Pengaturan → Akun & Login**; tanpa login pun semua fitur lokal tetap jalan (mode tamu tidak dihalangi).
  - **OAuth Google/GitHub** (BYO): Anda mendaftarkan aplikasi sendiri (Client ID/Secret disimpan server-side, dikirim ke UI hanya dalam bentuk tersamar); alur otorisasi + pertukaran kode diuji dengan mock endpoint resmi, belum diuji live.
  - **Input Data** (submenu Knowledge Base): teks langsung disimpan & diindeks ke Knowledge Base → otomatis terbaca oleh chat (BM25), Misi, dan MCP.
  - **MCP**: server JSON-RPC 2.0 lokal (`/api/mcp/call`) dengan tool nyata (kb_search, kb_stats, file_list) + pendaftaran MCP server eksternal (stdio) yang bisa diuji dengan handshake initialize/tools-list sungguhan.
  - **CLI**: `dudu` / `node server/cli.mjs` — status, chat, kb, usage via HTTP lokal (header X-Dudu-Client, opsional `DUDU_BEARER`).
  - **Plugin**: daftar plugin lokal (`<folder-data>/plugins/<nama>/manifest.json` + entry `.mjs`), aktif/nonaktif, jalankan tool plugin dengan error apa adanya.
  - **Connector**: webhook dieksekusi nyata (POST + header secret, tombol Uji koneksi eksekusi sesungguhnya); email SMTP/repo GitHub masih kerangka konfigurasi — status "belum ada implementasi live" tanpa tombol yang berpura-pura berhasil.
  - **Skill (v0.4.1)**: galeri skill bawaan yang menunjuk fitur nyata (KB, ekstraksi dokumen, MCP, CLI, webhook, dst.) + skill kustom buatan pengguna; instruksi skill yang diaktifkan (maks 5) benar-benar ditempelkan ke system prompt chat.
  - **Pengaturan API dirapikan (v0.4.1)**: bagian bernomor 1–4 (Provider & API → Model AI real-time → Routing/anggaran → Pemakaian) dengan **pemilih model real-time** (cari/filter tier, klik "Pakai model ini" langsung berlaku tanpa restart, tombol kembali ke Otomatis).
- **Unified Capability Registry (v0.5.0)**: satu katalog untuk skill, tool misi, MCP, plugin, connector, workflow, dan referensi eksternal. Status diturunkan dari store/validasi/probe/audit nyata — bukan teks statis. Tiga MCP tool lokal dapat dijalankan langsung; webhook dan plugin hanya setelah dikonfigurasi/diaktifkan, dengan konfirmasi eksplisit untuk efek samping. Validasi plugin tidak mengimpor kodenya; audit menyamarkan rahasia. Referensi WorkBuddy/Hermes/OpenClaw hanya dokumentasi dan **tidak dapat dijalankan**. Rincian: [CAPABILITY_INVENTORY.md](CAPABILITY_INVENTORY.md), [CAPABILITY_ARCHITECTURE.md](CAPABILITY_ARCHITECTURE.md), [CAPABILITY_COMPATIBILITY_MATRIX.md](CAPABILITY_COMPATIBILITY_MATRIX.md), [CAPABILITY_SECURITY.md](CAPABILITY_SECURITY.md), [CAPABILITY_ROADMAP.md](CAPABILITY_ROADMAP.md).
- **Chat** dengan lampiran multimodal: dokumen (PDF teks, DOCX, XLSX, PPTX, ODF, RTF, HTML, teks/kode/CSV/JSON), gambar, audio, video, ZIP. Setiap lampiran menampilkan tahapnya (dipilih → diunggah → tersimpan → siap/tidak terbaca AI → dianalisis). Isi file dikirim ke model; yang tidak bisa dibaca dinyatakan jujur.
  - Jalur legacy vision (`DUDU_VISION_MODEL`) tetap berjalan persis seperti v0.2.0 (tanpa routing) agar perilaku yang sudah teruji tidak berubah.
- **Files & Artifacts**: unggah, lihat teks hasil ekstraksi, unduh, hapus; artefak misi.
- **Knowledge Base**: indeks dokumen + pencarian kata kunci (BM25) dengan sumber (halaman/slide/sheet); dapat disertakan sebagai konteks chat.
- **Misi & Tugas**: misi *analisis data* (CSV/TSV/JSON/JSONL/XLSX) dengan kriteria penerimaan, persetujuan manusia, eksekusi tool lokal, verifikasi independen, dan artefak; plus tab **Pengingat** (Reminder). \*Perencana misi tetap deterministik berbasis aturan (bukan LLM).
- **v0.6.0 — "Unified Capability & Execution Architecture"**: pembatalan misi kooperatif (`cancelled`, berhenti di antara langkah), jembatan **Chat → Misi** (tombol "Jadikan Misi Analisis Data" saat ada lampiran tabular siap + tujuan di composer; misi lahir sebagai **Draft** dan tetap butuh persetujuan), menjalankan **kapabilitas dari konteks misi** (hanya yang `runnable`; hasil dilampirkan sebagai bukti), dan panel "Bukti kapabilitas" di detail misi. Cakupan rilis: TAHAP 0–4 (sebagian); TAHAP 5–7 masih rencana. Rincian status per tahap: [ROADMAP_V0.6.0.md](ROADMAP_V0.6.0.md), [CHANGELOG.md](CHANGELOG.md).
- **v0.6.3 — Unified Execution Audit, izin granular, approval terikat tindakan**: satu jejak audit append-only (`capability-audit.jsonl`) untuk **misi dan kapabilitas** dengan skema seragam (`eventId`, `eventType`, `missionId`, `taskId`, `execId`, `capabilityId`, `actor`, `outcome`, `correlationId`) — 19 jenis event, rahasia selalu disamarkan, dan penulisan audit untuk kontrol keamanan bersifat **fail-closed** (tindakan berisiko tidak berjalan bila audit tak bisa ditulis). Izin sekarang **granular dan ditegakkan di batas eksekusi** (bukan hanya di UI): `file:read`, `file:write`, `process:exec`, `network:out`, `credential:use`, `side-effect:external`, `plugin:exec`, `mcp:exec`; default tetap aman (izin jaringan/efek samping/credential hanya diberikan bila konfigurasi nyata ada + konfirmasi eksplisit). Persetujuan kini **terikat tindakan**: menjalankan kapabilitas di dalam misi memerlukan persetujuan khusus yang terikat kapabilitas + operasi + target + parameter (digest) + masa berlaku, dan **dipakai sekali** — persetujuan umum atas misi bukan izin tanpa batas. Rincian skema, izin nyata, dan batas yang masih terbuka: [SECURITY_NOTES.md](SECURITY_NOTES.md).
- **v0.6.1 — Pusat Eksekusi & hardening aksesibilitas**: halaman **Pusat Eksekusi** dengan *timeline eksekusi hidup* (langkah, stempel waktu, durasi, percobaan, status kriteria — semuanya dari state server, tanpa persentase karangan) dan *pusat "butuh perhatian"* (approval tertunda, gagal yang bisa diulang, perlu tinjauan manusia, integrasi belum terkonfigurasi). Kontras diperketat: tombol emas kini 5.47:1 (AA), batas kontrol form 3.16:1 (WCAG 1.4.11), teks emas pada latar terang diperbaiki; audit kontras ter-render (**0 temuan** di 15 halaman) dan audit responsif (**0 temuan overflow** di 90 kombinasi).
- **UI/UX overhaul (v0.6.0)**: satu design system (ivory hangat · putih · champagne gold · charcoal) dengan token warna/tipografi/spasi/radius/elevasi, komponen panel/kartu/formulir/notifikasi/badge yang konsisten, 15 halaman dirapikan (Input Data, MCP, CLI, Plugin, Connector, Skill, Settings, Akun & OAuth, Files, Memory, Tools, Workforce, Misi, Knowledge Base, Chat), dan audit responsif otomatis **0 temuan overflow di 90 kombinasi** (15 halaman × 6 lebar). Rincian token & aturan main: [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md).
- **Memory** (catatan eksplisit), **Tools & Integrations**, **Agent Workforce**, **Pengaturan**: menampilkan status kemampuan yang sebenarnya.
- **Belum ada** (dinyatakan di UI): OCR, pemrosesan video, kamera/mikrofon, embedding semantik, agen LLM otonom, integrasi pihak ketiga. Vision dan transkripsi audio aktif hanya bila model dikonfigurasi dan **belum diuji dengan layanan nyata**. Gateway baru juga **belum diuji live dengan kuota provider nyata** (semua jalurnya diuji dengan mock; tidak ada kunci API asli dalam proses pembuatan release ini).

> Status verifikasi yang jujur per target ada di [TEST_REPORT.md](TEST_REPORT.md) dan [GATEWAY_REPORT.md](GATEWAY_REPORT.md). Audit kesiapan rilis terakhir: [READINESS_AUDIT.md](READINESS_AUDIT.md). Skema audit, izin, dan approval: [SECURITY_NOTES.md](SECURITY_NOTES.md). Detail packaging dan rilis ada di [PACKAGING.md](PACKAGING.md).

## Unduhan v0.6.0 (21 Oktober 2026)

Berkas ada di folder `release/`; hash lengkap di `release/SHA256SUMS-0.6.0.txt`.

| Platform | Installer | Portable | Status |
|---|---|---|---|
| **Windows 10/11 x64** | `Dudu-AI-Setup-0.6.0-x64.exe` | `Dudu-AI-Portable-0.6.0-x64.exe` | **Tersedia & diuji** (smoke 51/51 pada biner unpacked, hasil instalasi, dan portable) |
| **Linux x64** | `dudu-ai_0.6.0_amd64.deb` — *belum ada* | `Dudu-AI-0.6.0-x86_64.AppImage` — *belum ada*; tersedia `Dudu-AI-0.6.0-linux-x64-portable.tar.gz` (extract → `chmod +x dudu-ai`) | **Sebagian** — paket resmi `.deb`/AppImage dibangun di Linux (`npm run dist:linux` atau job CI); tarball yang ada **belum dijalankan di Linux** |
| **macOS x64/arm64** | `Dudu-AI-0.6.0-<arch>.dmg` — *belum ada* | `Dudu-AI-Portable-0.6.0-<arch>.zip` — *belum ada* | **Harus dibangun di macOS** (`npm run dist:mac` atau job CI `macos-14`); electron-builder menolak build mac dari Windows/Linux |
| Semua OS (build sendiri) | — | `Dudu-AI-0.6.0-source.zip` | Tersedia (tanpa `node_modules`) |

Paket ZIP siap pakai: `Dudu-AI-0.6.0-Windows-x64.zip` (installer + portable + dokumentasi), `Dudu-AI-0.6.0-Linux-x64.zip` (tarball + dokumentasi). Semua paket **belum ditandatangani** (tidak ada sertifikat kode-signing) dan **belum diverifikasi di mesin bersih selain Windows asli**.

## Unduhan v0.6.3 (22 Oktober 2026)

Berkas ada di folder `release/`; hash lengkap di `release/SHA256SUMS-0.6.3.txt`.

| Platform | Installer | Portable | Status |
|---|---|---|---|
| **Windows 10/11 x64** | `Dudu-AI-Setup-0.6.3-x64.exe` | `Dudu-AI-Portable-0.6.3-x64.exe` | **Tersedia & diuji** — dipasang senyap, upgrade dari 0.5.0 diuji, smoke 51/51 |
| **Linux x64** | `dudu-ai_0.6.3_amd64.deb` — *belum ada* | `Dudu-AI-0.6.3-x86_64.AppImage` — *belum ada*; tersedia `Dudu-AI-0.6.3-linux-x64-portable.tar.gz` (sudah berisi izin eksekusi 0755, tinggal extract & jalankan `./dudu-ai`) | **Sebagian** — paket resmi `.deb`/AppImage dibangun di Linux (`npm run dist:linux`); tarball **belum dijalankan di Linux** |
| **macOS x64/arm64** | `Dudu-AI-0.6.3-<arch>.dmg` — *belum ada* | `Dudu-AI-Portable-0.6.3-<arch>.zip` — *belum ada* | **Harus dibangun di macOS** (`npm run dist:mac` atau job CI `macos-14`) |
| Semua OS (build sendiri) | — | `Dudu-AI-0.6.3-source.zip` | Tersedia (tanpa `node_modules`) |

Paket ZIP siap pakai: `Dudu-AI-0.6.3-Windows-x64.zip` (installer + portable + dokumentasi), `Dudu-AI-0.6.3-Windows-x64-Setup.zip` (installer saja), `Dudu-AI-0.6.3-Linux-x64.zip` (tarball + dokumentasi). Semua paket **belum ditandatangani**. Rilis sebelumnya (0.5.0 / 0.6.0 / 0.6.1 / 0.6.2) tetap tersedia di `release/` dengan hash masing-masing dan **tidak diubah**.

> **Perubahan yang memengaruhi pemakai dari v0.6.2:** menjalankan kapabilitas dari dalam misi kini memerlukan persetujuan khusus (terikat kapabilitas + parameter + masa berlaku, dipakai sekali). Persetujuan umum atas misi tidak lagi cukup untuk tindakan tersebut.

## Unduhan v0.6.2 (22 Oktober 2026)

Berkas ada di folder `release/`; hash lengkap di `release/SHA256SUMS-0.6.2.txt`.

| Platform | Installer | Portable | Status |
|---|---|---|---|
| **Windows 10/11 x64** | `Dudu-AI-Setup-0.6.2-x64.exe` | `Dudu-AI-Portable-0.6.2-x64.exe` | **Tersedia & diuji** — dipasang senyap, upgrade dari 0.5.0 diuji, smoke 51/51 |
| **Linux x64** | `dudu-ai_0.6.2_amd64.deb` — *belum ada* | `Dudu-AI-0.6.2-x86_64.AppImage` — *belum ada*; tersedia `Dudu-AI-0.6.2-linux-x64-portable.tar.gz` (sudah berisi izin eksekusi 0755, tinggal extract & jalankan `./dudu-ai`) | **Sebagian** — paket resmi `.deb`/AppImage dibangun di Linux (`npm run dist:linux`); tarball **belum dijalankan di Linux** |
| **macOS x64/arm64** | `Dudu-AI-0.6.2-<arch>.dmg` — *belum ada* | `Dudu-AI-Portable-0.6.2-<arch>.zip` — *belum ada* | **Harus dibangun di macOS** (`npm run dist:mac` atau job CI `macos-14`) |
| Semua OS (build sendiri) | — | `Dudu-AI-0.6.2-source.zip` | Tersedia (tanpa `node_modules`) |

Paket ZIP siap pakai: `Dudu-AI-0.6.2-Windows-x64.zip` (installer + portable + dokumentasi), `Dudu-AI-0.6.2-Linux-x64.zip` (tarball + dokumentasi). Semua paket **belum ditandatangani**. Rilis sebelumnya (0.5.0 / 0.6.0 / 0.6.1) tetap tersedia di `release/` dengan hash masing-masing.

## Untuk pengguna (aplikasi terpasang)

| Sistem | Berkas | Cara memakai |
|---|---|---|
| Windows 10/11 x64 | `Dudu-AI-Setup-<versi>-x64.exe` | Jalankan installer, pilih folder, selesai. Buka dari Start Menu / shortcut. |
| Windows (tanpa instal) | `Dudu-AI-Portable-<versi>-x64.exe` | Klik dua kali. |
| Linux x64 (universal) | `Dudu-AI-<versi>-x86_64.AppImage` | `chmod +x` lalu klik dua kali / jalankan. |
| Debian/Ubuntu x64 | `dudu-ai_<versi>_amd64.deb` | `sudo apt install ./dudu-ai_<versi>_amd64.deb`, lalu buka "Dudu AI" dari menu aplikasi. |

Tidak perlu terminal dan tidak perlu memasang Node.js. Aplikasi memuat UI dan menjalankan backend-nya sendiri.

**Windows menampilkan peringatan SmartScreen?** Installer saat ini **belum ditandatangani** (belum ada sertifikat code signing). Pilih "More info → Run anyway" hanya jika Anda mempercayai sumber berkasnya. Bandingkan SHA-256 dengan `SHA256SUMS-*.txt`.

### Menghubungkan provider AI (wajib agar Dudu bisa menjawab)

Tanpa kunci API, Dudu tetap terbuka dan menyimpan percakapan, tetapi akan menyatakan dengan jujur bahwa provider belum dikonfigurasi.

1. Di aplikasi: menu **Dudu AI → Buka folder konfigurasi (dudu.env)** (tekan `Alt` jika menu tersembunyi).
2. Isi `DUDU_PROVIDER_API_KEY=` dengan kunci milik Anda; sesuaikan `DUDU_PROVIDER_BASE_URL` dan `DUDU_MODEL` dengan akun provider Anda (kompatibel OpenAI Chat Completions). Opsional: `DUDU_VISION_MODEL` (gambar), `DUDU_STT_MODEL` (transkripsi audio), `DUDU_MAX_UPLOAD_MB`; lihat `.env.example`.
3. Simpan, kembali ke Dudu, klik **Coba lagi** pada pesan error. Tidak perlu memulai ulang.

Lokasi berkas: Windows `%APPDATA%\Dudu AI\dudu.env` · Linux `~/.config/Dudu AI/dudu.env`. Variabel environment sistem dengan nama yang sama menimpa isi berkas. Kunci tidak pernah ditanam di aplikasi maupun dikirim ke UI.

### Lokasi data pengguna
File, indeks Knowledge Base, misi, artefak, percakapan, dan preferensi disimpan **lokal** di folder data aplikasi (Windows `%APPDATA%\Dudu AI`, Linux `~/.config/Dudu AI`), bukan di folder instalasi. Uninstall **tidak** menghapus data ini. Untuk reset total, tutup aplikasi lalu hapus folder tersebut.

## Untuk developer

Persyaratan: **Node.js ≥ 20** (CI memakai 22), npm. Build Linux: tidak ada prasyarat sistem tambahan selain untuk `.deb`/AppImage yang diunduh otomatis oleh electron-builder.

```bash
npm ci                 # pasang dependensi persis sesuai package-lock.json
cp .env.example .env   # isi DUDU_PROVIDER_API_KEY (mode web saja)
```

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Frontend Vite di http://localhost:5174 (proxy `/api` → 8787) |
| `npm run server` | Server API development di `127.0.0.1:8787` (membaca `.env`) |
| `npm run desktop:dev` | Vite + server API + jendela Electron sekaligus (hot reload) |
| `npm run desktop` | Build produksi lalu jalankan Electron seperti versi terpaket |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Seluruh tes (Vitest; hanya `tests/**`) |
| `npm run build` | Typecheck + build produksi frontend ke `dist/` |
| `npm run verify` | typecheck + test + build |
| `npm run dist:dir` | Paket tak-terkompres untuk inspeksi (`release/<os>-unpacked`) |
| `npm run dist:linux` | AppImage + `.deb` (x64) |
| `npm run dist:win` | Installer NSIS + portable (x64) — lihat batasan di PACKAGING.md |
| `npm run dist:mac` | `.dmg` + `.app` zip untuk x64 & arm64 (harus di macOS) |
| `npm run icon` | Render ulang `build/icon.png` dari `build/icon.svg` |
| `node scripts/smoke-desktop.mjs <biner>` | Smoke test biner hasil build (lihat PACKAGING.md) |
| `node scripts/package-release.mjs <platform>` | ZIP + `SHA256SUMS` untuk `windows`/`linux`/`macos`/`source` |
| `node scripts/verify-asar.mjs <app.asar> 0.6.0` | Cek isi paket: versi, fitur 0.6.0, dan tidak adanya kunci API |
| `node scripts/ui-audit.cjs` | Audit responsif 16 halaman × 6 lebar + screenshot (lihat [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md)) |
| `node scripts/contrast-audit.cjs` | Audit kontras komponen **ter-render** (teks ≥4.5:1, non-teks ≥3:1) |
| `npm run verify:ui` | Jalankan kedua audit UI otomatis (menyalakan server sendiri, lalu mematikannya) |
| `npm run smoke:provider` | Uji kesiapan provider: jalur kesalahan (mock lokal) + uji live bila kredensial tersedia |
| `node scripts/tar-portable.mjs <folder> <out.tar.gz>` | Arsip tar.gz portabel Linux **dengan mode POSIX benar** (0755 untuk eksekutable) |
| `node scripts/upgrade-check.cjs <setup-lama> <setup-baru>` | Uji kompatibilitas upgrade: data pengguna, startup, smoke, dan uninstall |
| `node scripts/contrast-check.mjs` | Rasio kontras WCAG untuk token warna |

Tidak ada konfigurasi ESLint di proyek ini, jadi tidak ada perintah lint.

### Arsitektur desktop
- **UI** dilayani lewat skema internal `dudu://app` (origin tetap → data localStorage persisten antar peluncuran). Tidak ada server Vite dan **tidak ada port TCP** yang dibuka.
- **API chat** (`server/chat-api.mjs`) berjalan di proses utama Electron dan dipanggil lewat `dudu://app/api/*`. Modul yang sama dipakai server HTTP development (`server/chat-server.mjs`, hanya `127.0.0.1`).
- **Keamanan renderer**: `sandbox`, `contextIsolation`, tanpa Node integration, tanpa IPC, CSP ketat (tanpa sumber eksternal), hanya izin notifikasi, navigasi/pembukaan jendela ke luar dicegat (http/https dibuka di browser sistem). Font Inter di-bundle lokal.
- **Secret**: hanya dibaca di proses utama dari env/`dudu.env`; tidak ada di bundle `dist/`.

### Struktur
```
src/            UI React (Chat, Sidebars, ReminderWorkspace, lib/)
server/         api.mjs (router), gateway/routing/providers, capability-registry, missions/data-tools, skills/plugins/connectors/mcp, files/extract/knowledge/chat-api/config .mjs, chat-server.mjs (dev), cli.mjs
electron/       main.mjs, preload.cjs, helpers.mjs
tests/          19 file: composer, layout, reminders, storage, app-resilience, chat-api, desktop-helpers, files-extract, real-fixtures (berkas dari software independen), knowledge, missions, api, chat-attachments, attachments-ui, pages, gateway, integrations, capability-registry, capability-ui
scripts/        desktop-dev.mjs, smoke-desktop.mjs, render-icon.cjs
build/          icon.svg, icon.png (placeholder, lihat PACKAGING.md)
.github/workflows/build.yml
```

## Troubleshooting

- **"Belum ada provider AI aktif"** — isi kunci provider di **Pengaturan → Gateway AI** (desktop/web), atau `dudu.env` (desktop) / `.env` (web) seperti di atas. **"Provider merespons 401/502: …"** — pesan setelah titik dua berasal dari provider (mis. kunci/model salah).
- **Layar kosong di mode web** — pastikan `npm run server` berjalan; tanpa itu UI menampilkan "Server API tidak terjangkau".
- **AppImage tidak mau jalan: `libfuse.so.2`** — pasang `libfuse2` (Ubuntu 24.04: `libfuse2t64`), atau jalankan dengan `--appimage-extract-and-run`.
- **AppImage/Chromium gagal dengan pesan sandbox pada Ubuntu 24.04+** — kebijakan AppArmor membatasi user namespace. Gunakan paket `.deb` (skrip pasca-instalasi mengatur sandbox helper bila sistem memerlukannya) atau longgarkan kebijakan sistem Anda (`kernel.apparmor_restrict_unprivileged_userns=0`). Jangan menjalankan dengan `--no-sandbox` kecuali Anda memahami konsekuensinya. *(Perilaku ini bersumber dari kebijakan distro; belum diuji di Ubuntu 24.04 fisik.)*
- **Notifikasi pengingat tidak muncul di Linux** — butuh layanan notifikasi desktop (libnotify/daemon) pada lingkungan desktop Anda.
