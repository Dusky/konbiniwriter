import React, { useState, useEffect } from 'react'
import type { PromptTemplate, PromptFeature } from '@shared/types'
import { promptRegistry } from '../../lib/PromptRegistry'
import { useShellStore } from '../../store/shellStore'

const FEATURES: { id: PromptFeature | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inline', label: 'Inline' },
  { id: 'chat', label: 'Chat' },
  { id: 'evaluation', label: 'Evaluation' },
  { id: 'batch', label: 'Batch' },
  { id: 'autopilot', label: 'Autopilot' },
]

interface EditorState { prompt: PromptTemplate; dirty: boolean }

interface Props { onClose: () => void }

export default function PromptRegistryModal({ onClose }: Props): React.ReactElement {
  const [filter, setFilter] = useState<PromptFeature | 'all'>('all')
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [selected, setSelected] = useState<EditorState | null>(null)
  const [saved, setSaved] = useState(false)

  const reload = () => {
    const list = filter === 'all' ? promptRegistry.all() : promptRegistry.all(filter)
    setPrompts(list)
  }

  useEffect(reload, [filter])

  const selectPrompt = (p: PromptTemplate) => setSelected({ prompt: { ...p }, dirty: false })

  const handleChange = (field: keyof PromptTemplate, value: unknown) => {
    if (!selected) return
    setSelected({ prompt: { ...selected.prompt, [field]: value }, dirty: true })
    setSaved(false)
  }

  const handleSave = () => {
    if (!selected) return
    promptRegistry.save(selected.prompt)
    setSelected({ ...selected, dirty: false })
    setSaved(true)
    reload()
    setTimeout(() => setSaved(false), 1500)
  }

  const handleReset = (id: string) => {
    promptRegistry.reset(id)
    reload()
    if (selected?.prompt.id === id) {
      const fresh = promptRegistry.get(id)
      if (fresh) setSelected({ prompt: fresh, dirty: false })
    }
  }

  const handleDuplicate = (id: string) => {
    const copy = promptRegistry.duplicate(id)
    if (copy) { reload(); selectPrompt(copy) }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-hd">
          <h3>Prompt Registry</h3>
          <span className="tb-spacer" />
          <div className="seg" style={{ gap: 2 }}>
            {FEATURES.map((f) => (
              <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id as PromptFeature | 'all')}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', overflow: 'hidden' }}>
          {/* List */}
          <div style={{ borderRight: '0.5px solid var(--border)', overflowY: 'auto', padding: '6px 0' }}>
            {prompts.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPrompt(p)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 14px', border: 'none', cursor: 'pointer',
                  background: selected?.prompt.id === p.id ? 'var(--sel-bg)' : 'transparent',
                  borderLeft: selected?.prompt.id === p.id ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {p.feature}{p.isBuiltin ? '' : ' · custom'}
                </div>
              </button>
            ))}
          </div>

          {/* Editor */}
          {selected ? (
            <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Name</label>
                <input
                  value={selected.prompt.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  style={{ width: '100%', padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Description</label>
                <input
                  value={selected.prompt.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  style={{ width: '100%', padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Model</label>
                  <input
                    value={selected.prompt.model}
                    onChange={(e) => handleChange('model', e.target.value)}
                    style={{ width: '100%', padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Temperature</label>
                  <input
                    type="number" min={0} max={1} step={0.05}
                    value={selected.prompt.temperature}
                    onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                    style={{ width: '100%', padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Max Tokens</label>
                  <input
                    type="number"
                    value={selected.prompt.maxTokens ?? ''}
                    onChange={(e) => handleChange('maxTokens', parseInt(e.target.value) || undefined)}
                    style={{ width: '100%', padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12 }}
                  />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  Template <span style={{ opacity: 0.6 }}>— use {'{{variable}}'} syntax</span>
                </label>
                <textarea
                  value={selected.prompt.template}
                  onChange={(e) => handleChange('template', e.target.value)}
                  rows={14}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.5, resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {selected.prompt.isBuiltin && (
                  <button className="btn" onClick={() => handleReset(selected.prompt.id)} style={{ fontSize: 11 }}>
                    Reset to default
                  </button>
                )}
                <button className="btn" onClick={() => handleDuplicate(selected.prompt.id)} style={{ fontSize: 11 }}>
                  Duplicate
                </button>
                <span className="tb-spacer" />
                {saved && <span style={{ fontSize: 11, color: 'oklch(0.68 0.14 150)' }}>Saved</span>}
                <button
                  className="btn"
                  onClick={handleSave}
                  disabled={!selected.dirty}
                  style={{ background: selected.dirty ? 'var(--accent)' : undefined, color: selected.dirty ? 'var(--accent-fg)' : undefined, borderColor: selected.dirty ? 'transparent' : undefined }}
                >
                  Save changes
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Select a prompt to edit
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
