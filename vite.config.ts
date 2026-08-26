import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// One version, read from package.json at build time. The About box and the
// launch screen used to carry it as a literal and it went stale by fifteen
// phases; a released build must not be able to lie about which build it is.
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src'),
    },
  },
  // Keep Electron migration easy: the build output can be loaded by
  // an Electron BrowserWindow with file:// — just set base: './'
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
})
