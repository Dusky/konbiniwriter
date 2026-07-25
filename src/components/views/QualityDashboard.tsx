import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { wordCount } from '@shared/utils'
import { runJudge, judgeOverall, scoreBand, type JudgeResult } from '../../lib/judge'
import ModalShell from '../common/ModalShell'
import Icon from '../common/Icon'

interface Props { onClose: () => void; embedded?: boolean }

interface Scene { id: string; title: string; words: number; content: string }

export default function QualityDashboard({ onClose, embedded }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const judgeResults = useProjectStore((s) => s.judgeResults)
  const setJudgeResult = useProjectStore((s) => s.setJudgeResult)
  const selectNode = useProjectStore((s) => s.selectNode)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [running, setRunning] = useState<Set<string>>(new Set())
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
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

  const evalAll = async () => {
    const todo = scenes.filter((s) => s.content.trim())
    setBatch({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      await evalOne(todo[i])
      setBatch({ done: i + 1, total: todo.length })
    }
    setBatch(null)
  }

  const open = (id: string) => { selectNode(id); onClose() }

  const withScore = scenes.map((s) => {
    const r: JudgeResult | undefined = judgeResults.get(s.id)
    const overall = r ? judgeOverall(r.scores) : null
    const stale = !!(r && r.words !== undefined && Math.abs(r.words - s.words) > Math.max(20, s.words * 0.1))
    return { ...s, result: r, overall, stale }
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
            <button className="btn sm primary" disabled={!!batch || scenes.length === 0} onClick={evalAll}>
              {batch ? `Evaluating ${batch.done}/${batch.total}…` : 'Evaluate all'}
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
              </div>
            )}
            <div className="ql-table">
              {rows.map((r) => {
                const busy = running.has(r.id)
                return (
                  <div key={r.id} className="ql-row-wrap">
                    <div className="ql-row">
                      <button className="ql-title" onClick={() => open(r.id)} title="Open scene">{r.title}</button>
                      <span className="ql-words">{r.words.toLocaleString()}w</span>
                      {r.overall !== null ? (
                        <button className={`ql-badge ${scoreBand(r.overall)}`} onClick={() => setExpanded((e) => e === r.id ? null : r.id)} title="Show dimension breakdown">
                          {r.overall.toFixed(1)}{r.stale && <span className="ql-stale" title="Scene changed since this score">•</span>}
                        </button>
                      ) : (
                        <span className="ql-badge none">—</span>
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
