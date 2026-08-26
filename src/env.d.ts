/// <reference types="vite/client" />

import type { KonbiniAPI } from '@shared/types'

declare global {
  /** Injected by Vite from package.json — see `define` in vite.config.ts. */
  const __APP_VERSION__: string

  interface Window {
    api: KonbiniAPI
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>
  }
}
