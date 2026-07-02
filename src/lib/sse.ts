// SSE line assembly. Network chunks don't align with event boundaries, so a
// `data:` line can straddle two reads; splitting each chunk independently
// silently drops the straddled event. Callers feed every decoded chunk through
// a shared carry buffer and only ever see complete lines.

export interface SSEBuffer { pending: string }

/** Feed a chunk into the carry buffer; returns the complete lines it closed. */
export function sseLines(buf: SSEBuffer, chunk: string): string[] {
  buf.pending += chunk
  const lines = buf.pending.split('\n')
  buf.pending = lines.pop() ?? ''
  return lines
}

/** Drain whatever remains after the stream ends (usually empty). */
export function sseFlush(buf: SSEBuffer): string[] {
  if (!buf.pending) return []
  const last = buf.pending
  buf.pending = ''
  return [last]
}
