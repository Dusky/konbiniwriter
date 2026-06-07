import React, { useState, useRef, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { promptRegistry } from '../../lib/PromptRegistry'
import { createProposal } from '../../lib/ProposalService'
import { buildContext, renderContext } from '../../lib/ContextBuilder'
import { streamCompletion } from '../../lib/AIClient'

type Command = 'rewrite' | 'expand' | 'tighten' | 'describe' | 'brainstorm'

const COMMANDS: { id: Command; label: string; promptId: string }[] = [
  { id: 'rewrite',    label: 'Rewrite',    promptId: 'builtin:inline:rewrite' },
  { id: 'expand',     label: 'Expand',     promptId: 'builtin:inline:expand' },
  { id: 'tighten',    label: 'Tighten',    promptId: 'builtin:inline:tighten' },
  { id: 'describe',   label: 'Describe',   promptId: 'builtin:inline:describe' },
  { id: 'brainstorm', label: 'Brainstorm', promptId: 'builtin:inline:brainstorm' },
]

interface Props {
  docId: string
  selection: string
  anchorRect: DOMRect
  onClose: () => void
}

export default function CowriteBar({ docId, selection, anchorRect, onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const queueProposal = useProjectStore((s) => s.queueProposal)
  const { enabled } = useAIStore()

  const [running, setRunning] = useState<Command | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleCommand = useCallback(async (cmd: Command) => {
    if (!project || running) return
    const prompt = COMMANDS.find((c) => c.id === cmd)!
    const template = promptRegistry.get(prompt.promptId)
    if (!template) return

    setRunning(cmd)
    setError(null)

    const ctxPacket = buildContext(project, mentionIndex, docId, 'inline')
    const contextStr = renderContext(ctxPacket)

    const rendered = promptRegistry.render(prompt.promptId, {
      context: contextStr,
      selection,
      content: selection,
    })

    const controller = new AbortController()
    abortRef.current = controller

    await streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal: controller.signal },
      {
        onChunk: () => {},
        onDone: (full) => {
          const proposal = createProposal({
            docId,
            docTitle: project.nodes[docId]?.title ?? 'Document',
            command: cmd,
            label: `${prompt.label}: ${selection.slice(0, 40)}${selection.length > 40 ? '…' : ''}`,
            group: 'cowrite',
            original: selection,
            proposed: full.trim(),
            promptId: prompt.promptId,
          })
          queueProposal(proposal)
          setRunning(null)
          onClose()
        },
        onError: (err) => {
          setError(err.message)
          setRunning(null)
        },
      },
    )
  }, [project, mentionIndex, docId, selection, running, queueProposal, onClose])

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
      {COMMANDS.map((cmd) => (
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
