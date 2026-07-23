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

  const rowClass = (active: boolean, dim = false) =>
    `cdx-row${active ? ' on' : ''}${dim ? ' dim' : ''}`

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
      <div className="seg cdx-cats">
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
          <div className="cdx-scan-list">
            {scanResults.length === 0 && (
              <div className="cdx-empty">No new entries found.</div>
            )}
            {scanResults.map((e) => (
              <button key={e.id} onClick={() => setSelectedScan(e)} className={rowClass(selectedScan?.id === e.id, e.added)}>
                <div className="cdx-row-name">{e.added ? '✓ ' : ''}{e.name}</div>
                <div className="cdx-row-sub">{e.category}</div>
              </button>
            ))}
          </div>
          {/* Scan detail */}
          <div className="dock-body cdx-detail">
            {selectedScan ? (
              <>
                <div>
                  <div className="cdx-row-sub" style={{ marginTop: 0, marginBottom: 4 }}>
                    {selectedScan.category} {selectedScan.aliases.length > 0 && `· aka ${selectedScan.aliases.join(', ')}`}
                  </div>
                  <div className="cdx-scan-name">{selectedScan.name}</div>
                  <div style={{ fontSize: 'var(--t-base)', color: 'var(--text-2)', lineHeight: 1.55 }}>{selectedScan.summary}</div>
                </div>
                {selectedScan.facts.length > 0 && (
                  <div className="cdx-scan-facts">
                    {selectedScan.facts.map((f, i) => (
                      <div key={i} className="cdx-scan-fact">
                        <span className="k">{f.label}:</span> {f.value}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
                  {selectedScan.added ? (
                    <span style={{ fontSize: 'var(--t-sm)', color: 'var(--success)' }}>Added to codex ✓</span>
                  ) : (
                    <>
                      <button className="btn sm primary" onClick={() => handleAddScanEntry(selectedScan)}>
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
              <div style={{ color: 'var(--text-3)', fontSize: 'var(--t-base)' }}>Select an entry to review</div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Entry list */}
          <div className="cdx-list">
            <div className="cdx-list-scroll">
              {filtered.length === 0 && (
                <div className="cdx-empty">No {category}s yet</div>
              )}
              {filtered.map((e) => (
                <button key={e.id} onClick={() => setSelected({ ...e })} className={rowClass(selected?.id === e.id)}>
                  <div className="cdx-row-name">{e.name || '(unnamed)'}</div>
                  {e.aliases.length > 0 && (
                    <div className="cdx-row-sub">aka {e.aliases.join(', ')}</div>
                  )}
                </button>
              ))}
            </div>
            <div className="cdx-list-foot">
              <button className="btn sm" onClick={handleNew} style={{ width: '100%' }}>+ New {category}</button>
            </div>
          </div>

          {/* Detail */}
          {selected ? (
            <div className="dock-body cdx-detail">
              <div>
                <label>Name</label>
                <input
                  className="inp lg"
                  value={selected.name}
                  onChange={(e) => handleField('name', e.target.value)}
                  placeholder={`${category} name…`}
                />
              </div>

              <div>
                <label>
                  Aliases <span className="muted">— also matched in [[wikilinks]]</span>
                </label>
                <div className="cdx-chips">
                  {selected.aliases.map((a) => (
                    <span key={a} className="cdx-chip">
                      {a}
                      <button onClick={() => handleField('aliases', selected.aliases.filter((x) => x !== a))}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                  <input
                    className="inp"
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                    placeholder="Add alias…"
                  />
                  <button className="btn sm" onClick={handleAddAlias}>Add</button>
                </div>
              </div>

              <div>
                <label>Summary</label>
                <textarea
                  className="ta"
                  value={selected.summary}
                  onChange={(e) => handleField('summary', e.target.value)}
                  rows={4}
                  placeholder="Overview of this entry…"
                />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--s2)' }}>
                  <label style={{ flex: 1, marginBottom: 0 }}>Facts</label>
                  <button className="btn sm" onClick={handleAddFact}>+ Add fact</button>
                </div>
                {selected.facts.map((fact) => (
                  <div key={fact.id} className="cdx-fact">
                    <input
                      className="inp k"
                      value={fact.label}
                      onChange={(e) => handleFactChange(fact.id, { label: e.target.value })}
                      placeholder="Label"
                    />
                    <input
                      className="inp"
                      value={fact.value}
                      onChange={(e) => handleFactChange(fact.id, { value: e.target.value })}
                      onFocus={() => { factEditRef.current = { factId: fact.id, original: fact.value } }}
                      onBlur={() => handleFactBlur(fact)}
                      placeholder="Value"
                    />
                    <button className="cdx-fact-del" onClick={() => handleDeleteFact(fact.id)}>×</button>
                  </div>
                ))}
              </div>

              {backlinks.length > 0 && (
                <div>
                  <label>
                    Referenced in {backlinks.length} document{backlinks.length !== 1 ? 's' : ''}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
                    {backlinks.map((node) => node && (
                      <button key={node.id} className="cdx-linkbtn" onClick={() => selectNode(node.id)}>
                        {node.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="cdx-detail-foot">
                {scanError && <span style={{ fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>{scanError}</span>}
                <span className="tb-spacer" />
                <button className="btn sm" onClick={() => setConfirmDelete(selected.id)} style={{ color: 'var(--danger)' }}>
                  Delete entry
                </button>
              </div>
            </div>
          ) : (
            <div className="dock-body" style={{ padding: 'var(--s4)', color: 'var(--text-3)', fontSize: 'var(--t-base)' }}>
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
