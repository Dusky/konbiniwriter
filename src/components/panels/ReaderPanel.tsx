import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
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

// Each reader ends with a structured line we can aggregate (instruction rides on
// the user message, so the editable persona system prompts stay untouched).
function parseVerdict(text: string): { score: number | null; keep: boolean | null } {
  const m = text.match(/VERDICT:\s*(\d{1,3})\s*\|\s*(keep|drop|yes|no)/i)
  if (!m) return { score: null, keep: null }
  return { score: Math.min(100, Math.max(0, parseInt(m[1], 10))), keep: /keep|yes/i.test(m[2]) }
}
function stripVerdict(text: string): string {
  return text.replace(/\s*VERDICT:[^\n]*$/i, '').trim()
}

interface PersonaResult {
  text: string
  status: 'idle' | 'streaming' | 'done' | 'error'
  error?: string
}

export default function ReaderPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const setRailPanel = useShellStore((s) => s.setRailPanel)

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

    const userMessage = `Please give your honest reaction to this excerpt:\n\n---\n${docContent.slice(0, 6000)}\n---\n\nEnd your reply with exactly one line in this format:\nVERDICT: <0-100 engagement score> | <keep or drop>`

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

  // Aggregate panel verdict across finished readers.
  const verdicts = personas
    .map((p) => (results[p.id]?.status === 'done' ? parseVerdict(results[p.id].text) : null))
    .filter((v): v is { score: number | null; keep: boolean | null } => v !== null)
  const scores = verdicts.map((v) => v.score).filter((s): s is number => s != null)
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const keepTotal = verdicts.filter((v) => v.keep != null).length
  const keepCount = verdicts.filter((v) => v.keep === true).length
  const activeVerdict = activeResult?.status === 'done' ? parseVerdict(activeResult.text) : null

  return (
    <div className="dock-panel">
      <div className="dock-hd">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Reader Panel</h3>
          {docTitle && <span className="sub"> · {docTitle}</span>}
        </div>
        {running
          ? <button className="btn sm" onClick={stop}>Stop</button>
          : <button className="btn sm" onClick={runAll} disabled={!docContent.trim()}
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}>
              {anyDone ? 'Re-run' : 'Run readers'}
            </button>
        }
        <button className="icon-btn sm" onClick={() => setRailPanel(null)} title="Close reader panel">✕</button>
      </div>

      {avgScore != null && (
        <div style={{ padding: '8px 16px', borderBottom: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}
          title="Average engagement · readers who'd keep reading">
          Panel <strong style={{ color: 'var(--text)' }}>{avgScore}</strong>/100 · {keepCount}/{keepTotal} keep
        </div>
      )}

      {/* Persona tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '0.5px solid var(--border)', padding: '0 8px' }}>
        {personas.map((p) => {
          const res = results[p.id]
          return (
            <button
              key={p.id}
              onClick={() => setActiveTab(p.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '9px 10px', fontSize: 12.5, color: activeTab === p.id ? 'var(--accent)' : 'var(--text-2)',
                borderBottom: activeTab === p.id ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1, display: 'flex', alignItems: 'center', gap: 5,
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
      <div className="dock-body" style={{ padding: 20 }}>
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
          <>
            {activeVerdict?.score != null && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '4px 10px', borderRadius: 14, background: 'var(--bg-2)', fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--text)' }}>{activeVerdict.score}/100</span>
                <span style={{ color: activeVerdict.keep ? 'var(--st-final)' : 'var(--st-idea)' }}>
                  {activeVerdict.keep ? '✓ would keep reading' : '✕ would put it down'}
                </span>
              </div>
            )}
            <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {activeResult.status === 'streaming' ? activeResult.text : stripVerdict(activeResult.text)}
              {activeResult.status === 'streaming' && <span style={{ opacity: 0.7, animation: 'pulse 1s infinite' }}>▌</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
