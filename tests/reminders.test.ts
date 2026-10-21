import { describe, expect, it } from 'vitest'
import { makeReminder, validateReminder } from '../src/lib/reminders'

describe('Scheduled Reminder validation', () => {
  const future = new Date(Date.now() + 60_000)
  const localFuture = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`

  it('rejects an empty title', () => {
    expect(validateReminder('  ', localFuture)).toBe('Masukkan isi pengingat.')
  })

  it('rejects a missing date', () => {
    expect(validateReminder('Tes', '')).toBe('Pilih tanggal dan waktu.')
  })

  it('rejects a time in the past', () => {
    expect(validateReminder('Tes', '2020-01-01T00:00', Date.now())).toBe('Waktu pengingat harus berada di masa depan.')
  })

  it('stores the selected local time as an ISO timestamp and records the device time zone', () => {
    const reminder = makeReminder('  Tes pengingat  ', localFuture)
    expect(reminder.title).toBe('Tes pengingat')
    expect(Number.isNaN(Date.parse(reminder.dueAt))).toBe(false)
    expect(reminder.timeZone.length).toBeGreaterThan(0)
    expect(reminder.status).toBe('scheduled')
  })
})
