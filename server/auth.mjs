// Akun & otorisasi lokal Dudu: daftar/login email + kata sandi (scrypt), sesi token,
// dan OAuth Google/GitHub SANS MENYIMPAN APLIKASI PIHAK KETIGA.
// Jujur: OAuth hanya berfungsi bila pengguna mendaftarkan aplikasinya sendiri (clientId +
// clientSecret); tanpa itu statusnya `not_configured` dan tidak ada yang dikarang.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const OAUTH_PROVIDERS = ['google', 'github']
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 hari
const HASH_LEN = 64
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const OAUTH_URLS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    profile: 'https://api.github.com/user',
  },
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, file)
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, HASH_LEN).toString('hex')
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex') }

export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

export function normalizeEmail(email) {
  const e = String(email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(e)) throw new AuthError(400, 'bad_email', 'Format email tidak valid.')
  return e
}

export function createAuthStore({ dataDir, fetchImpl = globalThis.fetch }) {
  const usersFile = path.join(dataDir, 'users.json')
  const sessionsFile = path.join(dataDir, 'sessions.json')
  const oauthFile = path.join(dataDir, 'oauth-apps.json')
  const users = new Map()   // email -> user
  const sessions = new Map() // sha256(token) -> { userId, expiresAt }
  const oauth = new Map()   // provider -> { clientId, clientSecret }
  let loaded = false

  async function load() {
    if (loaded) return
    loaded = true
    for (const [file, map, ok] of [
      [usersFile, users, (u) => u && typeof u.email === 'string'],
      [sessionsFile, sessions, (s) => s && typeof s.userId === 'string'],
      [oauthFile, oauth, (o) => o && typeof o.clientId === 'string'],
    ]) {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'))
        for (const item of Array.isArray(raw) ? raw : Object.values(raw)) if (ok(item)) map.set(keyOf(file, item), item)
      } catch { /* belum ada / korup: mulai kosong, tak ada yang dikarang */ }
    }
  }
  const keyOf = (file, item) => (file === usersFile ? item.email : file === oauthFile ? item.provider : item.tokenHash)

  const persistUsers = () => writeAtomic(usersFile, JSON.stringify([...users.values()], null, 1))
  const persistSessions = () => writeAtomic(sessionsFile, JSON.stringify([...sessions.values()], null, 1))
  const persistOauth = () => writeAtomic(oauthFile, JSON.stringify([...oauth.values()], null, 1))

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, provider: u.provider, createdAt: u.createdAt })

  async function register({ email, password, name }) {
    await load()
    const e = normalizeEmail(email)
    if (typeof password !== 'string' || password.length < 8) throw new AuthError(400, 'weak_password', 'Kata sandi minimal 8 karakter.')
    if (users.has(e)) throw new AuthError(409, 'email_taken', 'Email ini sudah terdaftar di perangkat ini.')
    const salt = crypto.randomBytes(16).toString('hex')
    const user = {
      id: crypto.randomUUID(), email: e, name: String(name ?? e.split('@')[0]).slice(0, 60),
      provider: 'local', salt, passHash: hashPassword(password, salt), createdAt: Date.now(),
    }
    users.set(e, user); await persistUsers()
    return publicUser(user)
  }

  async function login({ email, password }) {
    await load()
    const e = normalizeEmail(email)
    const u = users.get(e)
    if (!u) throw new AuthError(401, 'bad_credentials', 'Email atau kata sandi salah.')
    // Verifikasi dengan pembanding konstan-waktu terhadap hash scrypt yang asli.
    const candidate = Buffer.from(hashPassword(password ?? '', u.salt), 'hex')
    const stored = Buffer.from(u.passHash, 'hex')
    const ok = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
    if (!ok) throw new AuthError(401, 'bad_credentials', 'Email atau kata sandi salah.')
    return publicUser(u)
  }

  async function upsertExternalUser({ provider, subject, email, name }) {
    await load()
    const e = normalizeEmail(email)
    let u = users.get(e)
    if (!u) {
      u = { id: crypto.randomUUID(), email: e, name: String(name ?? e.split('@')[0]).slice(0, 60), provider, subject, createdAt: Date.now() }
      users.set(e, u); await persistUsers()
    }
    return publicUser(u)
  }

  async function createSession(userId) {
    await load()
    if (![...users.values()].some((u) => u.id === userId)) throw new AuthError(404, 'no_user', 'Pengguna tidak ditemukan.')
    const token = crypto.randomBytes(32).toString('hex')
    const rec = { tokenHash: sha256(token), userId, expiresAt: Date.now() + SESSION_TTL_MS }
    sessions.set(rec.tokenHash, rec); await persistSessions()
    return { token, expiresAt: rec.expiresAt }
  }

  async function verifySession(token) {
    await load()
    if (typeof token !== 'string' || !token) return null
    const rec = sessions.get(sha256(token))
    if (!rec) return null
    if (rec.expiresAt < Date.now()) { sessions.delete(rec.tokenHash); await persistSessions(); return null }
    const u = [...users.values()].find((x) => x.id === rec.userId)
    return u ? { user: publicUser(u), expiresAt: rec.expiresAt } : null
  }

  async function logout(token) {
    await load()
    const rec = sessions.get(sha256(token ?? ''))
    if (!rec) return false
    sessions.delete(rec.tokenHash); await persistSessions(); return true
  }

  /* ---------- konfigurasi aplikasi OAuth milik pengguna (BYO credentials) ---------- */
  async function setOauthApp(provider, { clientId, clientSecret }) {
    await load()
    if (!OAUTH_PROVIDERS.includes(provider)) throw new AuthError(400, 'bad_provider', `Provider OAuth tidak dikenal; salah satu dari: ${OAUTH_PROVIDERS.join(', ')}.`)
    if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret.trim())
      throw new AuthError(400, 'bad_oauth_config', 'clientId dan clientSecret wajib diisi.')
    oauth.set(provider, { provider, clientId: clientId.trim(), clientSecret: clientSecret.trim() })
    await persistOauth()
  }
  async function oauthStatus(provider) {
    await load()
    const app = oauth.get(provider)
    return { provider, configured: Boolean(app), clientId: app ? `${app.clientId.slice(0, 4)}…` : null } // rahasia tidak pernah dikirim penuh
  }

  async function authorizeUrl(provider, { redirectUri, state } = {}) {
    await load()
    const def = OAUTH_URLS[provider]; const app = oauth.get(provider)
    if (!def || !app) throw new AuthError(409, 'not_configured', `Aplikasi OAuth ${provider} belum diatur — daftarkan Client ID & Secret dulu (lihat petunjuk di halaman Akun).`)
    const u = new URL(def.authorize)
    u.searchParams.set('client_id', app.clientId)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('scope', def.scope)
    u.searchParams.set('state', state || crypto.randomBytes(8).toString('hex'))
    return { url: u.toString() }
  }

  async function exchangeCode(provider, { code, redirectUri } = {}) {
    await load()
    const def = OAUTH_URLS[provider]; const app = oauth.get(provider)
    if (!def || !app) throw new AuthError(409, 'not_configured', `Aplikasi OAuth ${provider} belum diatur.`)
    if (typeof code !== 'string' || !code.trim()) throw new AuthError(400, 'bad_code', 'Kode otorisasi kosong.')
    const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code: code.trim(), grant_type: 'authorization_code' })
    if (def.token === 'https://oauth2.googleapis.com/token') body.set('redirect_uri', redirectUri ?? '')
    const res = await fetchImpl(def.token, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'DuduAI/0.4' },
      body: body.toString(),
    })
    const tok = await res.json().catch(() => null)
    if (!res.ok || !tok?.access_token) throw new AuthError(401, 'oauth_exchange_failed', `Pertukaran token ${provider} gagal: ${tok?.error_description || tok?.error || `HTTP ${res.status}`}.`)
    const profile = await fetchProfile(provider, tok.access_token)
    const user = await upsertExternalUser({ provider, subject: profile.subject ?? profile.id, email: profile.email, name: profile.name ?? profile.login })
    const session = await createSession(user.id)
    return { user, session }
  }

  async function fetchProfile(provider, accessToken) {
    const def = OAUTH_URLS[provider]
    const res = await fetchImpl(def.profile, { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}`, 'user-agent': 'DuduAI/0.4' } })
    if (!res.ok) throw new AuthError(401, 'oauth_profile_failed', `Profil ${provider} tidak dapat dibaca: HTTP ${res.status}.`)
    return res.json()
  }

  return { register, login, upsertExternalUser, createSession, verifySession, logout, setOauthApp, oauthStatus, authorizeUrl, exchangeCode }
}
