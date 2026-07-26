import React, { useState, useRef, useEffect } from 'react'
import { useAIStore, AI_SERVICES, type AIService } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import { formatUSD } from '../../lib/Pricing'
import { createPKCE, authorizeUrl, completeSignIn, type PKCE } from '../../lib/ClaudeOAuth'
import { kbd } from '../../lib/kbd'
import Icon from '../common/Icon'
import ModalShell from '../common/ModalShell'
import VoiceBriefModal from './VoiceBriefModal'
import { generateVoiceFingerprint, gatherProseSamples } from '../../lib/voice'

const ANTHROPIC_MODELS = [
  { id: 'claude-fable-5',   label: 'Claude Fable 5 (most capable)' },
  { id: 'claude-opus-4-8',  label: 'Claude Opus 4.8 (best quality)' },
  { id: 'claude-sonnet-5',  label: 'Claude Sonnet 5 (balanced)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fast/cheap)' },
]

// Sub-presets shown only under the "Custom" service — one-click endpoints for
// other OpenAI-compatible providers and local servers. The four first-class
// services (Claude/ChatGPT/NanoGPT/OpenRouter) live in AI_SERVICES.
// One-click commands for the Local-agent service. The "auto-edit" / "full
// access" Claude presets pass the permission flag that lets it actually write
// files headlessly (a bare `claude -p` would only respond).
const AGENT_PRESETS: { label: string; cmd: string; note: string }[] = [
  { label: 'Claude Code · auto-edit', cmd: 'claude -p --permission-mode acceptEdits', note: 'approves file edits, blocks riskier actions' },
  { label: 'Claude Code · full access', cmd: 'claude -p --dangerously-skip-permissions', note: 'approves everything — trusted projects only' },
  { label: 'opencode', cmd: 'opencode run -', note: 'reads the prompt from stdin' },
  { label: 'aider', cmd: 'aider --message-file -', note: 'reads the prompt from stdin' },
]

const CUSTOM_PRESETS: { label: string; url: string; keyRequired: boolean; exampleModel: string }[] = [
  { label: 'Groq',      url: 'https://api.groq.com/openai/v1',    keyRequired: true,  exampleModel: 'llama-3.3-70b-versatile' },
  { label: 'Together',  url: 'https://api.together.xyz/v1',        keyRequired: true,  exampleModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { label: 'Ollama',    url: 'http://localhost:11434/v1',          keyRequired: false, exampleModel: 'llama3.3' },
  { label: 'LM Studio', url: 'http://localhost:1234/v1',           keyRequired: false, exampleModel: 'local-model' },
]

async function validateAnthropicKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    })
    if (res.ok || res.status === 400) return { ok: true }
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function testOpenAIEndpoint(baseUrl: string, apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }], stream: false }),
    })
    if (res.ok || res.status === 400) return { ok: true }
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ai-row">
      <span className="lbl">{label}</span>
      <div className="ctl">{children}</div>
    </div>
  )
}

interface Props { onClose: () => void; embedded?: boolean }

export default function AISettingsModal({ onClose, embedded }: Props): React.ReactElement {
  const {
    enabled, setEnabled,
    provider, service, setService,
    anthropicAuthMode, setAnthropicAuthMode,
    oauthAccessToken, clearOAuth,
    anthropicKey, setAnthropicKey, anthropicModel, setAnthropicModel,
    anthropicKeyValidated, anthropicKeyError, setAnthropicKeyValidated,
    openaiBaseUrl, setOpenaiBaseUrl, openaiKey, setOpenaiKey, openaiModel, setOpenaiModel,
    savedModels, addSavedModel, removeSavedModel,
    chatMaxTokens, setChatMaxTokens, chatContextMessages, setChatContextMessages,
    contextBudgets, setContextBudget,
    spendInputTokens, spendOutputTokens, spendUSD, spendCalls, spendUnpriced, resetSpend,
    slopAutoRun, setSlopAutoRun,
    customInstructions, setCustomInstructions,
    aiMemoryEnabled, setAiMemoryEnabled,
    aiToolsEnabled, setAiToolsEnabled,
    agentCommand, setAgentCommand,
  } = useAIStore()

  const project = useProjectStore((s) => s.project)
  const setVoiceFingerprint = useProjectStore((s) => s.setVoiceFingerprint)
  const voiceFingerprint = (project?.settings.voiceFingerprint as string | undefined) ?? ''
  const setAiInstructions = useProjectStore((s) => s.setAiInstructions)
  const projectInstructions = (project?.settings.aiInstructions as string | undefined) ?? ''

  // Draft state so we persist on blur, not on every keystroke (project notes
  // write the manifest; global notes write prefs).
  const [globalInstrDraft, setGlobalInstrDraft] = useState(customInstructions)
  const [projectInstrDraft, setProjectInstrDraft] = useState(projectInstructions)
  useEffect(() => { setProjectInstrDraft(projectInstructions) }, [project?.id])

  const [voiceRefreshing, setVoiceRefreshing] = useState(false)
  const [voiceRefreshed, setVoiceRefreshed] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceBriefOpen, setVoiceBriefOpen] = useState(false)
  const voiceAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { voiceAbortRef.current?.abort() }, [])

  const handleRefreshVoice = async () => {
    if (!project || voiceRefreshing) return
    const samples = gatherProseSamples(project)
    if (!samples.trim()) { setVoiceError('No compiled prose found — describe the voice instead, or write some chapters first.'); return }
    setVoiceRefreshing(true); setVoiceError(null); setVoiceRefreshed(false)
    const controller = new AbortController()
    voiceAbortRef.current = controller
    try {
      const result = await generateVoiceFingerprint({ from: 'samples', samples }, () => {}, controller.signal)
      setVoiceFingerprint(result)
      setVoiceRefreshed(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setVoiceError((err as Error).message)
    } finally {
      setVoiceRefreshing(false)
    }
  }

  const [maxTokensDraft, setMaxTokensDraft] = useState(String(chatMaxTokens))
  const [contextMsgsDraft, setContextMsgsDraft] = useState(String(chatContextMessages))
  const [modelDraft, setModelDraft] = useState('')

  const BUDGET_FEATURES: { id: string; label: string; default: number }[] = [
    { id: 'inline',     label: 'Inline rewrite',  default: 16_000 },
    { id: 'chat',       label: 'Chat',             default: 48_000 },
    { id: 'batch',      label: 'Batch / generate', default: 48_000 },
    { id: 'evaluation', label: 'Evaluation',       default: 24_000 },
    { id: 'autopilot',  label: 'Autopilot',        default: 100_000 },
    { id: 'codex',      label: 'Codex',            default: 8_000 },
  ]
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(BUDGET_FEATURES.map(({ id, default: d }) => [id, String(contextBudgets[id] || d)]))
  )
  function commitBudget(id: string, val: string, defaultVal: number) {
    const n = parseInt(val.replace(/[^0-9]/g, ''), 10)
    const resolved = isNaN(n) || n <= 0 ? defaultVal : n
    setContextBudget(id, resolved === defaultVal ? 0 : resolved)
    setBudgetDrafts((prev) => ({ ...prev, [id]: String(resolved) }))
  }

  const [anthropicDraft, setAnthropicDraft] = useState(anthropicKey)
  const [validating, setValidating] = useState(false)
  const [openaiTested, setOpenaiTested] = useState(false)
  const [openaiTestError, setOpenaiTestError] = useState<string | null>(null)

  const handleAnthropicValidate = async () => {
    if (!anthropicDraft.trim()) return
    setValidating(true)
    setAnthropicKey(anthropicDraft.trim())
    const result = await validateAnthropicKey(anthropicDraft.trim())
    setAnthropicKeyValidated(result.ok, result.error ?? null)
    setValidating(false)
  }

  const handleOpenAITest = async () => {
    setValidating(true)
    setOpenaiTestError(null)
    const result = await testOpenAIEndpoint(openaiBaseUrl, openaiKey, openaiModel)
    setOpenaiTested(result.ok)
    setOpenaiTestError(result.ok ? null : (result.error ?? 'Connection failed'))
    setValidating(false)
  }

  // ── Claude subscription (OAuth) sign-in ──────────────────────────────────────
  const [pkce, setPkce] = useState<PKCE | null>(null)
  const [oauthCode, setOauthCode] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  const handleOAuthStart = async () => {
    setOauthError(null)
    const p = await createPKCE()
    setPkce(p)
    window.api.shell.openExternal(authorizeUrl(p))
  }

  const handleOAuthComplete = async () => {
    if (!pkce || !oauthCode.trim()) return
    setOauthBusy(true); setOauthError(null)
    const res = await completeSignIn(oauthCode.trim(), pkce)
    setOauthBusy(false)
    if (res.ok) { setPkce(null); setOauthCode('') }
    else setOauthError(res.error ?? 'Sign-in failed.')
  }

  const canEnable = service === 'agent'
    ? true
    : provider === 'anthropic'
      ? (anthropicAuthMode === 'oauth' ? !!oauthAccessToken : anthropicKeyValidated)
      : true

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={580} label="AI Settings">
        <div className="modal-hd">
          <h3>AI Settings</h3>
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 10, alignSelf: 'center' }}>
            All AI output goes through Changeset Review before touching any document.
          </span>
        </div>
        <div className="modal-body">

          <Row label="AI layer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                <span style={{ fontSize: 13 }}>Enable AI features</span>
              </label>
              {enabled && <span style={{ fontSize: 11, color: 'var(--success)' }}>● Active</span>}
            </div>
          </Row>

          <Row label="Provider">
            <div className="ai-col">
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {(Object.keys(AI_SERVICES) as AIService[]).map((id) => (
                  <button key={id} className={service === id ? 'on' : ''} onClick={() => setService(id)}>
                    {AI_SERVICES[id].label}
                  </button>
                ))}
              </div>
              <div className="ai-hint">Bring your own key for any provider — keys stay in localStorage, never in project files.</div>
            </div>
          </Row>

          {service === 'agent' ? (
            <>
              <Row label="Preset">
                <div className="ai-col">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {AGENT_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        className={`btn preset${agentCommand === p.cmd ? ' on' : ''}`}
                        title={p.note}
                        onClick={() => setAgentCommand(p.cmd)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="ai-hint">
                    Claude Code asks before editing files; the <b>auto-edit</b> preset passes the flag that lets it write headlessly. A bare <code className="kbd">claude -p</code> would only reply.
                  </div>
                </div>
              </Row>
              <Row label="Command">
                <div className="ai-col">
                  <input
                    value={agentCommand}
                    onChange={(e) => setAgentCommand(e.target.value)}
                    placeholder="claude -p --permission-mode acceptEdits"
                    className="ai-inp mono"
                  />
                  <div className="ai-hint">
                    Runs in your project folder with the prompt piped to stdin. Pick a preset above or edit freely. Desktop app only.
                  </div>
                </div>
              </Row>
              <Row label="How it writes">
                <div className="ai-warn">
                  <Icon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} /> The local agent edits your project's files <b>directly on disk</b>. Its changes <b>do not go through Changeset review</b> — unlike Konbini's own AI, they apply immediately, not after you approve them. Your safety net is after-the-fact: every save is snapshot-protected and any file the agent changes is backed up to a <code className="kbd">.conflict</code> file, and Konbini reloads the project when the agent finishes. Point this at a tool you trust.
                </div>
              </Row>
            </>
          ) : service === 'claude' ? (
            <>
              <Row label="Sign in with">
                <div className="ai-col">
                  <div className="seg">
                    <button className={anthropicAuthMode === 'key' ? 'on' : ''} onClick={() => setAnthropicAuthMode('key')}>API key</button>
                    <button className={anthropicAuthMode === 'oauth' ? 'on' : ''} onClick={() => setAnthropicAuthMode('oauth')}>Claude subscription</button>
                  </div>
                  <div className="ai-hint">
                    {anthropicAuthMode === 'oauth'
                      ? 'Uses your Claude Pro/Max subscription via OAuth. Requests are branded as Claude Code (a system prefix Anthropic requires for subscription tokens), which can affect some prompts.'
                      : 'Bring your own Anthropic API key — billed per token, no prompt restrictions.'}
                  </div>
                </div>
              </Row>

              {anthropicAuthMode === 'key' ? (
                <Row label="API Key">
                  <div className="ai-col">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        value={anthropicDraft}
                        onChange={(e) => { setAnthropicDraft(e.target.value); setAnthropicKeyValidated(false) }}
                        placeholder="sk-ant-…"
                        onKeyDown={(e) => e.key === 'Enter' && handleAnthropicValidate()}
                        className="ai-inp mono" style={{ flex: 1, borderColor: anthropicKeyValidated ? 'var(--success)' : anthropicKeyError ? 'var(--danger)' : undefined }}
                      />
                      <button className="btn" onClick={handleAnthropicValidate} disabled={validating || !anthropicDraft.trim()} style={{ whiteSpace: 'nowrap' }}>
                        {validating ? 'Checking…' : anthropicKeyValidated ? <><Icon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} /> Valid</> : 'Validate'}
                      </button>
                    </div>
                    {anthropicKeyError && <div className="msg-err">{anthropicKeyError}</div>}
                    {anthropicKeyValidated && <div className="msg-ok">Key validated successfully.</div>}
                    <div className="ai-hint">Stored in localStorage only — never written to project files.</div>
                  </div>
                </Row>
              ) : (
                <Row label="Subscription">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {oauthAccessToken ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: 'var(--success)' }}>● Signed in with your Claude subscription</span>
                        <span className="tb-spacer" />
                        <button className="btn" style={{ fontSize: 12, padding: '3px 10px' }} onClick={clearOAuth}>Sign out</button>
                      </div>
                    ) : (
                      <>
                        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={handleOAuthStart}>
                          {pkce ? 'Reopen sign-in page' : 'Sign in with Claude'}
                        </button>
                        {pkce && (
                          <div className="ai-col">
                            <div className="ai-hint">
                              Authorize in the browser, then paste the code Anthropic shows you here:
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                value={oauthCode}
                                onChange={(e) => setOauthCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleOAuthComplete()}
                                placeholder="code#state"
                                className="ai-inp mono" style={{ flex: 1 }}
                              />
                              <button className="btn" onClick={handleOAuthComplete} disabled={oauthBusy || !oauthCode.trim()} style={{ whiteSpace: 'nowrap' }}>
                                {oauthBusy ? 'Signing in…' : 'Complete'}
                              </button>
                            </div>
                          </div>
                        )}
                        {oauthError && <div className="msg-err">{oauthError}</div>}
                      </>
                    )}
                    <div className="ai-hint">Tokens stored in localStorage only — never written to project files.</div>
                  </div>
                </Row>
              )}
              <Row label="Model">
                <select value={anthropicModel} onChange={(e) => setAnthropicModel(e.target.value)} className="ai-inp">
                  {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Row>
            </>
          ) : (
            <>
              {service === 'custom' ? (
                <>
                  <Row label="Presets">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {CUSTOM_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          className={`btn preset${openaiBaseUrl === p.url ? ' on' : ''}`}
                          onClick={() => { setOpenaiBaseUrl(p.url); setOpenaiModel(p.exampleModel); setOpenaiTested(false) }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label="Base URL">
                    <input
                      value={openaiBaseUrl}
                      onChange={(e) => { setOpenaiBaseUrl(e.target.value); setOpenaiTested(false) }}
                      placeholder="https://api.openai.com/v1"
                      className="ai-inp mono"
                    />
                    <div className="ai-hint" style={{ marginTop: 4 }}>Any provider with an OpenAI-compatible <code className="kbd">/chat/completions</code> endpoint.</div>
                  </Row>
                </>
              ) : (
                <Row label="Endpoint">
                  <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--mono)', padding: '4px 0' }}>{openaiBaseUrl}</div>
                </Row>
              )}
              <Row label="API Key">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => { setOpenaiKey(e.target.value); setOpenaiTested(false) }}
                    placeholder={service === 'custom' ? 'Optional — leave blank for local servers' : `${AI_SERVICES[service].label} API key`}
                    className="ai-inp mono"
                  />
                  <div className="ai-hint">
                    Stored in localStorage only.{service === 'custom' ? ' Leave blank for Ollama / LM Studio.' : ''}
                  </div>
                </div>
              </Row>
              <Row label="Model">
                <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={openaiModel}
                      onChange={(e) => { setOpenaiModel(e.target.value); setOpenaiTested(false) }}
                      placeholder={AI_SERVICES[service].exampleModel ?? 'gpt-4o, llama3.3, etc.'}
                      className="ai-inp mono" style={{ flex: 1, borderColor: openaiTested ? 'var(--success)' : openaiTestError ? 'var(--danger)' : undefined }}
                    />
                    <button className="btn" onClick={handleOpenAITest} disabled={validating || !openaiBaseUrl.trim() || !openaiModel.trim()} style={{ whiteSpace: 'nowrap' }}>
                      {validating ? 'Testing…' : openaiTested ? <><Icon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} /> OK</> : 'Test'}
                    </button>
                  </div>
                  {openaiTestError && <div className="msg-err">{openaiTestError}</div>}
                  {openaiTested && <div className="msg-ok">Endpoint reachable.</div>}
                  {CUSTOM_PRESETS.find((p) => p.url === openaiBaseUrl && !p.keyRequired) && (
                    <div className="ai-hint">
                      Local server — make sure it's running and has CORS enabled{' '}
                      {openaiBaseUrl.includes('11434') && <>(Ollama: <code className="kbd">OLLAMA_ORIGINS=* ollama serve</code>)</>}.
                    </div>
                  )}
                </div>
              </Row>
            </>
          )}

          <Row label="Chat">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-2)', flex: '0 0 110px' }}>Max output tokens</label>
                <input
                  type="number"
                  min={256}
                  max={200000}
                  value={maxTokensDraft}
                  onChange={(e) => setMaxTokensDraft(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(maxTokensDraft, 10)
                    if (!isNaN(n) && n >= 256) { setChatMaxTokens(n); setMaxTokensDraft(String(n)) }
                    else setMaxTokensDraft(String(chatMaxTokens))
                  }}
                  className="ai-inp mono n"
                />
                <span className="ai-hint">per response — bump for long-form answers, lower for speed</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-2)', flex: '0 0 110px' }}>Context messages</label>
                <input
                  type="number"
                  min={0}
                  value={contextMsgsDraft}
                  onChange={(e) => setContextMsgsDraft(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(contextMsgsDraft, 10)
                    if (!isNaN(n) && n >= 0) { setChatContextMessages(n); setContextMsgsDraft(String(n)) }
                    else setContextMsgsDraft(String(chatContextMessages))
                  }}
                  className="ai-inp mono n"
                />
                <span className="ai-hint">recent messages sent per turn — 0 = send full history</span>
              </div>
            </div>
          </Row>

          <Row label="Generation models">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="ai-inp mono"
                  style={{ flex: 1 }}
                  placeholder="e.g. claude-opus-4-8 or gpt-4o"
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && modelDraft.trim()) { addSavedModel(modelDraft); setModelDraft('') } }}
                />
                <button className="btn" disabled={!modelDraft.trim()} onClick={() => { addSavedModel(modelDraft); setModelDraft('') }}>Add</button>
              </div>
              {savedModels.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {savedModels.map((m) => (
                    <span key={m} className="chip on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
                      <span className="mono">{m}</span>
                      <button onClick={() => removeSavedModel(m)} title="Remove" aria-label={`Remove ${m}`}
                        style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', lineHeight: 1, padding: 0 }}>
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="ai-hint">Add the models you draft with — the beat generator (⌘J) picks from this list. Empty = use your active model.</span>
              )}
            </div>
          </Row>

          <Row label="Context budgets">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {BUDGET_FEATURES.map(({ id, label, default: defaultVal }) => (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-2)', flex: '0 0 100px' }}>{label}</label>
                    <input
                      type="number"
                      min={1000}
                      value={budgetDrafts[id] ?? String(defaultVal)}
                      onChange={(e) => setBudgetDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                      onBlur={() => commitBudget(id, budgetDrafts[id] ?? '', defaultVal)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitBudget(id, budgetDrafts[id] ?? '', defaultVal) }}
                      className="ai-inp mono n" style={{ width: 80 }}
                    />
                  </div>
                ))}
              </div>
              <div className="ai-hint">
                Tokens of manuscript context sent per AI call, by feature. Defaults are sized for long-context models: inline 16k · chat 48k · batch 48k · autopilot 100k. Lower these for small local models.
              </div>
            </div>
          </Row>

          <Row label="Custom instructions">
            <div className="ai-col">
              <textarea
                value={globalInstrDraft}
                onChange={(e) => setGlobalInstrDraft(e.target.value)}
                onBlur={() => { if (globalInstrDraft !== customInstructions) setCustomInstructions(globalInstrDraft) }}
                placeholder="Give the AI a persona, tone, or standing preferences — applied across every project. e.g. “Write in a spare, Hemingwayesque register. Never use the word ‘palpable’.”"
                rows={4}
                className="ai-ta"
              />
              <div className="ai-hint">
                The AI's personality and standing notes for <b>all</b> projects — read on every chat and inline co-write. Konbini's CLAUDE.md, global scope.
              </div>
            </div>
          </Row>

          <Row label="Project notes">
            <div className="ai-col">
              <textarea
                value={projectInstrDraft}
                onChange={(e) => setProjectInstrDraft(e.target.value)}
                onBlur={() => { if (project && projectInstrDraft !== projectInstructions) setAiInstructions(projectInstrDraft) }}
                disabled={!project}
                placeholder={project
                  ? 'Facts and directives the AI should remember about THIS book — canon, character quirks, timeline rules, what to avoid.'
                  : 'Open a project to add its notes.'}
                rows={4}
                className="ai-ta"
                style={{ background: project ? undefined : 'var(--bg-3)', opacity: project ? 1 : 0.6 }}
              />
              <div className="ai-hint">
                Saved with this project's <code className="kbd">.konbini</code> bundle and travels with it. Combined with the global instructions above.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 2 }}>
                <input type="checkbox" checked={aiMemoryEnabled} onChange={(e) => setAiMemoryEnabled(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                <span style={{ fontSize: 12 }}>Let the assistant save memories to these notes</span>
              </label>
              <div className="ai-hint">
                When on, the chat assistant appends durable facts you share (canon, character details, style rules) here on its own — each one flagged in the conversation and fully editable above.
              </div>
            </div>
          </Row>

          <Row label="Assistant tools">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={aiToolsEnabled} onChange={(e) => setAiToolsEnabled(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
                <span style={{ fontSize: 13 }}>Let the assistant use tools <span style={{ color: 'var(--text-3)' }}>(Claude only)</span></span>
              </label>
              <div className="ai-hint">
                On Claude, the chat can search the manuscript, read the outline, open documents, create new documents, and propose edits across the whole project. Proposed edits are queued in Changeset for your review — never written directly.
              </div>
            </div>
          </Row>

          <Row label="Voice fingerprint">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {voiceFingerprint ? (
                <div style={{ padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg-2)', fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--mono)', lineHeight: 1.5, maxHeight: 72, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {voiceFingerprint.slice(0, 300)}{voiceFingerprint.length > 300 ? '…' : ''}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Not set — describe the voice you want, or derive one from prose you've already written.</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!project} onClick={() => setVoiceBriefOpen(true)}>
                  Describe a voice…
                </button>
                <button className="btn" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!project || voiceRefreshing} onClick={handleRefreshVoice}>
                  {voiceRefreshing ? 'Refreshing…' : voiceRefreshed ? <>Refreshed <Icon name="check" size={12} style={{ verticalAlign: '-1px', marginLeft: 3 }} /></> : 'Refresh from manuscript'}
                </button>
                {voiceError && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{voiceError}</span>}
              </div>
              <div className="ai-hint">
                <b>Describe a voice</b> writes the style guide from your description — use it before there's prose to learn from.
                <b> Refresh</b> re-derives it from your compiled documents. Either way it's saved to the project and editable.
              </div>
            </div>
          </Row>

          <Row label="Slop Proof">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={slopAutoRun} onChange={(e) => setSlopAutoRun(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
              <span style={{ fontSize: 13 }}>Auto-run after 30s idle</span>
            </label>
            <div className="ai-hint" style={{ marginTop: 4 }}>Automatically flag clichés and weak prose 30 seconds after you stop typing. Keyboard shortcut: {kbd('alt+p')}.</div>
          </Row>

          <Row label="Session usage">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>
                  {formatUSD(spendUSD)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {spendCalls} call{spendCalls === 1 ? '' : 's'} · {(spendInputTokens / 1000).toFixed(1)}k in / {(spendOutputTokens / 1000).toFixed(1)}k out
                </span>
                <span className="tb-spacer" />
                <button className="btn" style={{ fontSize: 12, padding: '3px 10px' }} disabled={spendCalls === 0} onClick={resetSpend}>Reset</button>
              </div>
              {spendUnpriced > 0 && (
                <div className="ai-hint">
                  {spendUnpriced} call{spendUnpriced === 1 ? '' : 's'} on a model with no known price — excluded from the dollar total.
                </div>
              )}
              <div className="ai-hint">
                Estimated from this session's API usage (resets on reload). List prices; your actual billing may differ.
              </div>
            </div>
          </Row>

        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          {!enabled && (
            <button className="btn" onClick={() => { setEnabled(true); onClose() }} disabled={!canEnable}
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}>
              Enable AI
            </button>
          )}
          {enabled && <button className="btn" onClick={onClose}>Done</button>}
        </div>

        {voiceBriefOpen && (
          <VoiceBriefModal
            initial={voiceFingerprint}
            onSave={(fp) => { setVoiceFingerprint(fp); setVoiceRefreshed(false); setVoiceError(null) }}
            onClose={() => setVoiceBriefOpen(false)}
          />
        )}
    </ModalShell>
  )
}
