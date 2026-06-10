import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

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
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
})
