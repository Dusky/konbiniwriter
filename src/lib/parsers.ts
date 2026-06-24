// parsers.ts — small pure parsers for model output shapes shared across
// AI features (reader-panel verdicts, brainstorm alternatives).

/** Parses a reader persona's "VERDICT: <score> | keep|drop" line. */
export function parseReaderVerdict(text: string): { score: number | null; keep: boolean | null } {
  const m = text.match(/VERDICT:\s*(\d{1,3})\s*\|\s*(keep|drop|yes|no)/i)
  if (!m) return { score: null, keep: null }
  return { score: Math.min(100, Math.max(0, parseInt(m[1], 10))), keep: /keep|yes/i.test(m[2]) }
}

/** Splits a numbered-list brainstorm response into its alternatives. Returns
 *  [] if fewer than 2 numbered items are found (not a valid alternatives list). */
export function parseBrainstormAlternatives(raw: string): string[] {
  const parts = raw
    .split(/\n+(?=\d+\.\s)/)
    .map((s) => s.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)
  return parts.length >= 2 ? parts : []
}
