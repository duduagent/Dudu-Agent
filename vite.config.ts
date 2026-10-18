/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    // Hanya suite di folder tests/ — mencegah salinan tes (mis. di release/ atau dist-electron/) ikut terbaca.
    include: ['tests/**/*.test.{ts,tsx,mjs}'],
    exclude: ['node_modules/**', 'dist/**', 'release/**'],
  },
})
