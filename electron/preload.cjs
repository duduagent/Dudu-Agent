// Preload ter-sandbox: hanya mengekspos konstanta statis. Tidak ada IPC, tidak ada akses Node ke halaman.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('dudu', Object.freeze({ isDesktop: true, platform: process.platform }))
