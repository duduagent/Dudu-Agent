import type { ReactNode } from 'react'
import { Icon } from '../ui'

export function PageShell({ title, subtitle, onToggleLeft, leftCollapsed, actions, children }: {
  title: string; subtitle?: string; onToggleLeft: () => void; leftCollapsed: boolean; actions?: ReactNode; children: ReactNode
}) {
  return (
    <section className="page" aria-labelledby="page-title">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={onToggleLeft} aria-expanded={!leftCollapsed} aria-controls="left-sidebar"
          title={leftCollapsed ? 'Buka sidebar kiri' : 'Tutup sidebar kiri'}>
          <Icon name="menu" size={18} /><span className="sr-only">Menu utama</span>
        </button>
        <div className="page-titles"><h1 id="page-title">{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      <div className="page-body">{children}</div>
    </section>
  )
}

export const StateMsg = ({ loading, error, onRetry }: { loading?: boolean; error?: string | null; onRetry?: () => void }) =>
  error ? <p className="state-msg error" role="alert">{error} {onRetry && <button type="button" className="link-btn" onClick={onRetry}>Coba lagi</button>}</p>
  : loading ? <p className="state-msg" role="status">Memuat…</p> : null

export const fmtDate = (t: number) => new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
