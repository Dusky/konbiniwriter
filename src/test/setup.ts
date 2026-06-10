// Minimal browser-shaped globals so store-importing modules (which read
// window.api.prefs / window.api.shell at module init) load under Vitest's
// node environment.

const store = new Map<string, string>()

const prefs = {
  get(key: string): string | null {
    return store.has(key) ? store.get(key)! : null
  },
  set(key: string, value: string): void {
    store.set(key, value)
  },
  remove(key: string): void {
    store.delete(key)
  },
}

const api = {
  prefs,
  shell: {
    platform: 'linux' as const,
    minimize() {},
    maximize() {},
    close() {},
    isMaximized: async () => false,
  },
}

;(globalThis as any).window = { api }
;(globalThis as any).localStorage = {
  getItem: (k: string) => prefs.get(k),
  setItem: (k: string, v: string) => prefs.set(k, v),
  removeItem: (k: string) => prefs.remove(k),
  clear: () => store.clear(),
}
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'Linux', userAgent: 'node' },
    configurable: true,
  })
}
