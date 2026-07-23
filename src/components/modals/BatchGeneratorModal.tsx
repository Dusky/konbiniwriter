import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore, subtreeWordCount } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { buildContext, renderContext } from '../../lib/ContextBuilder'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
import { runQualityGate } from '../../lib/QualityGate'
import type { ID } from '@shared/types'

type GeneratorId = 'cast' | 'beat-sheet' | 'chapter-draft' | 'judge'

const GENERATORS: { id: GeneratorId; label: string; desc: string; promptId: string; needsSynopsis: boolean }[] = [
  { id: 'cast',          label: 'Generate Cast',    desc: 'Character roster from project outline',       promptId: 'builtin:batch:cast',          needsSynopsis: false },
  { id: 'beat-sheet',    label: 'Beat Sheet',        desc: 'Plot beats for selected chapter',             promptId: 'builtin:batch:beat-sheet',     needsSynopsis: true  },
  { id: 'chapter-draft', label: 'Draft Chapter',     desc: 'Full prose draft from synopsis + outline',   promptId: 'builtin:batch:chapter-draft',  needsSynopsis: true  },
  { id: 'judge',         label: 'Evaluate Prose',    desc: 'Score on six craft dimensions',               promptId: 'builtin:evaluation:judge',     needsSynopsis: false },
]

interface Props { onClose: () => void }

export default function BatchGeneratorModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)

  const [gen, setGen] = useState<GeneratorId>('cast')
  const [targetId, setTargetId] = useState<ID>(selectedId ?? project?.rootIds[0] ?? '')
  const [synopsis, setSynopsis] = useState('')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [useGate, setUseGate] = useState(true)
  const [gateStatus, setGateStatus] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  if (!project) return <></>

  const selected = GENERATORS.find((g) => g.id === gen)!
  const allNodes = Object.values(project.nodes)

  const handleRun = async () => {
    if (running || !targetId) return
    setRunning(true)
    setError(null)
    setLog('')
    setGateStatus(null)

    const template = promptRegistry.get(selected.promptId)
    if (!template) { setRunning(false); return }

    const ctxPacket = buildContext(project, mentionIndex, targetId, 'batch')
    const contextStr = renderContext(ctxPacket)
    const nodeSynopsis = project.nodes[targetId]?.meta.synopsis ?? ''
    const effSynopsis = synopsis.trim() || nodeSynopsis
    const original = project.docs[targetId]?.content ?? ''

    const rendered = promptRegistry.render(selected.promptId, {
      context: contextStr,
      synopsis: effSynopsis,
      content: original,
    })

    const controller = new AbortController()
    abortRef.current = controller

    // 1) Generate the candidate.
    let result = ''
    try {
      result = await new Promise<string>((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        let full = ''
        streamCompletion(
          [{ role: 'user', content: rendered }],
          { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal: controller.signal },
          { onChunk: (c) => { full += c; setLog(full) }, onDone: resolve, onError: reject },
        ).catch(reject)
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      setRunning(false)
      return
    }

    // 2) For chapter drafts, run the quality gate (score → auto-revise if weak).
    let proposed = gen === 'judge' ? original + '\n\n---\n\n**Evaluation**\n\n' + result : result
    if (gen === 'chapter-draft' && useGate) {
      try {
        const outcome = await runQualityGate(result, {
          scorePromptId: 'builtin:evaluation:draft-gate',
          revisePromptId: 'builtin:revision:draft',
          scoreVars: (doc) => ({ synopsis: effSynopsis, context: contextStr, document: doc }),
          reviseVars: (doc, critique) => ({ synopsis: effSynopsis, context: contextStr, document: doc, critique }),
          signal: controller.signal,
          onRevise: (s) => setLog(s),
          onPhase: (phase, round) => setGateStatus(
            phase === 'revising' ? `Revising draft (round ${round})…` : `Scoring draft${round ? ` after revision ${round}` : ''}…`
          ),
        })
        proposed = outcome.text
        setGateStatus(`Scored ${outcome.score.overall}/100${outcome.passed ? ' · pass' : ` · auto-revised ${outcome.rounds}×`}`)
      } catch (e) {
        if ((e as Error).name === 'AbortError') { setRunning(false); return }
        setError(`Quality gate failed (${(e as Error).message}); using the ungated draft.`)
      }
    }

    // 3) Queue for changeset review.
    const targetNode = project.nodes[targetId]
    queueProposal(createProposal({
      docId: targetId,
      docTitle: targetNode?.title ?? 'Document',
      command: gen === 'judge' ? 'batch' : 'draft',
      label: `${selected.label}: ${targetNode?.title ?? ''}`,
      group: 'batch',
      original,
      proposed,
      promptId: selected.promptId,
    }))
    setRunning(false)
    onClose()
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }} role="dialog" aria-modal="true" aria-label="Batch Generator">
        <div className="modal-hd"><h3>Batch Generators</h3></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Generator picker */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Generator</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {GENERATORS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGen(g.id)}
                  style={{
                    padding: '10px 14px', borderRadius: 'var(--r-md)', border: '1px solid',
                    borderColor: gen === g.id ? 'var(--accent)' : 'var(--border-2)',
                    background: gen === g.id ? 'var(--sel-bg)' : 'transparent',
                    textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{g.label}</div>
                  <div className="hint">{g.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Target node */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Target document</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}
            >
              {allNodes.filter((n) => n.type !== 'folder').map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </div>

          {/* Synopsis override (only if needed) */}
          {selected.needsSynopsis && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                Synopsis / notes <span style={{ opacity: 0.6 }}>(overrides node synopsis)</span>
              </label>
              <textarea
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                rows={4}
                placeholder={project.nodes[targetId]?.meta.synopsis || 'Add plot notes, constraints, or tone guidance…'}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
              />
            </div>
          )}

          {/* Quality gate (chapter drafts only) */}
          {gen === 'chapter-draft' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={useGate} onChange={(e) => setUseGate(e.target.checked)} />
              Quality gate — score &amp; auto-revise the draft before review
            </label>
          )}
          {gateStatus && <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{gateStatus}</div>}

          {/* Live output */}
          {log && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', maxHeight: 200, overflowY: 'auto', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
              {log}
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          <span className="hint">
            Result opens in Changeset Review
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose} disabled={running}>Cancel</button>
          <button
            className="btn"
            onClick={handleRun}
            disabled={running || !targetId}
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
          >
            {running ? 'Generating…' : `Run ${selected.label}`}
          </button>
        </div>
      </div>
    </div>
  )
}
