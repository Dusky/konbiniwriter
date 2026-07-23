import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { buildContext, renderContext, estimateTokens } from '../../lib/ContextBuilder'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion, streamToString } from '../../lib/AIClient'
import { runQualityGate } from '../../lib/QualityGate'
import { agentRegistry } from '../../lib/PromptRegistry'
import { costOf, formatUSD } from '../../lib/Pricing'
import { parseReaderVerdict } from '../../lib/parsers'
import type { ID, PromptTemplate, AutopilotRunState } from '@shared/types'

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
          const settled = await Promise.allSettled(personas.map((p) =>
            streamToString(
              [{ role: 'user', content: userMsg }],
              { systemPrompt: p.systemPrompt, model: p.model, maxTokens: p.maxTokens, temperature: p.temperature, signal: abortRef.current.signal },
            )
          ))
          if (settled.some((r) => r.status === 'rejected' && (r.reason as Error)?.name === 'AbortError')) break

          const failedCount = settled.filter((r) => r.status === 'rejected').length
          const responding = personas.length - failedCount
          const failedNote = failedCount > 0 ? ` · ${failedCount} reader${failedCount > 1 ? 's' : ''} failed` : ''
          if (responding === 0) throw new Error('all readers failed to respond')

          const results = settled
            .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
            .map((r) => parseReaderVerdict(r.value))
          const valid = results.filter((r) => r.score !== null)
          const avgScore = valid.length ? Math.round(valid.reduce((s, r) => s + (r.score ?? 0), 0) / valid.length) : 0
          const keepCount = results.filter((r) => r.keep === true).length
          const passed = avgScore >= 65 && keepCount >= Math.ceil(responding / 2)
          if (!passed) {
            setReaderGateStatus(`Readers: ${avgScore}/100 · ${keepCount}/${responding} keep${failedNote} — revising…`)
            const revTemplate = promptRegistry.get('builtin:revision:draft')
            if (revTemplate) {
              const critique = `Reader panel score: ${avgScore}/100. ${keepCount} of ${responding} readers would keep reading. Revise to improve engagement — hook the reader earlier, raise stakes, sharpen character voice.`
              const revRendered = promptRegistry.render('builtin:revision:draft', { synopsis, context: contextStr, document: proposed, critique })
              const revised = await streamToString(
                [{ role: 'user', content: revRendered }],
                { maxTokens: revTemplate.maxTokens, temperature: revTemplate.temperature, signal: abortRef.current.signal },
                (s) => setStreamText(s),
              )
              if (revised.trim()) proposed = revised.trim()
            }
          }
          setReaderGateStatus(`Readers: ${avgScore}/100 · ${keepCount}/${responding} keep${failedNote}${!passed ? ` · revised` : ' · pass'}`)
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
            <div className="modal-body ap-body">
              {/* Resume banner */}
              {resumable && (
                <div className="ap-resume">
                  <div className="ap-resume-txt">
                    <strong>Unfinished run</strong> — {resumeRemaining} of {resumable.queue.length} scene{resumable.queue.length === 1 ? '' : 's'} left.
                  </div>
                  <button className="btn sm" onClick={() => setAutopilotRun(null)}>Discard</button>
                  <button className="btn sm primary" onClick={handleResume}>Resume</button>
                </div>
              )}

              {/* Prompt selector */}
              <div>
                <label className="reg-lbl">Prompt</label>
                <select className="sel" value={promptId} onChange={(e) => setPromptId(e.target.value)}>
                  {allPrompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Quality gate + reader gate (drafting prompts only) */}
              {gateEligible && (
                <div className="ai-col">
                  <label className="fnd-check">
                    <input type="checkbox" checked={useGate} onChange={(e) => setUseGate(e.target.checked)} />
                    Quality gate — score &amp; auto-revise each draft before review
                  </label>
                  <label className="fnd-check">
                    <input type="checkbox" checked={useReaderGate} onChange={(e) => setUseReaderGate(e.target.checked)} />
                    Reader gate — run reader panel, revise if engagement score &lt; 65
                  </label>
                </div>
              )}

              {/* Spend cap */}
              <label className="ap-cap">
                Spend cap
                <span className="dim">$</span>
                <input
                  className="inp mono"
                  style={{ width: 80 }}
                  type="number" min={0} step={0.5}
                  value={spendCapUSD || ''}
                  onChange={(e) => setSpendCap(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0 = none"
                />
                <span className="dim">halts the run when crossed</span>
              </label>
              {spendCapUSD > 0 && estimate?.cost != null && estimate.cost > spendCapUSD && (
                <div style={{ fontSize: 'var(--t-xs)', color: 'var(--st-idea)' }}>
                  Estimated ~{formatUSD(estimate.cost)} exceeds the {formatUSD(spendCapUSD)} cap — the run will stop partway.
                </div>
              )}

              {/* Node checklist */}
              <div>
                <label className="reg-lbl">
                  Scenes ({checkedIds.length} of {nodeList.length} selected)
                </label>
                <div className="ap-scenes">
                  {nodeList.map(({ id, depth }) => (
                    <label key={id} className="ap-scene" style={{ paddingLeft: 10 + depth * 16 }}>
                      <input
                        type="checkbox"
                        checked={checked[id] ?? false}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [id]: e.target.checked }))}
                      />
                      <span>{project.nodes[id]?.title ?? id}</span>
                    </label>
                  ))}
                  {nodeList.length === 0 && (
                    <div className="dock-empty" style={{ padding: '12px 14px' }}>No scenes found.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <span className="hint">
                {estimate
                  ? <>Est. {estimate.cost != null ? `~${formatUSD(estimate.cost)}` : '— (unpriced model)'} · ~{Math.round((estimate.inTok + estimate.outTok) / 1000)}k tokens{(gateOn || readerGateOn) ? ` incl.${gateOn ? ' quality' : ''}${gateOn && readerGateOn ? ' +' : ''}${readerGateOn ? ' reader' : ''} gate` : ''}</>
                  : 'Results open in Changeset Review'}
              </span>
              <span className="tb-spacer" />
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={handleRun} disabled={!canRun}>
                Run {checkedIds.length} scene{checkedIds.length !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <>
            <div className="modal-body ap-body">
              {/* Progress label */}
              <div className="ap-progress-lbl">
                Scene {currentIndex + 1} of {totalCount} — <strong>{currentNodeTitle}</strong>
              </div>
              {gateStatus && <div className="ap-status">{gateStatus}</div>}
              {readerGateStatus && <div className="ap-status">{readerGateStatus}</div>}
              <div className="hint">Spent this run: <strong className="mono">{formatUSD(Math.max(0, spendUSD - runStartSpend.current))}</strong></div>

              {/* Progress bar */}
              <div className="meter"><i style={{ width: `${(currentIndex / totalCount) * 100}%` }} /></div>

              {pipelineError && <div style={{ color: 'var(--st-idea)', fontSize: 'var(--t-sm)', marginTop: 'var(--s2)' }}>{pipelineError}</div>}

              {/* Streaming output */}
              <pre ref={streamBoxRef} className="ap-stream">
                {streamText || 'Generating…'}
              </pre>
            </div>

            <div className="modal-foot">
              <span className="tb-spacer" />
              <button className="btn danger" onClick={handleStop}>Stop</button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="modal-body">
              <div className="ap-done">
                {capHit
                  ? <>Stopped — spend cap of {formatUSD(spendCapUSD)} reached.</>
                  : 'All scenes processed.'}
                <br />
                <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>Spent this run: {formatUSD(Math.max(0, spendUSD - runStartSpend.current))}</span>
              </div>
            </div>
            <div className="modal-foot">
              {resumable && <span className="hint">{resumeRemaining} scene{resumeRemaining === 1 ? '' : 's'} left</span>}
              <span className="tb-spacer" />
              <button className="btn" onClick={onClose}>Close</button>
              {resumable && (
                <button className="btn primary" onClick={handleResume}>Resume</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
