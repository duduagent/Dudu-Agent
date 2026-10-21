# Dudu — Keputusan Pembangunan dan Kriteria End-to-End

> **Catatan:** dokumen keputusan awal. Arsitektur desktop dan strategi packaging terkini ada di [README.md](README.md) dan [PACKAGING.md](PACKAGING.md).

Tanggal: 11 Oktober 2026
Status: keputusan arah pembangunan; implementasi dan pengujian belum terverifikasi.

## Keputusan

1. Lanjutkan dari fondasi React 18 + TypeScript + Vite yang sudah dikirim sebagai source. Jangan menjadikan HTML prototype sebagai basis runtime utama; gunakan sebagai referensi visual bila diperlukan.
2. Orion adalah kolaborator opsional selama pembangunan, bukan dependency runtime. Tidak ada integrasi API Orion pada milestone ini.
3. Prioritas: satu misi Scheduled Reminder yang nyata, sempit, aman, dan dapat diverifikasi sebelum memperluas katalog misi.
4. Jangan menyatakan fitur sukses berdasarkan tampilan atau simulasi. Status harus didukung oleh hasil eksekusi dan bukti.
5. Penyimpanan lokal browser bukan cloud/database server; jangan menggambarkannya sebagai persistensi produksi.

## Alur target Scheduled Reminder

Instruksi pengguna → validasi waktu dan zona waktu → tampilkan ringkasan untuk konfirmasi → simpan misi dan status → jadwalkan pengingat melalui mekanisme yang benar-benar tersedia → jalankan/beritahu pengguna → catat hasil → izinkan melihat, membatalkan, dan memulihkan misi.

## Kriteria penerimaan minimum

- Waktu tidak valid atau masa lalu ditolak dengan pesan yang jelas.
- Zona waktu ditangani secara eksplisit; waktu tersimpan tidak bergeser setelah reload.
- Misi tetap terlihat setelah aplikasi dimulai ulang.
- Konfirmasi tidak membuat misi duplikat; eksekusi ulang bersifat idempoten.
- Pembatalan menghentikan pengingat yang belum dijalankan.
- Izin notifikasi ditangani dengan jujur; bila ditolak/tidak didukung, UI menyebutkan keterbatasan.
- Kegagalan scheduler/izin/penyimpanan terlihat sebagai gagal atau terhambat, bukan berhasil.
- Ada bukti pengujian otomatis dan uji runtime manual.

## Batasan penting

Browser timer biasa tidak menjamin notifikasi saat browser atau perangkat mati. Jika kebutuhan pengingat harus berjalan saat browser tertutup, diperlukan scheduler persisten di server/layanan terkelola dan notifikasi yang dikonfigurasi. Pilihan ini harus menjadi keputusan arsitektur tersendiri, bukan disamarkan oleh timer di UI.

## Status saat paket ini dibuat

- Source React/TypeScript diekstrak dari materi yang diberikan ke folder proyek.
- `npm install` dicoba tetapi timeout pada lingkungan ini; dependensi tidak terpasang.
- Karena itu `npm run build`, test otomatis, dan runtime belum bisa diklaim lulus.
- Langkah teknis berikutnya: selesaikan audit source, pasang dependensi pada lingkungan dengan akses registry, jalankan build dan test, perbaiki kegagalan, lalu implementasikan workflow Scheduled Reminder dengan scheduler yang dipilih dan kriteria di atas.

## Pembaruan implementasi — Scheduled Reminder MVP

- Ditambahkan halaman Scheduled Reminder pada menu Misi & Tugas.
- Pengingat disimpan di localStorage, memvalidasi judul dan waktu masa depan, menyimpan timestamp ISO dan zona waktu perangkat, serta menyediakan pembatalan dan riwayat.
- Jika browser mendukung Web Notifications, aplikasi meminta izin melalui aksi pengguna. Jika izin ditolak/tidak tersedia, aplikasi menjelaskan batasannya.
- Scheduler MVP hanya memeriksa pengingat saat aplikasi terbuka. Ini belum menjamin eksekusi saat browser/perangkat mati dan bukan scheduler server produksi.
- Ditambahkan tes validasi dan pembuatan pengingat di `tests/reminders.test.ts`.
- Build dan tes tetap BELUM TERVERIFIKASI karena `npm install --no-audit --no-fund` timeout di lingkungan kerja ini; jangan menyatakan tes lulus sebelum dijalankan pada lingkungan dengan akses dependensi.
