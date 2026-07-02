import { useAIStore } from '../store/aiStore'
import { sseLines, sseFlush, type SSEBuffer } from './sse'

export interface TokenUsage { inputTokens: number; outputTokens: number }

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: (fullText: string) => void
  onError: (err: Error) => void
  onUsage?: (usage: TokenUsage) => void
  /** Called instead of onError when the request was aborted via opts.signal. */
  onAbort?: () => void
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

function handleStreamError(e: unknown, cb: StreamCallbacks): void {
  const err = e as Error
  if (err.name === 'AbortError') {
    if (cb.onAbort) cb.onAbort()
    else cb.onError(err)
  } else {
    cb.onError(err)
  }
}

export async function streamCompletion(
  messages: AIMessage[],
  opts: {
    model?: string
    maxTokens?: number
    temperature?: number
    systemPrompt?: string
    signal?: AbortSignal
  },
  callbacks: StreamCallbacks,
): Promise<void> {
  const store = useAIStore.getState()
  const { provider } = store
  const requested = opts.model || undefined
  let model = requested ?? (provider === 'anthropic' ? store.anthropicModel : store.openaiModel)
  // Prompt/agent templates often hardcode `claude-*` model IDs. If the active
  // provider doesn't match what the requested model ID looks like, fall back
  // to the provider's configured default rather than sending a model ID to
  // the wrong API.
  if (provider === 'openai' && /^claude-/.test(model)) model = store.openaiModel
  if (provider === 'anthropic' && !/^claude-/.test(model)) model = store.anthropicModel

  // Intercept usage to record session spend centrally, then forward to caller.
  const wrapped: StreamCallbacks = {
    ...callbacks,
    onUsage: (u) => {
      useAIStore.getState().recordSpend(model, u.inputTokens, u.outputTokens)
      callbacks.onUsage?.(u)
    },
  }

  if (provider === 'anthropic') {
    await streamAnthropic(
      { apiKey: store.anthropicKey, model, messages, maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.7, systemPrompt: opts.systemPrompt, signal: opts.signal },
      wrapped,
    )
  } else {
    await streamOpenAI(
      { baseUrl: store.openaiBaseUrl, apiKey: store.openaiKey, model, messages, maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.7, systemPrompt: opts.systemPrompt, signal: opts.signal },
      wrapped,
    )
  }
}

// ── Anthropic Messages API (SSE) ─────────────────────────────────────────────

async function streamAnthropic(
  opts: { apiKey: string; model: string; messages: AIMessage[]; maxTokens: number; temperature: number; systemPrompt?: string; signal?: AbortSignal },
  cb: StreamCallbacks,
): Promise<void> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: opts.messages,
    stream: true,
  }
  if (opts.systemPrompt) body.system = opts.systemPrompt

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (e) {
    handleStreamError(e, cb)
    return
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const apiMsg = (body?.error?.message ?? '') as string
    let msg: string
    if (res.status === 401) msg = 'Authentication failed — check your API key in AI Settings'
    else if (res.status === 429) msg = 'Rate limit reached — wait a moment and try again'
    else if (res.status >= 500) msg = `API service error (${res.status}) — try again shortly`
    else msg = apiMsg || `Request failed (${res.status})`
    cb.onError(new Error(msg))
    return
  }

  const reader = res.body?.getReader()
  if (!reader) { cb.onError(new Error('No response body')); return }

  const decoder = new TextDecoder()
  const buf: SSEBuffer = { pending: '' }
  let full = ''
  let inputTokens = 0
  let outputTokens = 0

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (data === '[DONE]') return
    try {
      const ev = JSON.parse(data)
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        full += ev.delta.text
        cb.onChunk(ev.delta.text)
      } else if (ev.type === 'message_start') {
        // Initial usage: input tokens (+ any cache tokens) and a partial output count.
        const u = ev.message?.usage
        if (u) {
          inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          outputTokens = u.output_tokens ?? 0
        }
      } else if (ev.type === 'message_delta' && ev.usage) {
        // Cumulative output tokens for the message.
        outputTokens = ev.usage.output_tokens ?? outputTokens
      }
    } catch { /* ignore malformed SSE */ }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of sseLines(buf, decoder.decode(value, { stream: true }))) handleLine(line)
    }
    for (const line of sseLines(buf, decoder.decode())) handleLine(line)
    for (const line of sseFlush(buf)) handleLine(line)
    if (inputTokens || outputTokens) cb.onUsage?.({ inputTokens, outputTokens })
    cb.onDone(full)
  } catch (e) {
    handleStreamError(e, cb)
  } finally {
    reader.releaseLock()
  }
}

// ── OpenAI-compatible chat completions API (SSE) ─────────────────────────────
// Covers: OpenAI, Groq, Together, Fireworks, Mistral, LM Studio,
//         Ollama (/v1/chat/completions), any local server.

async function streamOpenAI(
  opts: { baseUrl: string; apiKey: string; model: string; messages: AIMessage[]; maxTokens: number; temperature: number; systemPrompt?: string; signal?: AbortSignal },
  cb: StreamCallbacks,
): Promise<void> {
  const msgs: AIMessage[] = opts.systemPrompt
    ? [{ role: 'user', content: `[System: ${opts.systemPrompt}]\n\n${opts.messages[0]?.content ?? ''}` }, ...opts.messages.slice(1)]
    : opts.messages

  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.apiKey) headers['authorization'] = `Bearer ${opts.apiKey}`

  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: msgs,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: opts.signal,
    })
  } catch (e) {
    handleStreamError(e, cb)
    return
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const apiMsg = (body?.error?.message ?? '') as string
    let msg: string
    if (res.status === 401) msg = 'Authentication failed — check your API key in AI Settings'
    else if (res.status === 429) msg = 'Rate limit reached — wait a moment and try again'
    else if (res.status >= 500) msg = `API service error (${res.status}) — try again shortly`
    else msg = apiMsg || `Request failed (${res.status})`
    cb.onError(new Error(msg))
    return
  }

  const reader = res.body?.getReader()
  if (!reader) { cb.onError(new Error('No response body')); return }

  const decoder = new TextDecoder()
  const buf: SSEBuffer = { pending: '' }
  let full = ''
  let inputTokens = 0
  let outputTokens = 0

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (data === '[DONE]') return
    try {
      const ev = JSON.parse(data)
      const text = ev.choices?.[0]?.delta?.content
      if (text) { full += text; cb.onChunk(text) }
      // Final usage chunk (stream_options.include_usage); usually has empty choices.
      if (ev.usage) {
        inputTokens = ev.usage.prompt_tokens ?? inputTokens
        outputTokens = ev.usage.completion_tokens ?? outputTokens
      }
    } catch { /* ignore malformed SSE */ }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of sseLines(buf, decoder.decode(value, { stream: true }))) handleLine(line)
    }
    for (const line of sseLines(buf, decoder.decode())) handleLine(line)
    for (const line of sseFlush(buf)) handleLine(line)
    if (inputTokens || outputTokens) cb.onUsage?.({ inputTokens, outputTokens })
    cb.onDone(full)
  } catch (e) {
    handleStreamError(e, cb)
  } finally {
    reader.releaseLock()
  }
}

// ── Convenience: stream into a single resolved string ───────────────────────
//
// Wraps streamCompletion in a Promise, resolving with the full text on
// completion and rejecting with an AbortError if opts.signal aborts (mirrors
// the abort-listener pattern previously duplicated across cowrite.ts,
// QualityGate.ts, DebtService.ts, and AutopilotModal.tsx).

export function streamToString(
  messages: AIMessage[],
  opts: Parameters<typeof streamCompletion>[1],
  onChunk?: (partial: string) => void,
): Promise<string> {
  let partial = ''
  return new Promise<string>((resolve, reject) => {
    if (opts.signal) opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    streamCompletion(messages, opts, {
      onChunk: (c) => { partial += c; onChunk?.(partial) },
      onDone: resolve,
      onError: reject,
    }).catch(reject)
  })
}
