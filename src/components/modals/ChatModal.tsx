import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { streamCompletion } from '../../lib/AIClient'
import { buildContext, renderContext } from '../../lib/ContextBuilder'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
}

interface Props {
  onClose: () => void
}

function chatKey(projectId: string, nodeId: string | null): string {
  return `chat:${projectId}:${nodeId ?? '__project__'}`
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
      style={{
        marginTop: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 11,
        color: copied ? 'var(--st-prog)' : 'var(--text-3)',
        padding: '2px 0',
        alignSelf: 'flex-start',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ChatModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)
  const mentionIndex = useProjectStore((s) => s.mentionIndex)
  const chatMaxTokens = useAIStore((s) => s.chatMaxTokens)
  const chatContextMessages = useAIStore((s) => s.chatContextMessages)

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const node = selectedId && project ? project.nodes[selectedId] : null
  const contextLabel = node?.type !== 'folder' && node?.title
    ? node.title
    : project?.title ?? ''

  // Build context packet — used both for the system prompt and the empty-state hint
  const contextPacket = project && selectedId && node?.type !== 'folder'
    ? buildContext(project, mentionIndex, selectedId, 'chat')
    : null
  const hasContext = (contextPacket?.totalTokens ?? 0) > 0

  // Load persisted conversation whenever context switches
  useEffect(() => {
    if (!project) return
    const raw = window.api.prefs.get(chatKey(project.id, selectedId))
    if (raw) {
      try { setMessages(JSON.parse(raw)) } catch { setMessages([]) }
    } else {
      setMessages([])
    }
  }, [project?.id, selectedId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  function persistMessages(msgs: Message[]) {
    if (!project) return
    // Store full history — no cap
    const toStore = msgs.filter((m) => !m.isError)
    window.api.prefs.set(chatKey(project.id, selectedId), JSON.stringify(toStore))
  }

  function buildSystemPrompt(): string {
    const base = 'You are a creative writing assistant. Help the author with story questions, character development, plot, prose, and craft. Be specific and direct.'
    if (!contextPacket) return base
    const ctx = renderContext(contextPacket)
    return ctx ? `${base}\n\n${ctx}` : base
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)

    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    // Strip errors + limit context sent to API (0 = send all)
    const filtered = newMessages.filter((m) => !m.isError)
    const apiMessages = (chatContextMessages > 0 ? filtered.slice(-chatContextMessages) : filtered)
      .map(({ role, content }) => ({ role, content }))

    abortRef.current = new AbortController()

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
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + chunk }
            }
            return updated
          })
        },
        onDone: (full) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: full }
            }
            persistMessages(updated)
            return updated
          })
          setStreaming(false)
        },
        onError: (err) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: err.message, isError: true }
            }
            persistMessages(updated)
            return updated
          })
          setStreaming(false)
        },
      },
    )
  }

  function stop() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  function clearChat() {
    stop()
    setMessages([])
    if (project) window.api.prefs.remove(chatKey(project.id, selectedId))
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
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 700, height: 540, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        role="dialog" aria-modal="true" aria-label="AI Chat"
      >
        {/* Header */}
        <div className="modal-hd" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h3 style={{ margin: 0 }}>AI Chat</h3>
            {contextLabel && (
              <span className="sub" style={{ fontSize: 12 }}>
                {hasContext ? `reading "${contextLabel}"` : 'no document context'}
              </span>
            )}
            {contextPacket && (
              <button
                onClick={() => setShowContext((v) => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: showContext ? 'var(--accent)' : 'var(--text-3)', padding: '0 2px' }}
                title="Show context tiers"
              >
                {showContext ? '▾ context' : '▸ context'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {messages.length > 0 && (
              <button className="btn" onClick={clearChat}>Clear</button>
            )}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Context inspector */}
        {showContext && contextPacket && (
          <div style={{ borderBottom: '0.5px solid var(--border)', padding: '8px 20px', background: 'var(--bg-2)', fontSize: 11 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {contextPacket.tiers.filter((t) => t.content.trim()).map((tier) => (
                <div key={tier.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: tier.included ? 'var(--st-prog)' : 'var(--st-idea)', flexShrink: 0, width: 10 }}>
                    {tier.included ? '✓' : '✗'}
                  </span>
                  <span style={{ flex: 1, color: tier.included ? 'var(--text-2)' : 'var(--text-3)' }}>{tier.label}</span>
                  <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{tier.tokens.toLocaleString()} tok</span>
                </div>
              ))}
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)' }}>
                <span>{contextPacket.truncated ? '⚠ some tiers dropped — raise context budget in AI Settings' : 'all tiers included'}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{contextPacket.totalTokens.toLocaleString()} / {contextPacket.budgetTokens.toLocaleString()} tok</span>
              </div>
            </div>
          </div>
        )}

        {/* Message list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', paddingTop: 40, lineHeight: 1.7 }}>
              {hasContext
                ? <>Ask anything about <em>{contextLabel}</em> — plot, characters, prose, craft.</>
                : 'Select a document in the binder to give the AI context, or just ask a question.'}
            </div>
          )}
          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1
            const isStreamingThis = streaming && isLast && msg.role === 'assistant'
            return (
              <div
                key={i}
                style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
              >
                {msg.isError ? (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    background: 'var(--bg-3)', border: '1px solid var(--st-idea)',
                    borderRadius: 10, maxWidth: '85%', padding: '8px 12px',
                    fontSize: 13, lineHeight: 1.5,
                  }}>
                    <span style={{ color: 'var(--st-idea)', flexShrink: 0, marginTop: 1 }}>⚠</span>
                    <span style={{ color: 'var(--text-2)' }}>{msg.content}</span>
                  </div>
                ) : (
                  <>
                    <div style={{
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-2)',
                      color: msg.role === 'user' ? 'var(--accent-fg)' : 'var(--text)',
                      borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                      maxWidth: msg.role === 'user' ? '75%' : '88%',
                      padding: '9px 13px',
                      fontSize: 14,
                      lineHeight: 1.65,
                    }}>
                      {isThinking && isLast
                        ? <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>Thinking…</span>
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
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{ borderTop: '0.5px solid var(--border)', padding: '12px 20px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something… (Enter to send, Shift+Enter for newline)"
            rows={2}
            style={{
              flex: 1,
              resize: 'none',
              background: 'var(--bg-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          {streaming
            ? <button className="btn" onClick={stop} style={{ flexShrink: 0 }}>Stop</button>
            : <button className="btn primary" onClick={send} disabled={!input.trim()} style={{ flexShrink: 0 }}>Send</button>
          }
        </div>
      </div>
    </div>
  )
}
