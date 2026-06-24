import { describe, it, expect } from 'vitest'
import { buildSegments, applySegments, resolveProposal, spliceSelection } from './ProposalService'
import { createProposal } from './ProposalService'

describe('buildSegments / applySegments roundtrip', () => {
  it('reconstructs the original when no hunks are accepted', () => {
    const original = 'line1\nline2\nline3'
    const proposed = 'line1\nCHANGED\nline3'
    const segments = buildSegments(original, proposed)
    expect(applySegments(original, segments, [])).toBe(original)
  })

  it('reconstructs the proposed text when all hunks are accepted', () => {
    const original = 'line1\nline2\nline3'
    const proposed = 'line1\nCHANGED\nline3'
    const segments = buildSegments(original, proposed)
    const hunkIndices = segments.filter((s) => s.type === 'hunk').map((s) => s.idx)
    expect(applySegments(original, segments, hunkIndices)).toBe(proposed)
  })

  it('handles multi-hunk diffs with partial acceptance', () => {
    const original = 'a\nb\nc\nd\ne'
    const proposed = 'A\nb\nc\nD\ne'
    const segments = buildSegments(original, proposed)
    const hunks = segments.filter((s) => s.type === 'hunk')
    expect(hunks.length).toBe(2)
    // Accept only the first hunk
    const result = applySegments(original, segments, [hunks[0].idx])
    expect(result).toBe('A\nb\nc\nd\ne')
  })

  it('resolveProposal matches buildSegments+applySegments', () => {
    const original = 'one\ntwo\nthree'
    const proposed = 'one\nTWO\nthree'
    const segments = buildSegments(original, proposed)
    const hunkIndices = segments.filter((s) => s.type === 'hunk').map((s) => s.idx)
    const proposal = createProposal({
      docId: 'doc1',
      docTitle: 'Doc',
      command: 'rewrite',
      label: 'Rewrite',
      group: 'cowrite',
      original,
      proposed,
    })
    expect(resolveProposal(proposal, hunkIndices)).toBe(applySegments(original, segments, hunkIndices))
  })
})

describe('spliceSelection', () => {
  function selectionProposal(opts: { original: string; proposed: string; selRange?: { from: number; to: number } }) {
    return createProposal({
      docId: 'doc1',
      docTitle: 'Doc',
      command: 'rewrite',
      label: 'Rewrite',
      group: 'cowrite',
      original: opts.original,
      proposed: opts.proposed,
      scope: 'selection',
      selRange: opts.selRange,
    })
  }

  it('splices the resolved text using selRange when it still matches', () => {
    const doc = 'The quick brown fox jumps.'
    const original = 'brown fox'
    const from = doc.indexOf(original)
    const to = from + original.length
    const proposal = selectionProposal({ original, proposed: 'red fox', selRange: { from, to } })
    const result = spliceSelection(doc, proposal, 'red fox')
    expect(result).toEqual({ content: 'The quick red fox jumps.' })
  })

  it('falls back to indexOf when selRange no longer matches', () => {
    const doc = 'prefix added. The quick brown fox jumps.'
    const original = 'brown fox'
    // Stale range from before "prefix added. " was inserted
    const proposal = selectionProposal({ original, proposed: 'red fox', selRange: { from: 0, to: original.length } })
    const result = spliceSelection(doc, proposal, 'red fox')
    expect(result).toEqual({ content: 'prefix added. The quick red fox jumps.' })
  })

  it('uses the first match when text is duplicated and no selRange is given', () => {
    const doc = 'cat cat cat'
    const proposal = selectionProposal({ original: 'cat', proposed: 'dog' })
    const result = spliceSelection(doc, proposal, 'dog')
    expect(result).toEqual({ content: 'dog cat cat' })
  })

  it('returns an error when the selection text can no longer be found', () => {
    const doc = 'completely different content'
    const proposal = selectionProposal({ original: 'brown fox', proposed: 'red fox', selRange: { from: 0, to: 9 } })
    const result = spliceSelection(doc, proposal, 'red fox')
    expect(result).toEqual({ error: 'selection-not-found' })
  })
})
