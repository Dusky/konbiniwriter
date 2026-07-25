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

const noop = async () => {}

const api = {
  prefs,
  // Persistence seams the stores write through. Tests don't assert on these;
  // they exist so a store action never throws on an undefined namespace.
  codex: { save: noop },
  debt: { save: noop },
  settings: { save: noop },
  aux: { read: async () => null, write: noop, remove: noop },
  shell: {
    platform: 'linux' as const,
    minimize() {},
    maximize() {},
    close() {},
    isMaximized: async () => false,
  },
}

;(globalThis as any).window = { api, location: { reload() {} } }
// Minimal document so stores that apply theme/CSS vars at construction load
// under the node test environment.
;(globalThis as any).document = {
  documentElement: { dataset: {} as Record<string, string>, style: { setProperty() {} } },
  addEventListener() {},
  removeEventListener() {},
}
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
