import React, { useState } from 'react'
import { useAIStore, type AIProvider } from '../../store/aiStore'

const MODELS = [
  { id: 'claude-opus-4-8',             label: 'Claude Opus 4.8 (best quality)' },
  { id: 'claude-sonnet-4-6',           label: 'Claude Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5-20251001',   label: 'Claude Haiku 4.5 (fast/cheap)' },
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
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    if (res.ok || res.status === 400) return { ok: true }
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

interface Props { onClose: () => void }

export default function AISettingsModal({ onClose }: Props): React.ReactElement {
  const { enabled, setEnabled, provider, setProvider, apiKey, setApiKey,
          ollamaHost, setOllamaHost, defaultModel, setDefaultModel,
          keyValidated, keyError, setKeyValidated } = useAIStore()

  const [keyDraft, setKeyDraft] = useState(apiKey)
  const [validating, setValidating] = useState(false)

  const handleValidate = async () => {
    if (!keyDraft.trim()) return
    setValidating(true)
    setApiKey(keyDraft.trim())
    const result = await validateAnthropicKey(keyDraft.trim())
    setKeyValidated(result.ok, result.error ?? null)
    setValidating(false)
  }

  const handleEnable = () => {
    if (!keyValidated && provider === 'anthropic') return
    setEnabled(true)
    onClose()
  }

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
        <span style={{ flex: '0 0 130px', fontSize: 13, color: 'var(--text-2)', paddingTop: 6 }}>{label}</span>
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    )
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
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
                <input
                  type="checkbox" checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13 }}>Enable AI features</span>
              </label>
              {enabled && <span style={{ fontSize: 11, color: 'oklch(0.68 0.14 150)' }}>● Active</span>}
            </div>
          </Row>

          <Row label="Provider">
            <div className="seg">
              {(['anthropic', 'ollama'] as AIProvider[]).map((p) => (
                <button key={p} className={provider === p ? 'on' : ''} onClick={() => setProvider(p)}>
                  {p === 'anthropic' ? 'Anthropic API' : 'Ollama (local)'}
                </button>
              ))}
            </div>
          </Row>

          {provider === 'anthropic' ? (
            <Row label="API Key">
              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => { setKeyDraft(e.target.value); setKeyValidated(false) }}
                    placeholder="sk-ant-…"
                    style={{
                      flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 13,
                      border: `1px solid ${keyValidated ? 'oklch(0.68 0.14 150)' : keyError ? 'oklch(0.60 0.15 20)' : 'var(--border-2)'}`,
                      background: 'var(--bg-2)', color: 'var(--text)', fontFamily: 'var(--mono)',
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
                  />
                  <button
                    className="btn"
                    onClick={handleValidate}
                    disabled={validating || !keyDraft.trim()}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {validating ? 'Checking…' : keyValidated ? '✓ Valid' : 'Validate'}
                  </button>
                </div>
                {keyError && <div style={{ fontSize: 11, color: 'oklch(0.65 0.15 20)' }}>{keyError}</div>}
                {keyValidated && <div style={{ fontSize: 11, color: 'oklch(0.68 0.14 150)' }}>Key validated successfully.</div>}
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Stored in localStorage only — never written to project files or sent anywhere except api.anthropic.com.
                </div>
              </div>
            </Row>
          ) : (
            <Row label="Ollama host">
              <div style={{ width: '100%' }}>
                <input
                  value={ollamaHost}
                  onChange={(e) => setOllamaHost(e.target.value)}
                  placeholder="http://localhost:11434"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)', boxSizing: 'border-box' }}
                />
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Ollama must allow browser access. Start with:{' '}
                  <code style={{ fontFamily: 'var(--mono)', background: 'var(--ui-2)', padding: '1px 4px', borderRadius: 3 }}>OLLAMA_ORIGINS=* ollama serve</code>
                </div>
              </div>
            </Row>
          )}

          <Row label="Default model">
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}
            >
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Row>

        </div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          {!enabled && (
            <button
              className="btn"
              onClick={handleEnable}
              disabled={provider === 'anthropic' && !keyValidated}
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
            >
              Enable AI
            </button>
          )}
          {enabled && <button className="btn" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  )
}
