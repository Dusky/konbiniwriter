import React, { useState, useEffect } from 'react'
import type { PromptTemplate, PromptFeature, AgentTemplate, AgentCategory } from '@shared/types'
import { promptRegistry, agentRegistry } from '../../lib/PromptRegistry'
import { uid } from '@shared/utils'

const FEATURES: { id: PromptFeature | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inline', label: 'Inline' },
  { id: 'chat', label: 'Chat' },
  { id: 'evaluation', label: 'Evaluation' },
  { id: 'batch', label: 'Batch' },
  { id: 'autopilot', label: 'Autopilot' },
]

const AGENT_CATEGORIES: AgentCategory[] = ['reader', 'critic', 'judge', 'codex', 'autopilot']

const inputStyle: React.CSSProperties = { width: '100%', padding: '6px 9px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }
const monoStyle: React.CSSProperties = { ...inputStyle, fontSize: 12, fontFamily: 'var(--mono)' }
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }

interface EditorState { prompt: PromptTemplate; dirty: boolean }
interface AgentEditorState { agent: AgentTemplate; dirty: boolean }

interface Props { onClose: () => void }

export default function PromptRegistryModal({ onClose }: Props): React.ReactElement {
  const [tab, setTab] = useState<'prompts' | 'agents'>('prompts')
  const [saved, setSaved] = useState(false)

  // — prompts —
  const [filter, setFilter] = useState<PromptFeature | 'all'>('all')
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [selected, setSelected] = useState<EditorState | null>(null)

  const reload = () => setPrompts(filter === 'all' ? promptRegistry.all() : promptRegistry.all(filter))
  useEffect(reload, [filter])

  const selectPrompt = (p: PromptTemplate) => setSelected({ prompt: { ...p }, dirty: false })
  const handleChange = (field: keyof PromptTemplate, value: unknown) => {
    if (!selected) return
    setSelected({ prompt: { ...selected.prompt, [field]: value }, dirty: true }); setSaved(false)
  }
  const handleSave = () => {
    if (!selected) return
    promptRegistry.save(selected.prompt); setSelected({ ...selected, dirty: false }); setSaved(true); reload(); setTimeout(() => setSaved(false), 1500)
  }
  const handleReset = (id: string) => {
    promptRegistry.reset(id); reload()
    if (selected?.prompt.id === id) { const fresh = promptRegistry.get(id); if (fresh) setSelected({ prompt: fresh, dirty: false }) }
  }
  const handleDuplicate = (id: string) => { const copy = promptRegistry.duplicate(id); if (copy) { reload(); selectPrompt(copy) } }

  // — agents —
  const [agents, setAgents] = useState<AgentTemplate[]>([])
  const [selAgent, setSelAgent] = useState<AgentEditorState | null>(null)
  const allPrompts = promptRegistry.all()

  const reloadAgents = () => setAgents(agentRegistry.all())
  useEffect(() => { if (tab === 'agents') reloadAgents() }, [tab])

  const selectAgent = (a: AgentTemplate) => setSelAgent({ agent: { ...a, parameters: { ...a.parameters } }, dirty: false })
  const changeAgent = (field: keyof AgentTemplate, value: unknown) => {
    if (!selAgent) return
    setSelAgent({ agent: { ...selAgent.agent, [field]: value }, dirty: true }); setSaved(false)
  }
  const changeParam = (key: string, value: unknown) => {
    if (!selAgent) return
    setSelAgent({ agent: { ...selAgent.agent, parameters: { ...selAgent.agent.parameters, [key]: value } }, dirty: true }); setSaved(false)
  }
  const saveAgent = () => {
    if (!selAgent) return
    agentRegistry.save(selAgent.agent); setSelAgent({ ...selAgent, dirty: false }); setSaved(true); reloadAgents(); setTimeout(() => setSaved(false), 1500)
  }
  const resetAgent = (id: string) => {
    agentRegistry.reset(id); reloadAgents(); const fresh = agentRegistry.get(id); if (fresh) setSelAgent({ agent: fresh, dirty: false })
  }
  const dupAgent = (id: string) => { const c = agentRegistry.duplicate(id); if (c) { reloadAgents(); selectAgent(c) } }
  const deleteAgent = (id: string) => { agentRegistry.delete(id); reloadAgents(); setSelAgent(null) }
  const newAgent = () => {
    const readerPrompt = allPrompts.find((p) => p.id.startsWith('builtin:reader:'))?.id ?? allPrompts[0]?.id ?? ''
    const now = new Date().toISOString()
    const a: AgentTemplate = {
      id: `user:${uid()}`, name: 'New Reader', description: '', category: 'reader',
      systemPromptId: readerPrompt, model: '', temperature: 0.8,
      parameters: { emoji: '🙂', maxTokens: 500 }, isBuiltin: false, createdAt: now, modifiedAt: now,
    }
    agentRegistry.save(a); reloadAgents(); selectAgent(a)
  }

  const sa = selAgent?.agent

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-modal="true" aria-label="Registry">
        <div className="modal-hd">
          <h3>Registry</h3>
          <div className="seg" style={{ gap: 2, marginLeft: 12 }}>
            <button className={tab === 'prompts' ? 'on' : ''} onClick={() => setTab('prompts')}>Prompts</button>
            <button className={tab === 'agents' ? 'on' : ''} onClick={() => setTab('agents')}>Agents</button>
          </div>
          <span className="tb-spacer" />
          {tab === 'prompts' && (
            <div className="seg" style={{ gap: 2 }}>
              {FEATURES.map((f) => (
                <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id as PromptFeature | 'all')}>{f.label}</button>
              ))}
            </div>
          )}
          {tab === 'agents' && <button className="btn" onClick={newAgent} style={{ fontSize: 12 }}>+ New agent</button>}
        </div>

        {tab === 'prompts' ? (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', overflow: 'hidden' }}>
            <div style={{ borderRight: '0.5px solid var(--border)', overflowY: 'auto', padding: '6px 0' }}>
              {prompts.map((p) => (
                <button key={p.id} onClick={() => selectPrompt(p)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', cursor: 'pointer', background: selected?.prompt.id === p.id ? 'var(--sel-bg)' : 'transparent', borderLeft: selected?.prompt.id === p.id ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{p.feature}{p.isBuiltin ? '' : ' · custom'}</div>
                </button>
              ))}
            </div>
            {selected ? (
              <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><label style={labelStyle}>Name</label><input value={selected.prompt.name} onChange={(e) => handleChange('name', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Description</label><input value={selected.prompt.description} onChange={(e) => handleChange('description', e.target.value)} style={inputStyle} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div><label style={labelStyle}>Model</label><input value={selected.prompt.model} onChange={(e) => handleChange('model', e.target.value)} style={monoStyle} /></div>
                  <div><label style={labelStyle}>Temperature</label><input type="number" min={0} max={1} step={0.05} value={selected.prompt.temperature} onChange={(e) => handleChange('temperature', parseFloat(e.target.value))} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Max Tokens</label><input type="number" value={selected.prompt.maxTokens ?? ''} onChange={(e) => handleChange('maxTokens', parseInt(e.target.value) || undefined)} style={inputStyle} /></div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Template <span style={{ opacity: 0.6 }}>— use {'{{variable}}'} syntax</span></label>
                  <textarea value={selected.prompt.template} onChange={(e) => handleChange('template', e.target.value)} rows={14} style={{ ...monoStyle, lineHeight: 1.5, resize: 'vertical', padding: '8px 10px' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selected.prompt.isBuiltin && <button className="btn" onClick={() => handleReset(selected.prompt.id)} style={{ fontSize: 11 }}>Reset to default</button>}
                  <button className="btn" onClick={() => handleDuplicate(selected.prompt.id)} style={{ fontSize: 11 }}>Duplicate</button>
                  <span className="tb-spacer" />
                  {saved && <span style={{ fontSize: 11, color: 'var(--success)' }}>Saved</span>}
                  <button className="btn" onClick={handleSave} disabled={!selected.dirty} style={{ background: selected.dirty ? 'var(--accent)' : undefined, color: selected.dirty ? 'var(--accent-fg)' : undefined, borderColor: selected.dirty ? 'transparent' : undefined }}>Save changes</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>Select a prompt to edit</div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', overflow: 'hidden' }}>
            <div style={{ borderRight: '0.5px solid var(--border)', overflowY: 'auto', padding: '6px 0' }}>
              {agents.map((a) => (
                <button key={a.id} onClick={() => selectAgent(a)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', cursor: 'pointer', background: sa?.id === a.id ? 'var(--sel-bg)' : 'transparent', borderLeft: sa?.id === a.id ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{(a.parameters.emoji as string) ?? ''} {a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{a.category}{a.isBuiltin ? '' : ' · custom'}</div>
                </button>
              ))}
            </div>
            {sa ? (
              <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 10 }}>
                  <div><label style={labelStyle}>Name</label><input value={sa.name} onChange={(e) => changeAgent('name', e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Emoji</label><input value={(sa.parameters.emoji as string) ?? ''} onChange={(e) => changeParam('emoji', e.target.value)} style={{ ...inputStyle, textAlign: 'center' }} /></div>
                </div>
                <div><label style={labelStyle}>Description</label><input value={sa.description} onChange={(e) => changeAgent('description', e.target.value)} style={inputStyle} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Category</label>
                    <select value={sa.category} onChange={(e) => changeAgent('category', e.target.value as AgentCategory)} style={inputStyle}>
                      {AGENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>System prompt</label>
                    <select value={sa.systemPromptId} onChange={(e) => changeAgent('systemPromptId', e.target.value)} style={inputStyle}>
                      {allPrompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div><label style={labelStyle}>Model <span style={{ opacity: 0.6 }}>(blank = default)</span></label><input value={sa.model} placeholder="provider default" onChange={(e) => changeAgent('model', e.target.value)} style={monoStyle} /></div>
                  <div><label style={labelStyle}>Temperature</label><input type="number" min={0} max={2} step={0.05} value={sa.temperature} onChange={(e) => changeAgent('temperature', parseFloat(e.target.value) || 0)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Max Tokens</label><input type="number" value={(sa.parameters.maxTokens as number) ?? ''} onChange={(e) => changeParam('maxTokens', parseInt(e.target.value) || undefined)} style={inputStyle} /></div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  The system prompt holds this agent's instructions — edit it on the <strong>Prompts</strong> tab. Reader agents power the Reader Panel.
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {sa.isBuiltin
                    ? <button className="btn" onClick={() => resetAgent(sa.id)} style={{ fontSize: 11 }}>Reset to default</button>
                    : <button className="btn" onClick={() => deleteAgent(sa.id)} style={{ fontSize: 11, color: 'var(--st-idea)' }}>Delete</button>}
                  <button className="btn" onClick={() => dupAgent(sa.id)} style={{ fontSize: 11 }}>Duplicate</button>
                  <span className="tb-spacer" />
                  {saved && <span style={{ fontSize: 11, color: 'var(--success)' }}>Saved</span>}
                  <button className="btn" onClick={saveAgent} disabled={!selAgent.dirty} style={{ background: selAgent.dirty ? 'var(--accent)' : undefined, color: selAgent.dirty ? 'var(--accent-fg)' : undefined, borderColor: selAgent.dirty ? 'transparent' : undefined }}>Save changes</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>Select an agent to edit, or “+ New agent”.</div>
            )}
          </div>
        )}

        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
