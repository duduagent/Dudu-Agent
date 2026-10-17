# Dudu — AI Workforce & Agent OS

## Persyaratan
- Node.js 18 atau lebih baru
- API key dari provider model yang kompatibel dengan endpoint OpenAI Chat Completions

## Instalasi di Windows
1. Ekstrak ZIP ke folder kerja, misalnya `C:\Users\LENOVO\Documents\Dudu agent\dudu`.
2. Buka folder tersebut di VS Code.
3. Buka terminal dan jalankan `npm install`.
4. Salin `.env.example` menjadi `.env`.
5. Isi `DUDU_PROVIDER_API_KEY` pada `.env` dengan API key milikmu. Jangan bagikan file `.env`.
6. Pastikan `DUDU_PROVIDER_BASE_URL` dan `DUDU_MODEL` cocok dengan provider dan model akunmu.

## Menjalankan aplikasi
Buka dua terminal terpisah di folder proyek.

Terminal 1 — backend:
```powershell
node --env-file=.env server/chat-server.mjs
```

Terminal 2 — frontend:
```powershell
npm.cmd run dev -- --port 5174
```

Buka `http://localhost:5174` di browser. Pemeriksaan backend: `http://localhost:8787/api/health`.

Jika terminal backend mengatakan `EADDRINUSE`, server sudah berjalan pada port itu; jangan jalankan backend kedua kali. Jika provider gagal, periksa pesan error di terminal backend dan status API key/model pada provider.

## Pemeriksaan
```powershell
npm test
npm run build
```

## Catatan keamanan
- `.env` tidak disertakan dalam ZIP ini. Buat dari `.env.example`.
- Jangan mengunggah atau membagikan API key aktif.
- `node_modules` dan `dist` tidak disertakan; keduanya dapat dibuat ulang dengan `npm install` dan `npm run build`.
