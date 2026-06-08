import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { streamCompletion } from '../../lib/AIClient'

interface Persona {
  id: string
  name: string
  emoji: string
  description: string
  systemPrompt: string
}

const PERSONAS: Persona[] = [
  {
    id: 'adventurous',
    name: 'Adventurous',
    emoji: '🗺',
    description: 'Reads for excitement, pace, and surprise',
    systemPrompt: `You are an adventurous fiction reader who loves fast-paced stories, unexpected twists, and compelling hooks. You prioritize excitement, momentum, and whether you'd keep reading. Be direct and specific. 200 words max.`,
  },
  {
    id: 'literary',
    name: 'Literary',
    emoji: '📚',
    description: 'Reads for prose, voice, and depth',
    systemPrompt: `You are a literary fiction reader who prizes distinctive prose, thematic depth, and authentic voice. You're sensitive to rhythm, imagery, and subtext. Be specific about what works and what doesn't. 200 words max.`,
  },
  {
    id: 'commercial',
    name: 'Commercial',
    emoji: '📈',
    description: 'Reads for marketability and audience appeal',
    systemPrompt: `You are a commercial fiction editor who thinks about market positioning, reader expectations, and genre conventions. You evaluate clarity, hooks, and broad appeal. Be practical and specific. 200 words max.`,
  },
  {
    id: 'skeptic',
    name: 'Skeptic',
    emoji: '🔍',
    description: 'Reads for plot holes, inconsistencies, and weak spots',
    systemPrompt: `You are a skeptical reader who actively looks for plot holes, weak character motivation, logical inconsistencies, and prose problems. Be critical and specific — your job is to find what's broken. 200 words max.`,
  },
]

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

  const [results, setResults] = useState<Record<string, PersonaResult>>({})
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState(PERSONAS[0].id)
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

    await Promise.all(PERSONAS.map(async (p) => {
      setPersonaResult(p.id, { status: 'streaming', text: '' })
      try {
        await streamCompletion(
          [{ role: 'user', content: userMessage }],
          { systemPrompt: p.systemPrompt, maxTokens: 400, temperature: 0.8, signal: abortRef.current!.signal },
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

  const activePersona = PERSONAS.find((p) => p.id === activeTab)!
  const activeResult = results[activeTab]
  const anyDone = PERSONAS.some((p) => results[p.id]?.status === 'done')

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
          {PERSONAS.map((p) => {
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
                ? <><p style={{ marginBottom: 12 }}>{activePersona.emoji} <b>{activePersona.name}</b> — {activePersona.description}</p><p>Click "Run readers" to get feedback from all four personas simultaneously.</p></>
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
