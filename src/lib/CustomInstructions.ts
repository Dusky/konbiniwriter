// CustomInstructions.ts — Konbini's CLAUDE.md analog.
//
// The author's standing guidance and persistent notes, at two scopes:
//   • global   — applies to every project (persona, tone, preferences)
//   • project  — travels with the .konbini bundle (facts about this book,
//                characters to remember, style directives the AI should keep)
//
// Both are read on every creative AI call (chat + inline co-write) so the model
// behaves consistently and "remembers" across sessions. Structured evaluators
// deliberately do NOT include these, to keep their JSON output clean.

import { useAIStore } from '../store/aiStore'
import { useProjectStore } from '../store/projectStore'

/** The global instructions (all projects). */
export function globalInstructions(): string {
  return (useAIStore.getState().customInstructions ?? '').trim()
}

/** The current project's instructions/notes, or '' when no project is open. */
export function projectInstructions(): string {
  return ((useProjectStore.getState().project?.settings.aiInstructions as string | undefined) ?? '').trim()
}

/**
 * Combine both scopes into a single system-prompt block, global first. Returns
 * '' when neither is set so callers can skip the section cleanly.
 */
export function composeCustomInstructions(): string {
  const parts = [globalInstructions(), projectInstructions()].filter(Boolean)
  if (parts.length === 0) return ''
  return `The author has set these standing instructions and notes — follow them and keep them in mind:\n\n${parts.join('\n\n')}`
}
