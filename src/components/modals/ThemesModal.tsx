import React, { useEffect, useRef, useState } from 'react'
import { useShellStore } from '../../store/shellStore'
import {
  BUILTIN_THEMES, ANCHOR_LABELS, applyTheme, toHex, exportTheme, importTheme,
  type Theme, type ThemeBase,
} from '../../lib/theme'
import Icon from '../common/Icon'

interface Props { onClose: () => void }

// A little palette preview for a theme card.
function Swatch({ theme }: { theme: Theme }) {
  const a = theme.anchors
  return (
    <div className="thm-swatch" style={{ background: a.bg }}>
      <span style={{ background: a.surface }} />
      <span style={{ background: a.text }} />
      <span style={{ background: a.accent }} />
      <span style={{ background: a.border }} />
    </div>
  )
}

export default function ThemesModal({ onClose }: Props): React.ReactElement {
  const themeId = useShellStore((s) => s.themeId)
  const customThemes = useShellStore((s) => s.customThemes)
  const setThemeId = useShellStore((s) => s.setThemeId)
  const saveCustomTheme = useShellStore((s) => s.saveCustomTheme)
  const deleteCustomTheme = useShellStore((s) => s.deleteCustomTheme)

  // The theme active when the modal opened — restored if an edit is cancelled.
  const originalId = useRef(themeId)
  const [draft, setDraft] = useState<Theme | null>(null)   // editing / creating
  const [io, setIo] = useState<null | { mode: 'export'; text: string } | { mode: 'import'; text: string; error?: string }>(null)

  // Live-preview the draft as its anchors change.
  useEffect(() => { if (draft) applyTheme(draft) }, [draft])

  const startEdit = (base: Theme, asNew: boolean) => {
    setDraft({
      ...base,
      id: asNew ? `custom-${Date.now().toString(36)}` : base.id,
      name: asNew ? `${base.name} copy` : base.name,
      builtin: false,
    })
  }

  const cancelEdit = () => { setDraft(null); setThemeId(originalId.current) }
  const saveEdit = () => { if (draft) { saveCustomTheme(draft); originalId.current = draft.id; setDraft(null) } }

  const setAnchor = (key: keyof Theme['anchors'], hex: string) =>
    setDraft((d) => (d ? { ...d, anchors: { ...d.anchors, [key]: hex } } : d))

  // ── Import / export view ───────────────────────────────────────────────────
  if (io) {
    return (
      <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setIo(null)}>
        <div className="modal" style={{ maxWidth: 480 }} role="dialog" aria-modal="true">
          <div className="modal-hd"><h3>{io.mode === 'export' ? 'Export theme' : 'Import theme'}</h3></div>
          <div className="modal-body">
            <textarea
              className="thm-io"
              readOnly={io.mode === 'export'}
              placeholder='Paste theme JSON…'
              value={io.text}
              onChange={(e) => io.mode === 'import' && setIo({ mode: 'import', text: e.target.value })}
            />
            {io.mode === 'import' && io.error && <div className="beat-err">{io.error}</div>}
          </div>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => setIo(null)}>Back</button>
            <span className="tb-spacer" />
            {io.mode === 'export'
              ? <button className="btn primary" onClick={() => { void navigator.clipboard?.writeText(io.text); onClose() }}>Copy</button>
              : <button className="btn primary" onClick={() => {
                  const r = importTheme(io.text)
                  if ('error' in r) { setIo({ mode: 'import', text: io.text, error: r.error }); return }
                  saveCustomTheme(r); originalId.current = r.id; setIo(null)
                }}>Import</button>}
          </div>
        </div>
      </div>
    )
  }

  // ── Editor view ─────────────────────────────────────────────────────────────
  if (draft) {
    return (
      <div className="modal-bg">
        <div className="modal" style={{ maxWidth: 460 }} role="dialog" aria-modal="true">
          <div className="modal-hd"><h3>Customize theme</h3><span className="sub">changes preview live</span></div>
          <div className="modal-body">
            <div className="field">
              <label>Name</label>
              <input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Base (drives status colours, shadows)</label>
              <div className="seg" style={{ gap: 2 }}>
                {(['dark', 'light'] as ThemeBase[]).map((b) => (
                  <button key={b} className={draft.base === b ? 'on' : ''} onClick={() => setDraft({ ...draft, base: b })}>
                    {b === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>
            <div className="thm-pickers">
              {ANCHOR_LABELS.map(({ key, label }) => (
                <label key={key} className="thm-picker">
                  <input type="color" value={toHex(draft.anchors[key])} onChange={(e) => setAnchor(key, e.target.value)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn ghost" onClick={cancelEdit}>Cancel</button>
            <span className="tb-spacer" />
            <button className="btn primary" onClick={saveEdit}>Save theme</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Gallery view ────────────────────────────────────────────────────────────
  const active = BUILTIN_THEMES.find((t) => t.id === themeId) ?? customThemes.find((t) => t.id === themeId)
  const card = (t: Theme) => (
    <div key={t.id} className={`thm-card${t.id === themeId ? ' on' : ''}`}>
      <button className="thm-apply" onClick={() => { setThemeId(t.id); originalId.current = t.id }} title={`Use ${t.name}`}>
        <Swatch theme={t} />
        <span className="thm-name">{t.name}{t.id === themeId && <Icon name="check" size={12} style={{ marginLeft: 5, verticalAlign: '-1px' }} />}</span>
        <span className="thm-base">{t.base}</span>
      </button>
      <div className="thm-actions">
        {!t.builtin && <button title="Edit" aria-label="Edit" onClick={() => startEdit(t, false)}><Icon name="edit" size={13} /></button>}
        <button title="Duplicate & edit" aria-label="Duplicate" onClick={() => startEdit(t, true)}><Icon name="copy" size={13} /></button>
        <button title="Export" aria-label="Export" onClick={() => setIo({ mode: 'export', text: exportTheme(t) })}><Icon name="download" size={13} /></button>
        {!t.builtin && <button title="Delete" aria-label="Delete" className="thm-del" onClick={() => deleteCustomTheme(t.id)}><Icon name="trash" size={13} /></button>}
      </div>
    </div>
  )

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-label="Themes">
        <div className="modal-hd"><h3>Themes</h3><span className="sub">pick a skin, or make your own</span></div>
        <div className="modal-body">
          <div className="thm-sec">Built-in</div>
          <div className="thm-grid">{BUILTIN_THEMES.map(card)}</div>
          {customThemes.length > 0 && <>
            <div className="thm-sec">Yours</div>
            <div className="thm-grid">{customThemes.map(card)}</div>
          </>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => startEdit(active ?? BUILTIN_THEMES[0], true)}>
            <Icon name="plus" size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />New theme
          </button>
          <button className="btn ghost" onClick={() => setIo({ mode: 'import', text: '' })}>Import…</button>
          <span className="tb-spacer" />
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
