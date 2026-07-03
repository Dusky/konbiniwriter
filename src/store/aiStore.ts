import { create } from 'zustand'
import { costOf } from '../lib/Pricing'

export type AIProvider = 'anthropic' | 'openai'

// User-facing BYOK service. Claude speaks the Anthropic wire format; every other
// service speaks the OpenAI-compatible /chat/completions format. 'custom' is the
// escape hatch for a free-form endpoint (local servers, Groq, Together, …).
export type AIService = 'claude' | 'chatgpt' | 'nanogpt' | 'openrouter' | 'custom'

export const AI_SERVICES: Record<AIService, { label: string; provider: AIProvider; url?: string; exampleModel?: string }> = {
  claude:     { label: 'Claude',     provider: 'anthropic' },
  chatgpt:    { label: 'ChatGPT',    provider: 'openai', url: 'https://api.openai.com/v1', exampleModel: 'gpt-4o' },
  nanogpt:    { label: 'NanoGPT',    provider: 'openai', url: 'https://nano-gpt.com/api/v1', exampleModel: 'chatgpt-4o-latest' },
  openrouter: { label: 'OpenRouter', provider: 'openai', url: 'https://openrouter.ai/api/v1', exampleModel: 'anthropic/claude-sonnet-4.5' },
  custom:     { label: 'Custom',     provider: 'openai' },
}

interface AIState {
  enabled: boolean
  service: AIService
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
  setService: (s: AIService) => void
  setProvider: (p: AIProvider) => void
  setAnthropicKey: (key: string) => void
  setAnthropicModel: (model: string) => void
  setAnthropicKeyValidated: (ok: boolean, err?: string | null) => void
  setOpenaiBaseUrl: (url: string) => void
  setOpenaiKey: (key: string) => void
  setOpenaiModel: (model: string) => void

  // — chat generation params —
  chatMaxTokens: number
  chatContextMessages: number   // messages sent to API per turn; 0 = all
  setChatMaxTokens: (n: number) => void
  setChatContextMessages: (n: number) => void

  // — context budgets (tokens per feature; 0 = use built-in default) —
  contextBudgets: Record<string, number>
  setContextBudget: (feature: string, tokens: number) => void

  // — session spend tally (in-memory; resets on reload) —
  spendInputTokens: number
  spendOutputTokens: number
  spendUSD: number          // sum of priced calls
  spendCalls: number
  spendUnpriced: number     // calls whose model has no known price
  recordSpend: (model: string, inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheCreationTokens?: number) => void
  resetSpend: () => void

  spendCapUSD: number       // 0 = no cap; halts an autopilot run when the run's cost crosses it
  setSpendCap: (usd: number) => void

  slopAutoRun: boolean
  setSlopAutoRun: (on: boolean) => void
}

const SK = 'konbini:ai'
function load(k: string, fallback = '') { return window.api.prefs.get(k) ?? fallback }
function save(k: string, v: string) { window.api.prefs.set(k, v) }

// Resolve the selected service: use the saved one, else derive from the legacy
// provider/baseUrl prefs so existing installs land on the right chip.
function initialService(): AIService {
  const saved = load(`${SK}:service`) as AIService
  if (saved && AI_SERVICES[saved]) return saved
  if (load(`${SK}:provider`, 'anthropic') === 'anthropic') return 'claude'
  const url = load(`${SK}:openaiBaseUrl`)
  const match = (Object.entries(AI_SERVICES) as [AIService, typeof AI_SERVICES[AIService]][])
    .find(([, s]) => s.url && s.url === url)
  return match ? match[0] : 'custom'
}

export const useAIStore = create<AIState>((set) => ({
  enabled: false,
  service: initialService(),
  provider: (load(`${SK}:provider`, 'anthropic') as AIProvider),
  anthropicKey: load(`${SK}:anthropicKey`),
  anthropicModel: load(`${SK}:anthropicModel`, 'claude-opus-4-8'),
  anthropicKeyValidated: false,
  anthropicKeyError: null,
  openaiBaseUrl: load(`${SK}:openaiBaseUrl`, 'https://api.openai.com/v1'),
  openaiKey: load(`${SK}:openaiKey`),
  openaiModel: load(`${SK}:openaiModel`, 'gpt-4o'),

  setEnabled: (enabled) => set({ enabled }),
  // Selecting a service also sets the wire-format provider and, for the named
  // OpenAI-compatible services, the endpoint + a starter model (only when the
  // current model is empty or still one of the built-in examples — never
  // clobbering a model the user typed).
  setService: (service) => {
    const s = AI_SERVICES[service]
    save(`${SK}:service`, service)
    save(`${SK}:provider`, s.provider)
    const patch: Partial<AIState> = { service, provider: s.provider }
    if (s.url) { save(`${SK}:openaiBaseUrl`, s.url); patch.openaiBaseUrl = s.url }
    if (s.exampleModel) {
      const cur = load(`${SK}:openaiModel`)
      const isDefaulty = !cur || Object.values(AI_SERVICES).some((x) => x.exampleModel === cur)
      if (isDefaulty) { save(`${SK}:openaiModel`, s.exampleModel); patch.openaiModel = s.exampleModel }
    }
    set(patch)
  },
  setProvider: (provider) => { save(`${SK}:provider`, provider); set({ provider }) },
  setAnthropicKey: (anthropicKey) => { save(`${SK}:anthropicKey`, anthropicKey); set({ anthropicKey, anthropicKeyValidated: false, anthropicKeyError: null }) },
  setAnthropicModel: (anthropicModel) => { save(`${SK}:anthropicModel`, anthropicModel); set({ anthropicModel }) },
  setAnthropicKeyValidated: (ok, err = null) => set({ anthropicKeyValidated: ok, anthropicKeyError: err }),
  setOpenaiBaseUrl: (openaiBaseUrl) => { save(`${SK}:openaiBaseUrl`, openaiBaseUrl); set({ openaiBaseUrl }) },
  setOpenaiKey: (openaiKey) => { save(`${SK}:openaiKey`, openaiKey); set({ openaiKey }) },
  setOpenaiModel: (openaiModel) => { save(`${SK}:openaiModel`, openaiModel); set({ openaiModel }) },

  chatMaxTokens: parseInt(load(`${SK}:chatMaxTokens`, '8192'), 10) || 8192,
  chatContextMessages: parseInt(load(`${SK}:chatContextMessages`, '30'), 10),
  setChatMaxTokens: (chatMaxTokens) => { save(`${SK}:chatMaxTokens`, String(chatMaxTokens)); set({ chatMaxTokens }) },
  setChatContextMessages: (chatContextMessages) => { save(`${SK}:chatContextMessages`, String(chatContextMessages)); set({ chatContextMessages }) },

  contextBudgets: (() => { try { return JSON.parse(load(`${SK}:contextBudgets`, '{}')) } catch { return {} } })(),
  setContextBudget: (feature, tokens) => set((s) => {
    const contextBudgets = { ...s.contextBudgets, [feature]: tokens }
    save(`${SK}:contextBudgets`, JSON.stringify(contextBudgets))
    return { contextBudgets }
  }),

  spendInputTokens: 0,
  spendOutputTokens: 0,
  spendUSD: 0,
  spendCalls: 0,
  spendUnpriced: 0,
  recordSpend: (model, inputTokens, outputTokens, cacheReadTokens = 0, cacheCreationTokens = 0) => set((s) => {
    const cost = costOf(model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
    return {
      // Cache tokens fold into the input tally so the UI total reflects
      // everything sent; the dollar figure already prices them correctly.
      spendInputTokens: s.spendInputTokens + inputTokens + cacheReadTokens + cacheCreationTokens,
      spendOutputTokens: s.spendOutputTokens + outputTokens,
      spendUSD: s.spendUSD + (cost ?? 0),
      spendCalls: s.spendCalls + 1,
      spendUnpriced: s.spendUnpriced + (cost === null ? 1 : 0),
    }
  }),
  resetSpend: () => set({ spendInputTokens: 0, spendOutputTokens: 0, spendUSD: 0, spendCalls: 0, spendUnpriced: 0 }),

  spendCapUSD: parseFloat(load(`${SK}:spendCap`, '0')) || 0,
  setSpendCap: (spendCapUSD) => { save(`${SK}:spendCap`, String(spendCapUSD)); set({ spendCapUSD }) },

  slopAutoRun: load(`${SK}:slopAutoRun`, 'false') === 'true',
  setSlopAutoRun: (slopAutoRun) => { save(`${SK}:slopAutoRun`, slopAutoRun ? 'true' : 'false'); set({ slopAutoRun }) },
}))
