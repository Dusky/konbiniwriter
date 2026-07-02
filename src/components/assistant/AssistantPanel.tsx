import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import { streamCompletion, type AIMessage } from '../../lib/AIClient'
import { buildContext, renderContext } from '../../lib/ContextBuilder'
import ConfirmDialog from '../common/ConfirmDialog'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
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

// ── Component ────────────────────────────────────────────────────────────────

export default function AssistantPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const chatMaxTokens = useAIStore((s) => s.chatMaxTokens)
  const chatContextMessages = useAIStore((s) => s.chatContextMessages)
  const setAssistantOpen = useShellStore((s) => s.setAssistantOpen)

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
    if (!contextPacket) return base
    const ctx = renderContext(contextPacket)
    return ctx ? `${base}\n\n${ctx}` : base
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
          updateLastAssistant((last) => ({ ...last, content: full }))
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
        <button className="icon-btn sm" onClick={() => setAssistantOpen(false)} title="Close assistant">✕</button>
      </div>

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
                          ? <MdText text={msg.content} />
                          : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>}
                      {isStreamingThis && !isThinking && (
                        <span style={{ opacity: 0.6, animation: 'pulse 1s infinite' }}>▌</span>
                      )}
                    </div>
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
