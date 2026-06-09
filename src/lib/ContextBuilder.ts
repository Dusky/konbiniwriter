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
}

export interface ContextPacket {
  docId: ID
  feature: ContextFeature
  tiers: ContextTier[]
  totalTokens: number
  budgetTokens: number
  truncated: boolean
}

// Default budget per feature (generous for context quality; tighten per model)
const BUDGETS: Record<ContextFeature, number> = {
  inline:     6_000,
  chat:       8_000,
  codex:      4_000,
  batch:     12_000,
  evaluation: 8_000,
  autopilot: 16_000,
}

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

  const addTier = (label: string, content: string): boolean => {
    if (!content.trim()) return true
    const tokens = estimateTokens(content)
    const included = tokens <= remaining
    tiers.push({ label, content, tokens, included })
    if (included) remaining -= tokens
    return included
  }

  // Tier 1 (always): scene content
  addTier('Scene content', body?.content ?? '')

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

  const included = tiers.filter((t) => t.included)
  const totalTokens = included.reduce((s, t) => s + t.tokens, 0)
  const truncated = tiers.some((t) => !t.included)

  return { docId, feature, tiers, totalTokens, budgetTokens: budget, truncated }
}

/** Render a ContextPacket to a prompt string (system context block). */
export function renderContext(packet: ContextPacket): string {
  const parts = packet.tiers
    .filter((t) => t.included && t.content.trim())
    .map((t) => `### ${t.label}\n${t.content}`)
  return parts.join('\n\n')
}
