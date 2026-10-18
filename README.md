# Dudu AI

Aplikasi asisten AI (React 18 + TypeScript + Vite) yang tersedia sebagai **aplikasi desktop Windows dan Linux** (Electron) serta mode web untuk development.

> Status verifikasi yang jujur per target ada di [TEST_REPORT.md](TEST_REPORT.md). Detail packaging dan rilis ada di [PACKAGING.md](PACKAGING.md).

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
2. Isi `DUDU_PROVIDER_API_KEY=` dengan kunci milik Anda; sesuaikan `DUDU_PROVIDER_BASE_URL` dan `DUDU_MODEL` dengan akun provider Anda (kompatibel OpenAI Chat Completions).
3. Simpan, kembali ke Dudu, klik **Coba lagi** pada pesan error. Tidak perlu memulai ulang.

Lokasi berkas: Windows `%APPDATA%\Dudu AI\dudu.env` · Linux `~/.config/Dudu AI/dudu.env`. Variabel environment sistem dengan nama yang sama menimpa isi berkas. Kunci tidak pernah ditanam di aplikasi maupun dikirim ke UI.

### Lokasi data pengguna
Percakapan dan preferensi disimpan **lokal** di folder data aplikasi (Windows `%APPDATA%\Dudu AI`, Linux `~/.config/Dudu AI`), bukan di folder instalasi. Uninstall **tidak** menghapus data ini. Untuk reset total, tutup aplikasi lalu hapus folder tersebut.

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
| `npm run icon` | Render ulang `build/icon.png` dari `build/icon.svg` |
| `node scripts/smoke-desktop.mjs <biner>` | Smoke test biner hasil build (lihat PACKAGING.md) |

Tidak ada konfigurasi ESLint di proyek ini, jadi tidak ada perintah lint.

### Arsitektur desktop
- **UI** dilayani lewat skema internal `dudu://app` (origin tetap → data localStorage persisten antar peluncuran). Tidak ada server Vite dan **tidak ada port TCP** yang dibuka.
- **API chat** (`server/chat-api.mjs`) berjalan di proses utama Electron dan dipanggil lewat `dudu://app/api/*`. Modul yang sama dipakai server HTTP development (`server/chat-server.mjs`, hanya `127.0.0.1`).
- **Keamanan renderer**: `sandbox`, `contextIsolation`, tanpa Node integration, tanpa IPC, CSP ketat (tanpa sumber eksternal), hanya izin notifikasi, navigasi/pembukaan jendela ke luar dicegat (http/https dibuka di browser sistem). Font Inter di-bundle lokal.
- **Secret**: hanya dibaca di proses utama dari env/`dudu.env`; tidak ada di bundle `dist/`.

### Struktur
```
src/            UI React (Chat, Sidebars, ReminderWorkspace, lib/)
server/         chat-api.mjs (logika), config.mjs, chat-server.mjs (dev)
electron/       main.mjs, preload.cjs, helpers.mjs
tests/          composer, layout, reminders, storage, app-resilience, chat-api, desktop-helpers
scripts/        desktop-dev.mjs, smoke-desktop.mjs, render-icon.cjs
build/          icon.svg, icon.png (placeholder, lihat PACKAGING.md)
.github/workflows/build.yml
```

## Troubleshooting

- **"Provider model belum dikonfigurasi"** — isi `dudu.env` (desktop) atau `.env` (web) seperti di atas. **"Provider merespons 401/502: …"** — pesan setelah titik dua berasal dari provider (mis. kunci/model salah).
- **Layar kosong di mode web** — pastikan `npm run server` berjalan; tanpa itu UI menampilkan "Server API tidak terjangkau".
- **AppImage tidak mau jalan: `libfuse.so.2`** — pasang `libfuse2` (Ubuntu 24.04: `libfuse2t64`), atau jalankan dengan `--appimage-extract-and-run`.
- **AppImage/Chromium gagal dengan pesan sandbox pada Ubuntu 24.04+** — kebijakan AppArmor membatasi user namespace. Gunakan paket `.deb` (skrip pasca-instalasi mengatur sandbox helper bila sistem memerlukannya) atau longgarkan kebijakan sistem Anda (`kernel.apparmor_restrict_unprivileged_userns=0`). Jangan menjalankan dengan `--no-sandbox` kecuali Anda memahami konsekuensinya. *(Perilaku ini bersumber dari kebijakan distro; belum diuji di Ubuntu 24.04 fisik.)*
- **Notifikasi pengingat tidak muncul di Linux** — butuh layanan notifikasi desktop (libnotify/daemon) pada lingkungan desktop Anda.
