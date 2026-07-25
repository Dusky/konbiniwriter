import React, { useState } from 'react'
import { useShellStore, type Density, type EditorFont } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { BUILTIN_THEMES } from '../../lib/theme'
import ModalShell from '../common/ModalShell'
import Icon from '../common/Icon'

interface Props { onClose: () => void; embedded?: boolean }

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
    <div className="pref-row">
      <span className="pref-row-lbl">{label}</span>
      <div className="pref-row-ctl">{children}</div>
    </div>
  )
}

export default function PrefsModal({ onClose, embedded }: Props): React.ReactElement {
  const theme = useShellStore((s) => s.theme)
  const setTheme = useShellStore((s) => s.setTheme)
  const themeId = useShellStore((s) => s.themeId)
  const customThemes = useShellStore((s) => s.customThemes)
  const openViewTab = useProjectStore((s) => s.openViewTab)
  const activeTheme = BUILTIN_THEMES.find((t) => t.id === themeId) ?? customThemes.find((t) => t.id === themeId)
  const density = useShellStore((s) => s.density)
  const setDensity = useShellStore((s) => s.setDensity)
  const editorFont = useShellStore((s) => s.editorFont)
  const setEditorFont = useShellStore((s) => s.setEditorFont)
  const editorSize = useShellStore((s) => s.editorSize)
  const setEditorSize = useShellStore((s) => s.setEditorSize)
  const editorColWidth = useShellStore((s) => s.editorColWidth)
  const setEditorColWidth = useShellStore((s) => s.setEditorColWidth)
  const typewriterMode = useShellStore((s) => s.typewriterMode)
  const setTypewriterMode = useShellStore((s) => s.setTypewriterMode)
  const autoVersion = useShellStore((s) => s.autoVersion)
  const setAutoVersion = useShellStore((s) => s.setAutoVersion)
  const historyRetentionDays = useShellStore((s) => s.historyRetentionDays)
  const setHistoryRetentionDays = useShellStore((s) => s.setHistoryRetentionDays)
  const accent = useShellStore((s) => s.accent)
  const setAccent = useShellStore((s) => s.setAccent)

  const project = useProjectStore((s) => s.project)
  const dictionary = useProjectStore((s) => s.dictionary)
  const removeDictionaryWord = useProjectStore((s) => s.removeDictionaryWord)
  const setProjectWordTarget = useProjectStore((s) => s.setProjectWordTarget)
  const wordTarget = project?.settings?.wordTarget
  const [targetDraft, setTargetDraft] = useState(wordTarget?.toString() ?? '')

  function commitTarget(val: string) {
    const n = parseInt(val.replace(/[^0-9]/g, ''), 10)
    setProjectWordTarget(isNaN(n) || n <= 0 ? undefined : n)
  }

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={520} label="Preferences">
        <div className="modal-hd"><h3>Preferences</h3></div>
        <div className="modal-body">

          <Row label="Appearance">
            <Seg<'dark' | 'light'>
              options={[{ label: 'Dark', value: 'dark' }, { label: 'Light', value: 'light' }]}
              value={theme}
              onChange={setTheme}
            />
          </Row>

          <Row label="Theme">
            <button className="btn" onClick={() => openViewTab('themes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {activeTheme && (
                <span style={{ display: 'inline-flex', gap: 2 }}>
                  {[activeTheme.anchors.bg, activeTheme.anchors.surface, activeTheme.anchors.accent, activeTheme.anchors.text].map((c, i) => (
                    <span key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '0.5px solid var(--border)' }} />
                  ))}
                </span>
              )}
              {activeTheme?.name ?? 'Custom'} — Browse skins…
            </button>
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
              className="pref-range"
              type="range"
              min={14}
              max={22}
              value={editorSize}
              onChange={(e) => setEditorSize(Number(e.target.value))}
            />
            <span className="pref-num">{editorSize}px</span>
          </Row>

          <Row label="Editor Width">
            <input
              className="pref-range"
              type="range"
              min={560}
              max={960}
              step={40}
              value={editorColWidth}
              onChange={(e) => setEditorColWidth(Number(e.target.value))}
            />
            <span className="pref-num" style={{ width: 42 }}>{editorColWidth}px</span>
          </Row>

          <Row label="Accent">
            <div className="pref-swatches">
              {[
                { label: 'Violet', hue: 300 },
                { label: 'Blue',   hue: 250 },
                { label: 'Green',  hue: 150 },
                { label: 'Amber',  hue: 75 },
                { label: 'Red',    hue: 20 },
              ].map(({ label, hue }) => {
                const color = `oklch(0.64 0.11 ${hue})`
                const active = accent === color
                return (
                  <button
                    key={hue}
                    className={`pref-swatch${active ? ' on' : ''}`}
                    title={label}
                    onClick={() => setAccent(color)}
                    style={{ background: color }}
                  />
                )
              })}
            </div>
          </Row>

          <Row label="Typewriter scroll">
            <label className="pref-check">
              <input
                type="checkbox"
                checked={typewriterMode}
                onChange={(e) => setTypewriterMode(e.target.checked)}
              />
              <span>Keep cursor at 40% from top while typing</span>
            </label>
          </Row>

          <Row label="Auto-history">
            <label className="pref-check">
              <input
                type="checkbox"
                checked={autoVersion}
                onChange={(e) => setAutoVersion(e.target.checked)}
              />
              <span>Auto-save versions as you write</span>
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
                className="inp mono"
                style={{ width: 100 }}
                type="number"
                min={0}
                value={targetDraft}
                placeholder="e.g. 80000"
                onChange={(e) => setTargetDraft(e.target.value)}
                onBlur={(e) => commitTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTarget(targetDraft) }}
              />
              <span style={{ marginLeft: 'var(--s2)', fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>words (project target)</span>
            </Row>
          )}

          {project && (
            <Row label="Dictionary">
              <div style={{ flex: 1, minWidth: 0 }}>
                {dictionary.length === 0 ? (
                  <div style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
                    Empty. Right-click a flagged name in the editor to add it.
                  </div>
                ) : (
                  <div className="kw-tokens" style={{ border: 'none', padding: 0 }}>
                    {dictionary.map((w) => (
                      <span key={w} className="kw-tok">
                        <span className="kw-tok-name" style={{ cursor: 'default' }}>{w}</span>
                        <button
                          className="kw-tok-x"
                          aria-label={`Remove ${w} from the dictionary`}
                          title="Remove"
                          onClick={() => removeDictionaryWord(w)}
                        ><Icon name="x" size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
                  Words Konbini treats as correctly spelled in this project. Codex
                  names and document titles already count — these are extras.
                </div>
              </div>
            </Row>
          )}

        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Done</button>
        </div>
    </ModalShell>
  )
}
