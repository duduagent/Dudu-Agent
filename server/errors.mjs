// Kelas error terpadu untuk gateway provider. status = HTTP-like code untuk respons API lokal.
export class DuduError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    Object.assign(this, extra)
  }
}

/** Konfigurasi (kunci/URL) tidak valid atau belum dipasang. */
export class ProviderConfigError extends DuduError {
  constructor(message) { super(400, 'provider_config_error', message) }
}

/** Permintaan ke provider gagal (jaringan/HTTP). status = status upstream bila ada. */
export class ProviderRequestError extends DuduError {
  constructor(message, status = 502, details = {}) {
    super(502, 'provider_request_error', message, { upstreamStatus: status, ...details })
  }
}

/** Funding/budget/kebijakan routing menghentikan permintaan. */
export class PolicyError extends DuduError {
  constructor(code, message, status = 402) { super(status, code, message) }
}

export const errorToBody = (e) => ({
  error: e?.code || 'internal_error',
  message: String(e?.message || e).slice(0, 400),
  ...(Number.isFinite(e?.upstreamStatus) ? { upstreamStatus: e.upstreamStatus } : {}),
})
