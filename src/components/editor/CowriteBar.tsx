import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { COWRITE_COMMANDS, runCowrite, type CowriteCommand } from '../../lib/cowrite'

interface Props {
  docId: string
  selection: string
  anchorRect: DOMRect
  onClose: () => void
  autoRun?: CowriteCommand   // when set (from the right-click menu), runs immediately
}

export default function CowriteBar({ docId, selection, anchorRect, onClose, autoRun }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const { enabled } = useAIStore()

  const [running, setRunning] = useState<CowriteCommand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const handleCommand = useCallback(async (cmd: CowriteCommand) => {
    if (!project || running) return
    setRunning(cmd)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const proposal = await runCowrite({ command: cmd, project, mentionIndex, docId, selection, signal: controller.signal })
      queueProposal(proposal)
      setRunning(null)
      onClose()
    } catch (err) {
      if ((err as Error).name === 'AbortError') { setRunning(null); return }
      setError((err as Error).message)
      setRunning(null)
    }
  }, [project, mentionIndex, docId, selection, running, queueProposal, onClose])

  // Auto-run a command when invoked from the right-click menu (once).
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (autoRun && !autoRanRef.current) { autoRanRef.current = true; handleCommand(autoRun) }
  }, [autoRun, handleCommand])

  const handleStop = () => {
    abortRef.current?.abort()
    setRunning(null)
  }

  // Position: just above the selection anchor, clamped to viewport
  const top = Math.max(8, anchorRect.top - 44)
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 320))

  if (!enabled) return <></>

  return (
    <div
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'var(--bg)',
        border: '1px solid var(--border-2)',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: 'var(--shadow)',
      }}
      onMouseDown={(e) => e.preventDefault()} // don't steal focus from editor
    >
      {COWRITE_COMMANDS.map((cmd) => (
        <button
          key={cmd.id}
          onClick={() => handleCommand(cmd.id)}
          disabled={running !== null}
          style={{
            padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)',
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
        <button onClick={handleStop} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'oklch(0.65 0.15 20)', fontSize: 12, cursor: 'pointer' }}>
          Stop
        </button>
      )}
      {error && (
        <span style={{ fontSize: 11, color: 'oklch(0.65 0.15 20)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={error}>
          {error}
        </span>
      )}
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>×</button>
    </div>
  )
}
