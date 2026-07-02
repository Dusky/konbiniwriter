import type { Project, ID } from '@shared/types'
import type { MentionIndex } from './MentionIndex'
import { mentionsIn } from './MentionIndex'
import { useAIStore } from '../store/aiStore'

// Rough token estimate: 1 token ≈ 4 chars for English prose.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type ContextFeature =
  | 'inline'      // single-element rewrite / expand / tighten
  | 'chat'        // AI assistant conversation
  | 'codex'       // codex card generation
  | 'batch'       // batch generator (chapter, cast, etc.)
  | 'evaluation'  // slop scorer / judge / reader panel
  | 'autopilot'   // autopilot pipeline step

export interface ContextTier {
  label: string
  content: string
  tokens: number
  included: boolean
  /** True when `content` is a trimmed portion of the original (see Tier 1). */
  truncated?: boolean
}

export interface ContextPacket {
  docId: ID
  feature: ContextFeature
  tiers: ContextTier[]
  totalTokens: number
  budgetTokens: number
  truncated: boolean
}

// Below this remaining-budget threshold, truncating the scene isn't worth
// it — drop the tier entirely instead of keeping a sliver of prose.
const MIN_TRUNCATE_TOKENS = 500

const TRUNCATION_PREFIX = '[…earlier scene content truncated…]\n\n'

// Default budget per feature. Sized for modern long-context models (200k–1M
// windows) — the manuscript tier lets drafting/chat see the whole book so far.
// Users can tighten per feature in AI Settings for smaller local models.
const BUDGETS: Record<ContextFeature, number> = {
  inline:     16_000,
  chat:       48_000,
  codex:       8_000,
  batch:      48_000,
  evaluation: 24_000,
  autopilot: 100_000,
}

// Features whose calls benefit from seeing the full manuscript written so far
// (continuity for drafting and conversation). Inline edits and evaluation stay
// scene-scoped.
const MANUSCRIPT_FEATURES: ReadonlySet<ContextFeature> = new Set(['chat', 'batch', 'autopilot'])

function getNodePath(project: Project, nodeId: ID): string[] {
  const path: string[] = []
  let current: import('@shared/types').KNode | null = project.nodes[nodeId] ?? null
  while (current) {
    path.unshift(current.title)
    current = current.parentId ? (project.nodes[current.parentId] ?? null) : null
  }
  return path
}

function getSiblingContext(project: Project, nodeId: ID): string {
  const node = project.nodes[nodeId]
  if (!node?.parentId) return ''
  const parent = project.nodes[node.parentId]
  if (!parent) return ''
  const siblings = parent.childIds
    .filter((id) => id !== nodeId)
    .slice(0, 4)
    .map((id) => {
      const n = project.nodes[id]
      if (!n) return ''
      const synopsis = n.meta.synopsis ? ` — ${n.meta.synopsis}` : ''
      return `- ${n.title}${synopsis}`
    })
    .filter(Boolean)
  return siblings.length ? `Siblings in "${parent.title}":\n${siblings.join('\n')}` : ''
}

/**
 * The manuscript written so far: every non-empty, non-folder document that
 * precedes `docId` in binder order (trash excluded), rendered as titled
 * sections. Truncation keeps the END, so the scenes closest to the current
 * one survive when the budget runs out.
 */
function getManuscriptSoFar(project: Project, docId: ID): string {
  const ordered: ID[] = []
  const walk = (ids: ID[]) => {
    for (const id of ids) {
      const n = project.nodes[id]
      if (!n) continue
      if (n.type !== 'folder') ordered.push(id)
      walk(n.childIds)
    }
  }
  walk(project.rootIds.filter((id) => id !== project.trashId))

  const idx = ordered.indexOf(docId)
  const before = idx === -1 ? [] : ordered.slice(0, idx)

  const sections = before
    .map((id) => {
      const content = project.docs[id]?.content?.trim()
      if (!content) return ''
      return `## ${project.nodes[id]?.title ?? 'Untitled'}\n${content}`
    })
    .filter(Boolean)

  return sections.join('\n\n')
}

function getCodexContext(
  project: Project,
  index: MentionIndex,
  docId: ID,
): string {
  const codexEntries = (project.settings.codex as import('@shared/types').CodexEntry[] | undefined) ?? []
  if (codexEntries.length === 0) return ''

  const aliases = new Set(mentionsIn(index, docId))
  if (aliases.size === 0) return ''

  const matched = codexEntries.filter((entry) => {
    if (aliases.has(entry.name.toLowerCase())) return true
    return entry.aliases.some((a) => aliases.has(a.toLowerCase()))
  })

  if (matched.length === 0) return ''

  return matched
    .map((entry) => {
      const header = `## ${entry.name} (${entry.category})`
      const desc = entry.summary ?? ''
      const facts = (entry.facts ?? []).map((f) => `${f.label}: ${f.value}`).join('\n')
      return [header, desc, facts].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

export function buildContext(
  project: Project,
  index: MentionIndex,
  docId: ID,
  feature: ContextFeature,
  budgetOverride?: number,
): ContextPacket {
  const stored = useAIStore.getState().contextBudgets[feature] ?? 0
  const budget = budgetOverride ?? (stored > 0 ? stored : BUDGETS[feature])
  const node = project.nodes[docId]
  const body = project.docs[docId]

  const tiers: ContextTier[] = []
  let remaining = budget

  const addTier = (label: string, content: string, opts?: { truncatable?: boolean }): boolean => {
    if (!content.trim()) return true
    const tokens = estimateTokens(content)
    if (tokens <= remaining) {
      tiers.push({ label, content, tokens, included: true })
      remaining -= tokens
      return true
    }

    // Tier doesn't fit whole. If truncatable and there's enough budget left
    // to be worth it, keep the END of the content (most relevant for
    // continuation — earlier context is covered by synopsis/sibling tiers),
    // trimmed to the next paragraph break.
    if (opts?.truncatable && remaining >= MIN_TRUNCATE_TOKENS) {
      const targetChars = remaining * 4
      let slice = content.slice(-targetChars)
      const breakIdx = slice.indexOf('\n\n')
      if (breakIdx !== -1 && breakIdx < slice.length - 2) {
        slice = slice.slice(breakIdx + 2)
      }
      const truncatedContent = TRUNCATION_PREFIX + slice
      const truncatedTokens = estimateTokens(truncatedContent)
      tiers.push({ label, content: truncatedContent, tokens: truncatedTokens, included: true, truncated: true })
      remaining -= truncatedTokens
      return true
    }

    tiers.push({ label, content, tokens, included: false })
    return false
  }

  // Tier 1 (always): scene content
  addTier('Scene content', body?.content ?? '', { truncatable: true })

  // Tier 2 (always): synopsis of direct parent
  const parentId = node?.parentId
  const parentNode = parentId ? project.nodes[parentId] : null
  if (parentNode?.meta.synopsis) {
    addTier('Chapter synopsis', `"${parentNode.title}": ${parentNode.meta.synopsis}`)
  }

  // Tier 3: sibling document titles + synopses
  addTier('Sibling scenes', getSiblingContext(project, docId))

  // Tier 4: document path (breadcrumb)
  const path = getNodePath(project, docId)
  if (path.length > 1) {
    addTier('Document path', `Location: ${path.join(' › ')}`)
  }

  // Tier 5: project-level voice fingerprint (style guide for prose generation)
  addTier('Voice fingerprint', (project.settings.voiceFingerprint as string | undefined) ?? '')

  // Tier 6: codex entities mentioned in this scene
  addTier('Codex entities', getCodexContext(project, index, docId))

  // Tier 7 (chat/batch/autopilot): the manuscript written so far. Added last
  // so it fills whatever budget the core tiers left; truncatable, keeping the
  // most recent scenes.
  if (MANUSCRIPT_FEATURES.has(feature)) {
    addTier('Manuscript so far', getManuscriptSoFar(project, docId), { truncatable: true })
  }

  const included = tiers.filter((t) => t.included)
  const totalTokens = included.reduce((s, t) => s + t.tokens, 0)
  const truncated = tiers.some((t) => !t.included || t.truncated)

  return { docId, feature, tiers, totalTokens, budgetTokens: budget, truncated }
}

/** Render a ContextPacket to a prompt string (system context block). */
export function renderContext(packet: ContextPacket): string {
  const parts = packet.tiers
    .filter((t) => t.included && t.content.trim())
    .map((t) => `### ${t.label}${t.truncated ? ' (truncated)' : ''}\n${t.content}`)
  return parts.join('\n\n')
}
