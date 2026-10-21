# Fixture tes

Berkas di sini dihasilkan oleh **perangkat lunak independen** (bukan oleh kode proyek) agar parser diuji terhadap format nyata:

| Berkas | Sumber |
|---|---|
| `real.docx` | python-docx (heading, run berformat, Unicode, tabel) |
| `real.xlsx` | openpyxl (2 sheet, string/angka/sel kosong, formula **tanpa** nilai tersimpan) |
| `real.pptx` | python-pptx (2 slide) |
| `real.odt`, `real.ods`, `real.odp`, `real.rtf`, `libreoffice.pdf` | LibreOffice headless (`--convert-to`) dari `real.docx/.xlsx/.pptx` |
| `real.pdf` | reportlab (2 halaman teks) |
| `scan.pdf`, `scan.png` | reportlab + Pillow: PDF berisi **hanya gambar**, tanpa lapisan teks (simulasi pindaian) |
| `sales.csv` | tulis tangan; nilai diketahui (4 baris; Jumlah total 41; Harga total 142000.5) |

Data fiktif. Untuk membuat ulang: `pip install python-docx openpyxl python-pptx reportlab pillow` lalu skrip pembuat di riwayat pengembangan; konversi ODF/RTF/PDF memakai `soffice --headless --convert-to`.
