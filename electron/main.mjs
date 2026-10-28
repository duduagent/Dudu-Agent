import { app, BrowserWindow, Menu, net, protocol, session, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApi } from '../server/api.mjs'
import { MAX_BODY_BYTES } from '../server/chat-api.mjs'
import {
  CSP, HOST, ORIGIN, SCHEME, ensureEnvTemplate, isAllowedExternalUrl, isAppUrl, loadDesktopConfig, resolveStaticPath,
} from './helpers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEV_URL = !app.isPackaged ? process.env.DUDU_DEV_URL : undefined
const DEVTOOLS = !app.isPackaged || process.env.DUDU_DEVTOOLS === '1'

app.setName('Dudu AI')
app.setAppUserModelId('ai.dudu.desktop') // Windows: identitas notifikasi, taskbar, dan installer

// Profil data eksplisit untuk pengujian/paket portabel. Tanpa variabel ini, Electron memakai
// folder data OS bawaan (Windows: %APPDATA%\Dudu AI) sehingga data pengguna tidak tercampur.
if (process.env.DUDU_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DUDU_USER_DATA))
}

// Skema kustom dengan origin tetap (dudu://app) → localStorage tidak hilang antar peluncuran,
// dan tidak perlu membuka port TCP lokal sama sekali.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let mainWindow = null
let apiInstance = null
// Store (misi, indeks KB) dibuat sekali; konfigurasi provider dibaca ulang per permintaan.
const getApi = () => apiInstance ??= createApi({
  getConfig: () => loadDesktopConfig(app.getPath('userData')),
  dataDir: path.join(app.getPath('userData'), 'data'),
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start).catch(fatal)
}

function fatal(err) {
  console.error('[dudu] gagal memulai:', err)
  dialog.showErrorBox('Dudu AI gagal dimulai', String(err?.message || err))
  app.exit(1)
}

function withSecurityHeaders(res) {
  const headers = new Headers(res.headers)
  // Respons yang sudah menetapkan CSP sendiri (mis. unduhan konten pengguna dengan `sandbox`) tidak boleh ditimpa.
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', CSP)
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function registerAppProtocol() {
  const distDir = path.join(app.getAppPath(), 'dist')
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`Build frontend tidak ditemukan di ${distDir}. Jalankan "npm run build" terlebih dahulu.`)
  }

  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== HOST) return new Response('Not found', { status: 404 })

    if (url.pathname.startsWith('/api/')) {
      const config = loadDesktopConfig(app.getPath('userData'))
      const isUpload = request.method === 'POST' && url.pathname === '/api/files'
      const limit = isUpload ? config.maxUploadBytes : MAX_BODY_BYTES
      const declared = Number(request.headers.get('content-length') ?? 0)
      if (declared > limit) return withSecurityHeaders(Response.json({ error: 'request_too_large' }, { status: 413 }))
      const bytes = request.method === 'GET' || request.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer())
      if (bytes.length > limit) return withSecurityHeaders(Response.json({ error: 'request_too_large' }, { status: 413 }))
      const result = await getApi().handle({
        method: request.method,
        path: url.pathname + url.search,
        contentType: request.headers.get('content-type'),
        headers: Object.fromEntries(request.headers.entries()),
        body: isUpload ? '' : bytes.toString('utf8'),
        bytes,
        signal: request.signal,
      })
      if (result.raw) return withSecurityHeaders(new Response(result.raw, { status: result.status, headers: result.headers }))
      // Konfigurasi dibaca ulang tiap permintaan: mengisi dudu.env berlaku tanpa memulai ulang aplikasi.
      return withSecurityHeaders(Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } }))
    }

    const file = resolveStaticPath(distDir, url.pathname)
    if (!file) return new Response('Forbidden', { status: 403 })
    try {
      if (!fs.statSync(file).isFile()) throw new Error('bukan file')
    } catch {
      return new Response('Not found', { status: 404 })
    }
    return withSecurityHeaders(await net.fetch(pathToFileURL(file).toString()))
  })
}

function hardenSession() {
  const ses = session.defaultSession
  // Tolak semua izin kecuali notifikasi untuk UI Dudu sendiri (dipakai fitur Scheduled Reminder).
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission === 'notifications' && isAppUrl(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permission === 'notifications' && isAppUrl(requestingOrigin))
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return
    if (isAppUrl(url)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

function buildMenu() {
  const openConfig = async () => {
    try {
      const file = ensureEnvTemplate(app.getPath('userData'))
      const err = await shell.openPath(path.dirname(file))
      if (err) throw new Error(err)
    } catch (e) {
      dialog.showErrorBox('Tidak dapat membuka folder konfigurasi', String(e?.message || e))
    }
  }
  const template = [
    {
      label: 'Dudu AI',
      submenu: [
        { label: 'Buka folder konfigurasi (dudu.env)', click: openConfig },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit', label: 'Keluar' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Tampilan',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
        ...(DEVTOOLS ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'Dudu AI',
    backgroundColor: '#FCFBF8',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: DEVTOOLS,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.on('page-title-updated', (e) => e.preventDefault()) // judul jendela tetap "Dudu AI"
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[dudu] renderer berhenti:', details.reason)
    if (details.reason !== 'clean-exit') win.reload()
  })
  win.on('closed', () => { mainWindow = null })
  void win.loadURL(DEV_URL || `${ORIGIN}/`)
  return win
}

async function start() {
  if (!DEV_URL) registerAppProtocol()
  hardenSession()
  buildMenu()
  mainWindow = createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow() })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
