import '@testing-library/jest-dom'

// Polyfill matchMedia untuk jsdom
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  })
}

// jsdom tidak mengimplementasikan scrollIntoView
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = () => {}
