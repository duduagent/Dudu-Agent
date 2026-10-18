# Laporan Tes & Build — Dudu AI

Lingkungan: Ubuntu 24.04 (container, x86_64), Node 22.22, npm 10.9, Electron 44, electron-builder 26, wine 9.0 (hanya untuk build Windows). Status: **LULUS** = dijalankan dan hasilnya diperiksa · **GAGAL** · **BELUM DIUJI** = tidak dijalankan / tidak bisa dijalankan di lingkungan ini.

## 1. Akar masalah tes composer
Tes `Enter mengirim pesan; textarea dikosongkan` gagal, tetapi **aplikasi benar**: pesan pengguna tampil, textarea kosong, percakapan tersimpan. `renderContent()` membungkus teks dalam `<p>`, sehingga DOM-nya `.msg-text > p`. `findByText` mencocokkan teks langsung milik elemen, sehingga selector `.msg-row.user .msg-text` tidak pernah cocok (elemen itu tidak punya node teks sendiri). Perbaikan ada di tes: kini memverifikasi baris pesan pengguna, isi teks, textarea kosong, dan tepat satu pesan. Tidak ada assertion yang dilonggarkan. Hanya ada satu salinan proyek di arsip ini (tidak ada salinan tes ganda); `vitest` kini dibatasi ke `tests/**` agar folder `release/` tidak pernah terbaca sebagai suite.

## 2. Bug nyata yang ditemukan dan diperbaiki
| # | Masalah | Perbaikan |
|---|---|---|
| 1 | Server mengikat ke semua interface (`listen(PORT)`); endpoint berkunci API terbuka ke LAN. Content-Type tidak diperiksa → situs web lain bisa memakai kunci lewat request tanpa preflight. | Loopback saja (`127.0.0.1`); wajib `application/json` (415); batas ukuran dalam byte; pembatalan klien menghentikan request ke provider; timeout dapat diatur. Aplikasi desktop tidak membuka port sama sekali. |
| 2 | localStorage tanpa validasi: JSON rusak (mis. `{}`) membuat `.find/.some` melempar dan layar putih saat start. | `sanitizeConversations`: entri/pesan tak valid dan ID ganda dibuang; prefs/activeId tervalidasi. |
| 3 | Pesan assistant berstatus `sending` ikut tersimpan; setelah app ditutup saat menunggu, indikator "mengetik" muncul selamanya. | Saat dimuat diubah menjadi error "Respons terputus…" dengan tombol Coba lagi. |
| 4 | `provider.ts` membuang detail error server ("Provider merespons 502."). | Detail dari provider ditampilkan (dipotong 300 karakter). Pesan "belum dikonfigurasi/tidak terjangkau" disesuaikan untuk desktop vs web. |
| 5 | Kegagalan menulis localStorage (kuota/mode privat) diabaikan diam-diam. | Dicatat sebagai event di panel aktivitas. |
| 6 | Enter penutup komposisi IME di Safari/WebKit (`keyCode 229`) bisa mengirim pesan. | Ditangani di `onKeyDown`. |
| 7 | Font diambil dari Google Fonts saat start (permintaan jaringan pihak ketiga; tidak cocok untuk app desktop/CSP ketat). | Inter di-bundle lokal (`@fontsource/inter`). |
| 8 | Origin localStorage di Electron terikat ke URL; port acak = data hilang tiap peluncuran. | Skema internal `dudu://app` dengan origin tetap. |
| 9 | (Bug di kode baru saya, tertangkap tes) `URL.origin` di Node bernilai `"null"` untuk skema kustom → `isAppUrl` menolak aplikasi sendiri. | Bandingkan `protocol` + `host`; ada tes. |

Tidak ada fitur, identitas Dudu, atau tes yang dihapus. Ditemukan juga namun **tidak** diubah: tidak ada UI pengaturan untuk memasukkan API key (diselesaikan lewat `dudu.env` + menu; UI pengaturan akan menjadi pekerjaan fitur terpisah).

## 3. Hasil tes otomatis
| Pemeriksaan | Hasil |
|---|---|
| `npm ci` dari ekstraksi ZIP bersih | **LULUS** (450 paket) |
| `npm run typecheck` | **LULUS** (0 error) |
| `npm test` — 7 file, **56 tes** | **LULUS** (composer 8, layout 3, reminders 4, storage 9, app-resilience 3, chat-api 15, desktop-helpers 14); 0 warning React/act, keluaran bersih |
| `npm run build` (produksi) | **LULUS**, bundle `dist/` ±0,5 kB html + 1 js + 1 css + font Inter |
| `npm run verify` dari ZIP bersih | **LULUS** (exit 0) |
| `npm audit --omit=dev` | **LULUS** (0 kerentanan; tidak ada dependensi runtime) |
| Lint | **TIDAK TERSEDIA** — proyek tidak memiliki konfigurasi ESLint |

Sebelum perbaikan: 10 dari 11 tes lulus (1 gagal = tes composer di atas).

## 4. Build dan paket
| Target | Dibangun | Dijalankan |
|---|---|---|
| Linux AppImage x64 (≈123 MB) | **LULUS** | **LULUS** — smoke test 29/29 |
| Linux .deb x64 (≈97 MB) | **LULUS** (`dpkg-deb -I`: Package `dudu-ai`, entri `.desktop`, ikon, symlink `/usr/bin/dudu-ai`) | **LULUS** — dipasang via `apt`, smoke test dari `/opt/Dudu AI` 29/29 |
| Windows installer NSIS x64 (≈102 MB) | **LULUS** (di Linux + wine) | **BELUM DIUJI** di Windows. Uji instalasi senyap di wine: keluar kode 2, *tidak konklusif* |
| Windows portable x64 (≈102 MB) | **LULUS** (di Linux + wine) | **BELUM DIUJI** |
| Penandatanganan Windows | **TIDAK ADA** — diverifikasi: tabel sertifikat Authenticode 0 byte di ketiga `.exe` (log "signing with signtool" menyesatkan) | — |
| Ikon & metadata `.exe` | **LULUS** (RT_GROUP_ICON ada; ProductName "Dudu AI", versi 0.1.0) | — |
| GitHub Actions `build.yml` | Sintaks YAML valid | **BELUM DIUJI** (tidak dijalankan di GitHub) |
| `.rpm`, arm64, macOS | tidak disiapkan | — |

Isi paket diperiksa (Linux dan Windows): `app.asar` hanya `package.json`, `dist/`, `electron/`, 2 modul server, ikon; tidak ada `.env`, source map, tes, `node_modules`, atau secret.

## 5. Smoke test aplikasi desktop (biner sungguhan, sandbox Chromium aktif, user non-root, profil terisolasi, cwd ≠ folder proyek)
29 pemeriksaan **LULUS** pada AppImage final dan pada `.deb` terpasang, termasuk: muat dari `dudu://app`; `window.dudu.isDesktop` dan tidak ada `require/process/Buffer` di halaman; kunci API tidak ada di bundle; `/api/health` internal; POST non-JSON → 415; path traversal tidak menghasilkan berkas; CSP memblokir request eksternal dan headernya terpasang; Enter mengirim, textarea kosong, tepat satu pesan, Shift+Enter tidak mengirim; tanpa kunci → error jujur + Coba lagi (tanpa balasan palsu); font Inter lokal; tidak ada overflow horizontal; tidak ada request http(s) eksternal; tidak ada console error/exception; percakapan pulih setelah buka ulang; data di `~/.config/Dudu AI` (bukan folder kerja/instalasi); provider **palsu lokal** via `dudu.env`: balasan tampil, header Authorization benar, kunci tidak bocor ke DOM/localStorage, riwayat ke provider tepat 3 pesan.
Satu-satunya log console yang diizinkan (allow-list di skrip): respons `501` pada `/api/chat` saat smoke test berjalan tanpa kunci — kontrak "provider belum dikonfigurasi".

## 6. Belum diuji / keterbatasan (jujur)
- **Provider AI sungguhan** (kunci, model, jaringan ke penyedia): tidak ada kredensial. Hanya provider palsu lokal yang dipakai; jalur HTTP, auth, dan penanganan error telah diuji.
- **Windows sungguhan**: installer, portable, shortcut, uninstall yang mempertahankan data, SmartScreen, notifikasi Windows — **belum diuji**. Konfigurasinya ada; verifikasi butuh mesin/runner Windows.
- Linux selain Ubuntu 24.04 container; arsitektur selain x64; pemasangan AppImage dengan mount FUSE (diuji dengan extract-and-run); pengalaman desktop interaktif (klik/penampilan di layar fisik) — yang diuji adalah perilaku lewat CDP di Xvfb.
- Notifikasi Reminder di OS (hanya logika `reminders.ts` yang diuji unit).
- Placeholder: `homepage`, `maintainer`, ikon maskot (lihat PACKAGING.md).
