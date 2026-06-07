import React, { useState } from 'react'
import { useProjectStore, subtreeWordCount } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { buildContext, renderContext } from '../../lib/ContextBuilder'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
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

  if (!project) return <></>

  const selected = GENERATORS.find((g) => g.id === gen)!
  const allNodes = Object.values(project.nodes)

  const handleRun = async () => {
    if (running || !targetId) return
    setRunning(true)
    setError(null)
    setLog('')

    const template = promptRegistry.get(selected.promptId)
    if (!template) { setRunning(false); return }

    const ctxPacket = buildContext(project, mentionIndex, targetId, 'batch')
    const contextStr = renderContext(ctxPacket)
    const nodeSynopsis = project.nodes[targetId]?.meta.synopsis ?? ''

    const rendered = promptRegistry.render(selected.promptId, {
      context: contextStr,
      synopsis: synopsis.trim() || nodeSynopsis,
      content: project.docs[targetId]?.content ?? '',
    })

    let full = ''
    await streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature },
      {
        onChunk: (chunk) => { full += chunk; setLog(full) },
        onDone: (result) => {
          const targetNode = project.nodes[targetId]
          const original = project.docs[targetId]?.content ?? ''
          const proposal = createProposal({
            docId: targetId,
            docTitle: targetNode?.title ?? 'Document',
            command: gen === 'judge' ? 'batch' : 'draft',
            label: `${selected.label}: ${targetNode?.title ?? ''}`,
            group: 'batch',
            original,
            proposed: gen === 'judge' ? original + '\n\n---\n\n**Evaluation**\n\n' + result : result,
            promptId: selected.promptId,
          })
          queueProposal(proposal)
          setRunning(false)
          onClose()
        },
        onError: (err) => { setError(err.message); setRunning(false) },
      },
    )
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
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
                    padding: '10px 14px', borderRadius: 8, border: '1px solid',
                    borderColor: gen === g.id ? 'var(--accent)' : 'var(--border-2)',
                    background: gen === g.id ? 'var(--sel-bg)' : 'transparent',
                    textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{g.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{g.desc}</div>
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
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}
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
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
              />
            </div>
          )}

          {/* Live output */}
          {log && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', maxHeight: 200, overflowY: 'auto', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
              {log}
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: 'oklch(0.65 0.15 20)' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
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
