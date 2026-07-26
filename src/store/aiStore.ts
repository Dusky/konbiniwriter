import { create } from 'zustand'
import { costOf } from '../lib/Pricing'

export type AIProvider = 'anthropic' | 'openai'

// User-facing BYOK service. Claude speaks the Anthropic wire format; every other
// service speaks the OpenAI-compatible /chat/completions format. 'custom' is the
// escape hatch for a free-form endpoint (local servers, Groq, Together, …).
export type AIService = 'claude' | 'chatgpt' | 'nanogpt' | 'openrouter' | 'custom' | 'agent'

// Konbini is provider-neutral BYOK: every service is a peer. Order here is just
// the picker order — Claude is one option among many, not the default.
export const AI_SERVICES: Record<AIService, { label: string; provider: AIProvider; url?: string; exampleModel?: string }> = {
  chatgpt:    { label: 'ChatGPT',    provider: 'openai', url: 'https://api.openai.com/v1', exampleModel: 'gpt-4o' },
  openrouter: { label: 'OpenRouter', provider: 'openai', url: 'https://openrouter.ai/api/v1', exampleModel: 'anthropic/claude-sonnet-4.5' },
  nanogpt:    { label: 'NanoGPT',    provider: 'openai', url: 'https://nano-gpt.com/api/v1', exampleModel: 'chatgpt-4o-latest' },
  claude:     { label: 'Claude',     provider: 'anthropic' },
  custom:     { label: 'Custom',     provider: 'openai', url: 'https://api.openai.com/v1', exampleModel: 'gpt-4o' },
  // A local CLI agent (opencode / Claude Code) that edits the project directly.
  // provider is unused — chat routes to window.api.agent, not the wire APIs.
  agent:      { label: 'Local agent', provider: 'anthropic' },
}

/** How Claude (anthropic) authenticates: a pasted API key, or a subscription via OAuth. */
export type AnthropicAuthMode = 'key' | 'oauth'

interface AIState {
  enabled: boolean
  service: AIService
  provider: AIProvider
  // Anthropic
  anthropicAuthMode: AnthropicAuthMode
  anthropicKey: string
  anthropicModel: string
  anthropicKeyValidated: boolean
  anthropicKeyError: string | null
  // Claude subscription (OAuth) — tokens persisted so a sign-in survives reload.
  oauthAccessToken: string
  oauthRefreshToken: string
  oauthExpiresAt: number
  // OpenAI-compatible (covers OpenAI, Groq, Together, Mistral, Ollama /v1, LM Studio, etc.)
  openaiBaseUrl: string
  openaiKey: string
  openaiModel: string

  setEnabled: (on: boolean) => void
  setService: (s: AIService) => void
  setProvider: (p: AIProvider) => void
  setAnthropicAuthMode: (mode: AnthropicAuthMode) => void
  setAnthropicKey: (key: string) => void
  setAnthropicModel: (model: string) => void
  setAnthropicKeyValidated: (ok: boolean, err?: string | null) => void
  setOAuthTokens: (access: string, refresh: string, expiresAt: number) => void
  clearOAuth: () => void
  setOpenaiBaseUrl: (url: string) => void
  setOpenaiKey: (key: string) => void
  setOpenaiModel: (model: string) => void

  // — user-managed list of model ids offered in the beat generator —
  savedModels: string[]
  addSavedModel: (model: string) => void
  removeSavedModel: (model: string) => void

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

  // Global custom instructions / persona applied to every project's AI.
  customInstructions: string
  setCustomInstructions: (text: string) => void

  // When on, the chat assistant may append durable memories to project notes.
  aiMemoryEnabled: boolean
  setAiMemoryEnabled: (on: boolean) => void

  // When on (Claude only), the chat assistant can call tools to search, read,
  // create, and propose edits across the whole project.
  aiToolsEnabled: boolean
  /**
   * Whether the assistant may propose changes to its own text settings.
   * Off by default and separate from `aiToolsEnabled`: reading the manuscript
   * and rewriting the author's standing instructions are different levels of
   * trust, even though both end up in the review queue.
   */
  aiConfigToolsEnabled: boolean
  setAiConfigToolsEnabled: (on: boolean) => void
  setAiToolsEnabled: (on: boolean) => void

  // Shell command for the "Local agent" service (runs in the project folder).
  agentCommand: string
  setAgentCommand: (cmd: string) => void
}

const SK = 'konbini:ai'
function load(k: string, fallback = '') { return window.api.prefs.get(k) ?? fallback }
function save(k: string, v: string) { window.api.prefs.set(k, v) }

// Resolve the selected service: use the saved one, else derive from the legacy
// provider/baseUrl prefs so existing installs land on the right chip. A fresh
// install has no saved provider and defaults to the generic OpenAI-compatible
// option — Konbini privileges no single vendor.
function initialService(): AIService {
  const saved = load(`${SK}:service`) as AIService
  if (saved && AI_SERVICES[saved]) return saved
  const savedProvider = load(`${SK}:provider`)
  if (savedProvider === 'anthropic') return 'claude'
  const url = load(`${SK}:openaiBaseUrl`)
  const match = (Object.entries(AI_SERVICES) as [AIService, typeof AI_SERVICES[AIService]][])
    .find(([, s]) => s.url && s.url === url)
  return match ? match[0] : 'custom'
}
const INITIAL_SERVICE = initialService()

export const useAIStore = create<AIState>((set) => ({
  enabled: load(`${SK}:enabled`, 'false') === 'true',
  service: INITIAL_SERVICE,
  // Provider follows the resolved service so the two never disagree on a fresh
  // install (no saved provider → OpenAI-compatible, not Anthropic).
  provider: AI_SERVICES[INITIAL_SERVICE].provider,
  anthropicAuthMode: (load(`${SK}:anthropicAuthMode`, 'key') as AnthropicAuthMode),
  anthropicKey: load(`${SK}:anthropicKey`),
  anthropicModel: load(`${SK}:anthropicModel`, 'claude-opus-4-8'),
  anthropicKeyValidated: false,
  anthropicKeyError: null,
  oauthAccessToken: load(`${SK}:oauthAccessToken`),
  oauthRefreshToken: load(`${SK}:oauthRefreshToken`),
  oauthExpiresAt: parseInt(load(`${SK}:oauthExpiresAt`, '0'), 10) || 0,
  openaiBaseUrl: load(`${SK}:openaiBaseUrl`, 'https://api.openai.com/v1'),
  openaiKey: load(`${SK}:openaiKey`),
  openaiModel: load(`${SK}:openaiModel`, 'gpt-4o'),
  savedModels: (() => { try { return JSON.parse(load(`${SK}:savedModels`, '[]')) as string[] } catch { return [] } })(),

  setEnabled: (enabled) => { save(`${SK}:enabled`, enabled ? 'true' : 'false'); set({ enabled }) },
  addSavedModel: (model) => set((s) => {
    const m = model.trim()
    if (!m || s.savedModels.includes(m)) return s
    const savedModels = [...s.savedModels, m]
    save(`${SK}:savedModels`, JSON.stringify(savedModels))
    return { savedModels }
  }),
  removeSavedModel: (model) => set((s) => {
    const savedModels = s.savedModels.filter((x) => x !== model)
    save(`${SK}:savedModels`, JSON.stringify(savedModels))
    return { savedModels }
  }),
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
  setAnthropicAuthMode: (anthropicAuthMode) => { save(`${SK}:anthropicAuthMode`, anthropicAuthMode); set({ anthropicAuthMode }) },
  setOAuthTokens: (access, refresh, expiresAt) => {
    save(`${SK}:oauthAccessToken`, access)
    save(`${SK}:oauthRefreshToken`, refresh)
    save(`${SK}:oauthExpiresAt`, String(expiresAt))
    set({ oauthAccessToken: access, oauthRefreshToken: refresh, oauthExpiresAt: expiresAt })
  },
  clearOAuth: () => {
    window.api.prefs.remove(`${SK}:oauthAccessToken`)
    window.api.prefs.remove(`${SK}:oauthRefreshToken`)
    window.api.prefs.remove(`${SK}:oauthExpiresAt`)
    set({ oauthAccessToken: '', oauthRefreshToken: '', oauthExpiresAt: 0 })
  },
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

  customInstructions: load(`${SK}:customInstructions`),
  setCustomInstructions: (customInstructions) => { save(`${SK}:customInstructions`, customInstructions); set({ customInstructions }) },

  aiMemoryEnabled: load(`${SK}:aiMemoryEnabled`, 'true') !== 'false',
  setAiMemoryEnabled: (aiMemoryEnabled) => { save(`${SK}:aiMemoryEnabled`, aiMemoryEnabled ? 'true' : 'false'); set({ aiMemoryEnabled }) },

  aiToolsEnabled: load(`${SK}:aiToolsEnabled`, 'true') !== 'false',
  aiConfigToolsEnabled: load(`${SK}:aiConfigToolsEnabled`, 'false') === 'true',
  setAiConfigToolsEnabled: (aiConfigToolsEnabled) => { save(`${SK}:aiConfigToolsEnabled`, aiConfigToolsEnabled ? 'true' : 'false'); set({ aiConfigToolsEnabled }) },
  setAiToolsEnabled: (aiToolsEnabled) => { save(`${SK}:aiToolsEnabled`, aiToolsEnabled ? 'true' : 'false'); set({ aiToolsEnabled }) },

  agentCommand: load(`${SK}:agentCommand`, 'claude -p --permission-mode acceptEdits'),
  setAgentCommand: (agentCommand) => { save(`${SK}:agentCommand`, agentCommand); set({ agentCommand }) },
}))
