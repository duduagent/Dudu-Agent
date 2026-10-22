# Sistem Desain — Dudu AI Agent OS

Dokumen ini menjelaskan token, komponen, dan aturan main yang dipakai di seluruh aplikasi.
Implementasi nyata: `src/styles.css` (satu berkas token + komponen), `src/components/pages/PageShell.tsx` (kerangka halaman), `src/components/ui.tsx` (ikon & logo).

## 1. Token

Semua nilai warna, tipografi, spasi, radius, elevasi, dan breakpoint berada di blok `:root` pada `src/styles.css`. Tidak ada warna/ukuran hard-coded di luar token (kecuali beberapa warna status legacy yang sudah disatukan).

### Warna

| Token | Nilai | Peran |
|---|---|---|
| `--ivory` | `#FCFBF8` | Latar aplikasi (ivory hangat) |
| `--paper` / `--white` | `#FFFFFF` | Permukaan kartu & panel |
| `--cream` | `#F7F4ED` | Permukaan terpilih/navigasi aktif |
| `--smoke` | `#F4F3EF` | Latar halus (input non-aktif, baris kode) |
| `--ink` | `#171717` | Teks utama |
| `--ink2` | `#4F4F4F` | Teks sekunder |
| `--ink3` | `#6E6E6E` | Teks bantu/meta |
| `--gold` | `#D6B36A` | Emas champagne — hanya border/aksen (tidak untuk teks) |
| `--gold-deep` | `#9C7016` | Garis fokus, aksen non-teks (≥3:1) |
| `--gold-ink` | `#8A6212` | Teks bermerek (5.47:1 di putih) |
| `--gold-btn` | `#8A6212` | Isian tombol emas (putuh di atasnya 5.47:1 ✔ AA) |
| `--gold-wash` | `#FDF8EC` | Latar aksen lembut |
| `--line` / `--line2` / `--line-strong` | `#EDEAE2` → `#D3CDBD` | Garis pembatas dekoratif (kartu/panel) |
| `--line-ctl` | `#9A9079` | Batas kontrol form (3.16:1 ✔ WCAG 1.4.11) |
| `--ok` / `--warn` / `--err` | `#2E7D4F` / `#8A5A12` / `#B3402F` | Status: sehat, perlu perhatian, gagal |

Rasio kontras diukur (`scripts/contrast-check.mjs` untuk token, `scripts/contrast-audit.cjs` untuk komponen ter-render):

| Pasangan | Rasio | Syarat |
|---|---|---|
| Teks putih di atas tombol emas (`--gold-btn`) | **5.47:1** | AA (teks normal) |
| `--ink3` di atas putih | 5.10:1 | AA |
| `--ink2` di atas putih | 6.90:1 | AA |
| `--gold-ink` di atas putih | 5.47:1 | AA |
| Batas kontrol form (`--line-ctl`) vs putih | **3.16:1** | 1.4.11 (non-teks ≥3:1) |
| Cincin fokus (`--gold-deep`) vs putih | 4.43:1 | 1.4.11 (≥3:1) ✔ |
| Badge status (ok/warn/err di atas latar pastel) | 4.64 / 5.48 / 5.13 | AA |
| Kontrol nonaktif | — | dikecualikan WCAG 1.4.3 (opacity .45) |

> Temuan penting (v0.6.1): pemeriksaan token saja **tidak** cukup. Audit ter-render menemukan teks emas pada avatar, badge sumber, tautan, label langkah, dan prompt CLI yang berada di 4.1–4.43:1 — gagal AA meski tokennya "terlihat benar". Karena itu `--gold-deep` tidak lagi dipakai sebagai warna teks; teks emas memakai `--gold-ink`.
> Catatan: emas terang `#C79A42` (2.58:1) tidak lagi dipakai untuk teks maupun isian tombol.

### Tipografi
Skala: `--fs-2xs` 10.5px · `--fs-xs` 11.5px · `--fs-sm` 12.5px · `--fs-base` 13.5px · `--fs-md` 15px · `--fs-lg` 17px · `--fs-xl` 21px · `--fs-2xl` 26px. Baris: `--lh-tight` 1.32 (judul) · `--lh-body` 1.55 (isi). Font: Inter (lokal, tanpa unduhan runtime) dengan fallback sistem; kode memakai monospace sistem.

### Spasi, radius, elevasi
`--sp-1…--sp-8` = 4→40px · radius `--r-xs` 6px, `--r-sm` 9px, `--r` 12px, `--r-lg` 16px, `--r-xl` 20px, `--r-pill` 999px · elevasi `--sh1` (kartu), `--sh2` (dialog/overlay), cincin fokus `--ring`.

### Kontrol
Tinggi kontrol desktop `--h-ctl` 42px, kontrol kecil `--h-ctl-sm` 34px. Tombol, input, dan select memakai tinggi yang sama agar sejajar.

### Gerak
`--dur` .18s dengan `--ease` cubic-bezier(.4,0,.2,1). `prefers-reduced-motion: reduce` menonaktifkan transisi/animasi.

## 2. Komponen

| Komponen | Kelas | Catatan |
|---|---|---|
| Permukaan halaman | `.panel` | Panel putih + border hangat + radius 16 + shadow halus. Varian: `.panel--flat` (tanpa shadow), `.panel--quiet` (latar emas) |
| Kepala panel | `.panel-head`, `.panel-title`, `.panel-sub`, `.panel-actions` | Judul + status di kiri, aksi di kanan, membungkus rapi di layar sempit |
| Kartu | `.card` | Permuka isi; `.card-block` = susunan kolom (untuk kartu form/grid) |
| Tombol | `.btn-primary` (emas), `.btn-ghost` (netral), `.btn-danger` (merah), `.chip-btn`, `.chip-toggle` | Semua punya keadaan hover/focus/disabled yang konsisten |
| Formulir | `.field` + `.field-label` + `.field-hint` + `.field-error` | Label selalu terlihat (bukan placeholder), bantuan di bawah kontrol |
| Badge status | `.pill` (+`ok`/`warn`/`err`/`info`/`neutral`), `.mini-badge`, `.source-badge` | Semantik: tersedia / perlu konfigurasi / gagal / nonaktif / referensi |
| Notifikasi | `.notice` (+`info`/`warn`/`err`/`ok`) | Untuk pesan informatif & peringatan; `.empty-note` untuk keadaan kosong |
| Grid | `.card-grid` | `repeat(auto-fill, minmax(min(272px,100%),1fr))` — tidak pernah meluber di layar sempit |
| Baris label/nilai | `.kv` | Dua kolom (160–220px + 1fr); menjadi satu kolom di bawah 880px |
| Toolbar | `.toolbar` | Baris filter/aksi yang membungkus rapi |
| Ringkasan angka | `.stat-grid`, `.stat`, `.stat-value`, `.stat-label` | Hanya untuk angka nyata dari server |
| Kode | `.cmd-row`, `.cmd-code`, `.copy-btn`, `.code-block` | Referensi perintah + aksi salin |
| Keadaan kosong | `.empty-state` | Judul + penjelasan + aksi opsional |

## 3. Aturan main

1. **Status berasal dari server.** Badge tidak pernah menebak; label "Tersedia" hanya muncul bila store/probe/validasi benar-benar mengatakannya.
2. **Label selalu terlihat.** Placeholder hanya contoh, bukan label.
3. **Tidak ada tombol palsu.** Setiap tombol melakukan sesuatu (menyimpan, menguji, menjalankan, menyalin) dan menampilkan umpan balik hanya setelah operasi benar-benar berhasil.
4. **Kegagalan ditampilkan apa adanya**, termasuk pesan error server.
5. **Tidak ada perbaikan semu.** Bila backend belum mendukung sesuatu, UI menyatakan statusnya dan tindakan berikutnya, bukan made-up.
6. **Rahasia tidak pernah tampil penuh**; nilai tersimpan ditampilkan tersamar.

## 4. Breakpoint

| Lebar | Perilaku |
|---|---|
| ≥1440 | Tata letak 3 region penuh; grid 3–4 kolom |
| ≥1280 | Ukuran standar |
| ≥1024 | Grid 2–3 kolom; panel tetap utuh |
| ≥881 | Batas desktop: sidebar kiri boleh menjadi rail ikon (60px) |
| ≤880 | Drawer + scrim; panel 1 kolom; `.kv` jadi satu kolom; composer penuh |
| ≤420 | Judul halaman disembunyikan (subjudul menjadi gantinya), statistik 2 kolom |

Diuji otomatis: `scripts/ui-audit.cjs` memuat 15 halaman × 6 lebar (1440/1280/1024/768/390/360) = 90 kombinasi, mengukur overflow halaman & elemen yang meluber, dan menyimpan screenshot.

## 5. Cara menjalankan audit UI

```bash
# 1) jalankan API + dev server
npm run server        # 127.0.0.1:8787
npm run dev          # 5174 (proxy /api)

# 2) audit responsif + screenshot (15 halaman × 6 lebar = 90 kombinasi)
set UI_AUDIT_URL=http://localhost:5174
set UI_AUDIT_OUT=ui-audit
node_modules\electron\dist\electron.exe scripts\ui-audit.cjs

# 3) audit kontras pada komponen TER-RENDER (bukan token)
set UI_AUDIT_OUT=ui-contrast
node_modules\electron\dist\electron.exe scripts\contrast-audit.cjs
```
Exit code 0 = tidak ada temuan; 1/2 = ada temuan (rincian di `run.log` / `contrast-report.txt` + `report.json` + screenshot PNG per kombinasi).

> Catatan teknis: URL **tidak** boleh diberikan sebagai argumen CLI Electron (dipakai sebagai argumen aplikasi oleh Electron dan proses berhenti diam-diam) — selalu lewat env var `UI_AUDIT_URL`. Selain itu, berkas `.cjs` di lingkungan ini **tidak boleh** diawali komentar `#` atau shebang (Node menafsirkan berkas sebagai ESM dan gagal parses) — gunakan `//`.

## 6. Checklist QA visual (dipakai pada v0.6.1)

1. Tiap rute dibuka pada 1440/1280/1024/768/390/360 → `ui-audit.cjs` (overflow + screenshot).
2. Kontras komponen ter-render diperiksa → `contrast-audit.cjs` (teks ≥4.5:1, non-teks ≥3:1, kontrol nonaktif dikecualikan).
3. Isi halaman dibaca ulang: duplikasi teks, ketuhan yang melayang di luar panel, baris yang tidak sejajar antar kartu.
4. Keadaan kosong/loading/error/success diuji per halaman.
5. Fokus keyboard terlihat (`:focus-visible` + cincin fokus ≥3:1), target sentuh ≥30px, `prefers-reduced-motion` dihormati.
