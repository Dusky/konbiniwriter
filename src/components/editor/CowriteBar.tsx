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
    <div className="cw" style={{ top, left }}>
      {/* Button bar */}
      <div className={`cw-bar${hasPanel ? ' open' : ''}`} onMouseDown={(e) => e.preventDefault()}>
        {COWRITE_COMMANDS.map((cmd) => (
          <button
            key={cmd.id}
            className={`cw-cmd${running === cmd.id ? ' on' : ''}${running && running !== cmd.id ? ' dim' : ''}`}
            onClick={() => handleCommand(cmd.id)}
            disabled={running !== null}
          >
            {running === cmd.id ? '…' : cmd.label}
          </button>
        ))}
        {running && (
          <button className="cw-stop" onClick={handleStop}>Stop</button>
        )}
        {error && (
          <span className="cw-err" title={error}>{error}</span>
        )}
        <button
          className={`cw-temp-btn${showTemp ? ' on' : ''}${tempOverride !== null ? ' set' : ''}`}
          onClick={() => setShowTemp(!showTemp)}
          title="Temperature override"
        >
          T{tempOverride !== null ? `:${tempOverride.toFixed(2)}` : ''}
        </button>
        <button className="cw-x" onClick={() => { setPicker(null); onClose() }}>×</button>
      </div>

      {/* Temperature slider panel */}
      {showTemp && (
        <div className={`cw-panel${picker ? '' : ' last'}`} onMouseDown={(e) => e.preventDefault()}>
          <span className="cw-temp-lbl">
            {tempOverride !== null ? `T = ${tempOverride.toFixed(2)}` : 'T = prompt default'}
          </span>
          <input
            className="cw-temp-range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={tempOverride ?? 0.7}
            onChange={(e) => setTempOverride(parseFloat(e.target.value))}
          />
          <button className="cw-reset" onClick={() => setTempOverride(null)}>reset</button>
        </div>
      )}

      {/* Brainstorm picker panel */}
      {picker && (
        <div className="cw-picker" onMouseDown={(e) => e.preventDefault()}>
          {picker.phase === 'streaming' ? (
            <div className="cw-streaming">
              {picker.partial || <em>Generating alternatives…</em>}
            </div>
          ) : (
            <div className="cw-alts">
              {picker.alternatives.map((alt, i) => (
                <div key={i} className="cw-alt">
                  <span className="cw-alt-n">{i + 1}</span>
                  <span className="cw-alt-txt">{alt}</span>
                  <button className="cw-use" onClick={() => handlePick(alt)}>Use</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
