import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { buildContext, renderContext } from '../../lib/ContextBuilder'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'

const PROFESSOR_ID = 'builtin:evaluation:professor'
const REVISE_ID = 'builtin:revision:draft'

interface Note { issue: string; suggestion: string; on: boolean }

export default function CriticPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [assessment, setAssessment] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [critiquing, setCritiquing] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const node = project && selectedId ? project.nodes[selectedId] : null
  const isDoc = !!node && node.type !== 'folder'
  const hasContent = !!(project && selectedId && project.docs[selectedId]?.content.trim())

  const gen = (promptId: string, vars: Record<string, string>): Promise<string> => {
    const tmpl = promptRegistry.get(promptId)
    if (!tmpl) return Promise.reject(new Error(`Missing prompt: ${promptId}`))
    const rendered = promptRegistry.render(promptId, vars)
    const controller = new AbortController()
    abortRef.current = controller
    return new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      streamCompletion(
        [{ role: 'user', content: rendered }],
        { model: tmpl.model, maxTokens: tmpl.maxTokens, temperature: tmpl.temperature, signal: controller.signal },
        { onChunk: () => {}, onDone: (full) => resolve(full.trim()), onError: reject },
      ).catch(reject)
    })
  }

  const ctxAndSynopsis = () => ({
    context: renderContext(buildContext(project!, mentionIndex, selectedId!, 'evaluation')),
    synopsis: node?.meta.synopsis ?? '',
    document: project!.docs[selectedId!]?.content ?? '',
  })

  const critique = async () => {
    if (!isDoc || !hasContent || critiquing) return
    setCritiquing(true); setError(null); setDone(false); setNotes([]); setAssessment('')
    try {
      const { context, synopsis, document } = ctxAndSynopsis()
      const raw = await gen(PROFESSOR_ID, { context, synopsis, document })
      const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      setAssessment(String(o.assessment ?? '').trim())
      const parsed: Note[] = Array.isArray(o.notes)
        ? o.notes.filter((n: { issue?: string }) => n.issue?.trim())
            .map((n: { issue: string; suggestion?: string }) => ({ issue: n.issue.trim(), suggestion: (n.suggestion ?? '').trim(), on: true }))
        : []
      setNotes(parsed)
      if (parsed.length === 0 && !o.assessment) setError('Could not parse the critique.')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setCritiquing(false)
    }
  }

  const draftRevision = async () => {
    if (!isDoc || drafting) return
    const selected = notes.filter((n) => n.on)
    if (selected.length === 0) { setError('Select at least one note to address.'); return }
    setDrafting(true); setError(null)
    try {
      const { context, synopsis, document } = ctxAndSynopsis()
      const critiqueText = selected.map((n) => `- ${n.issue}${n.suggestion ? `\n  Fix: ${n.suggestion}` : ''}`).join('\n')
      const revised = await gen(REVISE_ID, { context, synopsis, document, critique: critiqueText })
      queueProposal(createProposal({
        docId: selectedId!,
        docTitle: node!.title,
        command: 'revision',
        label: `Critique: ${node!.title}`,
        group: 'Critique',
        original: document,
        proposed: revised.trim(),
        promptId: REVISE_ID,
      }))
      setDone(true)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setDrafting(false)
    }
  }

  const busy = critiquing || drafting
  const toggle = (i: number) => setNotes((ns) => ns.map((n, j) => j === i ? { ...n, on: !n.on } : n))
  const selectedCount = notes.filter((n) => n.on).length

  return (
    <div className="dock-panel">
      <div className="dock-hd">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Critic</h3>
          <span className="sub"> · professor critique</span>
        </div>
      </div>

      {!aiEnabled ? (
        <div className="dock-body dock-empty">Enable AI to run a critique.</div>
      ) : !isDoc ? (
        <div className="dock-body dock-empty">Select a document in the binder to critique.</div>
      ) : (
        <>
          <div className="dock-body crit-body">
            <div className="crit-target">
              Target: <strong>{node!.title}</strong>
              {!hasContent && <span className="muted"> — empty document</span>}
            </div>

            {assessment && <div className="crit-assess">{assessment}</div>}

            {notes.length > 0 && (
              <div className="crit-notes">
                <div className="hint">Notes ({selectedCount} of {notes.length} selected for revision)</div>
                {notes.map((nt, i) => (
                  <label key={i} className={`crit-note${nt.on ? '' : ' off'}`}>
                    <input type="checkbox" checked={nt.on} onChange={() => toggle(i)} />
                    <div className="crit-note-body">
                      <div>{nt.issue}</div>
                      {nt.suggestion && <div className="fix">→ {nt.suggestion}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {critiquing && <div className="crit-loading">Reading the scene…</div>}
            {done && <div style={{ fontSize: 'var(--t-sm)', color: 'var(--st-final)' }}>Revision queued — review it in Changeset Review.</div>}
            {error && <div style={{ fontSize: 'var(--t-sm)', color: 'var(--st-idea)' }}>{error}</div>}
          </div>

          <div className="crit-foot">
            <button className="btn sm" onClick={critique} disabled={busy || !hasContent}>
              {critiquing ? 'Critiquing…' : notes.length ? 'Re-critique' : 'Critique'}
            </button>
            {notes.length > 0 && (
              <button className="btn sm primary" onClick={draftRevision} disabled={busy || selectedCount === 0}>
                {drafting ? 'Revising…' : 'Draft revision →'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
