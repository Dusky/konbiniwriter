import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { wordCount } from '@shared/utils'
import { runJudge, judgeOverall, scoreBand, type JudgeResult } from '../../lib/judge'
import { runSlop, type SlopResult } from '../../lib/slop'
import { runVoiceDrift, resolveVoice, type VoiceResult } from '../../lib/voice'
import ModalShell from '../common/ModalShell'
import Icon from '../common/Icon'

// Slop flags → band for colouring: any high flag is bad, a few mediums so-so, clean is good.
function slopBand(flags: SlopResult['flags']): 'strong' | 'ok' | 'weak' {
  if (flags.some((f) => f.severity === 'high')) return 'weak'
  if (flags.length > 2) return 'ok'
  return flags.length === 0 ? 'strong' : 'ok'
}

// A tiny craft-over-passes sparkline (auto-ranged for visibility of small deltas).
function Sparkline({ points }: { points: number[] }): React.ReactElement | null {
  if (points.length < 2) return null
  const w = 132, h = 26, pad = 3
  const min = Math.min(...points), max = Math.max(...points)
  const range = Math.max(0.4, max - min)
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad)
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastUp = points[points.length - 1] >= points[0]
  const stroke = lastUp ? 'var(--st-final)' : 'var(--st-idea)'
  return (
    <svg width={w} height={h} className="ql-spark" role="img" aria-label="craft score over passes">
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2.5" fill={stroke} />
    </svg>
  )
}

interface Props { onClose: () => void; embedded?: boolean }

interface Scene { id: string; title: string; words: number; content: string }

export default function QualityDashboard({ onClose, embedded }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const judgeResults = useProjectStore((s) => s.judgeResults)
  const setJudgeResult = useProjectStore((s) => s.setJudgeResult)
  const slopResults = useProjectStore((s) => s.slopResults)
  const setSlopResult = useProjectStore((s) => s.setSlopResult)
  const voiceResults = useProjectStore((s) => s.voiceResults)
  const setVoiceResult = useProjectStore((s) => s.setVoiceResult)
  const qualityHistory = useProjectStore((s) => s.qualityHistory)
  const pushQualityPoint = useProjectStore((s) => s.pushQualityPoint)
  const selectNode = useProjectStore((s) => s.selectNode)
  const aiEnabled = useAIStore((s) => s.enabled)

  const fingerprint = resolveVoice(project).trim()
  const hasVoice = fingerprint.length > 0

  const [running, setRunning] = useState<Set<string>>(new Set())
  const [proofing, setProofing] = useState<Set<string>>(new Set())
  const [voicing, setVoicing] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState<{ label: string; done: number; total: number } | null>(null)
  const [weakFirst, setWeakFirst] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Manuscript scenes = compile-eligible docs, in binder order (skips Trash).
  const scenes: Scene[] = []
  if (project) {
    const walk = (id: string) => {
      const n = project.nodes[id]
      if (!n) return
      if (n.type !== 'folder' && n.meta.includeInCompile) {
        const content = project.docs[id]?.content ?? ''
        scenes.push({ id, title: n.title, words: wordCount(content), content })
      }
      n.childIds.forEach(walk)
    }
    project.rootIds.forEach(walk)
  }

  const evalOne = async (scene: Scene): Promise<void> => {
    if (!scene.content.trim()) return
    setRunning((s) => new Set(s).add(scene.id))
    try {
      setJudgeResult(scene.id, await runJudge(scene.content))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning((s) => { const n = new Set(s); n.delete(scene.id); return n })
    }
  }

  const proofOne = async (scene: Scene): Promise<void> => {
    if (!scene.content.trim()) return
    setProofing((s) => new Set(s).add(scene.id))
    try {
      setSlopResult(scene.id, await runSlop(scene.content))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProofing((s) => { const n = new Set(s); n.delete(scene.id); return n })
    }
  }

  const voiceOne = async (scene: Scene): Promise<void> => {
    if (!scene.content.trim() || !hasVoice) return
    setVoicing((s) => new Set(s).add(scene.id))
    try {
      // Each scene is scored against the voice *it* is written in, not the
      // project default — otherwise a second POV voice reads as pure drift.
      setVoiceResult(scene.id, await runVoiceDrift(resolveVoice(project, scene.id), scene.content))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setVoicing((s) => { const n = new Set(s); n.delete(scene.id); return n })
    }
  }

  const runBatch = async (label: string, fn: (s: Scene) => Promise<void>) => {
    const todo = scenes.filter((s) => s.content.trim())
    setBatch({ label, done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      await fn(todo[i])
      setBatch({ label, done: i + 1, total: todo.length })
    }
    setBatch(null)
  }

  // Evaluate every scene, then record one manuscript-craft trend point for the pass.
  const evalAllAndRecord = async () => {
    await runBatch('Evaluating', evalOne)
    const jr = useProjectStore.getState().judgeResults
    const craftVals = scenes
      .map((s) => jr.get(s.id))
      .filter((r): r is JudgeResult => !!r)
      .map((r) => judgeOverall(r.scores))
      .filter((v) => v > 0)
    if (craftVals.length) {
      const craft = craftVals.reduce((a, b) => a + b, 0) / craftVals.length
      pushQualityPoint({ at: new Date().toISOString(), craft: +craft.toFixed(2), scored: craftVals.length, total: scenes.length })
    }
  }

  const open = (id: string) => { selectNode(id); onClose() }

  const withScore = scenes.map((s) => {
    const r: JudgeResult | undefined = judgeResults.get(s.id)
    const overall = r ? judgeOverall(r.scores) : null
    const stale = !!(r && r.words !== undefined && Math.abs(r.words - s.words) > Math.max(20, s.words * 0.1))
    const slop: SlopResult | undefined = slopResults.get(s.id)
    const voice: VoiceResult | undefined = voiceResults.get(s.id)
    return { ...s, result: r, overall, stale, slop, voice }
  })
  const rows = weakFirst
    ? [...withScore].sort((a, b) => (a.overall ?? 99) - (b.overall ?? 99))
    : withScore

  const scored = withScore.filter((r) => r.overall !== null)
  const manuscriptAvg = scored.length ? scored.reduce((a, r) => a + (r.overall ?? 0), 0) / scored.length : null

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={760} label="Quality">
      <div className="modal-hd" style={{ gap: 10, alignItems: 'baseline' }}>
        <h3>Manuscript Quality</h3>
        <span className="sub">where the draft is weak — judged per scene</span>
        <span className="tb-spacer" style={{ flex: 1 }} />
        {aiEnabled && (
          <>
            <button className={`chip${weakFirst ? ' on' : ''}`} onClick={() => setWeakFirst((v) => !v)} title="Sort weakest scenes first">Weak first</button>
            <button className="btn sm" disabled={!!batch || scenes.length === 0} onClick={() => runBatch('Proofing', proofOne)} title="Flag slop in every scene">
              {batch?.label === 'Proofing' ? `Proofing ${batch.done}/${batch.total}…` : 'Proof all'}
            </button>
            {hasVoice && (
              <button className="btn sm" disabled={!!batch || scenes.length === 0} onClick={() => runBatch('Voice', voiceOne)} title="Score every scene against your voice fingerprint">
                {batch?.label === 'Voice' ? `Voice ${batch.done}/${batch.total}…` : 'Voice all'}
              </button>
            )}
            <button className="btn sm primary" disabled={!!batch || scenes.length === 0} onClick={evalAllAndRecord}>
              {batch?.label === 'Evaluating' ? `Evaluating ${batch.done}/${batch.total}…` : 'Evaluate all'}
            </button>
          </>
        )}
      </div>
      <div className="modal-body">
        {error && <div className="beat-err" style={{ marginBottom: 10 }}>{error}</div>}
        {!aiEnabled ? (
          <div className="dock-empty">Enable AI to score your manuscript's craft, scene by scene.</div>
        ) : scenes.length === 0 ? (
          <div className="dock-empty">No compile-eligible scenes yet.</div>
        ) : (
          <>
            {manuscriptAvg !== null && (
              <div className="ql-summary">
                <span className={`ql-badge ${scoreBand(manuscriptAvg)}`}>{manuscriptAvg.toFixed(1)}</span>
                <span>manuscript average · {scored.length}/{scenes.length} scenes scored</span>
                {qualityHistory.length >= 2 && (() => {
                  const first = qualityHistory[0].craft
                  const last = qualityHistory[qualityHistory.length - 1].craft
                  const delta = +(last - first).toFixed(1)
                  return (
                    <span className="ql-trend">
                      <Sparkline points={qualityHistory.map((p) => p.craft)} />
                      <span className={delta >= 0 ? 'up' : 'down'}>
                        <Icon name={delta >= 0 ? 'trending-up' : 'trending-down'} size={13} style={{ verticalAlign: '-2px', marginRight: 3 }} />{delta >= 0 ? '+' : ''}{delta} over {qualityHistory.length} passes
                      </span>
                    </span>
                  )
                })()}
              </div>
            )}
            <div className="ql-table">
              {rows.map((r) => {
                const busy = running.has(r.id)
                const proofBusy = proofing.has(r.id)
                return (
                  <div key={r.id} className="ql-row-wrap">
                    <div className="ql-row">
                      <button className="ql-title" onClick={() => open(r.id)} title="Open scene">{r.title}</button>
                      <span className="ql-words">{r.words.toLocaleString()}w</span>
                      <button
                        className={`ql-badge slop ${r.slop ? slopBand(r.slop.flags) : 'none'}`}
                        disabled={proofBusy || !r.content.trim()}
                        onClick={() => r.slop ? setExpanded((e) => e === `slop:${r.id}` ? null : `slop:${r.id}`) : proofOne(r)}
                        title={r.slop ? `${r.slop.flags.length} slop flag(s) — click for detail` : 'Proof this scene for slop'}
                      >
                        {proofBusy ? '…' : <><Icon name="waves" size={12} />{r.slop ? <span style={{ marginLeft: 4 }}>{r.slop.flags.length}</span> : null}</>}
                      </button>
                      <button
                        className={`ql-badge voice ${r.voice ? scoreBand(r.voice.score) : 'none'}`}
                        disabled={!hasVoice || voicing.has(r.id) || !r.content.trim()}
                        onClick={() => r.voice ? setExpanded((e) => e === `voice:${r.id}` ? null : `voice:${r.id}`) : voiceOne(r)}
                        title={!hasVoice ? 'Set a voice fingerprint in Foundation to score voice match' : r.voice ? `Voice match ${r.voice.score}/10 — click for detail` : 'Score this scene against your voice'}
                      >
                        {voicing.has(r.id) ? '…' : <><Icon name="audio-lines" size={12} />{r.voice ? <span style={{ marginLeft: 4 }}>{r.voice.score}</span> : null}</>}
                      </button>
                      {r.overall !== null ? (
                        <button className={`ql-badge ${scoreBand(r.overall)}`} onClick={() => setExpanded((e) => e === r.id ? null : r.id)} title="Show dimension breakdown">
                          {r.overall.toFixed(1)}{r.stale && <span className="ql-stale" title="Scene changed since this score">•</span>}
                        </button>
                      ) : (
                        <button className="ql-badge none" onClick={() => evalOne(r)} disabled={busy || !r.content.trim()} title="Judge this scene">—</button>
                      )}
                      <button className="btn sm" disabled={busy || !r.content.trim()} onClick={() => evalOne(r)}>
                        {busy ? '…' : r.overall !== null ? 'Re-judge' : 'Judge'}
                      </button>
                    </div>
                    {expanded === r.id && r.result && (
                      <div className="ql-detail">
                        {r.result.scores.map((sc, i) => (
                          <div key={i} className="ql-dim">
                            <span className={`ql-dim-score ${scoreBand(sc.score)}`}>{sc.score}</span>
                            <span className="ql-dim-name">{sc.dimension}</span>
                            <span className="ql-dim-note">{sc.note}</span>
                          </div>
                        ))}
                        {r.result.verdict && <div className="ql-verdict">{r.result.verdict}</div>}
                      </div>
                    )}
                    {expanded === `voice:${r.id}` && r.voice && (
                      <div className="ql-detail">
                        <div className="ql-dim">
                          <span className={`ql-dim-score ${scoreBand(r.voice.score)}`}>{r.voice.score}</span>
                          <span className="ql-dim-name">voice match</span>
                          <span className="ql-dim-note">{r.voice.note}</span>
                        </div>
                      </div>
                    )}
                    {expanded === `slop:${r.id}` && r.slop && (
                      <div className="ql-detail">
                        {r.slop.flags.length === 0
                          ? <div className="ql-verdict">No slop flagged — clean prose.</div>
                          : r.slop.flags.map((f, i) => (
                            <div key={i} className="ql-dim">
                              <span className={`ql-dim-score ${f.severity === 'high' ? 'weak' : f.severity === 'medium' ? 'ok' : 'strong'}`}>{f.severity[0].toUpperCase()}</span>
                              <span className="ql-dim-name" style={{ fontStyle: 'italic' }}>“{f.excerpt.length > 32 ? f.excerpt.slice(0, 32) + '…' : f.excerpt}”</span>
                              <span className="ql-dim-note">{f.reason}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      {!embedded && (
        <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Done</button></div>
      )}
    </ModalShell>
  )
}
