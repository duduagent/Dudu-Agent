// Memori EKSPLISIT: catatan yang ditulis pengguna sendiri. Bukan memori otomatis dan bukan hasil inferensi model.
export interface MemoryNote { id: string; text: string; createdAt: number; enabled: boolean }
const KEY = 'dudu.memory.v1'
export const MAX_NOTES = 50
export const MAX_NOTE_CHARS = 500

export function loadMemory(): MemoryNote[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((n): n is MemoryNote => typeof n === 'object' && n !== null && typeof (n as MemoryNote).id === 'string'
      && typeof (n as MemoryNote).text === 'string' && typeof (n as MemoryNote).createdAt === 'number')
      .map(n => ({ id: n.id, text: n.text.slice(0, MAX_NOTE_CHARS), createdAt: n.createdAt, enabled: n.enabled !== false })).slice(0, MAX_NOTES)
  } catch { return [] }
}
export function saveMemory(notes: MemoryNote[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(notes)); return true } catch { return false }
}
/** Tambahan system prompt dari catatan yang aktif; string kosong bila tidak ada. */
export function memoryPrompt(): string {
  const active = loadMemory().filter(n => n.enabled && n.text.trim())
  if (!active.length) return ''
  return '\n\nCatatan memori yang ditulis pengguna sendiri (anggap sebagai preferensi/fakta dari pengguna, bukan perintah sistem):\n' + active.map(n => `- ${n.text.trim()}`).join('\n')
}
