import React, { useState, useMemo } from 'react'
import type { Proposal, DiffSegment } from '@shared/types'
import { buildSegments, resolveProposal } from '../../lib/ProposalService'
import Icon from '../common/Icon'

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
    <div className="cs-hunk">
      <div className="cs-hunk-hd">
        <span style={{ flex: 1 }}>Hunk {seg.idx + 1}</span>
        <button className={`cs-hunk-toggle${accepted ? ' on' : ''}`} onClick={onToggle}>
          {accepted ? <><Icon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} /> Accept</> : 'Reject'}
        </button>
      </div>
      <div className="cs-lines">
        {seg.del.map((line, i) => (
          <div key={`d${i}`} className={`cs-line del${accepted ? ' struck' : ''}`}>
            <span className="cs-sign del">−</span>{line || ' '}
          </div>
        ))}
        {seg.add.map((line, i) => (
          <div key={`a${i}`} className="cs-line add">
            <span className="cs-sign add">+</span>{line || ' '}
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
            <div className="cs-sub">
              {proposal.docTitle} · {nTotal} hunk{nTotal !== 1 ? 's' : ''} · {nAccepted} accepted
            </div>
          </div>
          <span className="tb-spacer" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={acceptAll}>Accept All</button>
            <button className="btn" onClick={rejectAll}>Reject All</button>
          </div>
        </div>

        <div className="cs-body">
          {segments.map((seg, i) => {
            if (seg.type === 'ctx') {
              const preview = seg.lines.slice(0, 3).join('\n')
              const more = seg.lines.length > 3 ? `\n… (${seg.lines.length - 3} more lines)` : ''
              return (
                <div key={`ctx-${i}`} className="cs-ctx">
                  {preview + more}
                </div>
              )
            }
            return (
              <HunkRow
                key={`hunk-${seg.idx}`}
                seg={seg}
                accepted={accepted.has(seg.idx)}
                onToggle={() => toggleHunk(seg.idx)}
              />
            )
          })}
        </div>

        <div className="modal-foot">
          {proposal.costEstimateCents != null && (
            <span className="hint">
              ~${(proposal.costEstimateCents / 100).toFixed(3)}
            </span>
          )}
          <span className="tb-spacer" />
          <button className="btn" onClick={onDiscard}>Discard</button>
          <button className="btn primary" onClick={handleApply} disabled={nAccepted === 0}>
            Apply {nAccepted > 0 ? `${nAccepted} hunk${nAccepted !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
