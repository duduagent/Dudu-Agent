// Ledger pemakaian token/biaya. Setiap rekaman membawa provenance eksplisit:
//  - usageProvenance: 'PROVIDER_REPORTED' (token dikatakan provider) | 'ESTIMATED' (chars/4 lokal)
//  - costProvenance: 'PROVIDER_REPORTED_COST' | 'COMPUTED_FROM_CATALOG_PRICING' | 'NONE' (bukan berarti gratis)
//  - tierRecorded: 'provider_catalog' dsb. Tier pada saat request. Kuota provider tdk dibaca → tak pernah diklaim.
import fsp from 'node:fs/promises'
import path from 'node:path'

const FILE = 'usage.json'
const MAX_RECORDS = 5000

export const USAGE_PROVENANCE = { PROVIDER_REPORTED: 'PROVIDER_REPORTED', ESTIMATED: 'ESTIMATED' }
export const COST_PROVENANCE = { PROVIDER_REPORTED_COST: 'PROVIDER_REPORTED_COST', COMPUTED_FROM_CATALOG_PRICING: 'COMPUTED_FROM_CATALOG_PRICING', NONE: 'NONE' }

export function estimateTokensFromChars(chars) {
  return Math.max(1, Math.ceil(Number(chars || 0) / 4))
}

export function createUsageLedger(dataDir, { fs = fsp, now = Date.now, maxRecords = MAX_RECORDS } = {}) {
  const file = path.join(dataDir, FILE)
  let cache = null

  async function load() {
    if (cache) return cache
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      if (raw && raw.version === 1 && Array.isArray(raw.records)) { cache = raw; return cache }
    } catch { /* belum ada */ }
    cache = { version: 1, records: [] }
    return cache
  }

  async function persist() {
    if (!cache) return
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(cache), { mode: 0o600 })
    await fs.rename(tmp, file)
  }

  function sanitizeRecord(r) {
    // Periksa ulang field; invalid → dibuang, jangan dimasukkan setengah-setengah.
    if (!r || typeof r !== 'object') return null
    if (typeof r.providerId !== 'string' || typeof r.modelId !== 'string') return null
    return {
      id: r.id, at: Number(r.at) || now(),
      providerId: r.providerId, modelId: r.modelId,
      kind: r.kind === 'vision' ? 'vision' : 'chat',
      tier: ['free', 'paid', 'unknown', 'local'].includes(r.tier) ? r.tier : 'unknown',
      status: r.status === 'success' ? 'success' : 'failed',
      usage: r.usage && (Number.isFinite(r.usage.input) || Number.isFinite(r.usage.output))
        ? { input: r.usage.input ?? null, output: r.usage.output ?? null, total: r.usage.total ?? (Number.isFinite(r.usage.total) ? r.usage.total : null), cached: r.usage.cached ?? null }
        : { input: null, output: null, total: null, cached: null },
      usageProvenance: r.usageProvenance === USAGE_PROVENANCE.PROVIDER_REPORTED ? USAGE_PROVENANCE.PROVIDER_REPORTED : USAGE_PROVENANCE.ESTIMATED,
      cost: (Number.isFinite(r.cost?.amount)) ? { amount: r.cost.amount, currency: r.cost.currency || 'USD', provenance: r.cost.provenance || COST_PROVENANCE.NONE } : { amount: null, currency: 'USD', provenance: COST_PROVENANCE.NONE },
      fallback: Array.isArray(r.fallback) ? r.fallback.slice(0, 3).map((f) => (typeof f === 'string' ? f.slice(0, 120) : String(f).slice(0, 120))) : [],
      escalationReason: typeof r.escalationReason === 'string' ? r.escalationReason.slice(0, 200) : null,
      mode: ['FREE_ONLY', 'FREE_FIRST', 'BEST_VALUE', 'BEST_QUALITY', 'MANUAL', 'ROTATE'].includes(r.mode) ? r.mode : 'FREE_FIRST',
      purpose: r.purpose === 'mission' ? 'mission' : 'chat',
      conversationId: r.conversationId ? String(r.conversationId).slice(0, 64) : null,
      missionId: r.missionId ? String(r.missionId).slice(0, 64) : null,
    }
  }

  async function record(fields) {
    const rec = sanitizeRecord({ ...fields, at: now() })
    rec.at = now()
    const all = await load()
    all.records.push(rec)
    if (all.records.length > maxRecords) all.records = all.records.slice(-maxRecords)
    await persist()
    return rec
  }

  async function recent(limit = 50) {
    const all = await load()
    return all.records.slice(-limit).reverse()
  }

  /** Ringkasan + status budget + sinyal alert yang dapat dipertanggungjawabkan. */
  async function summary({ now: tnow = now, budget = { paidUsdMonthly: 0 } } = {}) {
    const all = await load()
    const t = tnow()
    const periodStart = new Date(t); periodStart.setUTCDate(1); periodStart.setUTCHours(0, 0, 0, 0)
    const inPeriod = (r) => r.at >= periodStart.getTime()
    const sumBy = (key) => {
      const out = {}
      for (const r of all.records.filter(inPeriod)) {
        const k = key(r)
        out[k] ??= { requests: 0, success: 0, failed: 0, tokens: { input: 0, output: 0, total: 0, estimatedOnly: false, inputActual: 0, inputEstimated: 0, outputActual: 0, outputEstimated: 0 }, cost: 0, costApprox: false, costUnknown: 0 }
        const b = out[k]
        b.requests++
        if (r.status === 'success') b.success++; else b.failed++
        if (r.usage.input != null || r.usage.output != null) {
          const ip = r.usage.input ?? 0, op = r.usage.output ?? 0
          b.tokens.input += ip; b.tokens.output += op
          if (r.usageProvenance === USAGE_PROVENANCE.PROVIDER_REPORTED) {
            b.tokens.inputActual += ip; b.tokens.outputActual += op
          } else {
            b.tokens.inputEstimated += ip; b.tokens.outputEstimated += op; b.tokens.estimatedOnly = true
          }
          b.tokens.total += (r.usage.total ?? (ip + op))
        }
        if (r.cost?.amount != null && (r.cost.provenance === COST_PROVENANCE.PROVIDER_REPORTED_COST || r.cost.provenance === COST_PROVENANCE.COMPUTED_FROM_CATALOG_PRICING)) {
          b.cost += r.cost.amount
          if (r.cost.provenance === COST_PROVENANCE.COMPUTED_FROM_CATALOG_PRICING) b.costApprox = true
        } else if (r.tier === 'paid') {
          b.costUnknown++
        }
      }
      return out
    }
    const byProvider = sumBy((r) => r.providerId)
    const byModel = sumBy((r) => `${r.providerId}:${r.modelId}`)
    const totals = Object.values(byProvider).reduce((acc, b) => {
      acc.requests += b.requests; acc.success += b.success; acc.failed += b.failed
      acc.tokens.input += b.tokens.input; acc.tokens.output += b.tokens.output
      acc.tokens.total += b.tokens.total
      acc.tokens.inputActual += b.tokens.inputActual; acc.tokens.inputEstimated += b.tokens.inputEstimated
      acc.tokens.outputActual += b.tokens.outputActual; acc.tokens.outputEstimated += b.tokens.outputEstimated
      if (b.tokens.estimatedOnly) acc.tokens.estimatedOnly = true
      acc.cost += b.cost
      if (b.costApprox) acc.costApprox = true
      acc.costUnknown += b.costUnknown
      return acc
    }, { requests: 0, success: 0, failed: 0, tokens: { input: 0, output: 0, total: 0, estimatedOnly: false, inputActual: 0, inputEstimated: 0, outputActual: 0, outputEstimated: 0 }, cost: 0, costApprox: false, costUnknown: 0 })

    // Budget berbayar per periode (bulan berjalan UTC).
    const paidCost = Object.entries(byProvider).reduce((a, [id, b]) => a + (id.startsWith('ollama:') ? 0 : b.cost), 0)
    // total paid hanya dianggap dari rekaman tier 'paid'
    const paidRecords = all.records.filter(inPeriod).filter((r) => r.tier === 'paid')
    const paidCostExact = paidRecords.reduce((a, r) => a + (r.cost?.amount ?? 0), 0) // hanya provenance tercatat
    const cap = Math.max(0, Number(budget.paidUsdMonthly) || 0)
    const budgetStatus = cap <= 0
      ? { cap, spent: paidCostExact, pct: null, state: 'unset' }
      : { cap, spent: paidCostExact, pct: Math.min(100, Math.round((paidCostExact / cap) * 100)), state: paidCostExact >= cap ? 'exceeded' : paidCostExact >= cap * 0.9 ? 'critical' : paidCostExact >= cap * 0.75 ? 'warn' : 'ok' }

    // Sinyal alert dari data yang benar-benar tercatat:
    const recentRecords = all.records.slice(-200)
    const alerts = []
    if (budgetStatus.state === 'exceeded') alerts.push({ kind: 'budget_exceeded', message: `Anggaran berbayar tercapai (USD ${paidCostExact.toFixed(4)} / batas USD ${cap}). Permintaan berbayar baru diblokir.` })
    else if (budgetStatus.state === 'critical') alerts.push({ kind: 'budget_critical', message: `Pemakaian berbayar bulan ini ≥90% anggaran (USD ${paidCostExact.toFixed(4)} / USD ${cap}).` })
    else if (budgetStatus.state === 'warn') alerts.push({ kind: 'budget_warn', message: `Pemakaian berbayar bulan ini ≥75% anggaran (USD ${paidCostExact.toFixed(4)} / USD ${cap}).` })

    const rateLimited = recentRecords.some((r) => r.status === 'failed' && r.fallback.some((f) => f.includes('429')))
    if (rateLimited) alerts.push({ kind: 'rate_limit', message: 'Ada permintaan yang gagal karena rate limit (HTTP 429) dalam pemakaian terkini.' })

    const escalations = recentRecords.filter((r) => r.escalationReason && r.tier === 'paid').length
    if (escalations > 0) alerts.push({ kind: 'paid_escalation', message: `${escalations} request terakhir naik ke model berbayar (alasan tercatat di riwayat routing).` })

    const estOnly = recentRecords.filter((r) => r.usageProvenance === USAGE_PROVENANCE.ESTIMATED && (r.usage.input != null || r.usage.output != null)).length
    if (estOnly > 0) alerts.push({ kind: 'usage_estimated', message: `${estOnly} request terakhir tidak melaporkan token asli; angkanya estimasi lokal (chars/4), bukan angka provider.` })

    const failN = recentRecords.filter((r) => r.status === 'failed').length
    if (failN >= 3) alerts.push({ kind: 'provider_failures', message: `${failN} dari ${recentRecords.length} request terakhir gagal. Status test koneksi provider dapat dilihat di Pengaturan.` })

    return { generatedAt: t, periodStart: periodStart.getTime(), totals, byProvider, byModel, budget: budgetStatus, alerts, recordCount: all.records.length }
  }

  return { record, summary, recent, file }
}
