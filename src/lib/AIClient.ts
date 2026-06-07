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
  const { apiKey, provider, ollamaHost, defaultModel } = useAIStore.getState()
  const model = opts.model ?? defaultModel
  const maxTokens = opts.maxTokens ?? 2048
  const temperature = opts.temperature ?? 0.7

  if (provider === 'anthropic') {
    await streamAnthropic({ apiKey, model, messages, maxTokens, temperature, systemPrompt: opts.systemPrompt, signal: opts.signal }, callbacks)
  } else {
    await streamOllama({ host: ollamaHost, model, messages, maxTokens, temperature, systemPrompt: opts.systemPrompt, signal: opts.signal }, callbacks)
  }
}

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

async function streamOllama(
  opts: { host: string; model: string; messages: AIMessage[]; maxTokens: number; temperature: number; systemPrompt?: string; signal?: AbortSignal },
  cb: StreamCallbacks,
): Promise<void> {
  const messages: AIMessage[] = opts.systemPrompt
    ? [{ role: 'user', content: `[System: ${opts.systemPrompt}]\n\n${opts.messages[0]?.content ?? ''}` }, ...opts.messages.slice(1)]
    : opts.messages

  let res: Response
  try {
    res = await fetch(`${opts.host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: opts.model, messages, stream: true, options: { temperature: opts.temperature, num_predict: opts.maxTokens } }),
      signal: opts.signal,
    })
  } catch (e) {
    cb.onError(e as Error)
    return
  }

  if (!res.ok) { cb.onError(new Error(`Ollama HTTP ${res.status}`)); return }

  const reader = res.body?.getReader()
  if (!reader) { cb.onError(new Error('No response body')); return }

  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value, { stream: true }).split('\n').filter(Boolean)) {
        try {
          const ev = JSON.parse(line)
          if (ev.message?.content) { full += ev.message.content; cb.onChunk(ev.message.content) }
          if (ev.done) { cb.onDone(full); return }
        } catch { /* ignore */ }
      }
    }
    cb.onDone(full)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') cb.onError(e as Error)
  } finally {
    reader.releaseLock()
  }
}
