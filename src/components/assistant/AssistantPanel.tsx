import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import { streamCompletion, type AIMessage } from '../../lib/AIClient'
import { buildContext, renderContext, estimateTokens } from '../../lib/ContextBuilder'
import { composeCustomInstructions } from '../../lib/CustomInstructions'
import { MEMORY_INSTRUCTION, extractMemories, stripMemories, appendMemories } from '../../lib/AiMemory'
import ConfirmDialog from '../common/ConfirmDialog'
import type { Project } from '@shared/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  /** Durable notes this reply saved to project memory (for the UI indicator). */
  memories?: string[]
}

type ChatThreads = Record<string, Message[]>

const CHAT_FILE = 'chat.json'
const WRITE_DEBOUNCE_MS = 1000

function threadKey(nodeId: string | null): string {
  return nodeId ?? '__project__'
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function inlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} style={{ fontFamily: 'var(--mono)', fontSize: '0.88em', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>{part.slice(1, -1)}</code>
    return part
  })
}

function MdText({ text }: { text: string }): React.ReactElement {
  const blocks = text.split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l !== '')
        if (lines.length === 0) return null
        const isList = lines.every((l) => /^[-*•] /.test(l) || /^\d+\. /.test(l))
        if (isList) {
          return (
            <ul key={bi} style={{ margin: bi > 0 ? '10px 0 0' : '0', paddingLeft: 20, listStyle: 'disc' }}>
              {lines.map((l, li) => (
                <li key={li} style={{ marginBottom: 2 }}>
                  {inlineMarkdown(l.replace(/^[-*•] /, '').replace(/^\d+\. /, ''))}
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi} style={{ margin: bi > 0 ? '10px 0 0' : '0' }}>
            {lines.flatMap((line, li) => [
              ...inlineMarkdown(line),
              li < lines.length - 1 ? <br key={`br-${li}`} /> : null,
            ]).filter(Boolean)}
          </p>
        )
      })}
    </>
  )
}

// ── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      onClick={copy}
      className="linkish sm"
      style={{ marginTop: 4, alignSelf: 'flex-start', color: copied ? 'var(--st-prog)' : 'var(--text-3)' }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Attached files (extra chat context) ──────────────────────────────────────

// Soft cap on tokens contributed by user-attached files, so pinning several
// long chapters can't blow the model's window. The active document's own
// context is budgeted separately by ContextBuilder.
const ATTACH_TOKEN_CAP = 20_000

interface AttachedFile { id: string; title: string; tokens: number; truncated: boolean; included: boolean }
interface AttachedRender { text: string; totalTokens: number; files: AttachedFile[] }

// Assemble the attached documents into a single prompt section, filling up to
// ATTACH_TOKEN_CAP in attach order. Files past the cap are marked not-included
// so the UI can show they were dropped.
function renderAttachedFiles(project: Project, ids: string[]): AttachedRender {
  const files: AttachedFile[] = []
  const chunks: string[] = []
  let used = 0
  for (const id of ids) {
    const node = project.nodes[id]
    if (!node) continue
    const content = (project.docs[id]?.content ?? '').trim()
    if (!content) { files.push({ id, title: node.title, tokens: 0, truncated: false, included: false }); continue }
    const remaining = ATTACH_TOKEN_CAP - used
    if (remaining <= 0) { files.push({ id, title: node.title, tokens: estimateTokens(content), truncated: false, included: false }); continue }
    const full = estimateTokens(content)
    let body = content
    let truncated = false
    if (full > remaining) {
      body = content.slice(0, Math.max(0, Math.floor(content.length * (remaining / full))))
      truncated = true
    }
    const tokens = estimateTokens(body)
    used += tokens
    chunks.push(`## ${node.title}${truncated ? ' (truncated)' : ''}\n${body}`)
    files.push({ id, title: node.title, tokens, truncated, included: true })
  }
  const text = chunks.length ? `The author has attached these files for reference:\n\n${chunks.join('\n\n')}` : ''
  return { text, totalTokens: used, files }
}

// Pill styling for a context chip. `auto` marks the active-document chip, which
// is accent-tinted and has no remove control.
function chipStyle(auto: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 2,
    fontSize: 11, padding: '2px 8px', borderRadius: 10, maxWidth: 160,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    border: '1px solid var(--border-2)',
    background: auto ? 'var(--accent)' : 'var(--bg-2)',
    color: auto ? 'var(--accent-fg)' : 'var(--text-2)',
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AssistantPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const chatMaxTokens = useAIStore((s) => s.chatMaxTokens)
  const chatContextMessages = useAIStore((s) => s.chatContextMessages)
  const aiMemoryEnabled = useAIStore((s) => s.aiMemoryEnabled)
  const setAiInstructions = useProjectStore((s) => s.setAiInstructions)

  const [threads, setThreads] = useState<ChatThreads>({})
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadsRef = useRef<ChatThreads>({})
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const key = threadKey(selectedId)
  const messages = threads[key] ?? []

  const node = selectedId && project ? project.nodes[selectedId] : null
  const contextLabel = node?.type !== 'folder' && node?.title
    ? node.title
    : project?.title ?? ''

  // Build context packet — used both for the system prompt and the empty-state hint
  const contextPacket = project && selectedId && node?.type !== 'folder'
    ? buildContext(project, mentionIndex, selectedId, 'chat')
    : null
  const hasContext = (contextPacket?.totalTokens ?? 0) > 0

  // User-attached files pinned into the chat context (session-scoped, cleared
  // when the project changes). The active document is included automatically
  // above; these are additional references the author chooses.
  const [attachedIds, setAttachedIds] = useState<string[]>([])
  useEffect(() => { setAttachedIds([]) }, [project?.id])
  // The active document is already the automatic context — don't double-count it
  // if it's also pinned (it stays in attachedIds, just hidden while active).
  const attached = project
    ? renderAttachedFiles(project, attachedIds.filter((id) => id !== selectedId))
    : { text: '', totalTokens: 0, files: [] as AttachedFile[] }
  const addableDocs = project
    ? Object.values(project.nodes).filter((n) => n.type !== 'folder' && n.id !== selectedId && !attachedIds.includes(n.id))
    : []

  // Load persisted threads on project mount, with one-time migration from
  // the legacy per-document localStorage keys (`chat:<projectId>:<nodeId>`).
  useEffect(() => {
    if (!project) return
    let cancelled = false
    setLoaded(false)
    setThreads({})
    threadsRef.current = {}

    void (async () => {
      const raw = await window.api.aux.read(project.id, CHAT_FILE)
      if (cancelled) return

      if (raw) {
        let parsed: ChatThreads = {}
        try { parsed = JSON.parse(raw) } catch { parsed = {} }
        threadsRef.current = parsed
        setThreads(parsed)
        setLoaded(true)
        return
      }

      const migrated: ChatThreads = {}
      for (const k of ['__project__', ...Object.keys(project.nodes)]) {
        const legacyKey = `chat:${project.id}:${k}`
        const legacy = window.api.prefs.get(legacyKey)
        if (!legacy) continue
        try { migrated[k] = JSON.parse(legacy) } catch { /* skip unreadable thread */ }
        window.api.prefs.remove(legacyKey)
      }
      if (cancelled) return
      threadsRef.current = migrated
      setThreads(migrated)
      if (Object.keys(migrated).length > 0) {
        await window.api.aux.write(project.id, CHAT_FILE, JSON.stringify(migrated))
      }
      setLoaded(true)
    })()

    return () => { cancelled = true }
  }, [project?.id])

  // Debounced persistence of the full thread map.
  useEffect(() => {
    threadsRef.current = threads
    if (!project || !loaded) return
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null
      window.api.aux.write(project.id, CHAT_FILE, JSON.stringify(threadsRef.current)).catch((e: Error) => useShellStore.getState().setToast('Chat history could not be saved: ' + e.message))
    }, WRITE_DEBOUNCE_MS)
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    }
  }, [threads, project?.id, loaded])

  // Flush any pending write when the project changes or the panel unmounts.
  useEffect(() => () => {
    if (writeTimerRef.current && project) {
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
      window.api.aux.write(project.id, CHAT_FILE, JSON.stringify(threadsRef.current)).catch((e: Error) => useShellStore.getState().setToast('Chat history could not be saved: ' + e.message))
    }
  }, [project?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  function buildSystemPrompt(): string {
    const base = 'You are a creative writing assistant. Help the author with story questions, character development, plot, prose, and craft. Be specific and direct.'
    const parts = [base]
    const custom = composeCustomInstructions()
    if (custom) parts.push(custom)
    // Only let the assistant save memories when enabled and a project is open
    // to receive them.
    if (aiMemoryEnabled && project) parts.push(MEMORY_INSTRUCTION)
    if (contextPacket) { const ctx = renderContext(contextPacket); if (ctx) parts.push(ctx) }
    if (attached.text) parts.push(attached.text)
    return parts.join('\n\n')
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming || !project) return

    const threadId = key
    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]

    setThreads((prev) => ({ ...prev, [threadId]: [...newMessages, { role: 'assistant', content: '' }] }))
    setInput('')
    setStreaming(true)

    // Strip errors + limit context sent to API (0 = send all)
    const filtered = newMessages.filter((m) => !m.isError)
    const apiMessages: AIMessage[] = (chatContextMessages > 0 ? filtered.slice(-chatContextMessages) : filtered)
      .map(({ role, content }) => ({ role, content }))

    abortRef.current = new AbortController()

    function updateLastAssistant(updater: (last: Message) => Message) {
      setThreads((prev) => {
        const cur = prev[threadId] ?? []
        const updated = [...cur]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant') updated[updated.length - 1] = updater(last)
        return { ...prev, [threadId]: updated }
      })
    }

    await streamCompletion(
      apiMessages,
      {
        systemPrompt: buildSystemPrompt(),
        maxTokens: chatMaxTokens,
        temperature: 0.7,
        signal: abortRef.current.signal,
      },
      {
        onChunk: (chunk) => {
          updateLastAssistant((last) => ({ ...last, content: last.content + chunk }))
        },
        onDone: (full) => {
          const memories = aiMemoryEnabled && project ? extractMemories(full) : []
          const clean = memories.length ? stripMemories(full) : full
          updateLastAssistant((last) => ({ ...last, content: clean, memories: memories.length ? memories : undefined }))
          if (memories.length) {
            const cur = (useProjectStore.getState().project?.settings.aiInstructions as string | undefined) ?? ''
            setAiInstructions(appendMemories(cur, memories))
            useShellStore.getState().setToast(`Saved ${memories.length} note${memories.length > 1 ? 's' : ''} to project memory`, 'success')
          }
          setStreaming(false)
        },
        onError: (err) => {
          updateLastAssistant((last) => ({ ...last, content: err.message, isError: true }))
          setStreaming(false)
        },
        onAbort: () => {
          setStreaming(false)
        },
      },
    )
  }

  function stop() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  const [confirmClear, setConfirmClear] = useState(false)

  function clearChat() {
    stop()
    setThreads((prev) => ({ ...prev, [key]: [] }))
    setConfirmClear(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isThinking = streaming
    && messages.length > 0
    && messages[messages.length - 1].role === 'assistant'
    && messages[messages.length - 1].content === ''

  return (
    <div className="assistant">
      <div className="asst-hd">
        <span className="asst-mark">✦</span>
        <span className="asst-title">
          Assistant
          {contextLabel && (
            <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              {hasContext ? `· ${contextLabel}` : '· no document context'}
            </span>
          )}
        </span>
        {contextPacket && (
          <button
            className="linkish sm"
            onClick={() => setShowContext((v) => !v)}
            title="Show context tiers"
          >
            {showContext ? '▾ context' : '▸ context'}
          </button>
        )}
        {messages.length > 0 && (
          <button className="btn sm" onClick={() => setConfirmClear(true)}>Clear</button>
        )}
      </div>

      {project && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 14px', borderBottom: '0.5px solid var(--border)', background: 'var(--bg)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>Context</span>
          {hasContext && contextLabel && (
            <span title="Active document — included automatically" style={chipStyle(true)}>
              {contextLabel}
            </span>
          )}
          {attached.files.map((f) => (
            <span
              key={f.id}
              title={f.included ? `${f.tokens.toLocaleString()} tok${f.truncated ? ' · truncated to fit' : ''}` : 'Skipped — attachment budget full'}
              style={{ ...chipStyle(false), opacity: f.included ? 1 : 0.5 }}
            >
              {f.title}{f.truncated ? ' ✂' : ''}
              <button
                className="linkish"
                onClick={() => setAttachedIds((ids) => ids.filter((x) => x !== f.id))}
                aria-label={`Remove ${f.title} from context`}
                title="Remove from context"
                style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 13, lineHeight: 1, marginLeft: 2 }}
              >
                ×
              </button>
            </span>
          ))}
          {addableDocs.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) setAttachedIds((ids) => [...ids, e.target.value]) }}
              title="Attach another file to the chat context"
              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 10, border: '1px dashed var(--border-2)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}
            >
              <option value="">+ Add file</option>
              {addableDocs.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
            </select>
          )}
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear Chat"
          message="This deletes the entire conversation thread for this document. This cannot be undone."
          confirmLabel="Clear Thread"
          onConfirm={clearChat}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {showContext && contextPacket && (
        <div style={{ borderBottom: '0.5px solid var(--border)', padding: '8px 14px', background: 'var(--bg)', fontSize: 11 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {contextPacket.tiers.filter((t) => t.content.trim()).map((tier) => (
              <div key={tier.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: tier.included ? 'var(--st-prog)' : 'var(--st-idea)', flexShrink: 0, width: 10 }}>
                  {tier.included ? '✓' : '✗'}
                </span>
                <span style={{ flex: 1, color: tier.included ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {tier.label}{tier.truncated ? ' (truncated)' : ''}
                </span>
                <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{tier.tokens.toLocaleString()} tok</span>
              </div>
            ))}
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)' }}>
              <span>{contextPacket.truncated ? '⚠ some tiers dropped/truncated — raise context budget in AI Settings' : 'all tiers included'}</span>
              <span style={{ fontFamily: 'var(--mono)' }}>{contextPacket.totalTokens.toLocaleString()} / {contextPacket.budgetTokens.toLocaleString()} tok</span>
            </div>
          </div>
        </div>
      )}

      <div className="asst-chat">
        {messages.length === 0 && (
          <div className="asst-empty">
            {hasContext
              ? <>Ask anything about <em>{contextLabel}</em> — plot, characters, prose, craft.</>
              : 'Select a document in the binder to give the AI context, or just ask a question.'}
          </div>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1
          const isStreamingThis = streaming && isLast && msg.role === 'assistant'
          return (
            <div key={i} className={`msg ${msg.role === 'user' ? 'user' : 'ai'}`}>
              {msg.role === 'assistant' && <span className="msg-mark">✦</span>}
              <div className="msg-body">
                {msg.isError ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: 'var(--st-idea)', flexShrink: 0, marginTop: 1 }}>⚠</span>
                    <span className="msg-text">{msg.content}</span>
                  </div>
                ) : (
                  <>
                    <div className="msg-text">
                      {isThinking && isLast
                        ? (
                          <div className="thinking"><i /><i /><i /></div>
                        )
                        : msg.role === 'assistant'
                          ? <MdText text={stripMemories(msg.content)} />
                          : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>}
                      {isStreamingThis && !isThinking && (
                        <span style={{ opacity: 0.6, animation: 'pulse 1s infinite' }}>▌</span>
                      )}
                    </div>
                    {msg.role === 'assistant' && msg.memories && msg.memories.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-3)' }}>
                        {msg.memories.map((m, mi) => (
                          <div key={mi} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ color: 'var(--accent)', flexShrink: 0 }}>✦</span>
                            <span>Remembered: {m}</span>
                          </div>
                        ))}
                        <span style={{ color: 'var(--text-3)', opacity: 0.8 }}>Saved to project notes — edit or remove in AI Settings.</span>
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.content && !isStreamingThis && (
                      <CopyButton text={msg.content} />
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="asst-input">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask something… (Enter to send, Shift+Enter for newline)"
          rows={2}
        />
        {streaming
          ? <button className="send-btn" onClick={stop} title="Stop">■</button>
          : <button className="send-btn" onClick={send} disabled={!input.trim()} title="Send">↑</button>
        }
      </div>
    </div>
  )
}
