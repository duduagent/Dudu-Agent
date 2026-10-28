export type ReminderStatus = 'scheduled' | 'fired' | 'cancelled'
export interface Reminder {
  id: string
  title: string
  dueAt: string
  timeZone: string
  status: ReminderStatus
  createdAt: string
  firedAt?: string
}

const KEY = 'dudu.reminders.v1'

export function validateReminder(title: string, localDateTime: string, now = Date.now()): string | null {
  if (!title.trim()) return 'Masukkan isi pengingat.'
  if (!localDateTime) return 'Pilih tanggal dan waktu.'
  const due = new Date(localDateTime).getTime()
  if (!Number.isFinite(due)) return 'Tanggal atau waktu tidak valid.'
  if (due <= now) return 'Waktu pengingat harus berada di masa depan.'
  return null
}

export function loadReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Reminder => !!item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.dueAt === 'string' && ['scheduled', 'fired', 'cancelled'].includes(item.status))
  } catch { return [] }
}

export function saveReminders(reminders: Reminder[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(reminders)); return true } catch { return false }
}

export function makeReminder(title: string, localDateTime: string, now = Date.now()): Reminder {
  const issue = validateReminder(title, localDateTime, now)
  if (issue) throw new Error(issue)
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rem-${now}-${Math.random().toString(36).slice(2, 9)}`,
    title: title.trim(), dueAt: new Date(localDateTime).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local', status: 'scheduled', createdAt: new Date(now).toISOString(),
  }
}

export function formatReminderTime(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Waktu tidak valid'
}
