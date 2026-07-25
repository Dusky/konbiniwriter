import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { debtService } from '../../lib/DebtService'
import type { DebtItem, DebtLayer, ID } from '@shared/types'
import Icon from '../common/Icon'

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
        <div className="modal-hd" style={{ gap: 10 }}>
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

        <div className="modal-body debt-body">
          {checkResult && (
            <div className="debt-note">
              {checkResult}
            </div>
          )}
          {debt.length === 0 ? (
            <div className="debt-empty">
              No propagation debt.<br />
              When you change a Codex fact, scenes that reference that entity are flagged here for review.
            </div>
          ) : debt.map((item) => {
            const allResolved = item.affected.every((a) => a.resolved)
            return (
              <div key={item.id} className={`debt-item${allResolved ? ' done' : ''}`}>
                <div className="debt-hd">
                  <span className="debt-layer" style={{ background: LAYER_COLOR[item.layer] }}>{item.layer}</span>
                  <span className="debt-title">{item.title}</span>
                  <span className="debt-detail">{item.detail}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn sm"
                    onClick={() => dismissDebt(item.id)}
                    title="Dismiss this debt item"
                  >{allResolved ? 'Clear' : 'Dismiss'}</button>
                </div>

                <div className="debt-affected">
                  {item.affected.map((a) => {
                    const title = project?.nodes[a.docId]?.title ?? '(deleted)'
                    const key = `${item.id}:${a.docId}`
                    return (
                      <div key={a.docId} className="debt-aff">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={`debt-aff-doc${a.resolved ? ' done' : ''}`}>{title}</div>
                          <div className="hint">{a.note}</div>
                        </div>
                        {a.resolved ? (
                          <span className="debt-resolved"><Icon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} /> Resolved</span>
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
          {error && <div style={{ fontSize: 'var(--t-sm)', color: 'var(--st-idea)' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          <span className="hint">
            Draft fix routes through changeset review — nothing is rewritten without your approval.
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
