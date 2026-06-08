import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { streamCompletion } from '../../lib/AIClient'
import { agentRegistry, promptRegistry } from '../../lib/PromptRegistry'

// A persona is derived from a registry 'reader' agent + its system-prompt — both
// editable (Prompt Registry for the instructions; the agent for model/temp).
interface Persona {
  id: string
  name: string
  emoji: string
  description: string
  systemPrompt: string
  model?: string
  temperature: number
  maxTokens: number
}

function readerPersonas(): Persona[] {
  return agentRegistry.byCategory('reader').map((a) => ({
    id: a.id,
    name: a.name,
    emoji: (a.parameters.emoji as string) ?? '🙂',
    description: a.description,
    systemPrompt: promptRegistry.get(a.systemPromptId)?.template ?? '',
    model: a.model || undefined, // '' → use the provider's default model
    temperature: a.temperature,
    maxTokens: (a.parameters.maxTokens as number) ?? 500,
  }))
}

interface PersonaResult {
  text: string
  status: 'idle' | 'streaming' | 'done' | 'error'
  error?: string
}

interface Props {
  onClose: () => void
}

export default function ReaderModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)

  // Snapshot the configured reader agents for this session.
  const personas = useMemo(() => readerPersonas(), [])

  const [results, setResults] = useState<Record<string, PersonaResult>>({})
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState(personas[0]?.id ?? '')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const docContent = selectedId && project
    ? (project.docs[selectedId]?.content ?? '')
    : ''
  const docTitle = selectedId && project ? project.nodes[selectedId]?.title ?? '' : ''

  function setPersonaResult(id: string, patch: Partial<PersonaResult>) {
    setResults((r) => ({ ...r, [id]: { ...(r[id] ?? { text: '', status: 'idle' }), ...patch } }))
  }

  async function runAll() {
    if (!docContent.trim()) return
    abortRef.current = new AbortController()
    setRunning(true)
    setResults({})

    const userMessage = `Please give your honest reaction to this excerpt:\n\n---\n${docContent.slice(0, 6000)}\n---`

    await Promise.all(personas.map(async (p) => {
      setPersonaResult(p.id, { status: 'streaming', text: '' })
      try {
        await streamCompletion(
          [{ role: 'user', content: userMessage }],
          { systemPrompt: p.systemPrompt, model: p.model, maxTokens: p.maxTokens, temperature: p.temperature, signal: abortRef.current!.signal },
          {
            onChunk: (chunk) => setResults((r) => ({ ...r, [p.id]: { ...(r[p.id] ?? { text: '', status: 'streaming' as const }), text: (r[p.id]?.text ?? '') + chunk, status: 'streaming' as const } })),
            onDone: (full) => setPersonaResult(p.id, { text: full, status: 'done' }),
            onError: (err) => setPersonaResult(p.id, { status: 'error', error: err.message }),
          },
        )
      } catch {
        setPersonaResult(p.id, { status: 'error', error: 'Stream failed' })
      }
    }))

    setRunning(false)
  }

  function stop() {
    abortRef.current?.abort()
    setRunning(false)
  }

  const activePersona = personas.find((p) => p.id === activeTab) ?? personas[0]
  const activeResult = results[activeTab]
  const anyDone = personas.some((p) => results[p.id]?.status === 'done')

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} role="dialog" aria-modal="true" aria-label="Reader Panel">
        <div className="modal-hd" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Reader Panel</h3>
            {docTitle && <span className="sub">{docTitle}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {running
              ? <button className="btn" onClick={stop}>Stop</button>
              : <button className="btn primary" onClick={runAll} disabled={!docContent.trim()}>
                  {anyDone ? 'Re-run' : 'Run readers'}
                </button>
            }
          </div>
        </div>

        {/* Persona tabs */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', padding: '0 20px' }}>
          {personas.map((p) => {
            const res = results[p.id]
            return (
              <button
                key={p.id}
                onClick={() => setActiveTab(p.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 14px', fontSize: 13, color: activeTab === p.id ? 'var(--accent)' : 'var(--text-2)',
                  borderBottom: activeTab === p.id ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
                  fontWeight: activeTab === p.id ? 600 : 400,
                }}
                title={p.description}
              >
                {p.emoji} {p.name}
                {res?.status === 'streaming' && <span style={{ fontSize: 10, color: 'var(--st-prog)' }}>●</span>}
                {res?.status === 'done' && <span style={{ fontSize: 10, color: 'var(--st-final)' }}>✓</span>}
                {res?.status === 'error' && <span style={{ fontSize: 10, color: 'var(--st-idea)' }}>!</span>}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: 24, minHeight: 220, overflowY: 'auto' }}>
          {!anyDone && !running && (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              {docContent.trim()
                ? <><p style={{ marginBottom: 12 }}>{activePersona?.emoji} <b>{activePersona?.name}</b> — {activePersona?.description}</p><p>Click "Run readers" to get feedback from all {personas.length} reader personas at once.</p></>
                : <p>Select a document in the binder to evaluate.</p>
              }
            </div>
          )}
          {activeResult?.status === 'error' && (
            <div style={{ color: 'var(--st-idea)', fontSize: 13 }}>
              Error: {activeResult.error}
            </div>
          )}
          {activeResult?.text && (
            <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {activeResult.text}
              {activeResult.status === 'streaming' && <span style={{ opacity: 0.7, animation: 'pulse 1s infinite' }}>▌</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
