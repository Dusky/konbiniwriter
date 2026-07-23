// agent.ts — a streaming tool-use loop for the chat assistant (Anthropic).
//
// Native function-calling: the model streams text and/or tool_use blocks; when a
// turn stops for tools we execute them (via agentTools), feed the results back,
// and continue until it produces a final answer. Reuses the same two request
// paths as AIClient — a direct fetch for API keys, the Electron main proxy for
// subscription (OAuth) tokens — so it works for both auth modes.

import { useAIStore } from '../store/aiStore'
import { getValidAccessToken, CLAUDE_CODE_SYSTEM } from './ClaudeOAuth'
import { sseLines, sseFlush, type SSEBuffer } from './sse'
import { AGENT_TOOLS, executeTool, type AgentToolContext } from './agentTools'
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

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
interface Msg { role: 'user' | 'assistant'; content: string | Block[] }
interface ToolUse { id: string; name: string; input: Record<string, unknown> }
interface TurnResult { text: string; toolUses: ToolUse[]; stopReason: string }

/** Stream one Anthropic turn, collecting text (streamed out) and any tool_use blocks. */
function streamTurn(
  body: Record<string, unknown>,
  oauthToken: string | undefined,
  onChunk: (t: string) => void,
  signal: AbortSignal | undefined,
): Promise<TurnResult> {
  const buf: SSEBuffer = { pending: '' }
  const partials = new Map<number, { id: string; name: string; json: string }>()
  const toolUses: ToolUse[] = []
  let text = ''
  let stopReason = ''
  let usageIn = 0
  let usageOut = 0
  let cacheRead = 0
  let cacheCreate = 0

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') return
    let ev: Record<string, unknown> & { type?: string }
    try { ev = JSON.parse(data) } catch { return }
    const e = ev as Record<string, any>
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
        if (b) { let input: Record<string, unknown> = {}; try { input = b.json ? JSON.parse(b.json) : {} } catch { input = {} } toolUses.push({ id: b.id, name: b.name, input }) }
        break
      }
      case 'message_start': {
        const u = e.message?.usage
        if (u) { usageIn = u.input_tokens ?? 0; cacheRead = u.cache_read_input_tokens ?? 0; cacheCreate = u.cache_creation_input_tokens ?? 0; usageOut = u.output_tokens ?? 0 }
        break
      }
      case 'message_delta':
        if (e.delta?.stop_reason) stopReason = e.delta.stop_reason
        if (e.usage) usageOut = e.usage.output_tokens ?? usageOut
        break
    }
  }
  const consume = (t: string) => { for (const line of sseLines(buf, t)) handleLine(line) }
  const recordUsage = () => {
    if (usageIn || usageOut || cacheRead || cacheCreate) {
      useAIStore.getState().recordSpend(String(body.model), usageIn, usageOut, cacheRead, cacheCreate)
    }
  }

  // OAuth: proxy through the platform. API key: direct fetch.
  if (oauthToken) {
    return new Promise<TurnResult>((resolve, reject) => {
      const handle = window.api.oauth.streamMessages({ token: oauthToken, body }, {
        onChunk: (t) => consume(t),
        onDone: () => { for (const l of sseFlush(buf)) handleLine(l); recordUsage(); resolve({ text, toolUses, stopReason }) },
        onError: ({ status, body: b }) => reject(new Error(status === 401 || status === 403 ? 'Claude subscription was rejected — sign in again under AI Settings.' : (b || `Request failed (${status ?? 0})`))),
        onAbort: () => reject(new DOMException('Aborted', 'AbortError')),
      })
      signal?.addEventListener('abort', () => handle.abort(), { once: true })
    })
  }

  return (async () => {
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
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')
    const decoder = new TextDecoder()
    for (;;) { const { done, value } = await reader.read(); if (done) break; consume(decoder.decode(value, { stream: true })) }
    consume(decoder.decode())
    for (const l of sseFlush(buf)) handleLine(l)
    recordUsage()
    return { text, toolUses, stopReason }
  })()
}

/** Run the full tool-use loop for a chat turn. */
export async function runAgent(
  messages: AIMessage[],
  opts: { model: string; maxTokens: number; temperature: number; systemPrompt?: string; signal?: AbortSignal; ctx: AgentToolContext },
  cb: AgentCallbacks,
): Promise<void> {
  const store = useAIStore.getState()
  const oauth = store.anthropicAuthMode === 'oauth'
  let oauthToken: string | undefined
  if (oauth) {
    oauthToken = (await getValidAccessToken()) ?? undefined
    if (!oauthToken) { cb.onError(new Error('Claude subscription not signed in — sign in again under AI Settings')); return }
  }

  const sysBlocks: Record<string, unknown>[] = []
  if (oauth) sysBlocks.push({ type: 'text', text: CLAUDE_CODE_SYSTEM })
  if (opts.systemPrompt) sysBlocks.push({ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } })

  const convo: Msg[] = messages.map((m) => ({ role: m.role, content: m.content }))
  let fullText = ''

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: convo,
        stream: true,
        tools: AGENT_TOOLS,
      }
      if (!NO_SAMPLING_PARAMS.test(opts.model)) body.temperature = opts.temperature
      if (sysBlocks.length) body.system = sysBlocks

      const turn = await streamTurn(body, oauthToken, cb.onChunk, opts.signal)
      fullText += turn.text

      if (turn.stopReason !== 'tool_use' || turn.toolUses.length === 0) { cb.onDone(fullText); return }

      // Record the assistant's turn (text + tool_use), then run the tools.
      const assistantContent: Block[] = []
      if (turn.text) assistantContent.push({ type: 'text', text: turn.text })
      for (const tu of turn.toolUses) assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      convo.push({ role: 'assistant', content: assistantContent })

      const results: Block[] = []
      for (const tu of turn.toolUses) {
        cb.onToolUse?.(tu.name, tu.input)
        let result: string
        try { result = await executeTool(tu.name, tu.input, opts.ctx) } catch (err) { result = `Error: ${(err as Error).message}` }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
      }
      convo.push({ role: 'user', content: results })
    }
    // Ran out of steps — return whatever text we have.
    cb.onDone(fullText || 'I reached the tool-use limit for this turn.')
  } catch (err) {
    if ((err as Error).name === 'AbortError') { if (cb.onAbort) cb.onAbort(); else cb.onError(err as Error) }
    else cb.onError(err as Error)
  }
}
