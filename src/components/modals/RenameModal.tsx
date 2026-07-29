// RenameModal — rename a character (or place, or anything named) everywhere.
//
// Project-wide replace already rewrites prose. What it leaves behind is the
// reason this exists: the scene still titled "Mira and the River", the codex
// entry, the synopsis on the corkboard, the keyword you filter the binder by,
// and every comment anchored by a quote that no longer exists — which orphans
// the note rather than moving it.
//
// The preview *is* the review. A rename across forty scenes would be forty
// changeset modals otherwise, which nobody would read by the fourth. Instead
// the author sees a complete inventory before anything happens, and every
// document is snapshotted before it is written, so History undoes any of it.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { createProposal } from '../../lib/ProposalService'
import { planRename, describePlan, NAME_DEFAULTS, type RenamePlan } from '../../lib/rename'
import Icon from '../common/Icon'
import type { ID } from '@shared/types'

interface Props { onClose: () => void; initialName?: string }

/** One collapsible group in the preview. */
function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div className="rn-group">
      <button className="rn-group-hd" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={open ? 'chevron-down' : 'chevron'} size={12} />
        <span className="rn-group-title">{title}</span>
        <span className="rn-group-count">{count}</span>
      </button>
      {open && <div className="rn-group-body">{children}</div>}
    </div>
  )
}

export default function RenameModal({ onClose, initialName = '' }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const updateContent = useProjectStore((s) => s.updateContent)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const editComment = useProjectStore((s) => s.editComment)
  const remapComment = useProjectStore((s) => s.remapComment)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const setToast = useShellStore((s) => s.setToast)

  const [from, setFrom] = useState(initialName)
  const [to, setTo] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(NAME_DEFAULTS.caseSensitive ?? true)
  const [wholeWord, setWholeWord] = useState(NAME_DEFAULTS.wholeWord ?? true)
  const [reviewProse, setReviewProse] = useState(false)
  const [running, setRunning] = useState(false)
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)

  useEffect(() => { (initialName ? toRef : fromRef).current?.focus() }, [initialName])

  const plan: RenamePlan = useMemo(
    () => (project ? planRename(project, from, to, { caseSensitive, wholeWord }) : { from, to, docs: [], titles: [], synopses: [], keywords: [], codex: [], comments: [], total: 0, empty: true }),
    [project, from, to, caseSensitive, wholeWord],
  )

  const run = async () => {
    if (!project || plan.empty || running) return
    setRunning(true)
    const pid = project.id
    try {
      // Prose first, each snapshotted before it is written. When the author
      // asked to review, the same edits go out as proposals instead and the
      // structural half still lands — the binder agreeing with the manuscript
      // is not something to review one document at a time.
      for (const doc of plan.docs) {
        if (reviewProse) {
          queueProposal(createProposal({
            docId: doc.id,
            docTitle: doc.title,
            command: 'revision',
            group: 'rename',
            label: `Rename "${plan.from}" → "${plan.to}"`,
            original: doc.original,
            proposed: doc.proposed,
            scope: 'document',
          }))
          continue
        }
        const snap = await window.api.snapshot.take(pid, doc.id, `Before rename: ${plan.from} → ${plan.to}`, 'auto')
        addSnapshot(doc.id, snap)
        updateContent(doc.id, doc.proposed)
        await window.api.doc.write(pid, doc.id, doc.proposed)
      }

      for (const t of plan.titles) applyMutation(await window.api.node.mutate(pid, { type: 'rename', id: t.id, title: t.to }))
      for (const s of plan.synopses) applyMutation(await window.api.node.mutate(pid, { type: 'updateMeta', id: s.id, patch: { synopsis: s.to } }))
      for (const k of plan.keywords) applyMutation(await window.api.node.mutate(pid, { type: 'updateMeta', id: k.id, patch: { keywords: k.to } }))
      for (const c of plan.codex) upsertCodexEntry(c.next)
      for (const c of plan.comments) {
        if (c.changed.includes('quote')) remapComment(c.id, c.anchor)
        if (c.changed.includes('body')) editComment(c.id, c.body)
      }

      setToast(
        reviewProse
          ? `Renamed the binder and codex; queued ${plan.docs.length} document${plan.docs.length === 1 ? '' : 's'} for review.`
          : `Renamed "${plan.from}" → "${plan.to}" — ${describePlan(plan)}.`,
        'success',
      )
      onClose()
    } catch (e) {
      setToast(`Rename failed: ${(e as Error).message}`, 'error')
      setRunning(false)
    }
  }

  const title = (id: ID) => project?.nodes[id]?.title ?? 'Untitled'

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }} role="dialog" aria-modal="true" aria-label="Rename everywhere">
        <div className="modal-hd" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <h3>Rename everywhere</h3>
          <span className="sub" style={{ marginLeft: 0 }}>
            Prose, titles, synopses, keywords, codex entries and comment anchors — in one pass.
          </span>
        </div>

        <div className="modal-body">
          <div className="rn-fields">
            <input
              ref={fromRef}
              className="srch-input"
              placeholder="Current name"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
              aria-label="Current name"
            />
            <Icon name="chevron" size={14} />
            <input
              ref={toRef}
              className="srch-input"
              placeholder="New name"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') void run() }}
              aria-label="New name"
            />
          </div>

          <div className="rn-opts">
            <button className={`chip${caseSensitive ? ' on' : ''}`} onClick={() => setCaseSensitive((v) => !v)} aria-pressed={caseSensitive} title="Match case">Aa</button>
            <button className={`chip${wholeWord ? ' on' : ''}`} onClick={() => setWholeWord((v) => !v)} aria-pressed={wholeWord} title="Whole word only">Whole word</button>
            <span className="rn-opts-note">
              Whole word keeps “Mira” out of “admiral” and still catches <code className="kbd">[[Mira]]</code> and “Mira’s”.
            </span>
          </div>

          {from.trim() && to.trim() && (
            <div className="rn-summary" aria-live="polite">
              {plan.empty
                ? <span className="rn-none">Nothing matches “{from.trim()}”.</span>
                : <><b>{plan.total}</b> change{plan.total === 1 ? '' : 's'} · {describePlan(plan)}</>}
            </div>
          )}

          {!plan.empty && (
            <div className="rn-groups">
              <Group title="Documents" count={plan.docs.length}>
                {plan.docs.map((d) => (
                  <div key={d.id} className="rn-item"><span>{d.title}</span><span className="rn-item-n">{d.count}</span></div>
                ))}
              </Group>
              <Group title="Binder titles" count={plan.titles.length}>
                {plan.titles.map((t) => (
                  <div key={t.id} className="rn-item"><span>{t.from}</span><span className="rn-item-to">→ {t.to}</span></div>
                ))}
              </Group>
              <Group title="Synopses" count={plan.synopses.length}>
                {plan.synopses.map((s) => <div key={s.id} className="rn-item"><span>{s.where}</span></div>)}
              </Group>
              <Group title="Keywords" count={plan.keywords.length}>
                {plan.keywords.map((k) => (
                  <div key={k.id} className="rn-item"><span>{k.where}</span><span className="rn-item-to">{k.to.join(', ')}</span></div>
                ))}
              </Group>
              <Group title="Codex" count={plan.codex.length}>
                {plan.codex.map((c) => (
                  <div key={c.id} className="rn-item"><span>{c.entryName}</span><span className="rn-item-to">{c.changed.join(', ')}</span></div>
                ))}
              </Group>
              <Group title="Comments" count={plan.comments.length}>
                {plan.comments.map((c) => (
                  <div key={c.id} className="rn-item">
                    <span>{title(c.docId)}</span>
                    <span className="rn-item-to">{c.changed.includes('quote') ? 'anchor + note' : 'note'}</span>
                  </div>
                ))}
              </Group>
            </div>
          )}

          <label className="rn-review">
            <input type="checkbox" checked={reviewProse} onChange={(e) => setReviewProse(e.target.checked)} />
            <span>Review each document's prose in Changeset first</span>
          </label>
          <div className="rn-note">
            {reviewProse
              ? 'Prose edits queue as proposals; titles, keywords, codex and comment anchors are applied now.'
              : 'Every document is snapshotted before it is written, so History can undo any of this.'}
          </div>
        </div>

        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={run} disabled={plan.empty || running}>
            {running ? 'Renaming…' : plan.empty ? 'Rename' : `Rename ${plan.total} thing${plan.total === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
