# SOP Operator — Daftar Tunggu Dudu (privasi, retensi, pemulihan, insiden)

Untuk siapa pun yang mengoperasikan instance Dudu yang menyimpan daftar tunggu (landing page publik).
Semua keputusan yang **belum ditetapkan pemilik produk** diberi label **DECISION REQUIRED** — jangan
ditebak, jangan diam-diam memutuskan.

> Dokumen ini mengatur **prosedur**, bukan kebijakan bisnis. Angka retensi, PIC, dan tenggat respons
> harus ditetapkan pemilik produk sebelum instance dipakai publik.

---

## 0. Tabel keputusan (ringkasan — pemilik produk)

Status: `DITETAPKAN` (sudah ada di kode/dokumen) · `DECISION REQUIRED` (menunggu pemilik produk).

| # | Item keputusan | Status | Usulan (bukan keputusan) | Dampak jika tidak diputuskan |
|---|---|---|---|---|
| K1 | Tujuan pengumpulan | **DITETAPKAN** | hubsungi saat rilis terverifikasi / beta mobile | — |
| K2 | Data yang dikumpulkan | **DITETAPKAN** | email + platform (+ role, note opsional) | — |
| K3 | Prinsip minimisasi | **DITETAPKAN** | jangan nama/HP/alamat/pembayaran | — |
| K4 | **Kebijakan retensi email** | `DECISION REQUIRED` | hapus entri > 12 bulan | data menumpuk tanpa batas |
| K5 | **Apakah field `note` perlu** | `DECISION REQUIRED` | boleh dikumpulkan, hapus setelah 30 hari | data bebas menumpuk |
| K6 | **PIC operasional** (siapa baca & ekspor daftar) | `DECISION REQUIRED` | satu peran bernama | tidak ada yang bertanggung jawab |
| K7 | **PIC insiden** (kebocoran/akses tak sah) | `DECISION REQUIRED` | satu peran bernama + cadangan | insiden tanpa owner |
| K8 | **Alamat kontak resmi** untuk permintaan penghapusan | `DECISION REQUIRED` | alamat pada domain resmi (belum ada) | pendaftar tidak bisa meminta hapus |
| K9 | **Tenggat respons penghapusan** | `DECISION REQUIRED` | 30 hari kalender | permintaan menggantung |
| K10 | **Backup & retensi backup** | `DECISION REQUIRED` | 1 salinan terenkripsi, retensi 3 bulan | data hilang saat insiden |
| K11 | **Prosedur insiden data** | **DITETAPKAN** | lihat §8 | — |
| K12 | Logging tanpa email | **DITETAPKAN** | API & proxy tidak mencatat email | — |
| K13 | Halaman operator (UI daftar) | **DITETAPKAN (tidak ada)** | akses lewat berkas | — |
| K14 | Notifikasi otomatis ke pendaftar | **DITETAPKAN (tidak ada)** | kontak dilakukan manusia | — |

> kolom "Usulan" **bukan keputusan** — kolom itu diisi pemilik produk, bukan agen.

---

## 1. Tujuan pengumpulan data (dipublikasikan ke pendaftar)

- Menghubungi pendaftar saat **rilis baru yang sudah diverifikasi** (termasuk rilis desktop berikutnya)
  atau saat **beta mobile dibuka**.
- **Bukan** untuk buletin: buletin, penjualan, atau compartir ke pihak ketiga.
- Tidak ada analytics, pixel, atau cookie pihak ketiga di landing page.

Teks ini tercermin di `landing/index.html` §"Get involved" — jika berubah, **perbaruikeduanya** (halaman
dan dokumen ini) agar tidak berbeda.

## 2. Data yang dikumpulkan

| Field | Wajib | Keterangan |
|---|---|---|
| `email` | ya | divalidasi server, dinormalisasi (huruf kecil), maksimal 254 karakter |
| `platform` | ya | salah satu: `web`, `windows`, `linux`, `macos`, `android`, `ios` |
| `role` | tidak | `developer`, `startup`, `umkm`, `creator`, `knowledge` |
| `note` | tidak | teks bebas, maksimal 500 karakter, karakter kontrol dibuang |

**Tidak** dikumpulkan: nama, nomor telepon, alamat, data pembayaran, atau data pengguna aplikasi.

## 3. Lokasi penyimpanan & siapa yang punya akses

| Platform | Lokasi | Perlindungan |
|---|---|---|
| Windows | `%APPDATA%\Dudu AI\data\waiting-list.json` | folder profil per-user (ACL Windows). **Mode POSIX 0600 tidak berlaku di Windows** — keamanan berasal dari ACL per-user. |
| Linux/macOS | `<dataDir>/waiting-list.json` (mis. `~/.config/Dudu AI/data/`) | mode **0600** (dijamin chmod eksplisit setelah tulis) |

- Berkas berisi **alamat email dalam bentuk plaintext** → perlakukan sebagai data pribadi.
- Akses: **hanya akun OS yang menjalankan instance tersebut** (dan operator yang diberi akses ke
  mesin itu). Tidak ada endpoint API untuk membaca daftar (sengaja) → daftar tidak bisa bocor lewat
  antarmuka HTTP.
- **DECISION REQUIRED:** siapa named person/role yang berhak membaca & mengekspor daftar?

## 4. Retensi — **DECISION REQUIRED**

| Item | Nilai | Status |
|---|---|---|
| Masa simpan maksimum entri | — | **DECISION REQUIRED** (usulan: hapus entri yang lebih tua dari 12 bulan) |
| Apakah catatan (`note`) boleh disimpan | — | **DECISION REQUIRED** (usulan: hapus `note` setelah 30 hari) |
| Setiap berapa kali daftar ditinjau | — | **DECISION REQUIRED** |
| Tujuan pencadangan (retensi backup) | — | **DECISION REQUIRED** (usulan: satu salinan terenkripsi, retensi 3 bulan) |

Sampai pemilik produk memutuskan, **jangan** mengarang angka. Yang sudah ditegakkan di kode:
- batas jumlah entri (10.000) → permintaan baru ditolak `429 list_full` (bukan file membengkak);
- batas laju 60/menit per instance → `429 rate_limited`;
- berkas rusak otomatis diprahkan (lihat §7).

## 5. Memproses permintaan penghapusan

Permintaan penghapusan masuk lewat kanal kontak resmi yang dipakai di footer (belum ada alamat
publik — **DECISION REQUIRED**: kanal kontak resmi harus ditetapkan sebelum publikasi).

Langkah:

1. Catat alamat email yang diminta **di luar** berkas daftar (mis. tiket), jangan di sistem lain.
2. Hapus entri:
   ```js
   //_operator (Node, di mesin instance):
   const { createWaitingListStore } = require('./server/waiting-list.mjs')  // ESM: import
   const store = createWaitingListStore({ dataDir: '<dataDir>' })
   await store.remove('alamat@contoh')      // idempoten: removed true/false
   ```
   (atau hapus berkas `waiting-list.json` bila instance di-reset).
3. Verifikasi: `store.count()` decreased dan entri tidak ada di berkas.
4. Balas ke peminta; catat waktu penyelesaian (bukan salinan data ke tempat lain).
5. **DECISION REQUIRED:** tenggat respons dan PIC.

## 6. Backup

- Backup: salin `waiting-list.json` (+ berkas `waiting-list.json.corrupt-*.json` bila ada) ke penyimpanan
  privat. Berkas kecil, plaintext → **enkripsi saat transit dan saat disimpan** wajib.
- Akses backup: seperlunya (DECISION REQUIRED: siapa boleh memulihkan).
- **Jangan** menaruh backup di repositori, CI, atau log aggregator.

## 7. Berkas rusak & pemulihan

Gejala: daftar tiba-tiba kosong, atau API menjawab `503 storage_unavailable`.

Perilaku yang sudah ada (terverifikasi):

- Berkas yang tidak bisa di-parse **tidak dihapus**: ia diprahkan sebagai
  `waiting-list.json.corrupt-<timestamp>.json` di folder data yang sama, lalu daftar baru dimulai.
- Pesan ke operator: `summary().lastRecovery` memberi tahu berkas mana yang diprahkan.

Langkah pemulihan:

1. Jangan menimpa berkas `.corrupt-*` (itu satu-satunya salinan data lama).
2. Periksa isinya (`python3 -m json.tool` / `jq .`) — biasanya caused oleh penulisan yang terputus.
3. Salin isinya ke `waiting-list.json` bila valid, atau pulihkan sebagian (entri yang masih punya
   `email`, `platform`, `createdAt`).
4. Hapus berkas `.corrupt-*` **setelah** pemulihan berhasil (dokumentasikan penghapusan).
5. Periksa log instance: `storage_unavailable` = masalah izin/ruang disk; `ENOSPC` (di log internal) =
   disk penuh.

## 8. Kebocoran atau akses tidak sah

Prosedur standar (**DECISION REQUIRED**: PIC insiden & kontak notifikasi):

1. **Batasi dampak** — hentikan/neutralkan endpoint: matikan blok `location = /api/waiting-list` di
   proxy (halaman statis tetap bisa serve) atau set `maxPerMinute` Very low sementara.
2. **Amankan bukti** — salin log proxy & log aplikasi ke tempat privat; **hapus** salinan yang memuat
   email dari log agregator (jangan sebarkan data yang bocor lebih luas).
3. **Nilai cakupan** — data yang Affected adalah: alamat email, platform, peran, catatan. Tidak ada kredensial
   aplikasi, kunci API, atau data pengguna aplikasi di berkas ini (API membaca daftar tidak pernah
   mengeksposnya).
4. **Komunikasi** — beri tahu pendaftar yang terdampak sesuai kewajiban yang berlaku di yurisdiksi
   instance (DECISION REQUIRED: siapa yang memutuskan & kapan).
5. **Shutdown & rotasi** — bila instance bisa dikompromikan, ganti folder data, buat ulang proxy,
   dan mulai dari daftar kosong (ekspor daftar lama hanya bila memang perlu & aman).
6. **Post-mortem** — catat kronologi, vektor masuk, dan tindakan perbaikan; perketat konfigurasi proxy
   (mis. batasi `limit_req`, tambah autentikasi proxy di depan endpoint).

## 9. Aturan logging (tetap berlaku)

- API **tidak** mencatat email, catatan, atau payload pendaftaran. Yang dicatat: method, path, kode
  error, dan pesan terpotong 200 karakter.
- Proxy **tidak** boleh mencatat body/query. Yang aman: method, path, IP klien, status.
- Jangan pernah mengarahkan `waiting-list.json` ke log aggregator atau CI.

## 10. Yang **belum** ada (harus ditetapkan sebelum publikasi)

| Kekurangan | Status |
|---|---|
| Kanal kontak resmi untuk permintaan penghapusan | **DECISION REQUIRED** |
| Angka & aturan retensi | **DECISION REQUIRED** |
| PIC operator & PIC insiden | **DECISION REQUIRED** |
| Mekanisme notifikasi (email otomatis) | **NOT IMPLEMENTED** — produk tidak punya mailing system; kontak dilakukan manusia |
| Halaman operator untuk melihat/menghapus entri | **NOT IMPLEMENTED** (disengaja — akses lewat berkas) |
