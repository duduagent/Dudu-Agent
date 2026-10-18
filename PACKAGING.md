# Packaging & Rilis Dudu AI

Alat: **Electron 44 + electron-builder 26** (`electron-builder.yml`). Electron dipilih karena aplikasi sudah berbasis React/Vite + Node, Chromium ter-bundel memberi perilaku identik di semua OS (termasuk Web Notification yang dipakai fitur Reminder), dan tidak perlu toolchain Rust/WebKit. Tidak ada migrasi framework UI.

## Target dan status

| Target | Perintah | Berkas | Dibangun? | Dijalankan/diuji? |
|---|---|---|---|---|
| Linux AppImage x64 | `npm run dist:linux` | `release/Dudu-AI-<v>-x86_64.AppImage` | Ya | Ya — smoke test 29/29 (extract-and-run, Ubuntu 24.04 container) |
| Linux .deb x64 | `npm run dist:linux` | `release/dudu-ai_<v>_amd64.deb` | Ya | Ya — dipasang dengan `apt`, smoke test dari `/opt/Dudu AI` 29/29 |
| Windows NSIS installer x64 | `npm run dist:win` | `release/Dudu-AI-Setup-<v>-x64.exe` | Ya (di Linux + wine 9) | **Belum** — belum pernah dijalankan di Windows |
| Windows portable x64 | `npm run dist:win` | `release/Dudu-AI-Portable-<v>-x64.exe` | Ya (di Linux + wine 9) | **Belum** |
| `.rpm`, arm64, macOS | — | — | Tidak disiapkan | — |

Detail hasil: [TEST_REPORT.md](TEST_REPORT.md).

## Cross-compilation — apa yang benar-benar terjadi
- Build Windows di Linux memerlukan **wine** (pembuatan uninstaller NSIS dan penyuntingan ikon/metadata `.exe` menjalankan program Windows). Di lingkungan pengembangan ini wine 9.0 dipasang dan build berhasil. Tanpa wine, build berhenti dengan `spawn wine ENOENT` dan meninggalkan stub `.exe` tidak lengkap — **jangan dipakai**.
- Cara yang disarankan untuk rilis: runner OS asli (`windows-2022` untuk Windows, `ubuntu-24.04` untuk Linux) seperti di `.github/workflows/build.yml`. Workflow tersebut **belum pernah dijalankan** (tidak ada akses GitHub saat penyusunan); validitas sintaks YAML saja yang sudah diperiksa.
- Uji installer Windows di wine **tidak konklusif**: instalasi senyap keluar dengan kode 2 pada lingkungan tanpa Windows; tidak diketahui apakah penyebabnya wine/Xvfb atau installer. Verifikasi di Windows asli diperlukan.

## Code signing
- **Windows: belum ditandatangani.** Tabel sertifikat Authenticode di ketiga `.exe` berukuran 0 (diperiksa dengan `pefile`), walaupun log electron-builder mencetak "signing with signtool.exe". Untuk menandatangani di CI, simpan sertifikat sebagai secret dan set `CSC_LINK` + `CSC_KEY_PASSWORD` pada job `windows`; electron-builder akan memakainya otomatis. Tanpa tanda tangan, SmartScreen akan memperingatkan pengguna.
- **Linux:** tidak ada penandatanganan paket.

## Isi paket (diperiksa)
`app.asar` hanya berisi `package.json`, `dist/` (hasil Vite, tanpa source map), `electron/`, `server/chat-api.mjs`, `server/config.mjs`, `build/icon.png`. Tidak ada `.env`, `tests/`, `src/`, `node_modules`, `server/chat-server.mjs`, atau dokumen. Pencarian pola kunci API pada isi asar: tidak ada temuan. Tidak ada dependensi runtime (`dependencies` kosong); semua paket npm adalah devDependencies yang dibundel Vite atau dipakai alat build.

Ukuran: AppImage ≈ 123 MB, .deb ≈ 97 MB, installer/portable Windows ≈ 102 MB (sebagian besar Chromium).

## Perilaku installer Windows (konfigurasi)
`oneClick: false`, pengguna boleh memilih folder instalasi, per-user secara bawaan (perMachine opsional), shortcut desktop + Start Menu, `deleteAppDataOnUninstall: false` → data pengguna tidak dihapus saat uninstall. *Dikonfigurasi, belum diverifikasi di Windows asli.*

## Platform & dependensi sistem (Linux)
x86_64. `.deb` memakai dependensi standar Electron (GTK3, NSS, libnotify, XDG utils, dsb. — lihat `dpkg-deb -I`). Diuji pada Ubuntu 24.04 (container, kernel mengizinkan user namespace). Distro/versi lain belum diuji.

## Placeholder yang HARUS diganti sebelum rilis publik
- `homepage` di `package.json` (`https://example.com/dudu-ai`) dan `linux.maintainer` di `electron-builder.yml` (`Dudu AI <dudu-ai@example.com>`): dibutuhkan metadata `.deb`; nilainya bukan kontak sebenarnya.
- `build/icon.svg`/`icon.png`: dibuat dari maskot placeholder di `src/components/ui.tsx` (yang sendiri menyatakan bukan aset resmi). Ganti dengan logo final lalu jalankan `npm run icon`.
- Belum ada berkas lisensi; tambahkan sesuai keputusan Anda.

## Smoke test biner
```bash
# Linux (tanpa display fisik: xvfb-run). Jalankan sebagai user biasa agar sandbox Chromium aktif.
xvfb-run -a node scripts/smoke-desktop.mjs "release/linux-unpacked/dudu-ai"
# AppImage tanpa FUSE:
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a node scripts/smoke-desktop.mjs release/Dudu-AI-<v>-x86_64.AppImage
# Windows (PowerShell):
node scripts/smoke-desktop.mjs "release\win-unpacked\Dudu AI.exe"
```
Skrip memakai profil HOME/APPDATA terisolasi dan mengendalikan aplikasi lewat Chrome DevTools Protocol. Ia memverifikasi: muat dari `dudu://app`, isolasi renderer, tidak ada kunci di bundle, API internal + penolakan permintaan tidak sah, CSP, alur Enter/Shift+Enter, error provider jujur, tidak ada request eksternal/console error, pemulihan data setelah buka ulang, lokasi data, dan jalur sukses dengan **provider palsu lokal** lewat `dudu.env`. Ia tidak menguji provider AI sungguhan.

## Membuat rilis
1. Naikkan `version` di `package.json`, commit, `git tag vX.Y.Z`, `git push --tags`.
2. Workflow menjalankan tes, membangun Linux dan Windows di runner masing-masing, menjalankan smoke test, mengunggah artefak + `SHA256SUMS-*.txt`, dan membuat GitHub Release **draft**.
3. Unduh artefak, uji di mesin bersih, baru publikasikan draft.
Secret provider AI **tidak dibutuhkan** untuk build maupun CI.
