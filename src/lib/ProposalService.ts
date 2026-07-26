import { diffLines } from 'diff'
import type { Proposal, DiffSegment, ID } from '@shared/types'
import { uid } from '@shared/utils'

// ── Diff → segments ──────────────────────────────────────────────────────────

export function buildSegments(original: string, proposed: string): DiffSegment[] {
  const changes = diffLines(original, proposed)
  const segments: DiffSegment[] = []
  let hunkIdx = 0
  let i = 0

  while (i < changes.length) {
    const change = changes[i]

    if (!change.added && !change.removed) {
      // Context block
      const lines = (change.value ?? '').split('\n').filter((_: string, j: number, a: string[]) => j < a.length - 1 || a[a.length - 1] !== '')
      segments.push({ type: 'ctx', lines })
      i++
      continue
    }

    // Collect contiguous del/add pair as one hunk
    const del: string[] = []
    const add: string[] = []

    while (i < changes.length && (changes[i].removed || changes[i].added)) {
      const c = changes[i]
      const lines = (c.value ?? '').replace(/\n$/, '').split('\n')
      if (c.removed) del.push(...lines)
      else if (c.added) add.push(...lines)
      i++
    }

    segments.push({ type: 'hunk', idx: hunkIdx++, del, add })
  }

  return segments
}

// ── Apply accepted hunks back to original ───────────────────────────────────

export function applySegments(
  original: string,
  segments: DiffSegment[],
  acceptedHunkIndices: number[],
): string {
  const accepted = new Set(acceptedHunkIndices)
  const parts: string[] = []

  for (const seg of segments) {
    if (seg.type === 'ctx') {
      parts.push(seg.lines.join('\n'))
    } else {
      if (accepted.has(seg.idx)) {
        parts.push(seg.add.join('\n'))
      } else {
        parts.push(seg.del.join('\n'))
      }
    }
  }

  return parts.join('\n')
}

// ── Proposal factory ─────────────────────────────────────────────────────────

export function createProposal(opts: {
  docId: ID
  docTitle: string
  command: Proposal['command']
  label: string
  group: string
  original: string
  proposed: string
  promptId?: string
  agentId?: string
  costEstimateCents?: number
  debtRef?: Proposal['debtRef']
  configRef?: Proposal['configRef']
  scope?: Proposal['scope']
  selRange?: Proposal['selRange']
}): Proposal {
  const segments = buildSegments(opts.original, opts.proposed)
  const nHunks = segments.filter((s) => s.type === 'hunk').length

  return {
    id: uid(),
    docId: opts.docId,
    docTitle: opts.docTitle,
    command: opts.command,
    label: opts.label,
    group: opts.group,
    original: opts.original,
    proposed: opts.proposed,
    createdAt: new Date().toISOString(),
    accepted: [],
    nHunks,
    status: 'pending',
    seq: Date.now(),
    promptId: opts.promptId,
    agentId: opts.agentId,
    costEstimateCents: opts.costEstimateCents,
    debtRef: opts.debtRef,
    configRef: opts.configRef,
    scope: opts.scope,
    selRange: opts.selRange,
  }
}

// ── Apply a proposal (snapshot first — caller must guarantee this) ───────────

export function resolveProposal(
  proposal: Proposal,
  acceptedHunkIndices: number[],
): string {
  const segments = buildSegments(proposal.original, proposal.proposed)
  return applySegments(proposal.original, segments, acceptedHunkIndices)
}

// ── Splice a resolved selection back into the current document ──────────────
//
// Selection-scoped proposals carry `original`/`proposed` for just the
// selected text (Studio.tsx must not pass `resolved` straight to
// `updateContent`, which would overwrite the whole document). This locates
// the selection in the *current* document content and replaces it with the
// resolved text.
//
// Match strategy: prefer `proposal.selRange` if the document still contains
// `proposal.original` at exactly that range (cheap, position-stable). Fall
// back to the first `indexOf(proposal.original)` match. If neither finds the
// original text, the document has changed underneath the proposal — surface
// an error rather than risk corrupting/duplicating content.

export function spliceSelection(
  docContent: string,
  proposal: Proposal,
  resolved: string,
): { content: string } | { error: 'selection-not-found' } {
  const { original, selRange } = proposal

  if (selRange && docContent.slice(selRange.from, selRange.to) === original) {
    return { content: docContent.slice(0, selRange.from) + resolved + docContent.slice(selRange.to) }
  }

  const idx = docContent.indexOf(original)
  if (idx === -1) return { error: 'selection-not-found' }

  return { content: docContent.slice(0, idx) + resolved + docContent.slice(idx + original.length) }
}
