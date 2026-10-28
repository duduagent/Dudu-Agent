/// <reference types="vite/client" />

interface Window {
  /** Disediakan oleh preload Electron; tidak ada pada mode web/dev biasa. */
  dudu?: { isDesktop: true; platform: string }
}
