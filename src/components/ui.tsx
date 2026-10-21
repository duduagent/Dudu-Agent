import type { ReactNode } from 'react'

export type IconName =
  | 'chevronLeft' | 'chevronRight' | 'plus' | 'chat' | 'target' | 'users' | 'book' | 'plug'
  | 'folder' | 'memory' | 'settings' | 'send' | 'stop' | 'mic' | 'x' | 'panel' | 'search'
  | 'copy' | 'retry' | 'pencil' | 'menu' | 'back' | 'alert' | 'paperclip' | 'file' | 'check' | 'upload' | 'trash' | 'download'
  | 'terminal' | 'puzzle' | 'link' | 'user'

const ICONS: Record<IconName, ReactNode> = {
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H6l-3 2.5V11.5a8.5 8.5 0 0 1 8.5-8.5h1A8.5 8.5 0 0 1 21 11.5z" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21 20c0-2.7-1.8-4.3-4.5-4.9" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  plug: <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5" />,
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" />,
  memory: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  retry: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  paperclip: <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6L15 7" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
  terminal: <><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>,
  puzzle: <><path d="M14 7.5a2.5 2.5 0 0 1 2.5-2.5H20v3.5a2.5 2.5 0 0 0 0 5V20h-3.5a2.5 2.5 0 0 1-5 0" /><path d="M14 7.5V3H4v7h4.5a2.5 2.5 0 0 1 0 5H4v6h6v-4.5" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

/**
 * PLACEHOLDER maskot — INI BUKAN aset Dudu asli (aset asli tidak tersedia).
 * Siluet: wajah gelap glossy, ekspresi ramah, headphone, bodi putih, tanda D emas.
 * Ganti dengan aset resmi begitu file asetnya ada.
 */
export function DuduMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Maskot Dudu (placeholder)">
      <defs>
        <linearGradient id="duduFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#33343a" /><stop offset="1" stopColor="#101014" />
        </linearGradient>
      </defs>
      <path d="M28 56a32 32 0 0 1 64 0" fill="none" stroke="#C79A42" strokeWidth="7" strokeLinecap="round" />
      <rect x="26" y="34" width="68" height="60" rx="30" fill="url(#duduFace)" stroke="#E8E7E3" strokeWidth="3" />
      <rect x="18" y="52" width="12" height="22" rx="6" fill="#C79A42" />
      <rect x="90" y="52" width="12" height="22" rx="6" fill="#C79A42" />
      <path d="M44 60q5 6 10 0" fill="none" stroke="#F2DFB3" strokeWidth="4" strokeLinecap="round" />
      <path d="M66 60q5 6 10 0" fill="none" stroke="#F2DFB3" strokeWidth="4" strokeLinecap="round" />
      <path d="M52 74q8 6 16 0" fill="none" stroke="#F2DFB3" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="42" cy="45" rx="9" ry="5" fill="#ffffff" opacity=".14" />
      <rect x="34" y="96" width="52" height="16" rx="8" fill="#FCFBF8" stroke="#E8E7E3" strokeWidth="2.5" />
      <circle cx="60" cy="104" r="6.5" fill="#C79A42" />
      <text x="60" y="107.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#FCFBF8" fontFamily="system-ui, sans-serif">D</text>
    </svg>
  )
}
