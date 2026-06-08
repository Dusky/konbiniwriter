import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
import { runQualityGate } from '../../lib/QualityGate'
import { uid } from '@shared/utils'
import type { ID, CodexEntry, CodexFact, CodexCategory } from '@shared/types'

type StepId = 'concept' | 'world' | 'characters' | 'outline'

const STEPS: { id: StepId; title: string; promptId: string; docTitle: string }[] = [
  { id: 'concept',    title: 'Concept',     promptId: 'builtin:foundation:concept',    docTitle: 'Concept' },
  { id: 'world',      title: 'World Bible',  promptId: 'builtin:foundation:world',      docTitle: 'World Bible' },
  { id: 'characters', title: 'Characters',   promptId: 'builtin:foundation:characters', docTitle: 'Characters' },
  { id: 'outline',    title: 'Outline',      promptId: 'builtin:foundation:outline',    docTitle: 'Outline' },
]

interface Props { onClose: () => void }

interface GateResult { overall: number; verdict: 'pass' | 'revise'; issues: string[]; suggestions: string[]; rounds: number }
const GATE_THRESHOLD = 75
const MAX_GATE_ROUNDS = 2

export default function FoundationModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const setVoiceFingerprint = useProjectStore((s) => s.setVoiceFingerprint)
  const setAutopilotPreset = useProjectStore((s) => s.setAutopilotPreset)
  const setModal = useShellStore((s) => s.setModal)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [seed, setSeed] = useState('')
  const [text, setText] = useState<Record<StepId, string>>({ concept: '', world: '', characters: '', outline: '' })
  const [running, setRunning] = useState<StepId | 'all' | 'voice' | 'gate' | null>(null)
  const [gate, setGate] = useState<GateResult | null>(null)
  const [autoGate, setAutoGate] = useState(true)
  const [addToCodex, setAddToCodex] = useState(true)
  const [addCanon, setAddCanon] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voice, setVoice] = useState(project?.settings.voiceFingerprint ?? '')
  const [voiceSaved, setVoiceSaved] = useState(false)
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
        : id === 'characters' ? { concept: cur.concept, world: cur.world }
          : { concept: cur.concept, world: cur.world, characters: cur.characters }

  // — Outline quality gate (eval → revise loop, via the shared QualityGate) —
  const gateLoop = async (initial: string) => {
    setGate(null)
    const controller = new AbortController()
    abortRef.current = controller
    const outcome = await runQualityGate(initial, {
      scorePromptId: 'builtin:evaluation:outline-gate',
      revisePromptId: 'builtin:foundation:outline-revise',
      threshold: GATE_THRESHOLD,
      maxRounds: MAX_GATE_ROUNDS,
      scoreVars: (outline) => ({ concept: text.concept, world: text.world, characters: text.characters, outline }),
      reviseVars: (outline, critique) => ({ concept: text.concept, world: text.world, characters: text.characters, outline, critique }),
      signal: controller.signal,
      onRevise: (s) => setStep('outline', s),
    })
    setStep('outline', outcome.text)
    setGate({
      overall: outcome.score.overall,
      verdict: outcome.passed ? 'pass' : 'revise',
      issues: outcome.score.issues,
      suggestions: outcome.score.suggestions,
      rounds: outcome.rounds,
    })
  }

  const runGate = async () => {
    if (running || sending || !text.outline.trim()) return
    setRunning('gate'); setError(null)
    try {
      await gateLoop(text.outline)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const runStep = async (id: StepId) => {
    if (running || sending) return
    if (id === 'concept' && !seed.trim()) { setError('Enter a seed first.'); return }
    setRunning(id); setError(null)
    try {
      const result = await gen(STEPS.find((s) => s.id === id)!.promptId, varsFor(id, text), (s) => setStep(id, s))
      setStep(id, result)
      if (id === 'outline' && autoGate) await gateLoop(result)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    if (running || sending || !seed.trim()) { if (!seed.trim()) setError('Enter a seed first.'); return }
    setRunning('all'); setError(null)
    const acc: Record<StepId, string> = { ...text }
    try {
      for (const step of STEPS) {
        const result = await gen(step.promptId, varsFor(step.id, acc), (s) => setStep(step.id, s))
        acc[step.id] = result
        setStep(step.id, result)
      }
      if (autoGate && acc.outline.trim()) await gateLoop(acc.outline)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  // Voice fingerprint — derive from existing manuscript prose if any, else from
  // the concept/world. Stored in project settings (engine context), not a doc.
  const gatherSamples = (): string => {
    const p = useProjectStore.getState().project
    if (!p) return ''
    let s = ''
    for (const id of Object.keys(p.docs)) {
      const node = p.nodes[id]
      if (!node || node.type === 'folder' || !node.meta.includeInCompile) continue
      const c = (p.docs[id]?.content ?? '').trim()
      if (c) { s += c + '\n\n'; if (s.length > 6000) break }
    }
    s = s.slice(0, 6000)
    if (s.trim()) return s
    const desc = [text.concept, text.world].filter((x) => x.trim()).join('\n\n')
    return desc ? `No prose samples yet. Intended work:\n\n${desc}` : ''
  }

  const runVoice = async () => {
    if (running || sending) return
    setRunning('voice'); setError(null); setVoiceSaved(false)
    const samples = gatherSamples()
    if (!samples.trim()) { setError('Generate a concept or write some prose first — nothing to derive a voice from yet.'); setRunning(null); return }
    try {
      const result = await gen('builtin:foundation:voice', { samples }, setVoice)
      setVoice(result)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const saveVoice = () => { setVoiceFingerprint(voice.trim()); setVoiceSaved(true) }

  // Reuse an existing root folder with this title, else create one.
  const ensureFolder = async (title: string): Promise<ID> => {
    const p = useProjectStore.getState().project!
    const existing = p.rootIds.map((id) => p.nodes[id]).find((n) => n?.type === 'folder' && n.title === title)
    if (existing) return existing.id
    const r = await window.api.node.mutate(p.id, { type: 'create', parentId: null, nodeType: 'folder', title })
    applyMutation(r)
    return Object.values(r.nodes).find((n) => n.ext['_newId'])!.id
  }

  // Parse the outline into chapters, scaffold a doc per chapter (title +
  // synopsis) under a "Manuscript" folder, then hand the new nodes to the
  // Autopilot runner pre-selected for gated drafting.
  const scaffoldAndDraft = async () => {
    if (running || sending || !text.outline.trim()) return
    setSending(true); setError(null)
    try {
      const raw = await gen('builtin:foundation:outline-parse', { outline: text.outline }, () => {})
      let chapters: Array<{ title?: string; synopsis?: string }> = []
      try { chapters = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { chapters = [] }
      chapters = chapters.filter((c) => c.title?.trim())
      if (chapters.length === 0) { setError('Could not parse any chapters from the outline.'); setSending(false); return }

      const folderId = await ensureFolder('Manuscript')
      const ids: ID[] = []
      for (const ch of chapters) {
        const pid = useProjectStore.getState().project!.id
        const r = await window.api.node.mutate(pid, { type: 'create', parentId: folderId, nodeType: 'document', title: ch.title!.trim() })
        applyMutation(r)
        const id = Object.values(r.nodes).find((n) => n.ext['_newId'])!.id
        if (ch.synopsis?.trim()) {
          applyMutation(await window.api.node.mutate(pid, { type: 'updateMeta', id, patch: { synopsis: ch.synopsis.trim() } }))
        }
        ids.push(id)
      }

      setAutopilotPreset(ids)
      onClose()
      setModal('autopilot')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`Scaffold failed: ${(e as Error).message}`)
      setSending(false)
    }
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

  // Parse the cast into structured Codex character entries (added directly —
  // Codex is structured data, not part of the doc proposal pipeline).
  const extractCodex = async (cast: string) => {
    const raw = await gen('builtin:foundation:codex', { characters: cast }, () => {})
    let parsed: Array<{ name?: string; aliases?: string[]; summary?: string; facts?: Array<{ label?: string; value?: string }> }> = []
    try { parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { parsed = [] }
    const now = new Date().toISOString()
    for (const e of parsed) {
      if (!e.name?.trim()) continue
      const facts: CodexFact[] = (e.facts ?? [])
        .filter((f) => f.label?.trim() && f.value?.trim())
        .map((f) => ({ id: uid(), label: f.label!.trim(), value: f.value!.trim(), aiGenerated: true, confirmedAt: null }))
      const entry: CodexEntry = {
        id: uid(),
        name: e.name.trim(),
        aliases: (e.aliases ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean),
        category: 'character',
        summary: e.summary?.trim() ?? '',
        facts,
        createdAt: now,
        modifiedAt: now,
        aiGenerated: true,
      }
      upsertCodexEntry(entry)
    }
  }

  // Parse the world bible into structured non-character Codex entries — the
  // canon database (locations, items, lore, concepts). Same store the continuity
  // checker, mention index, and propagation debt already key off.
  const CANON_CATEGORIES: CodexCategory[] = ['location', 'item', 'concept', 'lore']
  const extractCanon = async (world: string) => {
    const raw = await gen('builtin:foundation:canon', { world, concept: text.concept }, () => {})
    let parsed: Array<{ category?: string; name?: string; aliases?: string[]; summary?: string; facts?: Array<{ label?: string; value?: string }> }> = []
    try { parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { parsed = [] }
    const now = new Date().toISOString()
    for (const e of parsed) {
      if (!e.name?.trim()) continue
      const category: CodexCategory = CANON_CATEGORIES.includes((e.category ?? '') as CodexCategory)
        ? (e.category as CodexCategory) : 'lore'
      const facts: CodexFact[] = (e.facts ?? [])
        .filter((f) => f.label?.trim() && f.value?.trim())
        .map((f) => ({ id: uid(), label: f.label!.trim(), value: f.value!.trim(), aiGenerated: true, confirmedAt: null }))
      upsertCodexEntry({
        id: uid(),
        name: e.name.trim(),
        aliases: (e.aliases ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean),
        category,
        summary: e.summary?.trim() ?? '',
        facts,
        createdAt: now,
        modifiedAt: now,
        aiGenerated: true,
      })
    }
  }

  // Create the docs and queue each as a proposal for changeset review; optionally
  // also seed the Codex from the cast and the world bible.
  const sendToProject = async () => {
    setSending(true)
    setError(null)
    try {
      const folderId = await ensureFolder('Foundation')
      for (const step of STEPS) {
        if (text[step.id].trim()) await createDocProposal(folderId, step.docTitle, text[step.id])
      }
      if (addToCodex && text.characters.trim()) await extractCodex(text.characters)
      if (addCanon && text.world.trim()) await extractCanon(text.world)
      onClose()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`Send failed: ${(e as Error).message}`)
      setSending(false)
    }
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
    // Inert backdrop — generated foundation content is only dismissed via Cancel.
    <div className="modal-bg">
      <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-modal="true" aria-label="Foundation">
        <div className="modal-hd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3>Foundation</h3>
          <span className="sub">seed → concept → world → cast</span>
          <span className="tb-spacer" />
          <button className="btn sm" disabled={!!running || sending} onClick={runAll}>
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
            const disabled = !!running || sending || (step.id !== 'concept' && !text.concept.trim())
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

          {/* Outline quality gate — score + auto-revise loop */}
          {text.outline.trim() && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: gate ? 6 : 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Outline Quality Gate</span>
                {gate && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                    background: gate.verdict === 'pass' ? 'var(--st-final)' : 'var(--st-idea)', color: 'var(--accent-fg)',
                  }}>
                    {gate.overall}/100 · {gate.verdict === 'pass' ? 'pass' : 'needs work'}
                  </span>
                )}
                <span className="tb-spacer" />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoGate} onChange={(e) => setAutoGate(e.target.checked)} />
                  Auto-revise
                </label>
                <button className="btn sm" disabled={!!running || sending || !text.outline.trim()} onClick={runGate}>
                  {running === 'gate' ? 'Scoring…' : 'Score outline'}
                </button>
                <button
                  className="btn sm"
                  disabled={!!running || sending || !text.outline.trim()}
                  onClick={scaffoldAndDraft}
                  title="Create a document per chapter and open the Autopilot drafter on them"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
                >
                  {sending ? 'Scaffolding…' : 'Scaffold → draft'}
                </button>
              </div>
              {gate && (gate.rounds > 0 || gate.issues.length > 0 || gate.suggestions.length > 0) && (
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {gate.rounds > 0 && <div style={{ color: 'var(--text-3)' }}>Auto-revised {gate.rounds}× to reach this score.</div>}
                  {gate.issues.map((s, i) => <div key={`i${i}`}>⚠ {s}</div>)}
                  {gate.suggestions.map((s, i) => <div key={`s${i}`} style={{ color: 'var(--text-3)' }}>→ {s}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Voice fingerprint — saved to project settings, used as AI context */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Voice Fingerprint</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>style guide · injected into AI context</span>
              <span className="tb-spacer" />
              <button className="btn sm" disabled={!!running || sending} onClick={runVoice}>
                {running === 'voice' ? 'Generating…' : voice.trim() ? 'Regenerate' : 'Generate'}
              </button>
              <button className="btn sm" disabled={!voice.trim() || !!running || sending} onClick={saveVoice}>
                {voiceSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
            <textarea
              value={voice}
              onChange={(e) => { setVoice(e.target.value); setVoiceSaved(false) }}
              rows={voice ? 8 : 2}
              placeholder="Derived from your prose if any exists, else from the concept. Editable — click Save to store it on the project."
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, lineHeight: 1.55, fontFamily: 'var(--mono)', resize: 'vertical' }}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--st-idea)' }}>{error}</div>}
        </div>

        <div className="modal-foot">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addToCodex} onChange={(e) => setAddToCodex(e.target.checked)} />
              Add cast to Codex
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addCanon} onChange={(e) => setAddCanon(e.target.checked)} />
              Add world to Codex (canon)
            </label>
          </div>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose} disabled={!!running || sending}>Cancel</button>
          <button
            className="btn"
            onClick={sendToProject}
            disabled={!!running || sending || !hasAnyOutput}
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
          >
            {sending ? 'Sending…' : 'Send to project →'}
          </button>
        </div>
      </div>
    </div>
  )
}
