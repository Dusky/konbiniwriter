import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
import type { ID } from '@shared/types'

type StepId = 'concept' | 'world' | 'characters'

const STEPS: { id: StepId; title: string; promptId: string; docTitle: string }[] = [
  { id: 'concept',    title: 'Concept',     promptId: 'builtin:foundation:concept',    docTitle: 'Concept' },
  { id: 'world',      title: 'World Bible',  promptId: 'builtin:foundation:world',      docTitle: 'World Bible' },
  { id: 'characters', title: 'Characters',   promptId: 'builtin:foundation:characters', docTitle: 'Characters' },
]

interface Props { onClose: () => void }

export default function FoundationModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [seed, setSeed] = useState('')
  const [text, setText] = useState<Record<StepId, string>>({ concept: '', world: '', characters: '' })
  const [running, setRunning] = useState<StepId | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  if (!project) return <></>

  const setStep = (id: StepId, v: string) => setText((t) => ({ ...t, [id]: v }))

  // Run one step's prompt, streaming into its textarea, returning the final text.
  const gen = (promptId: string, vars: Record<string, string>, onChunk: (s: string) => void): Promise<string> => {
    const template = promptRegistry.get(promptId)
    if (!template) return Promise.reject(new Error(`Missing prompt: ${promptId}`))
    const rendered = promptRegistry.render(promptId, vars)
    const controller = new AbortController()
    abortRef.current = controller
    let full = ''
    return new Promise<string>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      streamCompletion(
        [{ role: 'user', content: rendered }],
        { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal: controller.signal },
        { onChunk: (c) => { full += c; onChunk(full) }, onDone: (r) => resolve(r.trim()), onError: reject },
      ).catch(reject)
    })
  }

  const varsFor = (id: StepId, cur: Record<StepId, string>): Record<string, string> =>
    id === 'concept' ? { seed }
      : id === 'world' ? { concept: cur.concept }
        : { concept: cur.concept, world: cur.world }

  const runStep = async (id: StepId) => {
    if (running) return
    if (id === 'concept' && !seed.trim()) { setError('Enter a seed first.'); return }
    setRunning(id); setError(null)
    try {
      const result = await gen(STEPS.find((s) => s.id === id)!.promptId, varsFor(id, text), (s) => setStep(id, s))
      setStep(id, result)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    if (running || !seed.trim()) { if (!seed.trim()) setError('Enter a seed first.'); return }
    setRunning('all'); setError(null)
    const acc: Record<StepId, string> = { ...text }
    try {
      for (const step of STEPS) {
        const result = await gen(step.promptId, varsFor(step.id, acc), (s) => setStep(step.id, s))
        acc[step.id] = result
        setStep(step.id, result)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  // Reuse an existing root "Foundation" folder, else create one.
  const ensureFolder = async (): Promise<ID> => {
    const p = useProjectStore.getState().project!
    const existing = p.rootIds.map((id) => p.nodes[id]).find((n) => n?.type === 'folder' && n.title === 'Foundation')
    if (existing) return existing.id
    const r = await window.api.node.mutate(p.id, { type: 'create', parentId: null, nodeType: 'folder', title: 'Foundation' })
    applyMutation(r)
    return Object.values(r.nodes).find((n) => n.ext['_newId'])!.id
  }

  const createDocProposal = async (folderId: ID, title: string, content: string) => {
    const pid = useProjectStore.getState().project!.id
    const r = await window.api.node.mutate(pid, { type: 'create', parentId: folderId, nodeType: 'document', title })
    applyMutation(r)
    const docId = Object.values(r.nodes).find((n) => n.ext['_newId'])!.id
    queueProposal(createProposal({
      docId, docTitle: title, command: 'foundation',
      label: `Foundation: ${title}`, group: 'Foundation',
      original: '', proposed: content.trim(), promptId: STEPS.find((s) => s.docTitle === title)?.promptId,
    }))
  }

  // Create the docs and queue each as a proposal for changeset review.
  const sendToProject = async () => {
    const folderId = await ensureFolder()
    for (const step of STEPS) {
      if (text[step.id].trim()) await createDocProposal(folderId, step.docTitle, text[step.id])
    }
    onClose()
  }

  const hasAnyOutput = STEPS.some((s) => text[s.id].trim())

  if (!aiEnabled) {
    return (
      <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="Foundation">
          <div className="modal-hd"><h3>Foundation</h3></div>
          <div className="modal-body" style={{ color: 'var(--text-3)' }}>Enable AI to use the Foundation pipeline.</div>
          <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-modal="true" aria-label="Foundation">
        <div className="modal-hd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3>Foundation</h3>
          <span className="sub">seed → concept → world → cast</span>
          <span className="tb-spacer" />
          <button className="btn sm" disabled={!!running} onClick={runAll}>
            {running === 'all' ? 'Generating…' : 'Generate all'}
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Seed — a premise or logline</label>
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              rows={2}
              placeholder="e.g. A retired cartographer discovers her old maps are redrawing themselves overnight."
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>

          {STEPS.map((step) => {
            // world & characters need the concept text first.
            const disabled = !!running || (step.id !== 'concept' && !text.concept.trim())
            return (
              <div key={step.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{step.title}</span>
                  <span className="tb-spacer" />
                  <button className="btn sm" disabled={disabled} onClick={() => runStep(step.id)}>
                    {running === step.id ? 'Generating…' : text[step.id].trim() ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
                <textarea
                  value={text[step.id]}
                  onChange={(e) => setStep(step.id, e.target.value)}
                  rows={text[step.id] ? 8 : 2}
                  placeholder={step.id === 'concept' ? 'Generated concept appears here — editable before review.' : `Generated from the ${step.id === 'world' ? 'concept' : 'concept + world'}.`}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, lineHeight: 1.55, fontFamily: 'var(--mono)', resize: 'vertical' }}
                />
              </div>
            )
          })}
          {error && <div style={{ fontSize: 12, color: 'var(--st-idea)' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Sends each part to a “Foundation” folder via changeset review.
          </span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose} disabled={!!running}>Cancel</button>
          <button
            className="btn"
            onClick={sendToProject}
            disabled={!!running || !hasAnyOutput}
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
          >
            Send to project →
          </button>
        </div>
      </div>
    </div>
  )
}
