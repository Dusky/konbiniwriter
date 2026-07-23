import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { COWRITE_COMMANDS, runCowrite, streamBrainstorm, type CowriteCommand } from '../../lib/cowrite'
import { parseBrainstormAlternatives } from '../../lib/parsers'
import { createProposal } from '../../lib/ProposalService'

type PickerState =
  | null
  | { phase: 'streaming'; partial: string }
  | { phase: 'done'; alternatives: string[]; raw: string }

interface Props {
  docId: string
  selection: string
  selRange?: { from: number; to: number }
  anchorRect: DOMRect
  onClose: () => void
  autoRun?: CowriteCommand
}

export default function CowriteBar({ docId, selection, selRange, anchorRect, onClose, autoRun }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const { enabled } = useAIStore()

  const [running, setRunning] = useState<CowriteCommand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerState>(null)
  const [tempOverride, setTempOverride] = useState<number | null>(null)
  const [showTemp, setShowTemp] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const handleCommand = useCallback(async (cmd: CowriteCommand) => {
    if (!project || running) return
    setRunning(cmd)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller

    if (cmd === 'brainstorm') {
      setPicker({ phase: 'streaming', partial: '' })
      try {
        const raw = await streamBrainstorm({
          project, mentionIndex, docId, selection,
          signal: controller.signal,
          onChunk: (partial) => setPicker({ phase: 'streaming', partial }),
          temperatureOverride: tempOverride ?? undefined,
        })
        const alternatives = parseBrainstormAlternatives(raw)
        if (alternatives.length >= 2) {
          setPicker({ phase: 'done', alternatives, raw })
        } else {
          // Malformed output — fall back to full proposal
          setPicker(null)
          queueProposal(createProposal({
            docId,
            docTitle: project.nodes[docId]?.title ?? 'Document',
            command: 'brainstorm',
            label: `Brainstorm: ${selection.slice(0, 40)}${selection.length > 40 ? '…' : ''}`,
            group: 'cowrite',
            original: selection,
            proposed: raw.trim(),
            promptId: 'builtin:inline:brainstorm',
            scope: 'selection',
            selRange,
          }))
          onClose()
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') { setPicker(null); setRunning(null); return }
        setError((err as Error).message)
        setPicker(null)
      }
      setRunning(null)
      return
    }

    try {
      const proposal = await runCowrite({ command: cmd, project, mentionIndex, docId, selection, selRange, signal: controller.signal, temperatureOverride: tempOverride ?? undefined })
      queueProposal(proposal)
      setRunning(null)
      onClose()
    } catch (err) {
      if ((err as Error).name === 'AbortError') { setRunning(null); return }
      setError((err as Error).message)
      setRunning(null)
    }
  }, [project, mentionIndex, docId, selection, selRange, running, queueProposal, onClose])

  const handlePick = (chosen: string) => {
    if (!project) return
    queueProposal(createProposal({
      docId,
      docTitle: project.nodes[docId]?.title ?? 'Document',
      command: 'brainstorm',
      label: `Brainstorm: ${selection.slice(0, 40)}${selection.length > 40 ? '…' : ''}`,
      group: 'cowrite',
      original: selection,
      proposed: chosen,
      promptId: 'builtin:inline:brainstorm',
      scope: 'selection',
      selRange,
    }))
    setPicker(null)
    onClose()
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setPicker(null)
    setRunning(null)
  }

  // Auto-run a command when invoked from the right-click menu (once).
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (autoRun && !autoRanRef.current) { autoRanRef.current = true; handleCommand(autoRun) }
  }, [autoRun, handleCommand])

  const hasPanel = showTemp || picker !== null

  // Position: just above the selection anchor, clamped to viewport
  const top = Math.max(8, anchorRect.top - 44)
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 340))

  if (!enabled) return <></>

  return (
    <div style={{ position: 'fixed', top, left, zIndex: 1000 }}>
      {/* Button bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'var(--bg)',
          border: '1px solid var(--border-2)',
          borderRadius: hasPanel ? '8px 8px 0 0' : 8,
          padding: '4px 6px',
          boxShadow: 'var(--shadow)',
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        {COWRITE_COMMANDS.map((cmd) => (
          <button
            key={cmd.id}
            onClick={() => handleCommand(cmd.id)}
            disabled={running !== null}
            style={{
              padding: '3px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              background: running === cmd.id ? 'var(--accent)' : 'transparent',
              color: running === cmd.id ? 'var(--accent-fg)' : 'var(--text)',
              fontSize: 12, cursor: running ? 'default' : 'pointer',
              opacity: running && running !== cmd.id ? 0.5 : 1,
            }}
          >
            {running === cmd.id ? '…' : cmd.label}
          </button>
        ))}
        {running && (
          <button onClick={handleStop} style={{ padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}>
            Stop
          </button>
        )}
        {error && (
          <span style={{ fontSize: 11, color: 'var(--danger)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={error}>
            {error}
          </span>
        )}
        <button
          onClick={() => setShowTemp(!showTemp)}
          title="Temperature override"
          style={{ padding: '3px 7px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: showTemp ? 'var(--bg-2)' : 'transparent', color: tempOverride !== null ? 'var(--accent)' : 'var(--text-3)', fontSize: 11, cursor: 'pointer' }}
        >
          T{tempOverride !== null ? `:${tempOverride.toFixed(2)}` : ''}
        </button>
        <button onClick={() => { setPicker(null); onClose() }} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>×</button>
      </div>

      {/* Temperature slider panel */}
      {showTemp && (
        <div
          style={{
            width: 340,
            background: 'var(--bg)',
            border: '1px solid var(--border-2)',
            borderTop: 'none',
            borderRadius: picker ? 0 : '0 0 8px 8px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, width: 80 }}>
            {tempOverride !== null ? `T = ${tempOverride.toFixed(2)}` : 'T = prompt default'}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={tempOverride ?? 0.7}
            onChange={(e) => setTempOverride(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <button
            onClick={() => setTempOverride(null)}
            style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
          >
            reset
          </button>
        </div>
      )}

      {/* Brainstorm picker panel */}
      {picker && (
        <div
          style={{
            width: 340,
            background: 'var(--bg)',
            border: '1px solid var(--border-2)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            boxShadow: 'var(--shadow)',
            maxHeight: 300,
            overflowY: 'auto',
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {picker.phase === 'streaming' ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {picker.partial || <em>Generating alternatives…</em>}
            </div>
          ) : (
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {picker.alternatives.map((alt, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)',
                    padding: '8px 10px',
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, marginTop: 1, fontFamily: 'var(--mono)' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 12, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{alt}</span>
                  <button
                    onClick={() => handlePick(alt)}
                    style={{
                      flexShrink: 0,
                      padding: '3px 9px',
                      borderRadius: 'var(--r-sm)',
                      border: 'none',
                      background: 'var(--accent)',
                      color: 'var(--accent-fg)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
