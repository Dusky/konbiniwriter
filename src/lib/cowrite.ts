// cowrite.ts — the single seam for inline co-write generation.
//
// Both the floating CowriteBar (shown on text selection) and the editor
// right-click menu invoke commands through `runCowrite`, so the prompt lookup,
// context assembly, streaming, and proposal construction live in exactly one
// place. The result is a pending Proposal; the caller queues it into the
// changeset review pipeline (AI never writes the doc directly — invariant #2).

import type { Project, Proposal } from '@shared/types'
import type { MentionIndex } from './MentionIndex'
import { promptRegistry } from './PromptRegistry'
import { createProposal } from './ProposalService'
import { buildContext, renderContext } from './ContextBuilder'
import { streamCompletion } from './AIClient'

export type CowriteCommand = 'rewrite' | 'expand' | 'tighten' | 'describe' | 'brainstorm'

export const COWRITE_COMMANDS: { id: CowriteCommand; label: string; promptId: string }[] = [
  { id: 'rewrite',    label: 'Rewrite',    promptId: 'builtin:inline:rewrite' },
  { id: 'expand',     label: 'Expand',     promptId: 'builtin:inline:expand' },
  { id: 'tighten',    label: 'Tighten',    promptId: 'builtin:inline:tighten' },
  { id: 'describe',   label: 'Describe',   promptId: 'builtin:inline:describe' },
  { id: 'brainstorm', label: 'Brainstorm', promptId: 'builtin:inline:brainstorm' },
]

export function runCowrite(opts: {
  command: CowriteCommand
  project: Project
  mentionIndex: MentionIndex
  docId: string
  selection: string
  signal?: AbortSignal
}): Promise<Proposal> {
  const { command, project, mentionIndex, docId, selection, signal } = opts
  const spec = COWRITE_COMMANDS.find((c) => c.id === command)
  if (!spec) return Promise.reject(new Error(`Unknown co-write command: ${command}`))
  const template = promptRegistry.get(spec.promptId)
  if (!template) return Promise.reject(new Error(`Missing prompt template: ${spec.promptId}`))

  const ctxPacket = buildContext(project, mentionIndex, docId, 'inline')
  const contextStr = renderContext(ctxPacket)
  const rendered = promptRegistry.render(spec.promptId, { context: contextStr, selection, content: selection })

  return new Promise<Proposal>((resolve, reject) => {
    // streamCompletion swallows AbortError without firing a callback, so settle
    // the promise here when the caller aborts.
    if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })

    streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal },
      {
        onChunk: () => {},
        onDone: (full) => resolve(createProposal({
          docId,
          docTitle: project.nodes[docId]?.title ?? 'Document',
          command,
          label: `${spec.label}: ${selection.slice(0, 40)}${selection.length > 40 ? '…' : ''}`,
          group: 'cowrite',
          original: selection,
          proposed: full.trim(),
          promptId: spec.promptId,
        })),
        onError: (err) => reject(err),
      },
    ).catch(reject)
  })
}
