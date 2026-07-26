import React, { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import { STATUS_META, STATUS_ORDER, LABEL_META, LABEL_ORDER, wordCount, charCount } from '@shared/utils'
import type { StatusId, LabelId } from '@shared/types'
import { backlinksFor } from '../../lib/MentionIndex'
import { runJudge, type JudgeScore } from '../../lib/judge'
import KeywordEditor from './KeywordEditor'

function scoreColor(score: number): string {
  return score >= 8 ? 'var(--success)' : score >= 5 ? 'var(--accent)' : 'var(--danger)'
}

export default function Inspector(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const voiceProfiles = (project?.settings.voiceProfiles as import('@shared/types').VoiceProfile[] | undefined) ?? []
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const aiEnabled = useAIStore((s) => s.enabled)

  const judgeResultsMap = useProjectStore((s) => s.judgeResults)
  const setJudgeResultStore = useProjectStore((s) => s.setJudgeResult)
  const judgeResult = selectedId ? (judgeResultsMap.get(selectedId) ?? null) : null
  const [judgeRunning, setJudgeRunning] = useState(false)
  const [judgeError, setJudgeError] = useState<string | null>(null)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const selectNode = useProjectStore((s) => s.selectNode)
  const [activeTab, setActiveTab] = useState<'info' | 'links'>('info')

  if (!project || !selectedId) {
    return (
      <div className="inspector">
        <div className="insp-scroll">
          <div className="insp-empty">Select a document to see its properties.</div>
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

  const runJudgeInspector = async () => {
    const content = project?.docs[selectedId]?.content ?? ''
    if (!content.trim()) return
    setJudgeRunning(true)
    setJudgeError(null)
    try {
      setJudgeResultStore(selectedId, await runJudge(content))
    } catch (err) {
      setJudgeError((err as Error).message)
    } finally {
      setJudgeRunning(false)
    }
  }

  const mutateNode = async (op: Parameters<typeof window.api.node.mutate>[1]) => {
    try {
      const result = await window.api.node.mutate(project.id, op)
      applyMutation(result)
    } catch (e) {
      useShellStore.getState().setToast('Change could not be saved: ' + (e as Error).message)
    }
  }

  const handleMeta = (patch: Partial<typeof node.meta>) => {
    updateMeta(selectedId, patch)
    mutateNode({ type: 'updateMeta', id: selectedId, patch })
  }

  const backlinkIds = node.type !== 'folder' && mentionIndex
    ? backlinksFor(mentionIndex, node.title).filter((id) => id !== selectedId)
    : []

  return (
    <div className="inspector">
      {node.type !== 'folder' && (
        <div className="insp-tabs">
          {(['info', 'links'] as const).map((tab) => (
            <button
              key={tab}
              className={`insp-tab${activeTab === tab ? ' on' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'info' ? 'Info' : '↩ Links'}
            </button>
          ))}
        </div>
      )}
      {activeTab === 'links' && node.type !== 'folder' ? (
        <div className="insp-scroll">
          <div className="insp-sec">
            <h4>Backlinks</h4>
            {backlinkIds.length === 0 ? (
              <div className="insp-note">No documents link here.</div>
            ) : (
              <div className="insp-links">
                {backlinkIds.map((id) => {
                  const n = project.nodes[id]
                  if (!n) return null
                  return (
                    <button key={id} className="insp-link" onClick={() => selectNode(id)}>
                      {n.title}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
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

        {/* Voice — only worth showing once the project has more than one. */}
        {voiceProfiles.length > 1 && node.type !== 'folder' && (
          <div className="insp-sec">
            <h4>Voice</h4>
            <div className="pill-row">
              <button
                className={`pill${!node.meta.voiceId ? ' on' : ''}`}
                title="Follow the project default"
                onClick={() => handleMeta({ voiceId: undefined })}
              >
                Default
              </button>
              {voiceProfiles.map((v) => (
                <button
                  key={v.id}
                  className={`pill${node.meta.voiceId === v.id ? ' on' : ''}`}
                  title={v.fingerprint.slice(0, 400)}
                  onClick={() => handleMeta({ voiceId: v.id })}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Keywords */}
        <div className="insp-sec">
          <h4>Keywords</h4>
          <KeywordEditor
            keywords={node.meta.keywords ?? []}
            onChange={(keywords) => handleMeta({ keywords })}
          />
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
                <div className="insp-note">
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
              <label className="check-lbl">
                <input
                  type="checkbox"
                  checked={node.meta.includeInCompile}
                  onChange={(e) => handleMeta({ includeInCompile: e.target.checked })}
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
                onClick={runJudgeInspector}
              >
                {judgeRunning ? '…' : judgeResult ? 'Re-score' : 'Score'}
              </button>
            </h4>
            {judgeError && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{judgeError}</div>}
            {judgeResult && (
              <>
                {judgeResult.scores.map((s) => (
                  <div key={s.dimension} className="jscore">
                    <div className="jscore-hd">
                      <span className="jscore-name">{s.dimension}</span>
                      <span className="jscore-val" style={{ color: scoreColor(s.score) }}>
                        {s.score}/10
                      </span>
                    </div>
                    <div className="meter"><i style={{ width: `${s.score * 10}%`, background: scoreColor(s.score) }} /></div>
                    <div className="jscore-note">{s.note}</div>
                  </div>
                ))}
                {judgeResult.verdict && (
                  <div className="jverdict">{judgeResult.verdict}</div>
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
            <div className="insp-meta-val">{node.type}</div>
          </div>
          <div className="field">
            <label>ID</label>
            <div className="insp-meta-val mono">{node.id}</div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
