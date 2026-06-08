// DebtService — propagation-debt detection and resolution.
//
// When a Codex canon fact changes, scenes that reference the entity may now be
// stale. `fromFactChange` builds a DebtItem listing the implicated documents;
// `draftFix` produces a revision Proposal for one of them via the registry
// prompt (AI never writes the doc directly — it flows through changeset review).

import type { Project, CodexEntry, DebtItem, DebtAffected, Proposal, ID } from '@shared/types'
import { uid } from '@shared/utils'
import { backlinksFor, type MentionIndex } from './MentionIndex'
import { promptRegistry } from './PromptRegistry'
import { createProposal } from './ProposalService'
import { buildContext, renderContext } from './ContextBuilder'
import { streamCompletion } from './AIClient'

const REVISION_PROMPT_ID = 'builtin:revision:canon'

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

  /** Generate a revision proposal reconciling one document with the new fact. */
  draftFix(opts: {
    project: Project
    mentionIndex: MentionIndex
    docId: ID
    entityName: string
    factLabel: string
    oldValue: string
    newValue: string
    signal?: AbortSignal
  }): Promise<Proposal> {
    const { project, mentionIndex, docId, entityName, factLabel, oldValue, newValue, signal } = opts
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
          })),
          onError: (err) => reject(err),
        },
      ).catch(reject)
    })
  },
}
