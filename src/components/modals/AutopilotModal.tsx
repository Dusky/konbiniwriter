import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { buildContext, renderContext, estimateTokens } from '../../lib/ContextBuilder'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
import { runQualityGate } from '../../lib/QualityGate'
import { agentRegistry } from '../../lib/PromptRegistry'
import { costOf, formatUSD } from '../../lib/Pricing'
import type { ID, PromptTemplate, AutopilotRunState } from '@shared/types'

function parseReaderVerdict(text: string): { score: number | null; keep: boolean | null } {
  const m = text.match(/VERDICT:\s*(\d{1,3})\s*\|\s*(keep|drop|yes|no)/i)
  if (!m) return { score: null, keep: null }
  return { score: Math.min(100, Math.max(0, parseInt(m[1], 10))), keep: /keep|yes/i.test(m[2]) }
}

// The gate scores prose craft, so it only makes sense for drafting prompts.
const gateEligibleFor = (p?: PromptTemplate | null): boolean =>
  !!p && /draft|chapter|scene|prose/i.test(`${p.id} ${p.name}`)

type Phase = 'config' | 'running' | 'done'

interface Props { onClose: () => void }

function getAllNonFolderNodes(project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>): Array<{ id: ID; depth: number }> {
  const out: Array<{ id: ID; depth: number }> = []
  const walk = (ids: ID[], depth: number) => {
    for (const id of ids) {
      const n = project.nodes[id]
      if (!n) continue
      if (n.type !== 'folder') out.push({ id, depth })
      walk(n.childIds, depth + 1)
    }
  }
  walk(project.rootIds, 0)
  return out
}

export default function AutopilotModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const setAutopilotQueue = useProjectStore((s) => s.setAutopilotQueue)
  const setAutopilotRunning = useProjectStore((s) => s.setAutopilotRunning)
  const setAutopilotCurrent = useProjectStore((s) => s.setAutopilotCurrent)
  const autopilotPreset = useProjectStore((s) => s.autopilotPreset)
  const setAutopilotPreset = useProjectStore((s) => s.setAutopilotPreset)
  const setAutopilotRun = useProjectStore((s) => s.setAutopilotRun)
  const aiModel = useAIStore((s) => (s.provider === 'anthropic' ? s.anthropicModel : s.openaiModel))
  const spendUSD = useAIStore((s) => s.spendUSD)
  const spendCapUSD = useAIStore((s) => s.spendCapUSD)
  const setSpendCap = useAIStore((s) => s.setSpendCap)

  const [phase, setPhase] = useState<Phase>('config')
  const [checked, setChecked] = useState<Record<ID, boolean>>({})
  const [promptId, setPromptId] = useState<string>('')
  const [streamText, setStreamText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [useGate, setUseGate] = useState(true)
  const [useReaderGate, setUseReaderGate] = useState(false)
  const [gateStatus, setGateStatus] = useState<string | null>(null)
  const [readerGateStatus, setReaderGateStatus] = useState<string | null>(null)
  const [capHit, setCapHit] = useState(false)
  const [currentTitle, setCurrentTitle] = useState('')

  const stopped = useRef(false)
  const abortRef = useRef<AbortController>(new AbortController())
  const streamBoxRef = useRef<HTMLPreElement>(null)
  const runStartSpend = useRef(0)

  // Populate available prompts
  const allPrompts: PromptTemplate[] = (() => {
    const filtered = promptRegistry.all().filter((p) => p.feature === 'batch' || p.feature === 'autopilot')
    return filtered.length > 0 ? filtered : promptRegistry.all()
  })()

  // Build flat node list on mount
  const nodeList = project ? getAllNonFolderNodes(project) : []

  useEffect(() => {
    if (!project) return
    // Arriving from a Foundation scaffold? Pre-select only those chapters and
    // default to a drafting prompt so the run is one click.
    const presetSet = autopilotPreset.length > 0 ? new Set(autopilotPreset) : null
    const initial: Record<ID, boolean> = {}
    for (const { id } of nodeList) initial[id] = presetSet ? presetSet.has(id) : true
    setChecked(initial)
    if (allPrompts.length > 0) {
      const draftPrompt = presetSet
        ? (allPrompts.find((p) => /chapter-draft/.test(p.id)) ?? allPrompts.find((p) => gateEligibleFor(p)))
        : undefined
      setPromptId((draftPrompt ?? allPrompts[0]).id)
    }
    if (presetSet) setAutopilotPreset([]) // consume — a later open should select all
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll stream box
  useEffect(() => {
    if (streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight
    }
  }, [streamText])

  if (!project) return <></>

  const checkedIds = nodeList.filter(({ id }) => checked[id]).map(({ id }) => id)
  const canRun = checkedIds.length > 0 && promptId !== ''
  const gateEligible = gateEligibleFor(allPrompts.find((p) => p.id === promptId))
  const gateOn = useGate && gateEligible
  const readerGateOn = useReaderGate && gateEligible

  // A persisted run is resumable if it still has unresolved, existing nodes.
  const storedRun = (project.settings.autopilotRun as AutopilotRunState | null | undefined) ?? null
  const resumable = storedRun && storedRun.queue.some((id) => project.nodes[id] && !storedRun.doneIds.includes(id))
    ? storedRun : null
  const resumeRemaining = resumable
    ? resumable.queue.filter((id) => project.nodes[id] && !resumable.doneIds.includes(id)).length
    : 0

  // Rough pre-run cost estimate: generation per scene, plus the gate's
  // score → revise → score loop (assume ~1 revision round). List prices.
  const checkedKey = checkedIds.join(',')
  const estimate = useMemo(() => {
    if (!project || checkedIds.length === 0) return null
    const tmpl = promptRegistry.get(promptId)
    const outPer = tmpl?.maxTokens ?? 2000
    const GATE_OUT = 1500
    let inTok = 0
    let outTok = 0
    for (const id of checkedIds) {
      const node = project.nodes[id]
      const baseIn = estimateTokens(renderContext(buildContext(project, mentionIndex, id, 'autopilot')))
        + estimateTokens(node?.meta.synopsis ?? '') + 300
      inTok += baseIn; outTok += outPer
      if (gateOn) {
        // score + revise + score, each seeing the ~draft-sized document
        const draft = outPer
        inTok += 3 * (baseIn + draft)
        outTok += 2 * GATE_OUT + draft
      }
      if (readerGateOn) {
        // N readers in parallel (each ~500 out), optional revision
        const numReaders = agentRegistry.byCategory('reader').length || 4
        const draft = outPer
        inTok += numReaders * (baseIn + draft)
        outTok += numReaders * 500 + draft // assume one revision round
      }
    }
    return { inTok, outTok, cost: costOf(aiModel, inTok, outTok) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedKey, promptId, gateOn, readerGateOn, aiModel, project])

  const runPipeline = async (nodeIds: ID[], selectedPromptId: string, gateChoice: boolean, doneIds: ID[], startedAt: string) => {
    setPhase('running')
    setTotalCount(nodeIds.length)
    setAutopilotRunning(true)
    setAutopilotQueue(nodeIds)

    const template = promptRegistry.get(selectedPromptId)
    const gateOn = gateChoice && gateEligibleFor(template)
    const readerGateOn = useReaderGate && gateEligibleFor(template)

    // Persist run state so an interruption (stop / close / refresh) is resumable.
    const done = new Set(doneIds)
    const persist = () => setAutopilotRun({ promptId: selectedPromptId, useGate: gateChoice, queue: nodeIds, doneIds: [...done], startedAt })
    persist()

    for (let i = 0; i < nodeIds.length; i++) {
      if (stopped.current) break
      const nodeId = nodeIds[i]
      if (done.has(nodeId)) continue // already processed in a prior run
      // Spend cap: halt before starting a new scene once the run's cost crosses
      // the ceiling (a scene already in flight is allowed to finish).
      if (spendCapUSD > 0 && (useAIStore.getState().spendUSD - runStartSpend.current) >= spendCapUSD) {
        setCapHit(true)
        break
      }
      setCurrentIndex(done.size)
      setAutopilotCurrent(nodeId)
      setStreamText('')
      setGateStatus(null)
      setReaderGateStatus(null)

      const node = project.nodes[nodeId]
      setCurrentTitle(node?.title ?? '')
      const synopsis = node?.meta.synopsis ?? ''
      const content = project.docs[nodeId]?.content ?? ''

      // Build context
      const packet = buildContext(project, mentionIndex, nodeId, 'autopilot')
      const contextStr = renderContext(packet)

      // Render prompt
      const rendered = promptRegistry.render(selectedPromptId, {
        content: content.slice(0, 8000),
        context: contextStr,
        synopsis,
        title: node?.title ?? '',
      })

      // 1) Generate the candidate.
      let fullText = ''
      try {
        fullText = await new Promise<string>((resolve, reject) => {
          abortRef.current.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          let acc = ''
          streamCompletion(
            [{ role: 'user', content: rendered }],
            {
              systemPrompt: template?.template,
              maxTokens: template?.maxTokens ?? 2000,
              temperature: template?.temperature ?? 0.7,
              signal: abortRef.current.signal,
            },
            { onChunk: (c) => { acc += c; setStreamText(acc) }, onDone: resolve, onError: reject },
          ).catch(reject)
        })
      } catch (e) {
        if ((e as Error).name === 'AbortError') break
        setPipelineError((e as Error).message)
        continue
      }

      // 2) Gate it (score → auto-revise) when the prompt is a drafting prompt.
      let proposed = fullText
      if (gateOn) {
        try {
          const outcome = await runQualityGate(fullText, {
            scorePromptId: 'builtin:evaluation:draft-gate',
            revisePromptId: 'builtin:revision:draft',
            scoreVars: (doc) => ({ synopsis, context: contextStr, document: doc }),
            reviseVars: (doc, critique) => ({ synopsis, context: contextStr, document: doc, critique }),
            signal: abortRef.current.signal,
            onRevise: (s) => setStreamText(s),
            onPhase: (phase, round) => setGateStatus(
              phase === 'revising' ? `Revising (round ${round})…` : `Scoring${round ? ` after revision ${round}` : ''}…`
            ),
          })
          proposed = outcome.text
          setGateStatus(`Scored ${outcome.score.overall}/100${outcome.passed ? ' · pass' : ` · auto-revised ${outcome.rounds}×`}`)
        } catch (e) {
          if ((e as Error).name === 'AbortError') break
          setPipelineError(`Quality gate failed: ${(e as Error).message} — using the ungated draft.`)
        }
      }

      // 2b) Reader gate — run all personas in parallel, revise once if below threshold.
      if (readerGateOn) {
        try {
          setReaderGateStatus('Readers evaluating…')
          const personas = agentRegistry.byCategory('reader').map((a) => ({
            systemPrompt: promptRegistry.get(a.systemPromptId)?.template ?? '',
            model: a.model || undefined,
            temperature: a.temperature,
            maxTokens: (a.parameters.maxTokens as number) ?? 500,
          }))
          const excerpt = proposed.slice(0, 6000)
          const userMsg = `${excerpt}\n\n---\nEnd your response with a single line: VERDICT: <0-100> | keep or drop`
          const results = await Promise.all(personas.map(async (p) => {
            let full = ''
            await streamCompletion(
              [{ role: 'user', content: userMsg }],
              { systemPrompt: p.systemPrompt, model: p.model, maxTokens: p.maxTokens, temperature: p.temperature, signal: abortRef.current.signal },
              { onChunk: (c) => { full += c }, onDone: () => {}, onError: () => {} },
            )
            return parseReaderVerdict(full)
          }))
          const valid = results.filter((r) => r.score !== null)
          const avgScore = valid.length ? Math.round(valid.reduce((s, r) => s + (r.score ?? 0), 0) / valid.length) : 0
          const keepCount = results.filter((r) => r.keep === true).length
          const passed = avgScore >= 65 && keepCount >= Math.ceil(personas.length / 2)
          if (!passed) {
            setReaderGateStatus(`Readers: ${avgScore}/100 · ${keepCount}/${personas.length} keep — revising…`)
            const revTemplate = promptRegistry.get('builtin:revision:draft')
            if (revTemplate) {
              const critique = `Reader panel score: ${avgScore}/100. ${keepCount} of ${personas.length} readers would keep reading. Revise to improve engagement — hook the reader earlier, raise stakes, sharpen character voice.`
              const revRendered = promptRegistry.render('builtin:revision:draft', { synopsis, context: contextStr, document: proposed, critique })
              let revised = ''
              await streamCompletion(
                [{ role: 'user', content: revRendered }],
                { maxTokens: revTemplate.maxTokens, temperature: revTemplate.temperature, signal: abortRef.current.signal },
                { onChunk: (c) => { revised += c; setStreamText(revised) }, onDone: () => {}, onError: () => {} },
              )
              if (revised.trim()) proposed = revised.trim()
            }
          }
          setReaderGateStatus(`Readers: ${avgScore}/100 · ${keepCount}/${personas.length} keep${!passed ? ` · revised` : ' · pass'}`)
        } catch (e) {
          if ((e as Error).name === 'AbortError') break
          setReaderGateStatus(`Reader gate failed: ${(e as Error).message}`)
        }
      }

      // 3) Queue for changeset review and wait for the author to resolve it.
      const targetNode = project.nodes[nodeId]
      const original = project.docs[nodeId]?.content ?? ''
      const proposal = createProposal({
        docId: nodeId,
        docTitle: targetNode?.title ?? 'Document',
        command: 'batch',
        label: `Autopilot: ${targetNode?.title ?? ''}`,
        group: 'autopilot',
        original,
        proposed,
        promptId: selectedPromptId,
      })
      queueProposal(proposal)

      await new Promise<void>((resolve) => {
        const unsub = useProjectStore.subscribe((s) => {
          const p = s.proposals.find((pr) => pr.id === proposal.id)
          if (!p || p.status === 'applied' || p.status === 'discarded') {
            unsub()
            resolve()
          }
        })
      })

      // Scene resolved — record progress so a later interruption resumes past it.
      done.add(nodeId)
      persist()
    }

    // Natural completion (every node resolved) clears the resume state;
    // an interrupted run (stop / cap / abort) leaves it persisted.
    if (nodeIds.every((id) => done.has(id))) setAutopilotRun(null)

    setAutopilotRunning(false)
    setAutopilotCurrent(null)
    setAutopilotQueue([])
    setPhase('done')
  }

  const handleRun = () => {
    if (!canRun) return
    stopped.current = false
    abortRef.current = new AbortController()
    setPipelineError(null)
    setCapHit(false)
    runStartSpend.current = useAIStore.getState().spendUSD
    void runPipeline(checkedIds, promptId, useGate, [], new Date().toISOString())
  }

  // Resume a persisted run, skipping scenes already resolved.
  const handleResume = () => {
    if (!resumable) return
    const validQueue = resumable.queue.filter((id) => project.nodes[id])
    const validDone = resumable.doneIds.filter((id) => project.nodes[id])
    setPromptId(resumable.promptId)
    setUseGate(resumable.useGate)
    stopped.current = false
    abortRef.current = new AbortController()
    setPipelineError(null)
    setCapHit(false)
    runStartSpend.current = useAIStore.getState().spendUSD
    void runPipeline(validQueue, resumable.promptId, resumable.useGate, validDone, resumable.startedAt)
  }

  const handleStop = () => {
    stopped.current = true
    abortRef.current.abort()
  }

  const currentNodeTitle = phase === 'running' ? currentTitle : ''

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && phase !== 'running' && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Autopilot Runner">
        <div className="modal-hd"><h3>Autopilot Runner</h3></div>

        {phase === 'config' && (
          <>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Resume banner */}
              {resumable && (
                <div style={{ border: '1px solid var(--accent)', background: 'var(--sel-bg)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
                    <strong>Unfinished run</strong> — {resumeRemaining} of {resumable.queue.length} scene{resumable.queue.length === 1 ? '' : 's'} left.
                  </div>
                  <button className="btn sm" onClick={() => setAutopilotRun(null)}>Discard</button>
                  <button className="btn sm" onClick={handleResume} style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}>Resume</button>
                </div>
              )}

              {/* Prompt selector */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Prompt</label>
                <select
                  value={promptId}
                  onChange={(e) => setPromptId(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}
                >
                  {allPrompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Quality gate + reader gate (drafting prompts only) */}
              {gateEligible && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={useGate} onChange={(e) => setUseGate(e.target.checked)} />
                    Quality gate — score &amp; auto-revise each draft before review
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={useReaderGate} onChange={(e) => setUseReaderGate(e.target.checked)} />
                    Reader gate — run reader panel, revise if engagement score &lt; 65
                  </label>
                </div>
              )}

              {/* Spend cap */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                Spend cap
                <span style={{ color: 'var(--text-3)' }}>$</span>
                <input
                  type="number" min={0} step={0.5}
                  value={spendCapUSD || ''}
                  onChange={(e) => setSpendCap(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0 = none"
                  style={{ width: 80, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)' }}
                />
                <span style={{ color: 'var(--text-3)' }}>halts the run when crossed</span>
              </label>
              {spendCapUSD > 0 && estimate?.cost != null && estimate.cost > spendCapUSD && (
                <div style={{ fontSize: 11, color: 'var(--st-idea)' }}>
                  Estimated ~{formatUSD(estimate.cost)} exceeds the {formatUSD(spendCapUSD)} cap — the run will stop partway.
                </div>
              )}

              {/* Node checklist */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                  Scenes ({checkedIds.length} of {nodeList.length} selected)
                </label>
                <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-2)', borderRadius: 6, background: 'var(--bg-2)' }}>
                  {nodeList.map(({ id, depth }) => (
                    <label
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        paddingLeft: 10 + depth * 16,
                        paddingRight: 10,
                        paddingTop: 6,
                        paddingBottom: 6,
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked[id] ?? false}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [id]: e.target.checked }))}
                      />
                      <span style={{ color: 'var(--text)' }}>{project.nodes[id]?.title ?? id}</span>
                    </label>
                  ))}
                  {nodeList.length === 0 && (
                    <div style={{ padding: '12px 14px', color: 'var(--text-3)', fontSize: 13 }}>No scenes found.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {estimate
                  ? <>Est. {estimate.cost != null ? `~${formatUSD(estimate.cost)}` : '— (unpriced model)'} · ~{Math.round((estimate.inTok + estimate.outTok) / 1000)}k tokens{(gateOn || readerGateOn) ? ` incl.${gateOn ? ' quality' : ''}${gateOn && readerGateOn ? ' +' : ''}${readerGateOn ? ' reader' : ''} gate` : ''}</>
                  : 'Results open in Changeset Review'}
              </span>
              <span className="tb-spacer" />
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn"
                onClick={handleRun}
                disabled={!canRun}
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
              >
                Run {checkedIds.length} scene{checkedIds.length !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Progress label */}
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                Scene {currentIndex + 1} of {totalCount} — <strong>{currentNodeTitle}</strong>
              </div>
              {gateStatus && <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{gateStatus}</div>}
              {readerGateStatus && <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{readerGateStatus}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Spent this run: <strong style={{ fontFamily: 'var(--mono)' }}>{formatUSD(Math.max(0, spendUSD - runStartSpend.current))}</strong></div>

              {/* Progress bar */}
              <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${(currentIndex / totalCount) * 100}%`,
                    background: 'var(--accent)',
                    borderRadius: 3,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              {pipelineError && <div style={{ color: 'var(--st-idea)', fontSize: 12, marginTop: 8 }}>{pipelineError}</div>}

              {/* Streaming output */}
              <pre
                ref={streamBoxRef}
                style={{
                  height: 200,
                  overflowY: 'auto',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                  fontFamily: 'var(--mono)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text-2)',
                  margin: 0,
                }}
              >
                {streamText || 'Generating…'}
              </pre>
            </div>

            <div className="modal-foot">
              <span className="tb-spacer" />
              <button
                className="btn"
                onClick={handleStop}
                style={{ borderColor: 'oklch(0.65 0.15 20)', color: 'oklch(0.65 0.15 20)' }}
              >
                Stop
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="modal-body">
              <div style={{ fontSize: 14, color: 'var(--text)', textAlign: 'center', padding: '20px 0' }}>
                {capHit
                  ? <>Stopped — spend cap of {formatUSD(spendCapUSD)} reached.</>
                  : 'All scenes processed.'}
                <br />
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Spent this run: {formatUSD(Math.max(0, spendUSD - runStartSpend.current))}</span>
              </div>
            </div>
            <div className="modal-foot">
              {resumable && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{resumeRemaining} scene{resumeRemaining === 1 ? '' : 's'} left</span>}
              <span className="tb-spacer" />
              <button className="btn" onClick={onClose}>Close</button>
              {resumable && (
                <button className="btn" onClick={handleResume} style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}>
                  Resume
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
