import { create } from 'zustand'

export type AIProvider = 'anthropic' | 'ollama'

interface AIState {
  enabled: boolean
  provider: AIProvider
  apiKey: string          // stored in memory only; persisted to localStorage (not project file)
  ollamaHost: string
  defaultModel: string
  keyValidated: boolean
  keyError: string | null

  setEnabled: (on: boolean) => void
  setProvider: (p: AIProvider) => void
  setApiKey: (key: string) => void
  setOllamaHost: (host: string) => void
  setDefaultModel: (model: string) => void
  setKeyValidated: (ok: boolean, err?: string | null) => void
}

const STORAGE_KEY = 'konbini:ai'

function loadPersistedKey(): string {
  try { return localStorage.getItem(`${STORAGE_KEY}:key`) ?? '' } catch { return '' }
}

export const useAIStore = create<AIState>((set) => ({
  enabled: false,
  provider: 'anthropic',
  apiKey: loadPersistedKey(),
  ollamaHost: 'http://localhost:11434',
  defaultModel: 'claude-opus-4-8',
  keyValidated: false,
  keyError: null,

  setEnabled: (enabled) => set({ enabled }),
  setProvider: (provider) => set({ provider }),
  setApiKey: (apiKey) => {
    try { localStorage.setItem(`${STORAGE_KEY}:key`, apiKey) } catch { /* ignore */ }
    set({ apiKey, keyValidated: false, keyError: null })
  },
  setOllamaHost: (ollamaHost) => set({ ollamaHost }),
  setDefaultModel: (defaultModel) => set({ defaultModel }),
  setKeyValidated: (ok, err = null) => set({ keyValidated: ok, keyError: err }),
}))
