import { create } from 'zustand'

export type AIProvider = 'anthropic' | 'openai'

interface AIState {
  enabled: boolean
  provider: AIProvider
  // Anthropic
  anthropicKey: string
  anthropicModel: string
  anthropicKeyValidated: boolean
  anthropicKeyError: string | null
  // OpenAI-compatible (covers OpenAI, Groq, Together, Mistral, Ollama /v1, LM Studio, etc.)
  openaiBaseUrl: string
  openaiKey: string
  openaiModel: string

  setEnabled: (on: boolean) => void
  setProvider: (p: AIProvider) => void
  setAnthropicKey: (key: string) => void
  setAnthropicModel: (model: string) => void
  setAnthropicKeyValidated: (ok: boolean, err?: string | null) => void
  setOpenaiBaseUrl: (url: string) => void
  setOpenaiKey: (key: string) => void
  setOpenaiModel: (model: string) => void
}

const SK = 'konbini:ai'
function load(k: string, fallback = '') {
  try { return localStorage.getItem(k) ?? fallback } catch { return fallback }
}
function save(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* ignore */ }
}

export const useAIStore = create<AIState>((set) => ({
  enabled: false,
  provider: (load(`${SK}:provider`, 'anthropic') as AIProvider),
  anthropicKey: load(`${SK}:anthropicKey`),
  anthropicModel: load(`${SK}:anthropicModel`, 'claude-opus-4-8'),
  anthropicKeyValidated: false,
  anthropicKeyError: null,
  openaiBaseUrl: load(`${SK}:openaiBaseUrl`, 'https://api.openai.com/v1'),
  openaiKey: load(`${SK}:openaiKey`),
  openaiModel: load(`${SK}:openaiModel`, 'gpt-4o'),

  setEnabled: (enabled) => set({ enabled }),
  setProvider: (provider) => { save(`${SK}:provider`, provider); set({ provider }) },
  setAnthropicKey: (anthropicKey) => { save(`${SK}:anthropicKey`, anthropicKey); set({ anthropicKey, anthropicKeyValidated: false, anthropicKeyError: null }) },
  setAnthropicModel: (anthropicModel) => { save(`${SK}:anthropicModel`, anthropicModel); set({ anthropicModel }) },
  setAnthropicKeyValidated: (ok, err = null) => set({ anthropicKeyValidated: ok, anthropicKeyError: err }),
  setOpenaiBaseUrl: (openaiBaseUrl) => { save(`${SK}:openaiBaseUrl`, openaiBaseUrl); set({ openaiBaseUrl }) },
  setOpenaiKey: (openaiKey) => { save(`${SK}:openaiKey`, openaiKey); set({ openaiKey }) },
  setOpenaiModel: (openaiModel) => { save(`${SK}:openaiModel`, openaiModel); set({ openaiModel }) },
}))
