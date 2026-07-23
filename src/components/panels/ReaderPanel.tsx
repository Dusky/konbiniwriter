import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { streamCompletion } from '../../lib/AIClient'
import { agentRegistry, promptRegistry } from '../../lib/PromptRegistry'
import Icon from '../common/Icon'

// A persona = a registry 'reader' agent (model/temp) + its editable system prompt.
interface Persona {
  id: string
  name: string
  description: string
  promptId: string
  systemPrompt: string
  model?: string
  temperature: number
  maxTokens: number
}

function readerPersonas(): Persona[] {
  return agentRegistry.byCategory('reader').map((a) => ({
    id: a.id,
    name: a.name.replace(/^Reader\s*·\s*/, ''),
    description: a.description,
    promptId: a.systemPromptId,
    systemPrompt: promptRegistry.get(a.systemPromptId)?.template ?? '',
    model: a.model || undefined,
    temperature: a.temperature,
    maxTokens: (a.parameters.maxTokens as number) ?? 500,
  }))
}

// Each reader ends with a structured line we aggregate; the instruction rides on
// the user message so the editable persona prompts stay clean.
function parseVerdict(text: string): { score: number | null; keep: boolean | null } {
  const m = text.match(/VERDICT:\s*(\d{1,3})\s*\|\s*(keep|drop|yes|no)/i)
  if (!m) return { score: null, keep: null }
  return { score: Math.min(100, Math.max(0, parseInt(m[1], 10))), keep: /keep|yes/i.test(m[2]) }
}
function stripVerdict(text: string): string {
  return text.replace(/\s*VERDICT:[^\n]*$/i, '').trim()
}

interface PersonaResult { text: string; status: 'idle' | 'streaming' | 'done' | 'error'; error?: string }

export default function ReaderPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)

  const [personas, setPersonas] = useState<Persona[]>(readerPersonas)
  const [results, setResults] = useState<Record<string, PersonaResult>>({})
  const [running, setRunning] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const docContent = selectedId && project ? (project.docs[selectedId]?.content ?? '') : ''
  const docTitle = selectedId && project ? project.nodes[selectedId]?.title ?? '' : ''

  function setPersonaResult(id: string, patch: Partial<PersonaResult>) {
    setResults((r) => ({ ...r, [id]: { ...(r[id] ?? { text: '', status: 'idle' }), ...patch } }))
  }

  async function runAll() {
    if (!docContent.trim() || personas.length === 0) return
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
            onAbort: () => setPersonaResult(p.id, { status: 'idle' }),
          },
        )
      } catch (e) {
        setPersonaResult(p.id, { status: 'error', error: (e as Error).message || 'Stream failed' })
      }
    }))
    setRunning(false)
  }

  function stop() { abortRef.current?.abort(); setRunning(false) }

  // Editable persona prompt (Advanced): persist to the registry + refresh.
  function savePrompt(p: Persona, template: string) {
    const tmpl = promptRegistry.get(p.promptId)
    if (!tmpl || template === tmpl.template) return
    promptRegistry.save({ ...tmpl, template, modifiedAt: new Date().toISOString() })
    setPersonas(readerPersonas())
  }
  function resetPrompt(p: Persona) {
    promptRegistry.reset(p.promptId)
    setPersonas(readerPersonas())
  }

  const anyDone = personas.some((p) => results[p.id]?.status === 'done')

  // Aggregate verdict across finished readers.
  const verdicts = personas
    .map((p) => (results[p.id]?.status === 'done' ? parseVerdict(results[p.id].text) : null))
    .filter((v): v is { score: number | null; keep: boolean | null } => v !== null)
  const scores = verdicts.map((v) => v.score).filter((s): s is number => s != null)
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const keepTotal = verdicts.filter((v) => v.keep != null).length
  const keepCount = verdicts.filter((v) => v.keep === true).length

  return (
    <div className="dock-panel">
      <div className="dock-hd">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Reader Panel</h3>
          {docTitle && <span className="sub"> · {docTitle}</span>}
        </div>
        <button className={`linkish sm${showAdvanced ? ' on' : ''}`} onClick={() => setShowAdvanced((v) => !v)} title="Edit reader prompts"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 'var(--s2)' }}>
          <Icon name="settings" size={13} /> Advanced
        </button>
        {running
          ? <button className="btn sm" onClick={stop}>Stop</button>
          : <button className="btn sm primary" onClick={runAll} disabled={!docContent.trim()}>
              {anyDone ? 'Re-run' : 'Run readers'}
            </button>}
      </div>

      {avgScore != null && !showAdvanced && (
        <div className="rp-panel-score">
          <div className="meter" style={{ flex: 1 }}><i style={{ width: `${avgScore}%` }} /></div>
          <span className="mono"><strong>{avgScore}</strong>/100 · {keepCount}/{keepTotal} keep</span>
        </div>
      )}

      <div className="dock-body">
        {showAdvanced ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="hint" style={{ padding: 'var(--s3) var(--s4) var(--s2)' }}>
              Each reader's instructions. Edits are saved and used on the next run — Reset restores the built-in.
            </div>
            {personas.map((p) => (
              <div key={p.id} className="rp-adv">
                <div className="rp-adv-hd">
                  <span style={{ fontWeight: 600, fontSize: 'var(--t-base)' }}>{p.name}</span>
                  <button className="linkish sm" onClick={() => resetPrompt(p)}>Reset</button>
                </div>
                <textarea
                  className="ai-ta"
                  rows={4}
                  defaultValue={p.systemPrompt}
                  onBlur={(e) => savePrompt(p, e.target.value)}
                />
              </div>
            ))}
          </div>
        ) : !anyDone && !running && Object.keys(results).length === 0 ? (
          <div className="rp-empty">
            {docContent.trim()
              ? <>Get reactions from all {personas.length} reader personas at once. <br />Each rates engagement and whether they'd keep reading.</>
              : 'Select a document in the binder to evaluate.'}
          </div>
        ) : (
          // Compare view — every reader's reaction, stacked.
          <div>
            {personas.map((p) => {
              const res = results[p.id]
              const verdict = res?.status === 'done' ? parseVerdict(res.text) : null
              return (
                <div key={p.id} className="rp-reader">
                  <div className="rp-reader-hd">
                    <span className="rp-name">{p.name}</span>
                    {res?.status === 'streaming' && <span className="rp-dot" />}
                    {res?.status === 'error' && <Icon name="warning" size={13} style={{ color: 'var(--st-idea)' }} />}
                    {verdict?.score != null && (
                      <span className="rp-verdict" style={{ color: verdict.keep ? 'var(--st-final)' : 'var(--st-idea)' }}>
                        <Icon name={verdict.keep ? 'check' : 'x'} size={12} />
                        <span className="mono">{verdict.score}</span>
                      </span>
                    )}
                  </div>
                  {res?.status === 'error' ? (
                    <div className="rp-body" style={{ color: 'var(--st-idea)' }}>{res.error}</div>
                  ) : res?.text ? (
                    <div className="rp-body">
                      {res.status === 'streaming' ? res.text : stripVerdict(res.text)}
                      {res.status === 'streaming' && <span style={{ opacity: 0.7, animation: 'pulse 1s infinite' }}>▌</span>}
                    </div>
                  ) : (
                    <div className="rp-body hint">{running ? 'Reading…' : '—'}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
