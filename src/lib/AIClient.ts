import { useAIStore } from '../store/aiStore'

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: (fullText: string) => void
  onError: (err: Error) => void
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
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

  if (provider === 'anthropic') {
    const model = opts.model ?? store.anthropicModel
    await streamAnthropic(
      { apiKey: store.anthropicKey, model, messages, maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.7, systemPrompt: opts.systemPrompt, signal: opts.signal },
      callbacks,
    )
  } else {
    const model = opts.model ?? store.openaiModel
    await streamOpenAI(
      { baseUrl: store.openaiBaseUrl, apiKey: store.openaiKey, model, messages, maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.7, systemPrompt: opts.systemPrompt, signal: opts.signal },
      callbacks,
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
    cb.onError(e as Error)
    return
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    cb.onError(new Error(err?.error?.message ?? `HTTP ${res.status}`))
    return
  }

  const reader = res.body?.getReader()
  if (!reader) { cb.onError(new Error('No response body')); return }

  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const ev = JSON.parse(data)
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            full += ev.delta.text
            cb.onChunk(ev.delta.text)
          }
        } catch { /* ignore malformed SSE */ }
      }
    }
    cb.onDone(full)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') cb.onError(e as Error)
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
      }),
      signal: opts.signal,
    })
  } catch (e) {
    cb.onError(e as Error)
    return
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    cb.onError(new Error(err?.error?.message ?? `HTTP ${res.status}`))
    return
  }

  const reader = res.body?.getReader()
  if (!reader) { cb.onError(new Error('No response body')); return }

  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const ev = JSON.parse(data)
          const text = ev.choices?.[0]?.delta?.content
          if (text) { full += text; cb.onChunk(text) }
        } catch { /* ignore malformed SSE */ }
      }
    }
    cb.onDone(full)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') cb.onError(e as Error)
  } finally {
    reader.releaseLock()
  }
}
