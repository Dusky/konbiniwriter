import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { STATUS_META, STATUS_ORDER, LABEL_META, LABEL_ORDER, wordCount, charCount } from '@shared/utils'
import type { StatusId, LabelId } from '@shared/types'
import { promptRegistry } from '../../lib/PromptRegistry'
import { streamCompletion } from '../../lib/AIClient'

interface JudgeScore { dimension: string; score: number; note: string }
interface JudgeResult { scores: JudgeScore[]; verdict: string }

export default function Inspector(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null)
  const [judgeRunning, setJudgeRunning] = useState(false)
  const [judgeError, setJudgeError] = useState<string | null>(null)

  if (!project || !selectedId) {
    return (
      <div className="inspector">
        <div className="insp-scroll">
          <div style={{ padding: '24px 16px', color: 'var(--text-3)', fontSize: 13 }}>
            Select a document to see its properties.
          </div>
        </div>
      </div>
    )
  }

  const node = project.nodes[selectedId]
  if (!node) return <div className="inspector" />

  const body = project.docs[selectedId]
  const content = body?.content ?? ''
  const words = wordCount(content)
  const chars = charCount(content)
  const target = node.meta.target
  const progress = target > 0 ? Math.min(1, words / target) : 0

  const runJudge = async () => {
    const content = project?.docs[selectedId]?.content ?? ''
    if (!content.trim()) return
    setJudgeRunning(true)
    setJudgeError(null)
    const rendered = promptRegistry.render('builtin:evaluation:judge', { content: content.slice(0, 8000) })
    const template = promptRegistry.get('builtin:evaluation:judge')!
    await streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature },
      {
        onChunk: () => {},
        onDone: (full) => {
          try {
            const jsonMatch = full.match(/\[[\s\S]*?\]/)
            const scores: JudgeScore[] = jsonMatch ? JSON.parse(jsonMatch[0]) : []
            const afterJson = jsonMatch ? full.slice(full.indexOf(jsonMatch[0]) + jsonMatch[0].length).trim() : ''
            setJudgeResult({ scores, verdict: afterJson })
          } catch {
            setJudgeError('Could not parse judge response')
          }
          setJudgeRunning(false)
        },
        onError: (err) => { setJudgeError(err.message); setJudgeRunning(false) },
      },
    )
  }

  const mutateNode = async (op: Parameters<typeof window.api.node.mutate>[1]) => {
    const result = await window.api.node.mutate(project.id, op)
    applyMutation(result)
  }

  const handleMeta = (patch: Partial<typeof node.meta>) => {
    updateMeta(selectedId, patch)
    mutateNode({ type: 'updateMeta', id: selectedId, patch })
  }

  return (
    <div className="inspector">
      <div className="insp-scroll">
        {/* Status & Label */}
        <div className="insp-sec">
          <h4>Status</h4>
          <div className="pill-row">
            {STATUS_ORDER.map((st) => {
              const m = STATUS_META[st]
              return (
                <button
                  key={st}
                  className={`pill${node.meta.status === st ? ' on' : ''}`}
                  onClick={() => handleMeta({ status: st as StatusId })}
                >
                  <span className="dot" style={{ background: m.color }} />
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="insp-sec">
          <h4>Label</h4>
          <div className="pill-row">
            {LABEL_ORDER.map((lb) => {
              const m = LABEL_META[lb]
              return (
                <button
                  key={lb}
                  className={`pill${node.meta.label === lb ? ' on' : ''}`}
                  onClick={() => handleMeta({ label: lb as LabelId })}
                >
                  {lb !== 'none' && <span className="dot" style={{ background: m.color }} />}
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Synopsis */}
        <div className="insp-sec">
          <h4>Synopsis</h4>
          <div className="field">
            <textarea
              className="ta"
              rows={4}
              placeholder="A short description of this section…"
              value={node.meta.synopsis}
              onChange={(e) => handleMeta({ synopsis: e.target.value })}
            />
          </div>
        </div>

        {/* Word count target */}
        {node.type !== 'folder' && (
          <div className="insp-sec">
            <h4>Word Count</h4>
            <div className="stat-grid" style={{ marginBottom: 12 }}>
              <div className="stat">
                <div className="n">{words.toLocaleString()}</div>
                <div className="l">Words</div>
              </div>
              <div className="stat">
                <div className="n">{chars.toLocaleString()}</div>
                <div className="l">Chars</div>
              </div>
            </div>
            {target > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div className="meter"><i style={{ width: `${progress * 100}%` }} /></div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  {words} / {target} words ({Math.round(progress * 100)}%)
                </div>
              </div>
            )}
            <div className="field">
              <label>Target</label>
              <input
                className="inp"
                type="number"
                min={0}
                value={target || ''}
                placeholder="0 = none"
                onChange={(e) => handleMeta({ target: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        )}

        {/* Include in compile */}
        {node.type !== 'folder' && (
          <div className="insp-sec">
            <h4>Compile</h4>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={node.meta.includeInCompile}
                  onChange={(e) => handleMeta({ includeInCompile: e.target.checked })}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                />
                Include in Compile
              </label>
            </div>
          </div>
        )}

        {/* AI Judge scoring */}
        {aiEnabled && node.type !== 'folder' && (
          <div className="insp-sec">
            <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Score
              <button
                className="tb-btn"
                style={{ fontSize: 11, padding: '2px 8px' }}
                disabled={judgeRunning}
                onClick={runJudge}
              >
                {judgeRunning ? '…' : judgeResult ? 'Re-score' : 'Score'}
              </button>
            </h4>
            {judgeError && <div style={{ color: 'var(--accent-danger, #ef4444)', fontSize: 12 }}>{judgeError}</div>}
            {judgeResult && (
              <>
                {judgeResult.scores.map((s) => (
                  <div key={s.dimension} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.dimension}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: s.score >= 8 ? 'var(--accent-ok, #22c55e)' : s.score >= 5 ? 'var(--accent)' : 'var(--accent-danger, #ef4444)' }}>
                        {s.score}/10
                      </span>
                    </div>
                    <div style={{ height: 3, background: 'var(--ui-3)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ height: '100%', width: `${s.score * 10}%`, background: s.score >= 8 ? 'var(--accent-ok, #22c55e)' : s.score >= 5 ? 'var(--accent)' : 'var(--accent-danger, #ef4444)', borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>{s.note}</div>
                  </div>
                ))}
                {judgeResult.verdict && (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--ui-2)', borderRadius: 4, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    {judgeResult.verdict}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Node metadata */}
        <div className="insp-sec">
          <h4>Document</h4>
          <div className="field">
            <label>Type</label>
            <div style={{ fontSize: 12, color: 'var(--text-2)', padding: '4px 0' }}>{node.type}</div>
          </div>
          <div className="field">
            <label>ID</label>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', padding: '4px 0', wordBreak: 'break-all' }}>
              {node.id}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
