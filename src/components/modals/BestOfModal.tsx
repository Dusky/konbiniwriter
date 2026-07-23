import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { buildContext, renderContext } from '../../lib/ContextBuilder'
import { createProposal } from '../../lib/ProposalService'
import { streamCompletion } from '../../lib/AIClient'
import { rankVariants, type RankedVariant } from '../../lib/Ranking'

const GEN_PROMPT_ID = 'builtin:batch:chapter-draft'
const VARIANT_TEMP = 0.95 // elevated for diversity across variants

interface Props { onClose: () => void }

type Phase = 'config' | 'generating' | 'ranking' | 'results'

export default function BestOfModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [n, setN] = useState(3)
  const [synopsis, setSynopsis] = useState('')
  const [phase, setPhase] = useState<Phase>('config')
  const [genIndex, setGenIndex] = useState(0)
  const [rankProgress, setRankProgress] = useState({ done: 0, total: 0 })
  const [ranked, setRanked] = useState<RankedVariant[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  if (!project) return <></>

  const node = selectedId ? project.nodes[selectedId] : null
  const isDoc = !!node && node.type !== 'folder'
  const nodeSynopsis = node?.meta.synopsis ?? ''
  const effSynopsis = synopsis.trim() || nodeSynopsis

  const genOne = (rendered: string, controller: AbortController): Promise<string> => {
    const tmpl = promptRegistry.get(GEN_PROMPT_ID)
    return new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      streamCompletion(
        [{ role: 'user', content: rendered }],
        { model: tmpl?.model, maxTokens: tmpl?.maxTokens ?? 4000, temperature: VARIANT_TEMP, signal: controller.signal },
        { onChunk: () => {}, onDone: (full) => resolve(full.trim()), onError: reject },
      ).catch(reject)
    })
  }

  const run = async () => {
    if (!isDoc || !selectedId) return
    setError(null)
    setRanked([])
    const controller = new AbortController()
    abortRef.current = controller

    const contextStr = renderContext(buildContext(project, mentionIndex, selectedId, 'batch'))
    const rendered = promptRegistry.render(GEN_PROMPT_ID, {
      context: contextStr,
      synopsis: effSynopsis,
      content: project.docs[selectedId]?.content ?? '',
    })

    // 1) Generate N variants.
    setPhase('generating')
    const variants: string[] = []
    try {
      for (let i = 0; i < n; i++) {
        setGenIndex(i)
        variants.push(await genOne(rendered, controller))
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      setPhase('config')
      return
    }

    // 2) Rank them pairwise (Elo).
    setPhase('ranking')
    try {
      const result = await rankVariants(variants, {
        comparePromptId: 'builtin:evaluation:compare',
        compareVars: (a, b) => ({ a, b }),
        signal: controller.signal,
        onProgress: (done, total) => setRankProgress({ done, total }),
      })
      setRanked(result)
      setPhase('results')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      setPhase('config')
    }
  }

  const useVariant = (text: string) => {
    if (!selectedId || !node) return
    queueProposal(createProposal({
      docId: selectedId,
      docTitle: node.title,
      command: 'draft',
      label: `Best of ${n}: ${node.title}`,
      group: 'batch',
      original: project.docs[selectedId]?.content ?? '',
      proposed: text,
      promptId: GEN_PROMPT_ID,
    }))
    onClose()
  }

  const stop = () => { abortRef.current?.abort(); setPhase('config') }

  return (
    // Inert backdrop — ranked variants are only dismissed via Close.
    <div className="modal-bg">
      <div className="modal" style={{ maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-modal="true" aria-label="Best of N">
        <div className="modal-hd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3>Best of N</h3>
          <span className="sub">generate · rank · pick the winner</span>
        </div>

        {!aiEnabled ? (
          <>
            <div className="modal-body" style={{ color: 'var(--text-3)' }}>Enable AI to run a variant tournament.</div>
            <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
          </>
        ) : !isDoc ? (
          <>
            <div className="modal-body" style={{ color: 'var(--text-3)' }}>Select a document in the binder to generate variants for.</div>
            <div className="modal-foot"><span className="tb-spacer" /><button className="btn" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <div className="modal-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                Target: <strong style={{ color: 'var(--text)' }}>{node!.title}</strong>
              </div>

              {phase === 'config' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Variants</label>
                    <div className="seg">
                      {[2, 3, 4].map((k) => (
                        <button key={k} className={n === k ? 'on' : ''} onClick={() => setN(k)}>{k}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      {n} drafts · {(n * (n - 1)) / 2} pairwise comparison{(n * (n - 1)) / 2 === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                      Synopsis / notes <span style={{ opacity: 0.6 }}>(overrides node synopsis)</span>
                    </label>
                    <textarea
                      value={synopsis}
                      onChange={(e) => setSynopsis(e.target.value)}
                      rows={3}
                      placeholder={nodeSynopsis || 'What this scene should cover…'}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
                    />
                  </div>
                </>
              )}

              {phase === 'generating' && (
                <div style={{ fontSize: 13, color: 'var(--text-2)', padding: '20px 0', textAlign: 'center' }}>
                  Generating variant {genIndex + 1} of {n}…
                </div>
              )}
              {phase === 'ranking' && (
                <div style={{ fontSize: 13, color: 'var(--text-2)', padding: '20px 0', textAlign: 'center' }}>
                  Judging pairwise — {rankProgress.done} / {rankProgress.total}…
                </div>
              )}

              {phase === 'results' && ranked.map((v, rank) => (
                <div key={v.index} style={{ border: '1px solid', borderColor: rank === 0 ? 'var(--accent)' : 'var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: rank === 0 ? 'var(--accent)' : 'var(--text-2)' }}>
                      {rank === 0 ? '★ Winner' : `#${rank + 1}`}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      Elo {Math.round(v.rating)} · {v.wins}W-{v.losses}L{v.ties ? `-${v.ties}T` : ''}
                    </span>
                    <span className="tb-spacer" />
                    <button className="btn sm" onClick={() => useVariant(v.text)} style={rank === 0 ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}>
                      Use this →
                    </button>
                  </div>
                  <div style={{ maxHeight: 130, overflowY: 'auto', fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)', whiteSpace: 'pre-wrap', background: 'var(--bg-2)', borderRadius: 'var(--r-md)', padding: '8px 10px' }}>
                    {v.text}
                  </div>
                </div>
              ))}

              {error && <div style={{ fontSize: 12, color: 'var(--st-idea)' }}>{error}</div>}
            </div>

            <div className="modal-foot">
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>The winner opens in Changeset Review.</span>
              <span className="tb-spacer" />
              {phase === 'generating' || phase === 'ranking' ? (
                <button className="btn" onClick={stop}>Stop</button>
              ) : (
                <>
                  <button className="btn" onClick={onClose}>Close</button>
                  <button className="btn" onClick={run} style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}>
                    {phase === 'results' ? 'Re-run' : `Run best of ${n}`}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
