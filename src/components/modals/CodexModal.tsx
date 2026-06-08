import React, { useState, useMemo, useRef } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { backlinksFor } from '../../lib/MentionIndex'
import { debtService } from '../../lib/DebtService'
import { uid } from '@shared/utils'
import type { CodexEntry, CodexCategory, CodexFact, ID } from '@shared/types'

const CATEGORIES: { id: CodexCategory; label: string; icon: string }[] = [
  { id: 'character', label: 'Characters', icon: '◉' },
  { id: 'location',  label: 'Locations',  icon: '◎' },
  { id: 'item',      label: 'Items',      icon: '◈' },
  { id: 'concept',   label: 'Concepts',   icon: '◇' },
  { id: 'lore',      label: 'Lore',       icon: '◆' },
]

function newEntry(category: CodexCategory): CodexEntry {
  return {
    id: uid(),
    name: '',
    aliases: [],
    category,
    summary: '',
    facts: [],
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    aiGenerated: false,
  }
}

interface Props { onClose: () => void }

export default function CodexModal({ onClose }: Props): React.ReactElement {
  const codex = useProjectStore((s) => s.codex)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const deleteCodexEntry = useProjectStore((s) => s.deleteCodexEntry)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const project = useProjectStore((s) => s.project)
  const selectNode = useProjectStore((s) => s.selectNode)
  const raiseDebt = useProjectStore((s) => s.raiseDebt)

  const [category, setCategory] = useState<CodexCategory>('character')
  const [selected, setSelected] = useState<CodexEntry | null>(null)
  const [aliasDraft, setAliasDraft] = useState('')
  // Value of a fact when the user focused it, so a real change can raise debt.
  const factEditRef = useRef<{ factId: ID; original: string } | null>(null)

  const filtered = useMemo(() =>
    codex.filter((e) => e.category === category).sort((a, b) => a.name.localeCompare(b.name)),
    [codex, category]
  )

  const handleNew = () => {
    const entry = newEntry(category)
    upsertCodexEntry(entry)
    setSelected({ ...entry })
  }

  const handleField = <K extends keyof CodexEntry>(field: K, value: CodexEntry[K]) => {
    if (!selected) return
    const updated: CodexEntry = { ...selected, [field]: value, modifiedAt: new Date().toISOString() }
    setSelected(updated)
    upsertCodexEntry(updated)
  }

  const handleAddFact = () => {
    if (!selected) return
    const fact: CodexFact = { id: uid(), label: '', value: '', aiGenerated: false, confirmedAt: null }
    handleField('facts', [...selected.facts, fact])
  }

  const handleFactChange = (factId: ID, patch: Partial<CodexFact>) => {
    if (!selected) return
    handleField('facts', selected.facts.map((f) => f.id === factId ? { ...f, ...patch } : f))
  }

  const handleDeleteFact = (factId: ID) => {
    if (!selected) return
    handleField('facts', selected.facts.filter((f) => f.id !== factId))
  }

  // When a fact value is changed (not first-filled), flag scenes that reference
  // this entity as potentially stale — propagation debt.
  const handleFactBlur = (fact: CodexFact) => {
    const edit = factEditRef.current
    factEditRef.current = null
    if (!edit || edit.factId !== fact.id) return
    const oldValue = edit.original
    if (!oldValue.trim() || oldValue === fact.value || !selected || !project) return
    const item = debtService.fromFactChange({
      project, mentionIndex, entity: selected,
      factLabel: fact.label, oldValue, newValue: fact.value,
    })
    if (item) raiseDebt(item)
  }

  const handleAddAlias = () => {
    if (!selected || !aliasDraft.trim()) return
    const alias = aliasDraft.trim().toLowerCase()
    if (!selected.aliases.includes(alias)) {
      handleField('aliases', [...selected.aliases, alias])
    }
    setAliasDraft('')
  }

  const handleDelete = (id: ID) => {
    deleteCodexEntry(id)
    if (selected?.id === id) setSelected(null)
  }

  const backlinks = useMemo(() => {
    if (!selected || !project) return []
    const aliases = [selected.name.toLowerCase(), ...selected.aliases]
    const docIds = new Set<ID>()
    for (const alias of aliases) {
      for (const id of backlinksFor(mentionIndex, alias)) docIds.add(id)
    }
    return [...docIds].map((id) => project.nodes[id]).filter(Boolean)
  }, [selected, mentionIndex, project])

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 920, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-modal="true" aria-label="Codex">
        <div className="modal-hd">
          <h3>Codex</h3>
          <span className="tb-spacer" />
          <div className="seg" style={{ gap: 2 }}>
            {CATEGORIES.map((c) => (
              <button key={c.id} className={category === c.id ? 'on' : ''} onClick={() => setCategory(c.id)}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr', overflow: 'hidden' }}>
          {/* List */}
          <div style={{ borderRight: '0.5px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {filtered.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '32px 16px' }}>
                  No {category}s yet
                </div>
              )}
              {filtered.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelected({ ...e })}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none',
                    padding: '8px 14px', cursor: 'pointer',
                    background: selected?.id === e.id ? 'var(--sel-bg)' : 'transparent',
                    borderLeft: selected?.id === e.id ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{e.name || '(unnamed)'}</div>
                  {e.aliases.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      aka {e.aliases.join(', ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div style={{ padding: '8px', borderTop: '0.5px solid var(--border)' }}>
              <button className="btn" onClick={handleNew} style={{ width: '100%' }}>
                + New {category}
              </button>
            </div>
          </div>

          {/* Detail */}
          {selected ? (
            <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Name</label>
                <input
                  value={selected.name}
                  onChange={(e) => handleField('name', e.target.value)}
                  placeholder={`${category} name…`}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 15, fontWeight: 600 }}
                />
              </div>

              {/* Aliases */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                  Aliases <span style={{ opacity: 0.6 }}>— also matched in binder [[wikilinks]]</span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {selected.aliases.map((a) => (
                    <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, background: 'var(--bg-3)', fontSize: 12, color: 'var(--text-2)' }}>
                      {a}
                      <button onClick={() => handleField('aliases', selected.aliases.filter((x) => x !== a))} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 0, fontSize: 12 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                    placeholder="Add alias…"
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12 }}
                  />
                  <button className="btn" onClick={handleAddAlias} style={{ fontSize: 11 }}>Add</button>
                </div>
              </div>

              {/* Summary */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Summary</label>
                <textarea
                  value={selected.summary}
                  onChange={(e) => handleField('summary', e.target.value)}
                  rows={4}
                  placeholder="Overview of this entry…"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
                />
              </div>

              {/* Facts */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', flex: 1 }}>Facts</label>
                  <button className="btn" onClick={handleAddFact} style={{ fontSize: 11 }}>+ Add fact</button>
                </div>
                {selected.facts.map((fact) => (
                  <div key={fact.id} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                    <input
                      value={fact.label}
                      onChange={(e) => handleFactChange(fact.id, { label: e.target.value })}
                      placeholder="Label"
                      style={{ flex: '0 0 120px', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12 }}
                    />
                    <input
                      value={fact.value}
                      onChange={(e) => handleFactChange(fact.id, { value: e.target.value })}
                      onFocus={() => { factEditRef.current = { factId: fact.id, original: fact.value } }}
                      onBlur={() => handleFactBlur(fact)}
                      placeholder="Value"
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12 }}
                    />
                    <button onClick={() => handleDeleteFact(fact.id)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 16, padding: '4px 2px' }}>×</button>
                  </div>
                ))}
              </div>

              {/* Backlinks */}
              {backlinks.length > 0 && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                    Referenced in {backlinks.length} document{backlinks.length !== 1 ? 's' : ''}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {backlinks.map((node) => node && (
                      <button
                        key={node.id}
                        onClick={() => { selectNode(node.id); onClose() }}
                        style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' }}
                      >
                        {node.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 8 }}>
                <button className="btn" onClick={() => handleDelete(selected.id)} style={{ fontSize: 11, color: 'oklch(0.65 0.15 20)' }}>
                  Delete entry
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Select or create an entry
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{codex.length} entr{codex.length !== 1 ? 'ies' : 'y'}</span>
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
