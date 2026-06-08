import React, { useState } from 'react'
import { useShellStore, type Density, type EditorFont } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'

interface Props { onClose: () => void }

function Seg<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" style={{ gap: 2 }}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
      <span style={{ flex: '0 0 130px', fontSize: 13, color: 'var(--text-2)' }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

export default function PrefsModal({ onClose }: Props): React.ReactElement {
  const theme = useShellStore((s) => s.theme)
  const setTheme = useShellStore((s) => s.setTheme)
  const density = useShellStore((s) => s.density)
  const setDensity = useShellStore((s) => s.setDensity)
  const editorFont = useShellStore((s) => s.editorFont)
  const setEditorFont = useShellStore((s) => s.setEditorFont)
  const editorSize = useShellStore((s) => s.editorSize)
  const setEditorSize = useShellStore((s) => s.setEditorSize)
  const typewriterMode = useShellStore((s) => s.typewriterMode)
  const setTypewriterMode = useShellStore((s) => s.setTypewriterMode)
  const autoVersion = useShellStore((s) => s.autoVersion)
  const setAutoVersion = useShellStore((s) => s.setAutoVersion)
  const historyRetentionDays = useShellStore((s) => s.historyRetentionDays)
  const setHistoryRetentionDays = useShellStore((s) => s.setHistoryRetentionDays)

  const project = useProjectStore((s) => s.project)
  const setProjectWordTarget = useProjectStore((s) => s.setProjectWordTarget)
  const wordTarget = project?.settings?.wordTarget
  const [targetDraft, setTargetDraft] = useState(wordTarget?.toString() ?? '')

  function commitTarget(val: string) {
    const n = parseInt(val.replace(/[^0-9]/g, ''), 10)
    setProjectWordTarget(isNaN(n) || n <= 0 ? undefined : n)
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="Preferences">
        <div className="modal-hd"><h3>Preferences</h3></div>
        <div className="modal-body">

          <Row label="Appearance">
            <Seg<'dark' | 'light'>
              options={[{ label: 'Dark', value: 'dark' }, { label: 'Light', value: 'light' }]}
              value={theme}
              onChange={setTheme}
            />
          </Row>

          <Row label="Density">
            <Seg<Density>
              options={[
                { label: 'Compact', value: 'compact' },
                { label: 'Balanced', value: 'balanced' },
                { label: 'Roomy', value: 'roomy' },
              ]}
              value={density}
              onChange={setDensity}
            />
          </Row>

          <Row label="Editor Font">
            <Seg<EditorFont>
              options={[
                { label: 'Mono', value: 'mono' },
                { label: 'Serif', value: 'serif' },
                { label: 'Sans', value: 'sans' },
              ]}
              value={editorFont}
              onChange={setEditorFont}
            />
          </Row>

          <Row label="Editor Size">
            <input
              type="range"
              min={14}
              max={22}
              value={editorSize}
              onChange={(e) => setEditorSize(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ width: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
              {editorSize}px
            </span>
          </Row>

          <Row label="Accent">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: 'Violet', hue: 300 },
                { label: 'Blue',   hue: 250 },
                { label: 'Green',  hue: 150 },
                { label: 'Amber',  hue: 75 },
                { label: 'Red',    hue: 20 },
              ].map(({ label, hue }) => {
                const color = `oklch(0.64 0.11 ${hue})`
                return (
                  <button
                    key={hue}
                    title={label}
                    onClick={() => document.documentElement.style.setProperty('--accent', color)}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: color, border: '2px solid transparent',
                      cursor: 'pointer', padding: 0,
                    }}
                  />
                )
              })}
            </div>
          </Row>

          <Row label="Typewriter scroll">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={typewriterMode}
                onChange={(e) => setTypewriterMode(e.target.checked)}
              />
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Keep cursor at 40% from top while typing</span>
            </label>
          </Row>

          <Row label="Auto-history">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoVersion}
                onChange={(e) => setAutoVersion(e.target.checked)}
              />
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Auto-save versions as you write</span>
            </label>
          </Row>

          <Row label="Keep versions">
            <Seg<string>
              options={[
                { label: '7 days', value: '7' },
                { label: '14 days', value: '14' },
                { label: '30 days', value: '30' },
                { label: 'Forever', value: '0' },
              ]}
              value={String(historyRetentionDays)}
              onChange={(v) => setHistoryRetentionDays(Number(v))}
            />
          </Row>

          {project && (
            <Row label="Word Goal">
              <input
                type="number"
                min={0}
                value={targetDraft}
                placeholder="e.g. 80000"
                onChange={(e) => setTargetDraft(e.target.value)}
                onBlur={(e) => commitTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTarget(targetDraft) }}
                style={{ width: 100, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)' }}
              />
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)' }}>words (project target)</span>
            </Row>
          )}

        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
