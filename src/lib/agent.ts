// agent.ts — the chat assistant's streaming tool-use loop.
//
// One loop, two wires. The loop is provider-neutral: stream a turn, run whatever
// tools the model asked for, feed the results back, repeat until it answers.
// What differs between providers is only *phrasing* — Anthropic sends `tool_use`
// blocks and takes `tool_result` blocks back; OpenAI-compatible endpoints send
// `tool_calls` deltas and take `role: "tool"` messages back. Both are
// implemented here, so tools are a capability of the assistant rather than of
// one vendor.
//
// Auth reuses the same two request paths as AIClient — a direct fetch for API
// keys, the Electron main proxy for Claude subscription (OAuth) tokens.

import { useAIStore } from '../store/aiStore'
import { getValidAccessToken, CLAUDE_CODE_SYSTEM } from './ClaudeOAuth'
import { sseLines, sseFlush, type SSEBuffer } from './sse'
import { AGENT_TOOLS, AGENT_CONFIG_TOOLS, executeTool, type ToolDef, type AgentToolContext } from './agentTools'
import type { AIMessage } from './AIClient'

const MAX_STEPS = 6
const NO_SAMPLING_PARAMS = /fable-5|mythos|opus-4-[78]|sonnet-5/i

export interface AgentCallbacks {
  onChunk: (text: string) => void
  onToolUse?: (name: string, input: Record<string, unknown>) => void
  onDone: (fullText: string) => void
  onError: (err: Error) => void
  onAbort?: () => void
}

// ── The shape both wires speak ───────────────────────────────────────────────

/** One tool invocation the model asked for. */
export interface ToolCall { id: string; name: string; input: Record<string, unknown> }
interface Usage { in: number; out: number; cacheRead: number; cacheCreate: number }

/**
 * The result of one model turn.
 *
 * `truncated` means the response hit the output-token ceiling. It matters
 * because a tool call cut off mid-argument parses to garbage, and running a
 * tool on garbage is worse than stopping — so the loop ends the turn instead.
 */
export interface Turn { text: string; calls: ToolCall[]; truncated: boolean; usage: Usage }

interface ToolResult { call: ToolCall; content: string }

/** A provider's half of the loop: how to ask, and how to report results back. */
interface Wire {
  turn(onChunk: (t: string) => void, signal?: AbortSignal): Promise<Turn>
  record(turn: Turn, results: ToolResult[]): void
}

/** Incremental SSE → Turn. `push` per network chunk, `end` once at the close. */
export interface StreamParser {
  push(chunk: string): void
  end(): Turn
}

const emptyUsage = (): Usage => ({ in: 0, out: 0, cacheRead: 0, cacheCreate: 0 })

// ── Anthropic wire ───────────────────────────────────────────────────────────

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
interface AnthMsg { role: 'user' | 'assistant'; content: string | Block[] }

/** Parse Anthropic's Messages SSE. Exported for unit tests. */
export function anthropicParser(onChunk: (t: string) => void): StreamParser {
  const buf: SSEBuffer = { pending: '' }
  const partials = new Map<number, { id: string; name: string; json: string }>()
  const calls: ToolCall[] = []
  const usage = emptyUsage()
  let text = ''
  let stopReason = ''

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') return
    let e: Record<string, any>
    try { e = JSON.parse(data) } catch { return }
    switch (e.type) {
      case 'content_block_start':
        if (e.content_block?.type === 'tool_use') partials.set(e.index, { id: e.content_block.id, name: e.content_block.name, json: '' })
        break
      case 'content_block_delta':
        if (e.delta?.type === 'text_delta') { text += e.delta.text; onChunk(e.delta.text) }
        else if (e.delta?.type === 'input_json_delta') { const b = partials.get(e.index); if (b) b.json += e.delta.partial_json ?? '' }
        break
      case 'content_block_stop': {
        const b = partials.get(e.index)
        if (b) {
          let input: Record<string, unknown> = {}
          try { input = b.json ? JSON.parse(b.json) : {} } catch { input = {} }
          calls.push({ id: b.id, name: b.name, input })
        }
        break
      }
      case 'message_start': {
        const u = e.message?.usage
        if (u) { usage.in = u.input_tokens ?? 0; usage.cacheRead = u.cache_read_input_tokens ?? 0; usage.cacheCreate = u.cache_creation_input_tokens ?? 0; usage.out = u.output_tokens ?? 0 }
        break
      }
      case 'message_delta':
        if (e.delta?.stop_reason) stopReason = e.delta.stop_reason
        if (e.usage) usage.out = e.usage.output_tokens ?? usage.out
        break
    }
  }

  return {
    push: (chunk) => { for (const l of sseLines(buf, chunk)) handleLine(l) },
    end: () => {
      for (const l of sseFlush(buf)) handleLine(l)
      return { text, calls, truncated: stopReason === 'max_tokens', usage }
    },
  }
}

function anthropicWire(
  convo: AnthMsg[],
  tools: ToolDef[],
  opts: { model: string; maxTokens: number; temperature: number; systemPrompt?: string; oauthToken?: string },
): Wire {
  const sysBlocks: Record<string, unknown>[] = []
  if (opts.oauthToken) sysBlocks.push({ type: 'text', text: CLAUDE_CODE_SYSTEM })
  if (opts.systemPrompt) sysBlocks.push({ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } })

  return {
    async turn(onChunk, signal) {
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: convo,
        stream: true,
        tools,
      }
      if (!NO_SAMPLING_PARAMS.test(opts.model)) body.temperature = opts.temperature
      if (sysBlocks.length) body.system = sysBlocks

      const parser = anthropicParser(onChunk)

      // OAuth: proxy through the platform (the request must carry no browser
      // Origin). API key: direct fetch.
      if (opts.oauthToken) {
        const turn = await new Promise<Turn>((resolve, reject) => {
          const handle = window.api.oauth.streamMessages({ token: opts.oauthToken as string, body }, {
            onChunk: (t) => parser.push(t),
            onDone: () => resolve(parser.end()),
            onError: ({ status, body: b }) => reject(new Error(status === 401 || status === 403 ? 'Claude subscription was rejected — sign in again under AI Settings.' : (b || `Request failed (${status ?? 0})`))),
            onAbort: () => reject(new DOMException('Aborted', 'AbortError')),
          })
          signal?.addEventListener('abort', () => handle.abort(), { once: true })
        })
        recordUsage(opts.model, turn.usage)
        return turn
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': useAIStore.getState().anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        let msg = ''
        try { msg = JSON.parse(t)?.error?.message ?? '' } catch { msg = '' }
        throw new Error(res.status === 401 ? 'Authentication failed — check your API key in AI Settings' : (msg || `Request failed (${res.status})`))
      }
      const turn = await drain(res, parser)
      recordUsage(opts.model, turn.usage)
      return turn
    },

    record(turn, results) {
      const assistant: Block[] = []
      if (turn.text) assistant.push({ type: 'text', text: turn.text })
      for (const c of turn.calls) assistant.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input })
      convo.push({ role: 'assistant', content: assistant })
      convo.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.call.id, content: r.content })) })
    },
  }
}

// ── OpenAI-compatible wire ───────────────────────────────────────────────────
// Covers OpenAI, Groq, Together, Fireworks, Mistral, DeepSeek, OpenRouter,
// vLLM, LM Studio, Ollama — anything serving /chat/completions.

interface OAFunctionCall { id: string; type: 'function'; function: { name: string; arguments: string } }
type OAMsg =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: OAFunctionCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Translate the tool definitions into OpenAI's function schema.
 *
 * The shapes are the same information under different names, which is why
 * `ToolDef` can stay the single definition for both providers: Anthropic's
 * `input_schema` *is* OpenAI's `parameters` — both are plain JSON Schema.
 */
export function toOpenAITools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

/**
 * Parse OpenAI-compatible chat-completion SSE. Exported for unit tests.
 *
 * Tool calls arrive as deltas that have to be reassembled: the name lands in
 * the first frame and the arguments dribble in as string fragments across the
 * rest. Compat servers diverge here more than anywhere else in the spec, so
 * this is deliberately forgiving:
 *
 * - frames keyed by `index`, falling back to `id`, falling back to 0 (several
 *   servers omit `index` entirely when there is only one call);
 * - `arguments` accepted as an object as well as a string, since some servers
 *   hand back already-parsed JSON;
 * - the legacy singular `function_call` treated as tool call 0;
 * - `message` accepted where the spec says `delta`, for servers that stream
 *   whole messages;
 * - an `id` synthesised when the server omits one, because the result message
 *   has to reference it.
 */
export function openaiParser(onChunk: (t: string) => void): StreamParser {
  const buf: SSEBuffer = { pending: '' }
  const partials = new Map<string, { id: string; name: string; args: string }>()
  const usage = emptyUsage()
  let text = ''
  let finish = ''

  // Which partial a frame belongs to. `index` is the spec's answer; when a
  // server omits it we fall back to the id we already know, and failing that to
  // the frame's position in the array — which is what a server that sends
  // neither is implicitly using.
  const byId = new Map<string, string>()
  const keyFor = (raw: Record<string, any>, pos: number): string => {
    if (raw.index !== undefined) return String(raw.index)
    const id = raw.id === undefined ? '' : String(raw.id)
    if (id && byId.has(id)) return byId.get(id) as string
    return `pos${pos}`
  }

  const noteCall = (raw: Record<string, any>, pos: number): void => {
    const key = keyFor(raw, pos)
    const fn = raw.function ?? {}
    let p = partials.get(key)
    if (!p) { p = { id: '', name: '', args: '' }; partials.set(key, p) }
    if (raw.id) { p.id = String(raw.id); byId.set(p.id, key) }
    if (fn.name) p.name = String(fn.name)
    if (typeof fn.arguments === 'string') p.args += fn.arguments
    else if (fn.arguments && typeof fn.arguments === 'object') p.args = JSON.stringify(fn.arguments)
  }

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') return
    let ev: Record<string, any>
    try { ev = JSON.parse(data) } catch { return }

    const choice = ev.choices?.[0]
    const d = choice?.delta ?? choice?.message
    if (d && typeof d.content === 'string' && d.content) { text += d.content; onChunk(d.content) }
    if (Array.isArray(d?.tool_calls)) d.tool_calls.forEach((tc: Record<string, any>, i: number) => noteCall(tc, i))
    else if (d?.function_call) noteCall({ function: d.function_call }, 0)
    if (choice?.finish_reason) finish = String(choice.finish_reason)

    // Final usage frame (stream_options.include_usage); usually has no choices.
    if (ev.usage) {
      usage.in = ev.usage.prompt_tokens ?? usage.in
      usage.out = ev.usage.completion_tokens ?? usage.out
    }
  }

  return {
    push: (chunk) => { for (const l of sseLines(buf, chunk)) handleLine(l) },
    end: () => {
      for (const l of sseFlush(buf)) handleLine(l)
      const calls: ToolCall[] = []
      let n = 0
      for (const p of partials.values()) {
        if (!p.name) continue // a frame that carried arguments for nothing
        let input: Record<string, unknown> = {}
        try { const v = p.args.trim() ? JSON.parse(p.args) : {}; if (v && typeof v === 'object') input = v as Record<string, unknown> } catch { input = {} }
        calls.push({ id: p.id || `call_${n}`, name: p.name, input })
        n++
      }
      return { text, calls, truncated: finish === 'length', usage }
    },
  }
}

function mapOpenAIError(status: number, raw: string): string {
  let apiMsg = ''
  try { apiMsg = (JSON.parse(raw)?.error?.message ?? '') as string } catch { apiMsg = raw.slice(0, 200) }
  if (status === 401) return 'Authentication failed — check your API key in AI Settings'
  if (status === 429) return 'Rate limit reached — wait a moment and try again'
  if (status >= 500) return `API service error (${status}) — try again shortly`
  return apiMsg || `Request failed (${status})`
}

function openaiWire(
  convo: OAMsg[],
  tools: ToolDef[],
  opts: { baseUrl: string; apiKey: string; model: string; maxTokens: number; temperature: number },
): Wire {
  const fnTools = toOpenAITools(tools)
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.apiKey) headers['authorization'] = `Bearer ${opts.apiKey}`

  // Two capabilities we ask for and can live without. A server that rejects
  // either should still answer the author's question, so a 4xx that names the
  // offending field retires it for the rest of the conversation and retries,
  // rather than surfacing as a failed chat turn.
  let sendTools = true
  let sendUsage = true

  return {
    async turn(onChunk, signal) {
      for (;;) {
        const body: Record<string, unknown> = {
          model: opts.model,
          messages: convo,
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          stream: true,
        }
        if (sendUsage) body.stream_options = { include_usage: true }
        if (sendTools) { body.tools = fnTools; body.tool_choice = 'auto' }

        const res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal })
        if (!res.ok) {
          const raw = await res.text().catch(() => '')
          if (res.status >= 400 && res.status < 500) {
            if (sendUsage && /stream_options/i.test(raw)) { sendUsage = false; continue }
            if (sendTools && /\btools?\b|\bfunction/i.test(raw)) { sendTools = false; continue }
          }
          throw new Error(mapOpenAIError(res.status, raw))
        }

        const turn = await drain(res, openaiParser(onChunk))
        recordUsage(opts.model, turn.usage)
        return turn
      }
    },

    record(turn, results) {
      convo.push({
        role: 'assistant',
        content: turn.text || null,
        tool_calls: turn.calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })),
      })
      // One message per call, in the order they were requested — an endpoint
      // that gets a tool_call_id it never issued (or misses one) 400s.
      for (const r of results) convo.push({ role: 'tool', tool_call_id: r.call.id, content: r.content })
    },
  }
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

/** Feed a streaming response body through a parser and close it out. */
async function drain(res: Response, parser: StreamParser): Promise<Turn> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    return parser.end()
  } finally {
    reader.releaseLock()
  }
}

function recordUsage(model: string, u: Usage): void {
  if (u.in || u.out || u.cacheRead || u.cacheCreate) {
    useAIStore.getState().recordSpend(model, u.in, u.out, u.cacheRead, u.cacheCreate)
  }
}

/**
 * The model to send, mirroring AIClient's rule: prompt templates hardcode
 * `claude-*` ids, so a requested model that doesn't match the active provider
 * gives way to that provider's configured default.
 */
function resolveModel(requested: string | undefined): string {
  const s = useAIStore.getState()
  const anthropic = s.provider === 'anthropic'
  let model = requested || (anthropic ? s.anthropicModel : s.openaiModel)
  if (!anthropic && /^claude-/.test(model)) model = s.openaiModel
  if (anthropic && !/^claude-/.test(model)) model = s.anthropicModel
  return model
}

// ── The loop ─────────────────────────────────────────────────────────────────

/** Run the full tool-use loop for a chat turn, on whichever provider is active. */
export async function runAgent(
  messages: AIMessage[],
  opts: { model?: string; maxTokens: number; temperature: number; systemPrompt?: string; signal?: AbortSignal; ctx: AgentToolContext },
  cb: AgentCallbacks,
): Promise<void> {
  const store = useAIStore.getState()
  const model = resolveModel(opts.model)

  // Advertise the config tools only when the capability is actually wired.
  // Deriving the list from the context rather than from a flag makes it
  // impossible to offer the model a tool whose executor will refuse it.
  const tools = opts.ctx.proposeConfig ? [...AGENT_TOOLS, ...AGENT_CONFIG_TOOLS] : AGENT_TOOLS

  let wire: Wire
  if (store.provider === 'anthropic') {
    let oauthToken: string | undefined
    if (store.anthropicAuthMode === 'oauth') {
      oauthToken = (await getValidAccessToken()) ?? undefined
      if (!oauthToken) { cb.onError(new Error('Claude subscription not signed in — sign in again under AI Settings')); return }
    }
    const convo: AnthMsg[] = messages.map((m) => ({ role: m.role, content: m.content }))
    wire = anthropicWire(convo, tools, { model, maxTokens: opts.maxTokens, temperature: opts.temperature, systemPrompt: opts.systemPrompt, oauthToken })
  } else {
    const convo: OAMsg[] = opts.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
      : [...messages]
    wire = openaiWire(convo, tools, { baseUrl: store.openaiBaseUrl, apiKey: store.openaiKey, model, maxTokens: opts.maxTokens, temperature: opts.temperature })
  }

  let fullText = ''
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const turn = await wire.turn(cb.onChunk, opts.signal)
      fullText += turn.text

      // Stop on "no tools wanted" rather than on a stop reason: compat servers
      // are inconsistent about reporting `tool_calls`, and several report
      // `stop` while still emitting a complete call.
      if (turn.calls.length === 0) { cb.onDone(fullText); return }
      // A call whose arguments were cut off mid-JSON isn't safe to run.
      if (turn.truncated) { cb.onDone(fullText || 'The response hit the token limit before it finished asking for a tool.'); return }

      const results: ToolResult[] = []
      for (const call of turn.calls) {
        cb.onToolUse?.(call.name, call.input)
        let content: string
        try { content = await executeTool(call.name, call.input, opts.ctx) } catch (err) { content = `Error: ${(err as Error).message}` }
        results.push({ call, content })
      }
      wire.record(turn, results)
    }
    // Ran out of steps — return whatever text we have.
    cb.onDone(fullText || 'I reached the tool-use limit for this turn.')
  } catch (err) {
    if ((err as Error).name === 'AbortError') { if (cb.onAbort) cb.onAbort(); else cb.onError(err as Error) }
    else cb.onError(err as Error)
  }
}
