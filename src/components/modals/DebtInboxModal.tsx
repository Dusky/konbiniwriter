import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { debtService } from '../../lib/DebtService'
import type { DebtItem, DebtLayer, ID } from '@shared/types'

const LAYER_COLOR: Record<DebtLayer, string> = {
  canon: 'var(--accent)',
  character: 'var(--st-prog)',
  world: 'var(--st-draft)',
  outline: 'var(--st-idea)',
  voice: 'var(--st-final)',
  prose: 'var(--text-3)',
}

interface Props { onClose: () => void }

export default function DebtInboxModal({ onClose }: Props): React.ReactElement {
  const debt = useProjectStore((s) => s.debt)
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const codex = useProjectStore((s) => s.codex)
  const selectedId = useProjectStore((s) => s.selectedId)
  const selectNode = useProjectStore((s) => s.selectNode)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const raiseDebt = useProjectStore((s) => s.raiseDebt)
  const resolveDebtAffected = useProjectStore((s) => s.resolveDebtAffected)
  const dismissDebt = useProjectStore((s) => s.dismissDebt)
  const aiEnabled = useAIStore((s) => s.enabled)

  // docId currently drafting, keyed `${debtId}:${docId}`
  const [drafting, setDrafting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const checkAbort = useRef<AbortController | null>(null)
  useEffect(() => () => { checkAbort.current?.abort() }, [])

  const selectedNode = selectedId && project ? project.nodes[selectedId] : null
  const canCheck = aiEnabled && !!selectedNode && selectedNode.type !== 'folder'

  const checkContinuity = async () => {
    if (!project || !selectedId) return
    setChecking(true)
    setCheckResult(null)
    setError(null)
    const controller = new AbortController()
    checkAbort.current = controller
    try {
      const { items, entitiesChecked } = await debtService.checkContinuity({
        project, mentionIndex, codex, docId: selectedId, signal: controller.signal,
      })
      items.forEach((it) => raiseDebt(it))
      setCheckResult(
        entitiesChecked === 0
          ? 'No Codex entities with facts are referenced in this scene.'
          : items.length === 0
            ? `No contradictions found (checked ${entitiesChecked} entit${entitiesChecked === 1 ? 'y' : 'ies'}).`
            : `Flagged ${items.length} possible contradiction${items.length === 1 ? '' : 's'}.`
      )
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const checkVoice = async () => {
    if (!project || !selectedId) return
    setChecking(true)
    setCheckResult(null)
    setError(null)
    const controller = new AbortController()
    checkAbort.current = controller
    try {
      const { items, hasVoice, checked } = await debtService.checkVoiceDrift({
        project, docId: selectedId, voice: project.settings.voiceFingerprint ?? '', signal: controller.signal,
      })
      items.forEach((it) => raiseDebt(it))
      setCheckResult(
        !hasVoice
          ? 'No voice fingerprint saved — generate one in Foundation first.'
          : !checked
            ? 'This scene has no prose to check.'
            : items.length === 0
              ? 'No voice drift found.'
              : `Flagged ${items.length} voice drift${items.length === 1 ? '' : 's'}.`
      )
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const draftVoiceFix = async (item: DebtItem, docId: ID) => {
    if (!project) return
    const voice = project.settings.voiceFingerprint ?? ''
    if (!voice.trim()) { setError('No voice fingerprint saved. Generate one in Foundation first.'); return }
    const key = `${item.id}:${docId}`
    setDrafting(key)
    setError(null)
    try {
      const issues = [item.detail, ...item.affected.filter((a) => a.docId === docId).map((a) => a.note)]
        .filter(Boolean).join('\n')
      const proposal = await debtService.draftVoiceFix({
        project, mentionIndex, docId, voice, issues, debtId: item.id,
      })
      queueProposal(proposal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setDrafting(null)
    }
  }

  const openDoc = (docId: ID) => { selectNode(docId); onClose() }

  const draftFix = async (item: DebtItem, docId: ID) => {
    if (!project || !item.revision) return
    const key = `${item.id}:${docId}`
    setDrafting(key)
    setError(null)
    try {
      const proposal = await debtService.draftFix({
        project, mentionIndex, docId,
        entityName: item.revision.entityName,
        factLabel: item.revision.factLabel,
        oldValue: item.revision.oldValue,
        newValue: item.revision.newValue,
        debtId: item.id,
      })
      queueProposal(proposal)
      // Resolution happens when the author APPLIES the proposal (via debtRef in
      // the apply seam) — not here. Discarding the proposal leaves it open.
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setDrafting(null)
    }
  }

  const openCount = debt.filter((d) => d.affected.some((a) => !a.resolved)).length

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-modal="true" aria-label="Propagation Debt">
        <div className="modal-hd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3>Propagation Debt</h3>
          <span className="sub">{openCount} open</span>
          <span className="tb-spacer" />
          {canCheck && (
            <>
              <button
                className="btn sm"
                disabled={checking}
                onClick={checkContinuity}
                title={`Run an AI continuity check on “${selectedNode?.title}” against the Codex`}
              >
                {checking ? 'Checking…' : 'Check continuity'}
              </button>
              <button
                className="btn sm"
                disabled={checking}
                onClick={checkVoice}
                title={`Check “${selectedNode?.title}” against the saved voice fingerprint`}
              >
                Check voice
              </button>
            </>
          )}
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {checkResult && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', padding: '6px 10px', background: 'var(--bg-2)', borderRadius: 6 }}>
              {checkResult}
            </div>
          )}
          {debt.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '48px 0', fontSize: 13, lineHeight: 1.6 }}>
              No propagation debt.<br />
              When you change a Codex fact, scenes that reference that entity are flagged here for review.
            </div>
          ) : debt.map((item) => {
            const allResolved = item.affected.every((a) => a.resolved)
            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px',
                  opacity: allResolved ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em',
                    background: LAYER_COLOR[item.layer], color: 'var(--accent-fg)',
                  }}>{item.layer}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{item.detail}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn sm"
                    onClick={() => dismissDebt(item.id)}
                    title="Dismiss this debt item"
                  >{allResolved ? 'Clear' : 'Dismiss'}</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {item.affected.map((a) => {
                    const title = project?.nodes[a.docId]?.title ?? '(deleted)'
                    const key = `${item.id}:${a.docId}`
                    return (
                      <div key={a.docId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '0.5px solid var(--border)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: a.resolved ? 'var(--text-3)' : 'var(--text)', textDecoration: a.resolved ? 'line-through' : 'none' }}>{title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{a.note}</div>
                        </div>
                        {a.resolved ? (
                          <span style={{ fontSize: 11, color: 'var(--st-final)' }}>✓ Resolved</span>
                        ) : (
                          <>
                            <button className="btn sm" onClick={() => openDoc(a.docId)}>Open</button>
                            {aiEnabled && item.layer === 'voice' ? (
                              <button className="btn sm" disabled={drafting === key} onClick={() => draftVoiceFix(item, a.docId)}>
                                {drafting === key ? '…' : 'Draft fix'}
                              </button>
                            ) : aiEnabled && item.revision ? (
                              <button className="btn sm" disabled={drafting === key} onClick={() => draftFix(item, a.docId)}>
                                {drafting === key ? '…' : 'Draft fix'}
                              </button>
                            ) : null}
                            <button className="btn sm" onClick={() => resolveDebtAffected(item.id, a.docId)}>Mark OK</button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {error && <div style={{ fontSize: 12, color: 'var(--st-idea)' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Draft fix routes through changeset review — nothing is rewritten without your approval.
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
