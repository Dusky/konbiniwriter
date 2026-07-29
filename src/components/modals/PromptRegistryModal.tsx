import React, { useState, useEffect } from 'react'
import type { PromptTemplate, PromptFeature, AgentTemplate, AgentCategory } from '@shared/types'
import { promptRegistry, agentRegistry } from '../../lib/PromptRegistry'
import { uid } from '@shared/utils'
import ModalShell from '../common/ModalShell'

const FEATURES: { id: PromptFeature | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inline', label: 'Inline' },
  { id: 'chat', label: 'Chat' },
  { id: 'evaluation', label: 'Evaluation' },
  { id: 'batch', label: 'Batch' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'adventure', label: 'Adventure' },
]

const AGENT_CATEGORIES: AgentCategory[] = ['reader', 'critic', 'judge', 'codex', 'autopilot']

interface EditorState { prompt: PromptTemplate; dirty: boolean }
interface AgentEditorState { agent: AgentTemplate; dirty: boolean }

interface Props { onClose: () => void; embedded?: boolean }

export default function PromptRegistryModal({ onClose, embedded }: Props): React.ReactElement {
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
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={900} label="Registry">
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
          <div className="reg-split">
            <div className="reg-list">
              {prompts.map((p) => (
                <button key={p.id} onClick={() => selectPrompt(p)} className={`reg-row${selected?.prompt.id === p.id ? ' on' : ''}`}>
                  <div className="reg-row-name">{p.name}</div>
                  <div className="reg-row-sub">{p.feature}{p.isBuiltin ? '' : ' · custom'}</div>
                </button>
              ))}
            </div>
            {selected ? (
              <div className="reg-editor">
                <div><label className="reg-lbl">Name</label><input className="inp" value={selected.prompt.name} onChange={(e) => handleChange('name', e.target.value)} /></div>
                <div><label className="reg-lbl">Description</label><input className="inp" value={selected.prompt.description} onChange={(e) => handleChange('description', e.target.value)} /></div>
                <div className="reg-grid-3">
                  <div><label className="reg-lbl">Model</label><input className="inp mono" value={selected.prompt.model} onChange={(e) => handleChange('model', e.target.value)} /></div>
                  <div><label className="reg-lbl">Temperature</label><input className="inp" type="number" min={0} max={1} step={0.05} value={selected.prompt.temperature} onChange={(e) => handleChange('temperature', parseFloat(e.target.value))} /></div>
                  <div><label className="reg-lbl">Max Tokens</label><input className="inp" type="number" value={selected.prompt.maxTokens ?? ''} onChange={(e) => handleChange('maxTokens', parseInt(e.target.value) || undefined)} /></div>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="reg-lbl">Template <span className="muted">— use {'{{variable}}'} syntax</span></label>
                  <textarea className="ta mono" value={selected.prompt.template} onChange={(e) => handleChange('template', e.target.value)} rows={14} />
                </div>
                <div className="reg-actions">
                  {selected.prompt.isBuiltin && <button className="btn" onClick={() => handleReset(selected.prompt.id)}>Reset to default</button>}
                  <button className="btn" onClick={() => handleDuplicate(selected.prompt.id)}>Duplicate</button>
                  <span className="tb-spacer" />
                  {saved && <span className="hint" style={{ color: 'var(--success)' }}>Saved</span>}
                  <button className={`btn${selected.dirty ? ' primary' : ''}`} onClick={handleSave} disabled={!selected.dirty}>Save changes</button>
                </div>
              </div>
            ) : (
              <div className="reg-empty">Select a prompt to edit</div>
            )}
          </div>
        ) : (
          <div className="reg-split">
            <div className="reg-list">
              {agents.map((a) => (
                <button key={a.id} onClick={() => selectAgent(a)} className={`reg-row${sa?.id === a.id ? ' on' : ''}`}>
                  <div className="reg-row-name">{(a.parameters.emoji as string) ?? ''} {a.name}</div>
                  <div className="reg-row-sub">{a.category}{a.isBuiltin ? '' : ' · custom'}</div>
                </button>
              ))}
            </div>
            {sa ? (
              <div className="reg-editor">
                <div className="reg-grid-ne">
                  <div><label className="reg-lbl">Name</label><input className="inp" value={sa.name} onChange={(e) => changeAgent('name', e.target.value)} /></div>
                  <div><label className="reg-lbl">Emoji</label><input className="inp" style={{ textAlign: 'center' }} value={(sa.parameters.emoji as string) ?? ''} onChange={(e) => changeParam('emoji', e.target.value)} /></div>
                </div>
                <div><label className="reg-lbl">Description</label><input className="inp" value={sa.description} onChange={(e) => changeAgent('description', e.target.value)} /></div>
                <div className="reg-grid-2">
                  <div>
                    <label className="reg-lbl">Category</label>
                    <select className="sel" value={sa.category} onChange={(e) => changeAgent('category', e.target.value as AgentCategory)}>
                      {AGENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="reg-lbl">System prompt</label>
                    <select className="sel" value={sa.systemPromptId} onChange={(e) => changeAgent('systemPromptId', e.target.value)}>
                      {allPrompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="reg-grid-3">
                  <div><label className="reg-lbl">Model <span className="muted">(blank = default)</span></label><input className="inp mono" value={sa.model} placeholder="provider default" onChange={(e) => changeAgent('model', e.target.value)} /></div>
                  <div><label className="reg-lbl">Temperature</label><input className="inp" type="number" min={0} max={2} step={0.05} value={sa.temperature} onChange={(e) => changeAgent('temperature', parseFloat(e.target.value) || 0)} /></div>
                  <div><label className="reg-lbl">Max Tokens</label><input className="inp" type="number" value={(sa.parameters.maxTokens as number) ?? ''} onChange={(e) => changeParam('maxTokens', parseInt(e.target.value) || undefined)} /></div>
                </div>
                <div className="reg-note">
                  The system prompt holds this agent's instructions — edit it on the <strong>Prompts</strong> tab. Reader agents power the Reader Panel.
                </div>
                <div style={{ flex: 1 }} />
                <div className="reg-actions">
                  {sa.isBuiltin
                    ? <button className="btn" onClick={() => resetAgent(sa.id)}>Reset to default</button>
                    : <button className="btn" onClick={() => deleteAgent(sa.id)} style={{ color: 'var(--st-idea)' }}>Delete</button>}
                  <button className="btn" onClick={() => dupAgent(sa.id)}>Duplicate</button>
                  <span className="tb-spacer" />
                  {saved && <span className="hint" style={{ color: 'var(--success)' }}>Saved</span>}
                  <button className={`btn${selAgent.dirty ? ' primary' : ''}`} onClick={saveAgent} disabled={!selAgent.dirty}>Save changes</button>
                </div>
              </div>
            ) : (
              <div className="reg-empty">Select an agent to edit, or “+ New agent”.</div>
            )}
          </div>
        )}

        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
    </ModalShell>
  )
}
