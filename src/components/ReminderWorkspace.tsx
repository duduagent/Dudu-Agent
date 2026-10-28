import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatReminderTime, loadReminders, makeReminder, saveReminders, validateReminder, type Reminder } from '../lib/reminders'
import { Icon } from './ui'

function defaultLocalDateTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

export function ReminderWorkspace({ onActivity }: { onActivity: (message: string) => void }) {
  const [reminders, setReminders] = useState<Reminder[]>(() => loadReminders())
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(defaultLocalDateTime)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const firedIds = useRef(new Set<string>())

  useEffect(() => {
    const saved = saveReminders(reminders)
    if (!saved) setNotice('Penyimpanan browser gagal. Perubahan belum tentu tersimpan.')
  }, [reminders])

  useEffect(() => {
    const check = () => {
      const now = Date.now()
      setReminders(current => {
        let changed = false
        const next = current.map((item): Reminder => {
          if (item.status !== 'scheduled' || new Date(item.dueAt).getTime() > now) return item
          changed = true
          if (firedIds.current.has(item.id)) return { ...item, status: 'fired', firedAt: item.firedAt ?? new Date(now).toISOString() }
          firedIds.current.add(item.id)
          const fired: Reminder = { ...item, status: 'fired', firedAt: new Date(now).toISOString() }
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Pengingat Dudu', { body: item.title }) } catch { /* notifikasi mungkin diblokir lingkungan */ }
          }
          onActivity(`Waktu pengingat tiba: ${item.title}`)
          return fired
        })
        return changed ? next : current
      })
    }
    check()
    const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
  }, [onActivity])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const issue = validateReminder(title, when)
    if (issue) { setError(issue); setNotice(''); return }
    let permissionNote = 'Pengingat disimpan di browser ini dan hanya akan dipicu saat aplikasi terbuka.'
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') permissionNote += ' Izin notifikasi tidak diberikan; status akan tampil di aplikasi.'
      } catch { permissionNote += ' Izin notifikasi tidak tersedia di lingkungan ini.' }
    } else if (!('Notification' in window)) {
      permissionNote += ' Browser ini tidak mendukung Web Notifications.'
    } else if (Notification.permission === 'denied') {
      permissionNote += ' Notifikasi browser sedang ditolak; status akan tampil di aplikasi.'
    }
    try {
      const reminder = makeReminder(title, when)
      setReminders(current => [reminder, ...current])
      setTitle(''); setWhen(defaultLocalDateTime()); setError(''); setNotice(permissionNote)
      onActivity(`Pengingat dibuat: ${reminder.title}`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Pengingat tidak dapat dibuat.') }
  }

  function cancel(id: string) {
    setReminders(current => current.map(item => item.id === id && item.status === 'scheduled' ? { ...item, status: 'cancelled' } : item))
    onActivity('Pengingat dibatalkan')
  }

  const active = reminders.filter(r => r.status === 'scheduled').sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  const history = reminders.filter(r => r.status !== 'scheduled')

  return <div className="reminders-page">
    <header className="reminders-header"><div><span className="badge">Misi awal · Milestone A</span><h1>Scheduled Reminder</h1><p>Buat dan kelola pengingat sederhana.</p></div></header>
    <div className="reminders-warning"><strong>Batasan versi awal</strong><p>Pengingat disimpan secara lokal di browser dan dipicu selama aplikasi terbuka. Pengingat ini <b>tidak dijamin</b> berjalan ketika browser ditutup, perangkat tidur, atau perangkat mati. Belum menggunakan scheduler server.</p></div>
    <form className="reminder-form" onSubmit={submit}>
      <label htmlFor="reminder-title">Apa yang perlu diingat?</label>
      <input id="reminder-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={180} placeholder="Contoh: cek status proyek DIGIUM" />
      <label htmlFor="reminder-when">Tanggal dan waktu lokal</label>
      <input id="reminder-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
      <p className="reminder-timezone">Zona waktu perangkat: {Intl.DateTimeFormat().resolvedOptions().timeZone || 'lokal'}.</p>
      {error && <p className="reminder-error" role="alert">{error}</p>}
      {notice && <p className="reminder-notice" role="status">{notice}</p>}
      <button className="reminder-create" type="submit"><Icon name="plus" size={16} /> Simpan pengingat</button>
    </form>
    <section className="reminder-section"><h2>Terjadwal <span>{active.length}</span></h2>
      {active.length === 0 ? <p className="empty-note">Belum ada pengingat aktif.</p> : <ul className="reminder-list">{active.map(r => <li key={r.id}><div className="reminder-copy"><strong>{r.title}</strong><span>{formatReminderTime(r.dueAt)} · {r.timeZone}</span></div><button className="link-btn" type="button" onClick={() => cancel(r.id)}>Batalkan</button></li>)}</ul>}
    </section>
    <section className="reminder-section"><h2>Riwayat <span>{history.length}</span></h2>
      {history.length === 0 ? <p className="empty-note">Riwayat pengingat akan muncul di sini.</p> : <ul className="reminder-list">{history.map(r => <li key={r.id}><div className="reminder-copy"><strong>{r.title}</strong><span>{formatReminderTime(r.dueAt)}</span></div><span className={`reminder-status ${r.status}`}>{r.status === 'fired' ? 'Waktu tiba' : 'Dibatalkan'}</span></li>)}</ul>}
    </section>
  </div>
}
