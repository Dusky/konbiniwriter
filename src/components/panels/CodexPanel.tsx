import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { backlinksFor } from '../../lib/MentionIndex'
import { debtService } from '../../lib/DebtService'
import { promptRegistry } from '../../lib/PromptRegistry'
import { streamCompletion } from '../../lib/AIClient'
import { uid } from '@shared/utils'
import Icon from '../common/Icon'
import ConfirmDialog from '../common/ConfirmDialog'
import type { CodexEntry, CodexCategory, CodexFact, ID } from '@shared/types'

interface ScanEntry {
  id: string
  name: string
  category: CodexCategory
  aliases: string[]
  summary: string
  facts: Array<{ label: string; value: string }>
  added: boolean
}

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

export default function CodexPanel(): React.ReactElement {
  const codex = useProjectStore((s) => s.codex)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const deleteCodexEntry = useProjectStore((s) => s.deleteCodexEntry)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const project = useProjectStore((s) => s.project)
  const selectNode = useProjectStore((s) => s.selectNode)
  const raiseDebt = useProjectStore((s) => s.raiseDebt)
  const aiEnabled = useAIStore((s) => s.enabled)

  const [category, setCategory] = useState<CodexCategory>('character')
  const [selected, setSelected] = useState<CodexEntry | null>(null)
  const [aliasDraft, setAliasDraft] = useState('')
  // Value of a fact when the user focused it, so a real change can raise debt.
  const factEditRef = useRef<{ factId: ID; original: string } | null>(null)

  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<ScanEntry[]>([])
  const [scanDone, setScanDone] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [showScan, setShowScan] = useState(false)
  const [selectedScan, setSelectedScan] = useState<ScanEntry | null>(null)
  const scanAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { scanAbortRef.current?.abort() }, [])

  const handleScan = async () => {
    if (!project || scanning) return
    setScanning(true); setScanError(null); setScanResults([]); setScanDone(false)
    let samples = ''
    for (const id of Object.keys(project.docs)) {
      const node = project.nodes[id]
      if (!node || node.type === 'folder' || !node.meta.includeInCompile) continue
      const c = (project.docs[id]?.content ?? '').trim()
      if (c) { samples += c + '\n\n'; if (samples.length > 8000) break }
    }
    samples = samples.slice(0, 8000)
    if (!samples.trim()) { setScanError('No compiled prose found — write some chapters first.'); setScanning(false); return }

    const existing = codex.map((e) => e.name).join(', ') || 'none'
    const template = promptRegistry.get('builtin:codex:scan')
    if (!template) { setScanError('Scan prompt not found.'); setScanning(false); return }
    const rendered = promptRegistry.render('builtin:codex:scan', { content: samples, existing })
    const controller = new AbortController()
    scanAbortRef.current = controller
    let full = ''
    await streamCompletion(
      [{ role: 'user', content: rendered }],
      { model: template.model, maxTokens: template.maxTokens, temperature: template.temperature, signal: controller.signal },
      {
        onChunk: (c) => { full += c },
        onDone: (result) => {
          try {
            const raw = result.match(/\[[\s\S]*\]/)?.[0] ?? '[]'
            const parsed = JSON.parse(raw) as Array<{ name?: string; category?: string; aliases?: string[]; summary?: string; facts?: Array<{ label?: string; value?: string }> }>
            const validCategories = new Set(['character', 'location', 'item', 'concept', 'lore'])
            const existingNames = new Set(codex.map((e) => e.name.toLowerCase()))
            const entries: ScanEntry[] = parsed
              .filter((e) => e.name?.trim() && !existingNames.has((e.name ?? '').toLowerCase()))
              .map((e) => ({
                id: uid(),
                name: e.name!.trim(),
                category: (validCategories.has(e.category ?? '') ? e.category : 'character') as CodexCategory,
                aliases: (e.aliases ?? []).filter((a): a is string => typeof a === 'string'),
                summary: e.summary ?? '',
                facts: (e.facts ?? []).filter((f) => f.label?.trim() && f.value?.trim()).map((f) => ({ label: f.label!, value: f.value! })),
                added: false,
              }))
            setScanResults(entries)
            if (entries.length > 0) { setShowScan(true); setSelectedScan(entries[0]) }
          } catch { setScanError('Could not parse scan results.') }
          setScanning(false); setScanDone(true)
        },
        onError: (err) => { if ((err as Error).name !== 'AbortError') setScanError((err as Error).message); setScanning(false) },
      },
    ).catch((err) => { if ((err as Error).name !== 'AbortError') setScanError((err as Error).message); setScanning(false) })
  }

  const handleAddScanEntry = (entry: ScanEntry) => {
    const now = new Date().toISOString()
    upsertCodexEntry({
      id: uid(), name: entry.name, aliases: entry.aliases,
      category: entry.category, summary: entry.summary,
      facts: entry.facts.map((f) => ({ id: uid(), label: f.label, value: f.value, aiGenerated: true, confirmedAt: null })),
      createdAt: now, modifiedAt: now, aiGenerated: true,
    })
    setScanResults((prev) => prev.map((e) => e.id === entry.id ? { ...e, added: true } : e))
    if (selectedScan?.id === entry.id) {
      const next = scanResults.find((e) => e.id !== entry.id && !e.added)
      setSelectedScan(next ?? null)
    }
  }

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

  const [confirmDelete, setConfirmDelete] = useState<ID | null>(null)

  const handleDelete = (id: ID) => {
    deleteCodexEntry(id)
    if (selected?.id === id) setSelected(null)
    setConfirmDelete(null)
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

  const listRowStyle = (active: boolean, dim = false): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left', border: 'none',
    padding: '7px 14px', cursor: 'pointer',
    background: active ? 'var(--sel-bg)' : 'transparent',
    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    opacity: dim ? 0.4 : 1,
  })

  return (
    <div className="dock-panel">
      <div className="dock-hd">
        <h3 style={{ flex: 1 }}>Codex</h3>
        {aiEnabled && (
          <button className="btn sm" disabled={scanning || !project} onClick={handleScan}
            title="Scan manuscript prose for new codex entries">
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="seg" style={{ gap: 2, flexWrap: 'wrap', padding: '8px 10px', borderBottom: '0.5px solid var(--border)' }}>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={!showScan && category === c.id ? 'on' : ''} onClick={() => { setShowScan(false); setCategory(c.id) }}>
            {c.icon} {c.label}
          </button>
        ))}
        {scanDone && scanResults.length > 0 && (
          <button className={showScan ? 'on' : ''} onClick={() => { setShowScan(true); if (!selectedScan && scanResults.length > 0) setSelectedScan(scanResults[0]) }}>
            <Icon name="sparkle" size={12} /> Scan ({scanResults.filter((e) => !e.added).length})
          </button>
        )}
      </div>

      {showScan ? (
        <>
          {/* Scan results list */}
          <div style={{ flex: '0 0 38%', overflowY: 'auto', borderBottom: '0.5px solid var(--border)', padding: '4px 0' }}>
            {scanResults.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '24px 16px' }}>No new entries found.</div>
            )}
            {scanResults.map((e) => (
              <button key={e.id} onClick={() => setSelectedScan(e)} style={listRowStyle(selectedScan?.id === e.id, e.added)}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{e.added ? '✓ ' : ''}{e.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{e.category}</div>
              </button>
            ))}
          </div>
          {/* Scan detail */}
          <div className="dock-body" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {selectedScan ? (
              <>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                    {selectedScan.category} {selectedScan.aliases.length > 0 && `· aka ${selectedScan.aliases.join(', ')}`}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{selectedScan.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{selectedScan.summary}</div>
                </div>
                {selectedScan.facts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selectedScan.facts.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        <span style={{ color: 'var(--text-3)' }}>{f.label}:</span> {f.value}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
                  {selectedScan.added ? (
                    <span style={{ fontSize: 12, color: 'var(--success)' }}>Added to codex ✓</span>
                  ) : (
                    <>
                      <button className="btn sm" style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }} onClick={() => handleAddScanEntry(selectedScan)}>
                        Add to Codex
                      </button>
                      <button className="btn sm" onClick={() => setScanResults((prev) => prev.filter((e) => e.id !== selectedScan.id))}>
                        Skip
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Select an entry to review</div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Entry list */}
          <div style={{ flex: '0 0 38%', display: 'flex', flexDirection: 'column', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {filtered.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '24px 16px' }}>
                  No {category}s yet
                </div>
              )}
              {filtered.map((e) => (
                <button key={e.id} onClick={() => setSelected({ ...e })} style={listRowStyle(selected?.id === e.id)}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{e.name || '(unnamed)'}</div>
                  {e.aliases.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>aka {e.aliases.join(', ')}</div>
                  )}
                </button>
              ))}
            </div>
            <div style={{ padding: 8, borderTop: '0.5px solid var(--border)' }}>
              <button className="btn sm" onClick={handleNew} style={{ width: '100%' }}>+ New {category}</button>
            </div>
          </div>

          {/* Detail */}
          {selected ? (
            <div className="dock-body" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Name</label>
                <input
                  value={selected.name}
                  onChange={(e) => handleField('name', e.target.value)}
                  placeholder={`${category} name…`}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 15, fontWeight: 600 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                  Aliases <span style={{ opacity: 0.6 }}>— also matched in [[wikilinks]]</span>
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
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                  />
                  <button className="btn sm" onClick={handleAddAlias}>Add</button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Summary</label>
                <textarea
                  value={selected.summary}
                  onChange={(e) => handleField('summary', e.target.value)}
                  rows={4}
                  placeholder="Overview of this entry…"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', flex: 1 }}>Facts</label>
                  <button className="btn sm" onClick={handleAddFact}>+ Add fact</button>
                </div>
                {selected.facts.map((fact) => (
                  <div key={fact.id} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                    <input
                      value={fact.label}
                      onChange={(e) => handleFactChange(fact.id, { label: e.target.value })}
                      placeholder="Label"
                      style={{ flex: '0 0 96px', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                    />
                    <input
                      value={fact.value}
                      onChange={(e) => handleFactChange(fact.id, { value: e.target.value })}
                      onFocus={() => { factEditRef.current = { factId: fact.id, original: fact.value } }}
                      onBlur={() => handleFactBlur(fact)}
                      placeholder="Value"
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                    />
                    <button onClick={() => handleDeleteFact(fact.id)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 16, padding: '4px 2px' }}>×</button>
                  </div>
                ))}
              </div>

              {backlinks.length > 0 && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                    Referenced in {backlinks.length} document{backlinks.length !== 1 ? 's' : ''}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {backlinks.map((node) => node && (
                      <button
                        key={node.id}
                        onClick={() => selectNode(node.id)}
                        style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' }}
                      >
                        {node.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 8 }}>
                {scanError && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{scanError}</span>}
                <span className="tb-spacer" />
                <button className="btn sm" onClick={() => setConfirmDelete(selected.id)} style={{ color: 'var(--danger)' }}>
                  Delete entry
                </button>
              </div>
            </div>
          ) : (
            <div className="dock-body" style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>
              {scanError ? <span style={{ color: 'var(--danger)' }}>{scanError}</span> : 'Select or create an entry.'}
            </div>
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Entry"
          message={`"${codex.find((e) => e.id === confirmDelete)?.name ?? 'This entry'}" and all its facts will be removed from the codex. This cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
