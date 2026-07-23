// AiMemory.ts — provider-agnostic "remember this" for the chat assistant.
//
// Native function-calling isn't available across every BYOK provider (local
// models especially), so instead of a tool the assistant emits a
// <remember>…</remember> directive in its reply when the author shares a durable
// fact worth keeping. After the stream finishes we extract those notes, append
// them to the project's notes (settings.aiInstructions — read on every future
// call and carried in the .konbini bundle), and strip the tags from what the
// user sees. Fully reviewable: the memories are plain text the author can edit
// or delete in AI Settings.

const REMEMBER_RE = /<remember>([\s\S]*?)<\/remember>/gi

export const MEMORY_INSTRUCTION =
  'Persistent memory: when the author states a durable fact, preference, or decision worth keeping for future ' +
  'sessions (a canon detail, a character trait, a style rule, a name spelling), save it by emitting on its own line:\n' +
  '<remember>a concise, self-contained note</remember>\n' +
  "Save only lasting, reusable facts — never ephemeral chatter, questions, or your own suggestions the author hasn't " +
  'accepted. Emit nothing when there is nothing worth saving. Saved notes are appended to the project notes and become ' +
  'available in every future conversation.'

/** Extract memory notes from an assistant reply, in order, trimmed and de-duped. */
export function extractMemories(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(REMEMBER_RE)) {
    const note = m[1].trim()
    if (note && !seen.has(note)) { seen.add(note); out.push(note) }
  }
  return out
}

/**
 * Remove <remember>…</remember> blocks from text shown to the user. Also drops a
 * trailing unclosed `<remember>` so a partial tag doesn't flash mid-stream.
 */
export function stripMemories(text: string): string {
  return text
    .replace(REMEMBER_RE, '')
    .replace(/<remember>[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Append notes to existing project-notes text as bullet lines. */
export function appendMemories(existing: string, notes: string[]): string {
  if (notes.length === 0) return existing
  const bullets = notes.map((n) => `- ${n}`).join('\n')
  return existing.trim() ? `${existing.trim()}\n${bullets}` : bullets
}
