// DebtService — propagation-debt detection and resolution.
//
// When a Codex canon fact changes, scenes that reference the entity may now be
// stale. `fromFactChange` builds a DebtItem listing the implicated documents;
// `draftFix` produces a revision Proposal for one of them via the registry
// prompt (AI never writes the doc directly — it flows through changeset review).

import { diffWords } from 'diff'
import type { Project, CodexEntry, DebtItem, DebtAffected, Proposal, ProposalCommand, ID } from '@shared/types'
import { uid, wordCount } from '@shared/utils'
import { backlinksFor, mentionsIn, type MentionIndex } from './MentionIndex'
import { promptRegistry } from './PromptRegistry'
import { createProposal } from './ProposalService'
import { buildContext, renderContext } from './ContextBuilder'
import { streamCompletion } from './AIClient'

const REVISION_PROMPT_ID = 'builtin:revision:canon'
const CONTINUITY_PROMPT_ID = 'builtin:evaluation:continuity'

// Proposal commands whose original/proposed span the WHOLE document, so a
// before/after at proposal scope reflects the document. (Co-write commands are
// selection-scoped and excluded — their staleness signal is weak anyway.)
const WHOLE_DOC_COMMANDS = new Set<ProposalCommand>(['draft', 'revision', 'batch'])

// Significance gate for "this revision may have outdated the synopsis".
const MIN_CHANGED_WORDS = 40
const MIN_CHANGED_RATIO = 0.3

function changedWordCount(before: string, after: string): number {
  let changed = 0
  for (const part of diffWords(before, after)) {
    if (part.added || part.removed) changed += wordCount(part.value)
  }
  return changed
}

function docsMentioning(project: Project, index: MentionIndex, entity: CodexEntry): ID[] {
  const aliases = [entity.name.toLowerCase(), ...entity.aliases].filter(Boolean)
  const ids = new Set<ID>()
  for (const alias of aliases) for (const id of backlinksFor(index, alias)) ids.add(id)
  return [...ids]
}

export const debtService = {
  /**
   * Build a debt item for a fact change. Returns null when no open document
   * references the entity (nothing to reconcile).
   */
  fromFactChange(opts: {
    project: Project
    mentionIndex: MentionIndex
    entity: CodexEntry
    factLabel: string
    oldValue: string
    newValue: string
  }): DebtItem | null {
    const { project, mentionIndex, entity, factLabel, oldValue, newValue } = opts
    const docIds = docsMentioning(project, mentionIndex, entity)
    if (docIds.length === 0) return null

    const oldTrim = oldValue.trim()
    const affected: DebtAffected[] = docIds
      .filter((id) => project.nodes[id])
      .map((id) => {
        const content = project.docs[id]?.content ?? ''
        const hasOld = oldTrim.length >= 2 && content.toLowerCase().includes(oldTrim.toLowerCase())
        return {
          docId: id,
          note: hasOld ? `References ${entity.name}; still contains "${oldTrim}"` : `References ${entity.name}`,
          resolved: false,
        }
      })

    // Surface docs that literally contain the old value first.
    affected.sort((a, b) => Number(b.note.includes('still contains')) - Number(a.note.includes('still contains')))

    return {
      id: uid('debt'),
      layer: 'canon',
      title: `${entity.name} · ${factLabel.trim() || 'fact'} changed`,
      detail: `"${oldTrim}" → "${newValue.trim()}"`,
      source: entity.id,
      affected,
      createdAt: new Date().toISOString(),
      revision: { entityName: entity.name, factLabel: factLabel.trim(), oldValue: oldTrim, newValue: newValue.trim() },
    }
  },

  /**
   * Heuristic prose→outline debt: when a whole-document revision is applied and
   * the prose changed substantially, the scene's synopsis may no longer match.
   * Returns null unless the doc has a synopsis and the change clears the gate.
   * No AI is involved — resolution is Open (update the synopsis) or Mark OK.
   */
  maybeRaiseFromProposal(opts: { project: Project; proposal: Proposal; applied: string }): DebtItem | null {
    const { project, proposal, applied } = opts
    if (!WHOLE_DOC_COMMANDS.has(proposal.command)) return null
    const node = project.nodes[proposal.docId]
    if (!node || node.type === 'folder') return null
    const synopsis = node.meta.synopsis?.trim()
    if (!synopsis) return null

    const before = proposal.original
    const changed = changedWordCount(before, applied)
    const ratio = changed / Math.max(1, wordCount(before))
    if (changed < MIN_CHANGED_WORDS && ratio < MIN_CHANGED_RATIO) return null

    const affected: DebtAffected[] = [{
      docId: proposal.docId,
      note: 'Synopsis may no longer match the revised prose',
      resolved: false,
    }]
    return {
      id: uid('debt'),
      layer: 'outline',
      title: `${node.title} · synopsis may be stale`,
      detail: `prose revised (~${changed} words changed)`,
      source: proposal.docId,
      affected,
      createdAt: new Date().toISOString(),
    }
  },

  /**
   * On-demand LLM continuity check: ask the model whether a scene contradicts
   * any Codex facts for the entities it references. Raises one canon-layer debt
   * item per contradiction (with a draft-fix that reconciles prose → canon).
   * Returns the new items plus how many entities had facts to check, so the
   * caller can distinguish "nothing to check" from "no contradictions".
   */
  async checkContinuity(opts: {
    project: Project
    mentionIndex: MentionIndex
    codex: CodexEntry[]
    docId: ID
    signal?: AbortSignal
  }): Promise<{ items: DebtItem[]; entitiesChecked: number }> {
    const { project, mentionIndex, codex, docId, signal } = opts
    const template = promptRegistry.get(CONTINUITY_PROMPT_ID)
    if (!template) throw new Error(`Missing prompt template: ${CONTINUITY_PROMPT_ID}`)

    const document = project.docs[docId]?.content ?? ''
    if (!document.trim()) return { items: [], entitiesChecked: 0 }

    // Entities referenced in this scene that actually carry facts.
    const aliasesInDoc = new Set(mentionsIn(mentionIndex, docId))
    const entities = codex.filter((e) => {
      const names = [e.name.toLowerCase(), ...e.aliases]
      return names.some((n) => aliasesInDoc.has(n)) && e.facts.some((f) => f.value.trim())
    })
    if (entities.length === 0) return { items: [], entitiesChecked: 0 }

    const facts = entities.map((e) => {
      const lines = e.facts.filter((f) => f.value.trim()).map((f) => `- ${f.label || 'fact'}: ${f.value.trim()}`)
      return `## ${e.name} (${e.category})\n${lines.join('\n')}`
    }).join('\n\n')

    const rendered = promptRegistry.render(CONTINUITY_PROMPT_ID, { facts, document })

    const raw = await new Promise<string>((resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      streamCompletion(
        [{ role: 'user', content: rendered }],
        { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
        { onChunk: () => {}, onDone: resolve, onError: reject },
      ).catch(reject)
    })

    let flags: Array<{ entity: string; fact: string; value: string; issue: string }> = []
    try { flags = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { flags = [] }

    const docTitle = project.nodes[docId]?.title ?? 'this scene'
    const items: DebtItem[] = flags
      .filter((f) => f.entity && f.issue)
      .map((f) => ({
        id: uid('debt'),
        layer: 'canon' as const,
        title: `${f.entity} · ${f.fact || 'fact'} contradiction`,
        detail: f.issue,
        // Unique per doc+entity+fact so re-checking updates rather than stacks.
        source: `cont:${docId}:${f.entity}:${f.fact}`,
        affected: [{ docId, note: `${docTitle} may contradict canon "${f.fact}: ${f.value}"`, resolved: false }],
        createdAt: new Date().toISOString(),
        revision: {
          entityName: f.entity,
          factLabel: f.fact || 'fact',
          oldValue: 'the version implied by the current prose',
          newValue: f.value,
        },
      }))

    return { items, entitiesChecked: entities.length }
  },

  /** Generate a revision proposal reconciling one document with the new fact. */
  draftFix(opts: {
    project: Project
    mentionIndex: MentionIndex
    docId: ID
    entityName: string
    factLabel: string
    oldValue: string
    newValue: string
    debtId?: ID
    signal?: AbortSignal
  }): Promise<Proposal> {
    const { project, mentionIndex, docId, entityName, factLabel, oldValue, newValue, debtId, signal } = opts
    const template = promptRegistry.get(REVISION_PROMPT_ID)
    if (!template) return Promise.reject(new Error(`Missing prompt template: ${REVISION_PROMPT_ID}`))

    const document = project.docs[docId]?.content ?? ''
    const context = renderContext(buildContext(project, mentionIndex, docId, 'inline'))
    const rendered = promptRegistry.render(REVISION_PROMPT_ID, {
      entity: entityName, fact: factLabel, oldValue, newValue, context, document,
    })

    return new Promise<Proposal>((resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      streamCompletion(
        [{ role: 'user', content: rendered }],
        { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
        {
          onChunk: () => {},
          onDone: (full) => resolve(createProposal({
            docId,
            docTitle: project.nodes[docId]?.title ?? 'Document',
            command: 'revision',
            label: `Reconcile: ${entityName} · ${factLabel}`,
            group: 'Propagation debt',
            original: document,
            proposed: full.trim(),
            promptId: REVISION_PROMPT_ID,
            debtRef: debtId ? { debtId, docId } : undefined,
          })),
          onError: (err) => reject(err),
        },
      ).catch(reject)
    })
  },
}
