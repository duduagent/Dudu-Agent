// Merender build/icon.svg → build/icon.png (1024x1024) memakai Chromium milik Electron.
// Pakai: npx electron scripts/render-icon.cjs   (di Linux tanpa display: xvfb-run -a npx electron --no-sandbox scripts/render-icon.cjs)
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const root = path.join(__dirname, '..')
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: true } })
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise(r => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), img.toPNG())
  console.log('icon.png ditulis:', img.getSize())
  app.quit()
})
