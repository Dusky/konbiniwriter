// The two wire formats the tool loop speaks. These are the parts that can't be
// checked by driving the app — a real endpoint is the other side of the wire —
// so they're pinned here against faithful transcripts of what each provider
// sends, including the divergences OpenAI-compatible servers are known for.

import { describe, it, expect } from 'vitest'
import { anthropicParser, openaiParser, toOpenAITools } from './agent'
import { AGENT_TOOLS } from './agentTools'
import type { StreamParser, Turn } from './agent'

/** Feed a transcript through a parser, optionally split at arbitrary offsets. */
function run(parser: StreamParser, sse: string, chunkSize = 0): Turn {
  if (chunkSize <= 0) { parser.push(sse) } else {
    for (let i = 0; i < sse.length; i += chunkSize) parser.push(sse.slice(i, i + chunkSize))
  }
  return parser.end()
}

const line = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`
const oa = (delta: unknown, extra: Record<string, unknown> = {}): string =>
  line({ choices: [{ index: 0, delta, ...extra }] })

describe('openaiParser', () => {
  it('streams plain text and reports no tool calls', () => {
    const seen: string[] = []
    const sse = oa({ role: 'assistant', content: '' }) + oa({ content: 'Once ' }) + oa({ content: 'upon' })
      + oa({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n'
    const turn = run(openaiParser((t) => seen.push(t)), sse)
    expect(seen.join('')).toBe('Once upon')
    expect(turn.text).toBe('Once upon')
    expect(turn.calls).toEqual([])
    expect(turn.truncated).toBe(false)
  })

  it('reassembles one tool call whose arguments arrive in fragments', () => {
    const sse =
      oa({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_document', arguments: '' } }] })
      + oa({ tool_calls: [{ index: 0, function: { arguments: '{"tit' } }] })
      + oa({ tool_calls: [{ index: 0, function: { arguments: 'le":"Chapter One"}' } }] })
      + oa({}, { finish_reason: 'tool_calls' })
      + 'data: [DONE]\n\n'
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.calls).toEqual([{ id: 'call_1', name: 'get_document', input: { title: 'Chapter One' } }])
  })

  it('survives the fragments being split across network chunk boundaries', () => {
    const sse =
      oa({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_manuscript', arguments: '' } }] })
      + oa({ tool_calls: [{ index: 0, function: { arguments: '{"query":"the lighthouse"}' } }] })
      + oa({}, { finish_reason: 'tool_calls' })
    // 7 is prime relative to nothing in the payload — every line straddles a read.
    const turn = run(openaiParser(() => {}), sse, 7)
    expect(turn.calls).toEqual([{ id: 'call_1', name: 'search_manuscript', input: { query: 'the lighthouse' } }])
  })

  it('keeps two parallel calls apart by index, interleaved', () => {
    const sse =
      oa({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'get_document', arguments: '' } }] })
      + oa({ tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'get_document', arguments: '' } }] })
      + oa({ tool_calls: [{ index: 0, function: { arguments: '{"title":"One"' } }] })
      + oa({ tool_calls: [{ index: 1, function: { arguments: '{"title":"Two"' } }] })
      + oa({ tool_calls: [{ index: 0, function: { arguments: '}' } }] })
      + oa({ tool_calls: [{ index: 1, function: { arguments: '}' } }] })
      + oa({}, { finish_reason: 'tool_calls' })
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.calls).toEqual([
      { id: 'a', name: 'get_document', input: { title: 'One' } },
      { id: 'b', name: 'get_document', input: { title: 'Two' } },
    ])
  })

  it('follows a call whose continuation frames carry neither index nor id', () => {
    const sse =
      oa({ tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'list_documents', arguments: '' } }] })
      + oa({ tool_calls: [{ function: { arguments: '{}' } }] })
      + oa({}, { finish_reason: 'tool_calls' })
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.calls).toEqual([{ id: 'call_x', name: 'list_documents', input: {} }])
  })

  it('accepts arguments delivered as an object rather than a JSON string', () => {
    const sse = oa({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'remember', arguments: { note: 'Mira is left-handed' } } }] })
      + oa({}, { finish_reason: 'tool_calls' })
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.calls[0]?.input).toEqual({ note: 'Mira is left-handed' })
  })

  it('accepts `message` where the spec says `delta`', () => {
    const sse = line({ choices: [{ index: 0, message: { content: 'hi', tool_calls: [{ index: 0, id: 'z', function: { name: 'list_documents', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.text).toBe('hi')
    expect(turn.calls[0]?.name).toBe('list_documents')
  })

  it('treats the legacy singular function_call as a tool call', () => {
    const sse = oa({ function_call: { name: 'list_documents', arguments: '' } })
      + oa({ function_call: { arguments: '{}' } })
      + oa({}, { finish_reason: 'function_call' })
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.calls).toEqual([{ id: 'call_0', name: 'list_documents', input: {} }])
  })

  it('still reports the call when finish_reason says `stop`', () => {
    // Several compat servers never emit `tool_calls` as a finish reason. The
    // loop keys on "were any calls requested", so this must still surface one.
    const sse = oa({ tool_calls: [{ index: 0, id: 'c', function: { name: 'list_documents', arguments: '{}' } }] })
      + oa({}, { finish_reason: 'stop' })
    expect(run(openaiParser(() => {}), sse).calls).toHaveLength(1)
  })

  it('flags a response cut off at the token ceiling', () => {
    const sse = oa({ tool_calls: [{ index: 0, id: 'c', function: { name: 'propose_edit', arguments: '{"document":"One","new_te' } }] })
      + oa({}, { finish_reason: 'length' })
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.truncated).toBe(true)
  })

  it('does not invent input from unparseable arguments', () => {
    const sse = oa({ tool_calls: [{ index: 0, id: 'c', function: { name: 'get_document', arguments: '{"title":' } }] })
      + oa({}, { finish_reason: 'tool_calls' })
    expect(run(openaiParser(() => {}), sse).calls[0]?.input).toEqual({})
  })

  it('reads the trailing usage frame, which carries no choices', () => {
    const sse = oa({ content: 'hi' }) + line({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 8 } }) + 'data: [DONE]\n\n'
    const turn = run(openaiParser(() => {}), sse)
    expect(turn.usage.in).toBe(120)
    expect(turn.usage.out).toBe(8)
  })

  it('ignores malformed frames instead of failing the turn', () => {
    const sse = 'data: not json\n\n' + oa({ content: 'ok' }) + ': keepalive\n\n'
    expect(run(openaiParser(() => {}), sse).text).toBe('ok')
  })
})

describe('anthropicParser', () => {
  const anth = (o: unknown): string => `event: x\ndata: ${JSON.stringify(o)}\n\n`

  it('streams text and reassembles a tool_use block', () => {
    const seen: string[] = []
    const sse =
      anth({ type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 900 } } })
      + anth({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      + anth({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me look.' } })
      + anth({ type: 'content_block_stop', index: 0 })
      + anth({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'search_manuscript' } })
      + anth({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query"' } })
      + anth({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"lighthouse"}' } })
      + anth({ type: 'content_block_stop', index: 1 })
      + anth({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 57 } })
    const turn = run(anthropicParser((t) => seen.push(t)), sse, 11)
    expect(seen.join('')).toBe('Let me look.')
    expect(turn.text).toBe('Let me look.')
    expect(turn.calls).toEqual([{ id: 'toolu_1', name: 'search_manuscript', input: { query: 'lighthouse' } }])
    expect(turn.usage).toEqual({ in: 40, out: 57, cacheRead: 900, cacheCreate: 0 })
    expect(turn.truncated).toBe(false)
  })

  it('flags a turn that stopped at max_tokens', () => {
    const sse = anth({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })
    expect(run(anthropicParser(() => {}), sse).truncated).toBe(true)
  })

  it('treats a tool_use block with no arguments as an empty input', () => {
    const sse = anth({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'list_documents' } })
      + anth({ type: 'content_block_stop', index: 0 })
    expect(run(anthropicParser(() => {}), sse).calls).toEqual([{ id: 't', name: 'list_documents', input: {} }])
  })
})

describe('toOpenAITools', () => {
  it('carries every tool across with its schema intact', () => {
    const out = toOpenAITools(AGENT_TOOLS) as Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
    expect(out).toHaveLength(AGENT_TOOLS.length)
    for (const [i, t] of AGENT_TOOLS.entries()) {
      expect(out[i]?.type).toBe('function')
      expect(out[i]?.function.name).toBe(t.name)
      expect(out[i]?.function.description).toBe(t.description)
      // Anthropic's input_schema and OpenAI's parameters are both plain JSON
      // Schema — the translation is a rename, not a conversion.
      expect(out[i]?.function.parameters).toEqual(t.input_schema)
    }
  })

  it('gives a no-argument tool a valid empty object schema', () => {
    const listing = toOpenAITools(AGENT_TOOLS.filter((t) => t.name === 'list_documents')) as Array<{ function: { parameters: { type: string; properties: unknown } } }>
    expect(listing[0]?.function.parameters).toEqual({ type: 'object', properties: {} })
  })
})
