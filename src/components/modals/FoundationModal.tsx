import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
import { runQualityGate } from '../../lib/QualityGate'
import { uid } from '@shared/utils'
import type { ID, CodexEntry, CodexFact, CodexCategory } from '@shared/types'
import ModalShell from '../common/ModalShell'

type DocStepId = 'concept' | 'world' | 'characters' | 'outline'
type WizardStepId = 'seeds' | DocStepId | 'voice'

const DOC_STEPS: { id: DocStepId; title: string; promptId: string; docTitle: string }[] = [
  { id: 'concept',    title: 'Concept',    promptId: 'builtin:foundation:concept',    docTitle: 'Concept' },
  { id: 'world',      title: 'World Bible', promptId: 'builtin:foundation:world',      docTitle: 'World Bible' },
  { id: 'characters', title: 'Characters', promptId: 'builtin:foundation:characters', docTitle: 'Characters' },
  { id: 'outline',    title: 'Outline',    promptId: 'builtin:foundation:outline',    docTitle: 'Outline' },
]

const WIZARD_STEPS: { id: WizardStepId; title: string; sub: string }[] = [
  { id: 'seeds',      title: 'Seeds',            sub: 'pick a premise' },
  { id: 'concept',    title: 'Concept',           sub: 'expand the premise' },
  { id: 'world',      title: 'World Bible',       sub: 'build the world' },
  { id: 'characters', title: 'Characters',        sub: 'populate the cast' },
  { id: 'outline',    title: 'Outline',           sub: 'structure the story' },
  { id: 'voice',      title: 'Voice Fingerprint', sub: 'capture the style' },
]

interface Props { onClose: () => void; embedded?: boolean }
interface GateResult { overall: number; verdict: 'pass' | 'revise'; issues: string[]; suggestions: string[]; rounds: number }
const GATE_THRESHOLD = 75
const MAX_GATE_ROUNDS = 2

export default function FoundationModal({ onClose, embedded }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const setVoiceFingerprint = useProjectStore((s) => s.setVoiceFingerprint)
  const setAutopilotPreset = useProjectStore((s) => s.setAutopilotPreset)
  const openViewTab = useProjectStore((s) => s.openViewTab)
  const aiEnabled = useAIStore((s) => s.enabled)

  // Wizard navigation
  const [stepIndex, setStepIndex] = useState(0)
  const currentStep = WIZARD_STEPS[stepIndex]

  // Seeds step
  const [seedHints, setSeedHints] = useState('')
  const [seeds, setSeeds] = useState<string[]>([])
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null)

  // Shared doc state (same as before)
  const [seed, setSeed] = useState('')
  const [text, setText] = useState<Record<DocStepId, string>>({ concept: '', world: '', characters: '', outline: '' })
  const [running, setRunning] = useState<WizardStepId | 'gate' | null>(null)
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

  const setStep = (id: DocStepId, v: string) => setText((t) => ({ ...t, [id]: v }))

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

  const varsFor = (id: DocStepId, cur: Record<DocStepId, string>): Record<string, string> =>
    id === 'concept'    ? { seed }
    : id === 'world'    ? { concept: cur.concept }
    : id === 'characters' ? { concept: cur.concept, world: cur.world }
    : { concept: cur.concept, world: cur.world, characters: cur.characters }

  // ── Seeds ─────────────────────────────────────────────────────────────────

  const runSeeds = async () => {
    if (running) return
    setRunning('seeds'); setError(null); setSeeds([])
    const hints = seedHints.trim()
      ? `Genre / tone / length hints: ${seedHints.trim()}`
      : 'No specific genre or tone constraints.'
    try {
      const result = await gen('builtin:foundation:seeds', { hints }, () => {})
      const parsed = result
        .split(/\n+/)
        .map((line) => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 5)
      setSeeds(parsed)
      if (parsed.length > 0) setSelectedSeed(parsed[0])
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  // ── Outline quality gate ───────────────────────────────────────────────────

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
    setGate({ overall: outcome.score.overall, verdict: outcome.passed ? 'pass' : 'revise', issues: outcome.score.issues, suggestions: outcome.score.suggestions, rounds: outcome.rounds })
  }

  const runGate = async () => {
    if (running || sending || !text.outline.trim()) return
    setRunning('gate'); setError(null)
    try { await gateLoop(text.outline) }
    catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message) }
    finally { setRunning(null) }
  }

  const runStep = async (id: DocStepId) => {
    if (running || sending) return
    if (id === 'concept' && !seed.trim()) { setError('Enter or pick a seed first.'); return }
    setRunning(id); setError(null)
    try {
      const result = await gen(DOC_STEPS.find((s) => s.id === id)!.promptId, varsFor(id, text), (s) => setStep(id, s))
      setStep(id, result)
      if (id === 'outline' && autoGate) await gateLoop(result)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  // ── Voice fingerprint ──────────────────────────────────────────────────────

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
    if (!samples.trim()) { setError('Generate a concept or write some prose first.'); setRunning(null); return }
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

  // ── Project output ─────────────────────────────────────────────────────────

  const ensureFolder = async (title: string): Promise<ID> => {
    const p = useProjectStore.getState().project!
    const existing = p.rootIds.map((id) => p.nodes[id]).find((n) => n?.type === 'folder' && n.title === title)
    if (existing) return existing.id
    const r = await window.api.node.mutate(p.id, { type: 'create', parentId: null, nodeType: 'folder', title })
    applyMutation(r)
    return Object.values(r.nodes).find((n) => n.ext['_newId'])!.id
  }

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
        if (ch.synopsis?.trim()) applyMutation(await window.api.node.mutate(pid, { type: 'updateMeta', id, patch: { synopsis: ch.synopsis.trim() } }))
        ids.push(id)
      }
      setAutopilotPreset(ids)
      onClose()
      openViewTab('autopilot')
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
    queueProposal(createProposal({ docId, docTitle: title, command: 'foundation', label: `Foundation: ${title}`, group: 'Foundation', original: '', proposed: content.trim(), promptId: DOC_STEPS.find((s) => s.docTitle === title)?.promptId }))
  }

  const CANON_CATEGORIES: CodexCategory[] = ['location', 'item', 'concept', 'lore']

  const extractCodex = async (cast: string) => {
    const raw = await gen('builtin:foundation:codex', { characters: cast }, () => {})
    let parsed: Array<{ name?: string; aliases?: string[]; summary?: string; facts?: Array<{ label?: string; value?: string }> }> = []
    try { parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { parsed = [] }
    const now = new Date().toISOString()
    for (const e of parsed) {
      if (!e.name?.trim()) continue
      const facts: CodexFact[] = (e.facts ?? []).filter((f) => f.label?.trim() && f.value?.trim()).map((f) => ({ id: uid(), label: f.label!.trim(), value: f.value!.trim(), aiGenerated: true, confirmedAt: null }))
      const entry: CodexEntry = { id: uid(), name: e.name.trim(), aliases: (e.aliases ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean), category: 'character', summary: e.summary?.trim() ?? '', facts, createdAt: now, modifiedAt: now, aiGenerated: true }
      upsertCodexEntry(entry)
    }
  }

  const extractCanon = async (world: string) => {
    const raw = await gen('builtin:foundation:canon', { world, concept: text.concept }, () => {})
    let parsed: Array<{ category?: string; name?: string; aliases?: string[]; summary?: string; facts?: Array<{ label?: string; value?: string }> }> = []
    try { parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { parsed = [] }
    const now = new Date().toISOString()
    for (const e of parsed) {
      if (!e.name?.trim()) continue
      const category: CodexCategory = CANON_CATEGORIES.includes((e.category ?? '') as CodexCategory) ? (e.category as CodexCategory) : 'lore'
      const facts: CodexFact[] = (e.facts ?? []).filter((f) => f.label?.trim() && f.value?.trim()).map((f) => ({ id: uid(), label: f.label!.trim(), value: f.value!.trim(), aiGenerated: true, confirmedAt: null }))
      upsertCodexEntry({ id: uid(), name: e.name.trim(), aliases: (e.aliases ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean), category, summary: e.summary?.trim() ?? '', facts, createdAt: now, modifiedAt: now, aiGenerated: true })
    }
  }

  const sendToProject = async () => {
    setSending(true); setError(null)
    if (voice.trim()) setVoiceFingerprint(voice.trim())
    try {
      const folderId = await ensureFolder('Foundation')
      for (const step of DOC_STEPS) {
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

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goNext = () => {
    if (currentStep.id === 'seeds' && selectedSeed) setSeed(selectedSeed)
    if (currentStep.id === 'voice' && voice.trim() && !voiceSaved) saveVoice()
    setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1))
    setError(null)
  }

  const goBack = () => { setStepIndex((i) => Math.max(i - 1, 0)); setError(null) }
  const goSkip = () => { setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1)); setError(null) }

  const hasAnyOutput = DOC_STEPS.some((s) => text[s.id].trim())
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1
  const isBusy = !!running || sending

  // ── AI disabled fallback ───────────────────────────────────────────────────

  if (!aiEnabled) {
    return (
      <ModalShell embedded={embedded} onClose={onClose} maxWidth={520} label="Foundation">
          <div className="modal-hd"><h3>Foundation</h3></div>
          <div className="modal-body dock-empty" style={{ padding: 'var(--s4) var(--s5)' }}>Enable AI to use the Foundation pipeline.</div>
          <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
      </ModalShell>
    )
  }

  // ── Step content ───────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (currentStep.id) {

      case 'seeds':
        return (
          <div className="fnd-step">
            <div className="fnd-row">
              <input
                className="inp"
                value={seedHints}
                onChange={(e) => setSeedHints(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isBusy && runSeeds()}
                placeholder="Optional hints — genre, tone, length… (e.g. dark fantasy, 80k words)"
              />
              <button className="btn" disabled={isBusy} onClick={runSeeds}>
                {running === 'seeds' ? 'Generating…' : seeds.length > 0 ? 'Regenerate' : 'Generate seeds'}
              </button>
            </div>

            {seeds.length > 0 && (
              <div className="fnd-seeds">
                {seeds.map((s, i) => (
                  <button key={i} onClick={() => setSelectedSeed(s)} className={`fnd-seed${selectedSeed === s ? ' on' : ''}`}>
                    <span className="fnd-seed-n">{i + 1}</span>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div>
              <label className="reg-lbl">Or write your own seed</label>
              <textarea
                className="ta"
                value={selectedSeed !== null && !seeds.includes(selectedSeed) ? selectedSeed : seed}
                onChange={(e) => { setSeed(e.target.value); setSelectedSeed(null) }}
                rows={2}
                placeholder="A retired cartographer discovers her old maps are redrawing themselves overnight."
              />
            </div>
          </div>
        )

      case 'concept':
      case 'world':
      case 'characters': {
        const docStep = DOC_STEPS.find((s) => s.id === currentStep.id)!
        const depMet = currentStep.id === 'concept' ? !!seed.trim() : !!text.concept.trim()
        return (
          <div className="fnd-step">
            {seed.trim() && currentStep.id === 'concept' && (
              <div className="fnd-seedbox">Seed: {seed}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn sm" disabled={isBusy || !depMet} onClick={() => runStep(currentStep.id as DocStepId)}>
                {running === currentStep.id ? 'Generating…' : text[currentStep.id as DocStepId].trim() ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            <textarea
              className="ta mono"
              value={text[currentStep.id as DocStepId]}
              onChange={(e) => setStep(currentStep.id as DocStepId, e.target.value)}
              rows={12}
              placeholder={!depMet ? (currentStep.id === 'concept' ? 'Enter a seed above first.' : 'Generate the Concept step first.') : 'Click Generate, or write directly here.'}
            />
          </div>
        )
      }

      case 'outline':
        return (
          <div className="fnd-step">
            <div className="fnd-row">
              <label className="fnd-check sm">
                <input type="checkbox" checked={autoGate} onChange={(e) => setAutoGate(e.target.checked)} />
                Auto-score &amp; revise
              </label>
              <span className="tb-spacer" />
              {text.outline.trim() && (
                <button className="btn sm" disabled={isBusy} onClick={runGate}>
                  {running === 'gate' ? 'Scoring…' : 'Score outline'}
                </button>
              )}
              {text.outline.trim() && (
                <button className="btn sm primary" disabled={isBusy} onClick={scaffoldAndDraft}>
                  {sending ? 'Scaffolding…' : 'Scaffold → draft'}
                </button>
              )}
              <button className="btn sm" disabled={isBusy || !text.concept.trim()} onClick={() => runStep('outline')}>
                {running === 'outline' ? 'Generating…' : text.outline.trim() ? 'Regenerate' : 'Generate'}
              </button>
            </div>

            {gate && (
              <div className="fnd-gate">
                <span style={{ fontWeight: 600, color: gate.verdict === 'pass' ? 'var(--success)' : 'var(--st-idea)' }}>
                  {gate.overall}/100 · {gate.verdict === 'pass' ? 'pass' : 'needs work'}
                </span>
                {gate.rounds > 0 && <span style={{ color: 'var(--text-3)', marginLeft: 10 }}>Auto-revised {gate.rounds}×</span>}
                {gate.issues.map((s, i) => <div key={`i${i}`} style={{ color: 'var(--text-2)', marginTop: 4 }}>⚠ {s}</div>)}
                {gate.suggestions.map((s, i) => <div key={`s${i}`} style={{ color: 'var(--text-3)' }}>→ {s}</div>)}
              </div>
            )}

            <textarea
              className="ta mono"
              value={text.outline}
              onChange={(e) => setStep('outline', e.target.value)}
              rows={10}
              placeholder={!text.concept.trim() ? 'Generate the Concept step first.' : 'Click Generate, or write directly here.'}
            />
          </div>
        )

      case 'voice':
        return (
          <div className="fnd-step">
            <div className="fnd-row">
              <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)', flex: 1 }}>
                Derived from your manuscript prose, or from the concept if no prose exists yet. Injected into every AI call.
              </span>
              <button className="btn sm" disabled={isBusy} onClick={runVoice}>
                {running === 'voice' ? 'Generating…' : voice.trim() ? 'Regenerate' : 'Generate'}
              </button>
              <button className="btn sm" disabled={!voice.trim() || isBusy} onClick={saveVoice}>
                {voiceSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
            <textarea
              className="ta mono"
              value={voice}
              onChange={(e) => { setVoice(e.target.value); setVoiceSaved(false) }}
              rows={12}
              placeholder="Click Generate, or paste your own style guide here."
            />
            <div className="fnd-checks">
              <label className="fnd-check">
                <input type="checkbox" checked={addToCodex} onChange={(e) => setAddToCodex(e.target.checked)} />
                Add cast to Codex when sending to project
              </label>
              <label className="fnd-check">
                <input type="checkbox" checked={addCanon} onChange={(e) => setAddCanon(e.target.checked)} />
                Add world to Codex (canon) when sending to project
              </label>
            </div>
          </div>
        )
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const canContinue = (() => {
    if (currentStep.id === 'seeds') return !!(selectedSeed?.trim() || seed.trim())
    if (currentStep.id === 'concept') return true // can advance even if empty (skip)
    return true
  })()

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={640} label="Foundation Wizard">

        {/* Header */}
        <div className="modal-hd" style={{ flexDirection: 'column', gap: 10, paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <h3 style={{ margin: 0 }}>Foundation</h3>
            <span className="sub">{currentStep.sub}</span>
            <span className="tb-spacer" />
            <button className="modal-x" onClick={onClose}>×</button>
          </div>

          {/* Step dots */}
          <div className="fnd-dots">
            {WIZARD_STEPS.map((s, i) => (
              <div
                key={s.id}
                title={s.title}
                className={`fnd-dot${i < stepIndex ? ' done' : ''}${i === stepIndex ? ' active' : ''}`}
                onClick={() => { if (i < stepIndex) { setStepIndex(i); setError(null) } }}
              />
            ))}
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)', marginLeft: 4 }}>
              {currentStep.title} · {stepIndex + 1} of {WIZARD_STEPS.length}
            </span>
          </div>
        </div>

        {/* Step body */}
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
          {renderStep()}
          {error && <div style={{ marginTop: 10, fontSize: 'var(--t-sm)', color: 'var(--st-idea)' }}>{error}</div>}
        </div>

        {/* Navigation footer */}
        <div className="modal-foot">
          {stepIndex > 0 && (
            <button className="btn" disabled={isBusy} onClick={goBack}>← Back</button>
          )}
          {!isLastStep && (
            <button className="btn" disabled={isBusy} onClick={goSkip} style={{ color: 'var(--text-3)' }}>
              Skip →
            </button>
          )}
          <span className="tb-spacer" />
          {hasAnyOutput && (
            <button className="btn" disabled={isBusy} onClick={sendToProject}>
              {sending ? 'Sending…' : 'Send to project ↗'}
            </button>
          )}
          {!isLastStep ? (
            <button className="btn primary" disabled={isBusy || !canContinue} onClick={goNext}>
              Continue →
            </button>
          ) : (
            <button className="btn primary" disabled={isBusy} onClick={sendToProject}>
              {sending ? 'Sending…' : hasAnyOutput ? 'Send to project ↗' : 'Done'}
            </button>
          )}
        </div>
    </ModalShell>
  )
}
