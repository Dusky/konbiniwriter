import { describe, it, expect } from 'vitest'
import { sseLines, sseFlush, type SSEBuffer } from './sse'

function collect(chunks: string[]): string[] {
  const buf: SSEBuffer = { pending: '' }
  const lines: string[] = []
  for (const c of chunks) lines.push(...sseLines(buf, c))
  lines.push(...sseFlush(buf))
  return lines
}

describe('sseLines', () => {
  it('passes whole-line chunks through unchanged', () => {
    expect(collect(['data: {"a":1}\n', 'data: {"b":2}\n'])).toEqual([
      'data: {"a":1}',
      'data: {"b":2}',
    ])
  })

  it('reassembles a line split across two chunks', () => {
    expect(collect(['data: {"text":"hel', 'lo"}\n'])).toEqual(['data: {"text":"hello"}'])
  })

  it('reassembles a line split across three chunks', () => {
    expect(collect(['da', 'ta: {"text":"wor', 'ld"}\n'])).toEqual(['data: {"text":"world"}'])
  })

  it('handles multiple lines in one chunk plus a straddled tail', () => {
    expect(collect(['data: {"a":1}\ndata: {"b"', ':2}\ndata: {"c":3}\n'])).toEqual([
      'data: {"a":1}',
      'data: {"b":2}',
      'data: {"c":3}',
    ])
  })

  it('neither loses nor duplicates lines across many small chunks', () => {
    const event = 'data: {"delta":{"type":"text_delta","text":"abcdef"}}\n\n'
    // Feed one character at a time — the worst-case chunking.
    const lines = collect(event.split(''))
    expect(lines.filter(Boolean)).toEqual(['data: {"delta":{"type":"text_delta","text":"abcdef"}}'])
  })
})

describe('sseFlush', () => {
  it('returns a trailing line missing its newline', () => {
    const buf: SSEBuffer = { pending: '' }
    expect(sseLines(buf, 'data: [DONE]')).toEqual([])
    expect(sseFlush(buf)).toEqual(['data: [DONE]'])
  })

  it('returns nothing when the stream ended cleanly', () => {
    const buf: SSEBuffer = { pending: '' }
    sseLines(buf, 'data: {"a":1}\n')
    expect(sseFlush(buf)).toEqual([])
  })

  it('drains the buffer so a second flush is empty', () => {
    const buf: SSEBuffer = { pending: 'tail' }
    expect(sseFlush(buf)).toEqual(['tail'])
    expect(sseFlush(buf)).toEqual([])
  })
})
