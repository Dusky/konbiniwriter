/// <reference types="vite/client" />

import type { KonbiniAPI } from '@shared/types'

declare global {
  interface Window {
    api: KonbiniAPI
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>
  }
}
