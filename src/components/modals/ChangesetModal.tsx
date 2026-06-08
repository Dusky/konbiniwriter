import React, { useState, useMemo } from 'react'
import type { Proposal, DiffSegment } from '@shared/types'
import { buildSegments, resolveProposal } from '../../lib/ProposalService'

interface Props {
  proposal: Proposal
  onApply: (content: string, accepted: number[]) => void
  onDiscard: () => void
}

function HunkRow({
  seg,
  accepted,
  onToggle,
}: {
  seg: Extract<DiffSegment, { type: 'hunk' }>
  accepted: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ margin: '6px 0', border: '1px solid var(--border-2)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '5px 10px', background: 'var(--bg-2)',
        borderBottom: '0.5px solid var(--border)',
        fontSize: 11, color: 'var(--text-2)',
      }}>
        <span style={{ flex: 1 }}>Hunk {seg.idx + 1}</span>
        <button
          onClick={onToggle}
          style={{
            padding: '2px 10px', borderRadius: 4, border: '1px solid',
            fontSize: 11, cursor: 'pointer',
            background: accepted ? 'var(--accent)' : 'transparent',
            borderColor: accepted ? 'var(--accent)' : 'var(--border-2)',
            color: accepted ? 'var(--accent-fg)' : 'var(--text-2)',
          }}
        >
          {accepted ? '✓ Accept' : 'Reject'}
        </button>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }}>
        {seg.del.map((line, i) => (
          <div key={`d${i}`} style={{ padding: '1px 10px', background: 'color-mix(in oklch, oklch(0.55 0.15 20) 12%, var(--bg))', color: 'var(--text)', textDecoration: accepted ? 'line-through' : 'none', opacity: accepted ? 0.5 : 1 }}>
            <span style={{ color: 'oklch(0.65 0.15 20)', marginRight: 6, userSelect: 'none' }}>−</span>{line || ' '}
          </div>
        ))}
        {seg.add.map((line, i) => (
          <div key={`a${i}`} style={{ padding: '1px 10px', background: 'color-mix(in oklch, oklch(0.60 0.14 150) 12%, var(--bg))', color: 'var(--text)' }}>
            <span style={{ color: 'oklch(0.68 0.16 150)', marginRight: 6, userSelect: 'none' }}>+</span>{line || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ChangesetModal({ proposal, onApply, onDiscard }: Props): React.ReactElement {
  const segments = useMemo(() => buildSegments(proposal.original, proposal.proposed), [proposal])
  const hunks = segments.filter((s): s is Extract<DiffSegment, { type: 'hunk' }> => s.type === 'hunk')

  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(hunks.map((h) => h.idx)))

  const toggleHunk = (idx: number) =>
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })

  const acceptAll = () => setAccepted(new Set(hunks.map((h) => h.idx)))
  const rejectAll = () => setAccepted(new Set())

  const handleApply = () => {
    const acceptedList = [...accepted]
    onApply(resolveProposal(proposal, acceptedList), acceptedList)
  }

  const nAccepted = accepted.size
  const nTotal = hunks.length

  return (
    // Backdrop is inert: applying or discarding a proposal must be an explicit
    // choice so a stray click can't throw away the generated draft.
    <div className="modal-bg">
      <div className="modal" style={{ maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-hd">
          <div>
            <h3 style={{ margin: 0 }}>{proposal.label}</h3>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
              {proposal.docTitle} · {nTotal} hunk{nTotal !== 1 ? 's' : ''} · {nAccepted} accepted
            </div>
          </div>
          <span className="tb-spacer" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={acceptAll} style={{ fontSize: 11 }}>Accept All</button>
            <button className="btn" onClick={rejectAll} style={{ fontSize: 11 }}>Reject All</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px' }}>
          {segments.map((seg, i) => {
            if (seg.type === 'ctx') {
              const preview = seg.lines.slice(0, 3).join('\n')
              const more = seg.lines.length > 3 ? `\n… (${seg.lines.length - 3} more lines)` : ''
              return (
                <div key={i} style={{
                  fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-3)',
                  padding: '4px 10px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>
                  {preview + more}
                </div>
              )
            }
            return (
              <HunkRow
                key={seg.idx}
                seg={seg}
                accepted={accepted.has(seg.idx)}
                onToggle={() => toggleHunk(seg.idx)}
              />
            )
          })}
        </div>

        <div className="modal-foot">
          {proposal.costEstimateCents != null && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              ~${(proposal.costEstimateCents / 100).toFixed(3)}
            </span>
          )}
          <span className="tb-spacer" />
          <button className="btn" onClick={onDiscard}>Discard</button>
          <button
            className="btn"
            onClick={handleApply}
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
            disabled={nAccepted === 0}
          >
            Apply {nAccepted > 0 ? `${nAccepted} hunk${nAccepted !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
