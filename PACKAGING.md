# Packaging & Rilis Dudu AI

Alat: **Electron 44 + electron-builder 26** (`electron-builder.yml`). Electron dipilih karena aplikasi sudah berbasis React/Vite + Node, Chromium ter-bundel memberi perilaku identik di semua OS (termasuk Web Notification yang dipakai fitur Reminder), dan tidak perlu toolchain Rust/WebKit. Tidak ada migrasi framework UI.

Rilis berjalan: **v0.6.3** (22 Oktober 2026). Versi paket: `package.json` + `package-lock.json` = `0.6.3`.
Rilis sebelumnya yang tetap tersedia di `release/`: 0.5.0, 0.6.0, 0.6.1, 0.6.2 (hash masing-masing tidak berubah).

> Increment 0.6.3 tidak mengubah cara pemaketan: struktur build, `electron-builder.yml`, dan skrip pengemasan tetap sama.
> Yang berubah: isi aplikasi (audit terpadu, gerbang izin, approval terikat tindakan), pemeriksaan tambahan
> `npm run check:imports` yang ikut `npm run verify`, dan dua dokumen baru (`SECURITY_NOTES.md`, `READINESS_AUDIT.md`)
> yang ikut dikemas.

## 1. Target dan status (v0.6.0) — apa yang benar-benar dibangun & diuji

| Target | Perintah | Berkas | Dibangun di sini? | Dijalankan/diuji? |
|---|---|---|---|---|
| **Windows installer x64** | `npm run dist:win` | `release/Dudu-AI-Setup-0.6.0-x64.exe` | **Ya** (Windows 10 x64 native) | **Ya** — dipasang senyap (`/S /D=…`) → aplikasi terpasang smoke **51/51** → uninstall `/S` bersih (exit 0) |
| **Windows portable x64** | `npm run dist:win` | `release/Dudu-AI-Portable-0.6.0-x64.exe` | **Ya** (native) | **Ya** — smoke **51/51** pada .exe portable (ekstrak & jalankan) |
| Windows unpacked x64 | `npm run dist:win` | `release/win-unpacked/Dudu AI.exe` | Ya | Ya — smoke **51/51** |
| **Linux installer .deb x64** | `npm run dist:linux` | `release/dudu-ai_0.6.0_amd64.deb` | **Tidak** di mesin ini — `fpm` (Ruby) tidak ada di Windows (`spawn fpm ENOENT`) | Tidak — harus dibangun di Linux/CI |
| **Linux portable AppImage x64** | `npm run dist:linux` | `release/Dudu-AI-0.6.0-x86_64.AppImage` | **Tidak** di mesin ini — pembuatan AppImage butuh symlink; Windows tanpa Developer Mode/privilege → `EPERM … symlink 'usr\share\icons\…\dudu-ai.png'` | Tidak — harus dibangun di Linux/CI |
| **Linux portable (tarball direktori aplikasi)** | `electron-builder --linux --x64` (direktori) + `tar` | `release/Dudu-AI-0.6.0-linux-x64-portable.tar.gz` | **Ya** — direktori aplikasi Linux ter-build di Windows (binari `dudu-ai` + `app.asar` 3,3 MB + locales), asar diverifikasi berisi kode 0.6.0 dan tanpa kunci API | **Belum dijalankan** (tidak ada mesin Linux di sini) |
| **macOS installer .dmg (x64 + arm64)** | `npm run dist:mac` | `release/Dudu-AI-0.6.0-{x64,arm64}.dmg` | **Tidak** — electron-builder: *"Build for macOS is supported only on macOS"* | Tidak — harus dibangun di macOS/CI |
| **macOS portable (.app ZIP, x64 + arm64)** | `npm run dist:mac` | `release/Dudu-AI-Portable-0.6.0-{x64,arm64}.zip` | **Tidak** —同上 | Tidak |

Detail hasil: [TEST_REPORT.md](TEST_REPORT.md). Hash: `release/SHA256SUMS-0.6.0.txt`.

**Yang TIDAK diklaim:** paket Linux `.deb`/AppImage dan paket macOS **belum ada sebagai berkas** pada rilis ini. Yang tersedia adalah konfigurasi build yang sudah benar + job CI yang membangunnya di runner OS masing-masing. Tidak ada artefak yang "diasumsikan" atau dibuatkan dummy.

## 2. Peta jalan membangun Linux & macOS (dua cara, keduanya nyata)

**Cara A — di mesin target (paling sederhana untuk satu platform)**
```bash
# Linux (Ubuntu/Debian 64-bit):
npm ci && npm run dist:linux      # → AppImage + .deb
# macOS (harus di macOS):
npm ci && npm run dist:mac        # → .dmg + .app .zip untuk x64 & arm64
```
Keduanya juga menjalankan smoke test:
```bash
# Linux: xvfb-run -a node scripts/smoke-desktop.mjs release/linux-unpacked/dudu-ai
# macOS: node scripts/smoke-desktop.mjs "release/mac/Dudu AI.app/Contents/MacOS/Dudu AI"
```

**Cara B — CI (membangun ketiganya sekaligus)**
`.github/workflows/build.yml` punya job `linux` (ubuntu-24.04), `windows` (windows-2022), dan **`macos` (macos-14, baru untuk 0.6.0)**. Semua job menjalankan `npm run verify` (tes) → build → smoke test → `node scripts/package-release.mjs <platform>` (ZIP + `SHA256SUMS`) → unggah artefak. Push tag `v0.6.0` membuat GitHub Release **draft** berisi semua platform. Workflow ini **belum pernah dijalankan** di GitHub (workspace ini bukan git repo) — hanya sintaks YAML yang diperiksa.

## 3. Paket ZIP & checksum

`scripts/package-release.mjs` (baru di 0.6.0) membuat ZIP distributif + berkas hash per platform, dan **menolak mengarang artefak**: berkas yang tidak ada dilaporkan "TIDAK DIBANGUN" dan tidak masuk ZIP/daftar hash.

```bash
node scripts/package-release.mjs windows   # installer + portable + dokumentasi → ZIP
node scripts/package-release.mjs linux     # .deb + AppImage (atau tarball) → ZIP
node scripts/package-release.mjs macos     # .dmg + .app zip → ZIP
node scripts/package-release.mjs source    # paket sumber (untuk membangun sendiri)
```

### Verifikasi rilis (perintah yang dijalankan)

| Perintah | Fungsi | Kapan |
|---|---|---|
| `npm run verify` | typecheck + tes + build produksi | setiap rilis |
| `npm run verify:ui` | menyalakan API + dev server, lalu **audit responsif** (16 rute × 6 lebar) dan **audit kontras ter-render**; mematikan server lagi | setiap rilis (butuh Electron lokal) |
| `npm run smoke:provider` | uji jalur provider: tanpa kredensial, 401/429/non-JSON (mock lokal), jaringan gagal, + uji live bila kredensial asli ada | sebelum rilis & saat konfigurasi provider berubah |
| `node scripts/smoke-desktop.mjs <biner>` | smoke 51 pemeriksaan pada biner desktop | setelah `dist:win` |
| `node scripts/upgrade-check.cjs <setup-lama> <setup-baru>` | kompatibilitas upgrade: data pengguna, startup, smoke, uninstall | sebelum rilis mayor |
| `node scripts/verify-asar.mjs <app.asar> <versi>` | memastikan paket berisi versi & fitur yang benar dan **tanpa kunci API** | setelah build |
| `node scripts/tar-portable.mjs <folder> <out.tar.gz>` | arsip Linux dengan mode POSIX benar (0755 untuk eksekutable) | saat membuat portabel Linux |

> Jalankan `npm run verify:ui` **tanpa** dev server lain yang aktif: Vite yang berjalan mengunci `release/` dan membuat build berikutnya gagal dengan `EPERM`.
> Repositori Git sudah diinisialisasi (branch `main`, tanpa remote/tag — lihat `TEST_REPORT.md` §14.1). Build & rilis tetap dilakukan manual di mesin build; CI (`.github/workflows/build.yml`) sudah mencakup ubuntu/windows/macos.

## 4. Cross-compilation — apa yang benar-benar terjadi
- ⚠️ **Jebakan build yang nyata (v0.6.1)**: bila aplikasi hasil build sebelumnya masih berjalan dari `release\win-unpacked` (mis. smoke test yang tertinggal), build berikutnya gagal dengan `EPERM: rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'`. Tutup semua proses `Dudu AI.exe`/`electron.exe` yang menyentuh folder `release/`, hapus sisa `release\win-unpacked.tmp`, lalu ulangi build. Jangan membangun paket sambil aplikasi desktop dari folder `release/` berjalan. Kadang rename ditolak sesaat oleh pemindai antivirus: hapus folder `win-unpacked.tmp` dan ulangi build.- **Windows dibangun native di Windows 10 x64** (bukan cross-compile). Build Linux di Linux, macOS di macOS. Build Windows di Linux memerlukan **wine** (pembuatan uninstaller NSIS & penyuntingan ikon/metadata `.exe` menjalankan program Windows) — tanpa wine build berhenti dengan `spawn wine ENOENT` dan meninggalkan stub `.exe` tidak lengkap; **jangan dipakai**.
- **Build macOS dari Windows/macOS non-macOS ditolak oleh electron-builder** (`Build for macOS is supported only on macOS`). Tidak ada jalur lain yang sah (membuild .app di Linux juga ditolak; membuat .dmg sendiri tanpa Electron macOS tidak menghasilkan aplikasi yang benar).
- **Build Linux dari Windows** bisa sampai tahap *packaging direktori aplikasi* (berhasil) tetapi **gagal saat membuat AppImage** (symlink `EPERM`; butuh Linux atau Windows dengan symlink privilege) dan **gagal membuat .deb** (`fpm` adalah alat Ruby). Karena itu paket Linux resmi tetap dibuat di runner Linux.
- Uji installer Windows di wine **tidak konklusif**. Yang dipakai untuk bukti rilis 0.6.0: instalasi senyap **di Windows asli** (biner yang sama) → smoke 51/51 → uninstall bersih.
- ⚠️ `node scripts/smoke-desktop.mjs` harus diberi **path absolut** untuk biner: skrip menjalankan biner dengan `cwd` = folder temp, sehingga path relatif menghasilkan `ENOENT`.

## 5. Code signing
- **Windows: belum ditandatangani.** Tabel sertifikat Authenticode di `.exe` berukuran 0 (meskipun log electron-builder mencetak "signing with signitor.exe"), jadi SmartScreen akan memperingatkan pengguna. Untuk menandatangani di CI, simpan sertifikat sebagai secret dan set `CSC_LINK` + `CSC_KEY_PASSWORD` pada job `windows`.
- **macOS: `identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY=false`** → hasil **tidak ditandatangani dan tidak dinotarize**. macOS akan memblokir aplikasi yang belum ditandatangani (Gatekeeper) dan quarantine unduhan web menambah┃. Untuk distribusi publik, set `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` agar notarize berjalan.
- **Linux:** tidak ada penandatanganan paket.

## 6. Isi paket (diperiksa)
`app.asar` hanya berisi `package.json`, `dist/` (hasil Vite, tanpa source map), `electron/`, `server/*.mjs` (kecuali `chat-server.mjs` khusus dev), `build/icon.png`. Tidak ada `.env`, `tests/`, `src/`, `node_modules`, atau dokumen di dalam asar. Pencarian pola kunci API pada isi asar: **tidak ada temuan** (dapat diulang: `node scripts/verify-asar.mjs <app.asar> 0.6.0`).

Ukuran v0.6.0: installer Windows ≈ 103,4 MB, portable ≈ 103,2 MB, `app.asar` 3,3 MB, direktori Linux ter-unpack ≈ 320 MB (sebagian besar Chromium).

## 7. Perilaku installer Windows (konfigurasi)
`oneClick: false`, pengguna boleh memilih folder instalasi, per-user secara bawaan (perMachine opsional), shortcut desktop + Start Menu, `deleteAppDataOnUninstall: false` → data pengguna tidak dihapus saat uninstall. *Dikonfigurasi; pada v0.6.0 diverifikasi di Windows asli: instalasi senyap exit 0, aplikasi terpasang smoke 51/51, uninstall exit 0 dan berkas aplikasi terhapus.*

## 8. Platform & dependensi sistem (Linux)
x86_64. `.deb` memakai dependensi standar Electron (GTK3, NSS, libnotify, XDG utils — lihat `dpkg-deb -I`). Pada v0.5.0 diuji pada Ubuntu 24.04 (container). Untuk rilis 0.6.0, paket Linux harus dibangun ulang di runner Linux dan diuji ulang di sana sebelum dipublikasikan.

⚠️ **Portabel Linux — izin eksekusi sudah benar sejak 0.6.2.** Saat arsip dibuat dari Windows, bit POSIX tidak bisa disimpan oleh `bsdtar`, sehingga pengguna lama harus `chmod +x dudu-ai` secara manual. `scripts/tar-portable.mjs` menulis header ustar sendiri dengan mode **0755** untuk `dudu-ai`, `chrome-sandbox`, dan `chrome_crashpad_handler` (0644 untuk berkas lain). Verifikasi: `tar -tvf Dudu-AI-0.6.3-linux-x64-portable.tar.gz` → `-rwxr-xr-x … dudu-ai` (pada 0.6.3: 20 entri, 3 berkas mode 0755). Paket ini **tetap belum dijalankan di Linux** — gunakan `.deb`/AppImage dari CI untuk rilis resmi.

## 8.1 Artefak rilis v0.6.3 (dibangun & diverifikasi di mesin ini)

| Artefak | Ukuran | SHA-256 (potongan) | Dibangun | Dijalankan/diuji |
|---|---|---|---|---|
| `Dudu-AI-Setup-0.6.3-x64.exe` | 103.428.563 B | `338AA52E…20771` | ✅ | ✅ dipasang senyap + upgrade 0.5.0 → 0.6.3 LOLUS, smoke 51/51 |
| `Dudu-AI-Portable-0.6.3-x64.exe` | 103.182.047 B | `273153A3…CF14B` | ✅ | ✅ smoke 51/51 (biner unpacked & asar terverifikasi) |
| `Dudu-AI-0.6.3-Windows-x64.zip` | 206.876.613 B | `96AD1763…F776` | ✅ | ✅ isi ZIP diperiksa |
| `Dudu-AI-0.6.3-Windows-x64-Setup.zip` | 103.582.429 B | `F91EEDE9…C69D` | ✅ | ✅ isi ZIP diperiksa |
| `Dudu-AI-0.6.3-linux-x64-portable.tar.gz` | 122.824.946 B | `E7D00390…1D6E` | ✅ (dir + tar 0755) | ❌ **belum dijalankan di Linux** |
| `Dudu-AI-0.6.3-Linux-x64.zip` | 122.521.062 B | `EB05D424…FCF6` | ✅ | ❌ **belum dijalankan di Linux** |
| `Dudu-AI-0.6.3-source.zip` | 671.556 B | `9D196D6A…1DCD` | ✅ | ❌ belum dibangun ulang dari paket ini |

Daftar hash lengkap: `release/SHA256SUMS-0.6.3.txt` (+ per-platform: `SHA256SUMS-0.6.3-{Windows,Linux,source}.txt`).

**Tidak dikarang:** `.deb` dan `.AppImage` **tidak dibangun** di mesin ini (`fpm`/symlink tidak tersedia di Windows) — `package-release.mjs linux` melaporkannya sebagai "TIDAK DIBANGUN" (exit 5) dan **tidak** memasukkannya ke ZIP/daftar hash. Tidak ada artefak macOS sama sekali.

**Artefak rilis historis tidak diubah** (dicek ulang pada sesi 0.6.3): hash 0.5.0 / 0.6.0 / 0.6.1 / 0.6.2 tetap sama dengan yang tercatat pada masanya.

### Pemeriksaan tambahan pada v0.6.3
- `npm run check:imports` (baru) memuat **13 modul server dengan ESM native Node**. Ini menutup celah "hijau palsu": pada sesi ini `redact` terdeklarasi ganda membuat aplikasi **terpaket gagal start** sementara seluruh tes tetap hijau (vitest/esbuild mentoleransi linking ESM yang Node/Electron tolak). Skrip ini kini ikut `npm run verify`.
- `node scripts/verify-asar.mjs release/win-unpacked/resources/app.asar 0.6.3` → **SEMUA PEMERIKSAAN LULUS**, tanpa kunci API literal di dalam asar.

## 9. Placeholder yang HARUS diganti sebelum rilis publik
- `homepage` di `package.json` (`https://example.com/dudu-ai`) dan `linux.maintainer` di `electron-builder.yml` (`Dudu AI <dudu-ai@example.com>`): dibutuhkan metadata `.deb`; nilainya bukan kontak sebenarnya.
- `build/icon.svg`/`icon.png`: dibuat dari maskot placeholder di `src/components/ui.tsx` (yang sendiri menyatakan bukan aset resmi). Ganti dengan logo final lalu jalankan `npm run icon`.
- Belum ada berkas lisensi; tambahkan sesuai keputusan Anda.
- `mac.category`/metadata sudah diisi, tetapi **`extendInfo`/notarize belum diverifikasi** (butuh akun Apple Developer).

## 10. Catatan penting pengujian AppImage
Mematikan pembungkus AppImage (`SIGTERM`) **tidak** mematikan proses Electron di dalamnya (terbukti). `scripts/smoke-desktop.mjs` menjalankan tiap sesi dalam grup proses sendiri, mematikan grup, dan menggagalkan sesi bila instance sebelumnya masih menjawab di port DevTools. Gunakan skrip ini apa adanya; jangan menjalankan ulang smoke test dengan `kill` pada pembungkus.

## 11. Smoke test biner
```bash
# Linux (tanpa display fisik: xvfb-run). Jalankan sebagai user biasa agar sandbox Chromium aktif.
xvfb-run -a node scripts/smoke-desktop.mjs release/linux-unpacked/dudu-ai
# AppImage tanpa FUSE:
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a node scripts/smoke-desktop.mjs release/Dudu-AI-<v>-x86_64.AppImage
# Windows (PowerShell) — WAJIB path absolut:
node scripts/smoke-desktop.mjs "C:\...\release\win-unpacked\Dudu AI.exe"
```
Skrip memakai profil HOME/APPDATA terisolasi; aplikasi menghormati `DUDU_USER_DATA` sehingga folder data benar-benar terpisah dari profil pengguna. Ia mengendalikan aplikasi lewat Chrome DevTools Protocol dan memverifikasi (51 pemeriksaan: unggah file asli lewat `<input type=file>`, ekstraksi DOCX/PDF di dalam `app.asar`, Knowledge Base, misi end-to-end, unduhan artefak, responsif 800/390 px, regresi overflow, CSP, anti-CSRF, lokasi data): muat dari `dudu://app`, isolasi renderer, tidak ada kunci di bundle, API internal + penolakan permintaan tidak sah, alur Enter/Shift+Enter, error provider jujur, tidak ada request eksternal/console error, pemulihan data setelah buka ulang, dan jalur sukses dengan **provider palsu lokal** lewat `dudu.env`. Ia **tidak** menguji provider AI sungguhan.

Hasil v0.6.0 di Windows asli: **51/51 lulus** pada tiga biner (unpacked, hasil instalasi senyap, dan .exe portable).

## 12. Membuat rilis
1. Naikkan `version` di `package.json` (`npm version X.Y.Z --no-git-tag-version`), commit, `git tag vX.Y.Z`, `git push --tags`.
2. Workflow menjalankan tes, membangun Linux/Windows/macOS di runner masing-masing, menjalankan smoke test, membuat ZIP + `SHA256SUMS-*.txt`, lalu membuat GitHub Release **draft**.
3. Unduh artefak, uji di mesin bersih, baru publikasikan draft.
4. Rilis yang dibangun manual di satu OS: `node scripts/package-release.mjs <platform>` untuk ZIP + hash.

Secret provider AI **tidak dibutuhkan** untuk build maupun CI.
