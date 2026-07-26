import type { RailPanel } from '../../store/shellStore'

/**
 * The right rail's panels, and which of them are AI surfaces.
 *
 * This is the single source of truth for that question. Studio uses it to force
 * the rail off an AI panel when AI is switched off (invariant: AI off = no AI
 * in the DOM), and RightRail uses it to build the tab strip. Kept together
 * because the two had drifted: a hand-written "not an AI panel" allowlist in
 * Studio silently made any newly added non-AI panel unreachable with AI off.
 */
export const RAIL_TABS: { id: Exclude<RailPanel, null>; label: string; ai: boolean }[] = [
  { id: 'inspector', label: 'Inspector', ai: false },
  { id: 'comments',  label: 'Comments',  ai: false },
  { id: 'history',   label: 'History',   ai: false },
  { id: 'assistant', label: 'Chat',      ai: true },
  { id: 'codex',     label: 'Codex',     ai: true },
  { id: 'reader',    label: 'Readers',   ai: true },
  { id: 'critic',    label: 'Critic',    ai: true },
]

/** True when this panel may only be shown while AI is enabled. */
export function isAIPanel(p: RailPanel): boolean {
  return !!p && (RAIL_TABS.find((t) => t.id === p)?.ai ?? false)
}
