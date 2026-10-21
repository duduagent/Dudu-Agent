// Routing engine: klasifikasi task heuristik → kandidat capability-aware → pemilihan.
// Default global FREE_FIRST (paid-when-justified). Tidak ada model yang ditukar diam-diam:
// setiap fallback/eskalasi punya alasan tercatat, dan MANUAL tidak pernah diganti.
//
// Mode:
//  FREE_ONLY     — hanya tier free/local; TIDAK ADA kandidat paid pada daftar fallback, apa pun alasannya.
//  FREE_FIRST    — gratis dulu; paid hanya bila tidak ada kandidat gratis yang memenuhi kebutuhan (alasan wajib).
//  BEST_VALUE    — gratis dan berbayar ditimbang (kecocokan capability, konteks, biaya).
//  BEST_QUALITY  — kualitas/durabilitas terbaik yang tersedia (tetap dijaga budget berbayar).
//  MANUAL        — model pilihan pengguna; tidak pernah diganti; error diteruskan apa adanya.
//
// Fallback antar kandidat dibatasi maxFallbacks dan SELALU mematuhi batasan tier & budget.

export const ROUTING_MODES = ['FREE_ONLY', 'FREE_FIRST', 'BEST_VALUE', 'BEST_QUALITY', 'MANUAL', 'ROTATE']

/** Batas output default per kategori tugas (Token Economy: batasi output yang tidak dibutuhkan). */
export const CLASS_MAX_TOKENS = {
  general_chat: 1200, coding: 2400, 'data-analysis': 1800, writing: 2000,
  research: 1600, reasoning: 2000, planning: 1600, vision: 1200,
}
export const defaultMaxTokens = (task) => CLASS_MAX_TOKENS[task?.category] ?? 1200

const INDEX_KEYS = [
  'koda|code|bug|stack trace|compile|typescript|javascript|python|sql|regex|debug|refactor',
  'analisis|data|statistik|grafik|tren|csv|dataset|tabel angka|profil',
  'terjemah|translate|ringkas|summar|paraprase',
  'riset|resea|cari|bandingkan|referensi',
  'algoritma|silogisme|buktikan|matematika|problem solving|logika',
  'rencanakan|dekomposisi|roadmap|checklist|tahapan',
]
const CATEGORY_BY_INDEX = ['coding', 'data-analysis', 'writing', 'research', 'reasoning', 'planning']

/** Klasifikasi task heuristik — TANPA panggilan LLM (hemat token; tidak dipanggil model untuk ayat sederhana). */
export function classifyTask(text, { hasImages = false } = {}) {
  const s = String(text ?? '')
  const lower = s.toLowerCase()
  let category = 'general_chat'
  if (hasImages) category = 'vision'
  else {
    for (let i = 0; i < INDEX_KEYS.length; i++) {
      const parts = INDEX_KEYS[i].split('|')
      for (const w of parts) {
        if (lower.includes(w)) { category = CATEGORY_BY_INDEX[i]; break }
      }
      if (category !== 'general_chat') break
    }
  }
  const requiresTools = /tool call|function call|structured output|json ketat/i.test(s)
  return {
    category, complexity: s.length > 1200 ? 'high' : s.length > 350 ? 'medium' : 'low',
    requiresVision: Boolean(hasImages), requiresTools,
    estimatedInputChars: s.length,
  }
}

export function candidateScore(m, task, { mode, privacyLocalPreferred = true } = {}) {
  let score = 0
  const reasons = []
  if (m.tier === 'free') { score += mode === 'BEST_QUALITY' ? 2 : 4; reasons.push('tier:gratis') }
  else if (m.tier === 'local') { score += privacyLocalPreferred ? 5 : 2; reasons.push('tier:lokal (tanpa biaya API)') }
  else if (m.tier === 'paid') {
    score += mode === 'BEST_QUALITY' ? 5 : mode === 'BEST_VALUE' ? 2 : 0
    if (mode !== 'BEST_QUALITY') reasons.push('tier:berbayar (hanya bila diperlukan)')
  } else { reasons.push('tier:tidak diketahui (diperlakukan bukan gratis)') }
  if (task.requiresVision) {
    if (m.capabilities?.vision === true) { score += 3; reasons.push('vision didukung') }
    else if (m.capabilities?.vision === false) return { score: -Infinity, reasons: ['vision tidak didukung'] }
    // vision === null (provider tidak melaporkan modalitas) → tidak bisa dipercaya untuk vision
    else return { score: -Infinity, reasons: ['dukungan vision tidak diketahui (metadata tidak tersedia)'] }
  }
  if (task.complexity === 'high' && Number.isFinite(m.contextWindow) && m.contextWindow >= 32_000) { score += 1; reasons.push('konteks besar') }
  return { score, reasons }
}

/**
 * Pilih kandidat. Bila tidak ada yang memenuhi kebutuhan, mengembalikan { error, detail }
 * dengan alasan spesifik — JANGAN memilih model yang tidak memenuhi kebutuhan.
 */
export function selectModel({ mode, manualSelection = null, task, catalogEntries = [], budgetStatus = { state: 'unset' }, maxFallbacks = 2, rotationCursor = 0 }) {
  const policy = { mode, maxFallbacks }
  if (mode === 'MANUAL') {
    if (!manualSelection?.providerId || !manualSelection?.modelId) return { error: 'manual_selection_missing', detail: 'Mode MANUAL memerlukan pilihan provider dan model.' }
    const entry = catalogEntries.find((m) => m.providerId === manualSelection.providerId && m.id === manualSelection.modelId)
    if (!entry) return { error: 'manual_model_not_listed', detail: 'Model pilihan tidak ada di katalog provider yang diaktifkan.' }
    if (budgetStatus.state === 'exceeded' && entry.tier === 'paid') return { error: 'budget_exceeded', detail: 'Anggaran berbayar tercapai; pilih model gratis atau naikkan batas anggaran.' }
    if (task.requiresVision && entry.capabilities?.vision !== true) return { error: 'manual_model_no_vision', detail: 'Model pilihan tidak mendukung gambar (metadata vision tidak memenuhi).' }
    return {
      chosen: entry, tier: entry.tier, mode, maxFallbacks,
      reason: 'Model pilihan manual pengguna; TIDAK diganti diam-diam.',
      candidates: [entry], considered: [entry], fallbackAllowed: false,
    }
  }

  const usable = catalogEntries.filter((m) => {
    if (m.tier === 'paid' && budgetStatus.state === 'exceeded') return false // budget habis → berbayar diblokir
    if (task.requiresVision && m.capabilities?.vision !== true) return false
    return true
  })
  const scored = usable
    .map((m) => ({ m, ...candidateScore(m, task, { mode, privacyLocalPreferred: true }) }))
    .filter((x) => x.score > -Infinity)
  scored.sort((a, b) => b.score - a.score)
  const paidNote = budgetStatus.state === 'exceeded' ? ' Anggaran berbayar bulan ini sudah habis — model berbayar diblokir kebijakan.' : ''

  const freeCandidates = scored.filter((x) => x.m.tier === 'free' || x.m.tier === 'local')

  if (mode === 'FREE_ONLY') {
    if (!freeCandidates.length) return { error: 'no_free_model', detail: `Mode free-only: tidak ada model gratis/lokal yang tersedia dan memenuhi kebutuhan${task.requiresVision ? ' (butuh vision)' : ''}.${paidNote}` }
    const best = freeCandidates[0]
    return {
      chosen: best.m, tier: best.m.tier, mode, maxFallbacks,
      reason: `Free-only: dipilih dari ${freeCandidates.length} kandidat gratis/lokal (${best.reasons.join(', ')}). Fallback hanya antar kandidat gratis/lokal; kandidat berbayar tidak pernah diizinkan.`,
      candidates: freeCandidates.map((x) => x.m), considered: scored.map((x) => x.m).slice(0, 6),
      fallbackAllowed: true,
    }
  }

  if (!scored.length) return { error: 'no_available_model', detail: `Tidak ada model yang tersedia dan memenuhi kebutuhan${paidNote}` }

  if (mode === 'FREE_FIRST') {
    if (freeCandidates.length) {
      const best = freeCandidates[0]
      return {
        chosen: best.m, tier: best.m.tier, mode, maxFallbacks,
        reason: `Free-first: kandidat gratis/lokal tersedia; berbayar tidak diperlukan (${best.reasons.join(', ')}).`,
        candidates: freeCandidates.map((x) => x.m), considered: scored.map((x) => x.m).slice(0, 6),
        fallbackAllowed: true,
      }
    }
    // Tidak ada kandidat gratis yang memenuhi: lanjut ke kandidat terbaik yang tersisa.
    // Hanya tier 'paid' yang dianggap eskalasi berbayar; tier 'unknown' diberi label jujur (bukan gratis, tidak dibayar tahu).
    if (budgetStatus.state === 'exceeded') return { error: 'budget_exceeded', detail: 'Tidak ada kandidat gratis dan anggaran berbayar habis; kandidat berbayar diblokir kebijakan.' }
    const best = scored[0]
    const escalating = best.m.tier === 'paid'
    return {
      chosen: best.m, tier: best.m.tier, mode, maxFallbacks,
      ...(escalating ? { escalationReason: `Tidak ada model gratis/lokal yang memenuhi kebutuhan${task.requiresVision ? ' (butuh vision)' : ''}; eskalasi ke model berbayar.` } : {}),
      reason: `Tidak ada kandidat gratis yang memenuhi kebutuhan; memakai ${best.m.providerId}/${best.m.id} (tier: ${best.m.tier}) (${best.reasons.join(', ')}).`,
      candidates: [best.m], considered: scored.map((x) => x.m).slice(0, 6),
      fallbackAllowed: true,
    }
  }

  // BEST_VALUE / BEST_QUALITY — atau ROTATE (perputaran otomatis antar kandidat yang cocok
  // per kategori tugas; gratis/lokal selalu didahulukan agar hemat token, berbayar tetap dijaga budget).
  if (mode === 'ROTATE') {
    const pool = freeCandidates.length ? freeCandidates : scored
    if (!pool.length) return { error: 'no_available_model', detail: `Tidak ada kandidat yang memenuhi kebutuhan${paidNote}` }
    const idx = ((rotationCursor % pool.length) + pool.length) % pool.length
    const pick = pool[idx]
    return {
      chosen: pick.m, tier: pick.m.tier, mode, maxFallbacks,
      reason: `Perputaran otomatis: kandidat ke-${idx + 1}/${pool.length} untuk task "${task.category}" (${pick.reasons.join(', ')}). Gratis/lokal didahulukan; seluruh model berbayar tetap dijaga anggaran.`,
      candidates: pool.map((x) => x.m), considered: scored.map((x) => x.m).slice(0, 6),
      fallbackAllowed: true,
      nextRotation: rotationCursor + 1,
    }
  }

  const chosen = scored[0]
  return {
    chosen: chosen.m, tier: chosen.m.tier, mode, maxFallbacks,
    reason: `${mode}: dipilih (skor tertinggi: ${chosen.reasons.join(', ')}).`,
    candidates: scored.map((x) => x.m).slice(0, 4), considered: scored.map((x) => x.m).slice(0, 6),
    fallbackAllowed: true,
  }
}

/**
 * Fallback terkendali setelah kandidat gagal:
 * - MANUAL: tidak pernah.
 * - FREE_ONLY: tetap pada kandidat free/local; berbayar tidak pernah masuk.
 * - Lainnya: kandidat berikutnya yang lolos budget guard.
 */
export function nextFallback(state, failedCandidate) {
  if (!state?.fallbackAllowed || state.mode === 'MANUAL') return null
  if (state.fallbackCount >= (state.maxFallbacks ?? 2)) return null
  const used = state.usedSet ?? new Set()
  used.add(`${failedCandidate.providerId}::${failedCandidate.id}`)
  const pool = (state.candidates ?? []).filter((c) => {
    if (used.has(`${c.providerId}::${c.id}`)) return false
    if (c.tier === 'paid' && state.budgetStatus?.state === 'exceeded') return false
    if (state.mode === 'FREE_ONLY' && c.tier !== 'free' && c.tier !== 'local') return false
    if (state.mode === 'FREE_FIRST' && (state.escalationReason == null) && c.tier === 'paid') {
      // fallback dari gratis → berbayar hanya bila kegagalan bukan sekadar kecepatan (biaya) dan policy;
      // kegagalan dsb. diberlakukan di gateway dengan alasan — berbayar diperbolehkan (eskalasi terkendali).
      return false
    }
    return true
  })
  if (!pool.length) return null
  const next = pool[0]
  return {
    ...state, chosen: next, tier: next.tier,
    fallbackCount: (state.fallbackCount ?? 0) + 1,
    usedSet: used,
    lastFallbackReason: `Kandidat ${failedCandidate.providerId}/${failedCandidate.id} gagal; beralih ke ${next.providerId}/${next.id} (fallback ${state.fallbackCount + 1}/${state.maxFallbacks}).`,
  }
}

export function buildManualSelection(userProviderId, userModelId) {
  return { providerId: String(userProviderId || ''), modelId: String(userModelId || '') }
}
