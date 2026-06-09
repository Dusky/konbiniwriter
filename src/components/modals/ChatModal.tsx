import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { streamCompletion } from '../../lib/AIClient'

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

const MAX_STORED = 60

export default function ChatModal({ onClose }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const selectedId = useProjectStore((s) => s.selectedId)

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const docContent = selectedId && project
    ? (project.docs[selectedId]?.content ?? '')
    : ''

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

  function persistMessages(msgs: Message[]) {
    if (!project) return
    const toStore = msgs.filter((m) => !m.isError).slice(-MAX_STORED)
    window.api.prefs.set(chatKey(project.id, selectedId), JSON.stringify(toStore))
  }

  function buildSystemPrompt(): string {
    let sys = 'You are a creative writing assistant. Help the author with story questions, character development, plot, prose, and craft. Be specific and direct. The author\'s current document is provided for context.'
    if (docContent.trim()) {
      sys += `\n\nCurrent document:\n---\n${docContent.slice(0, 4000)}\n---`
    }
    return sys
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)

    // Push placeholder assistant message
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    abortRef.current = new AbortController()

    await streamCompletion(
      newMessages,
      {
        systemPrompt: buildSystemPrompt(),
        maxTokens: 1024,
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
            // Persist without the error message so the conversation is intact on reload
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

  const isThinking = streaming && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content === ''

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 680, height: 500, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        role="dialog" aria-modal="true" aria-label="AI Chat"
      >
        {/* Header */}
        <div className="modal-hd" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>AI Chat</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {messages.length > 0 && (
              <button className="btn" onClick={clearChat}>Clear</button>
            )}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Message list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              {docContent.trim()
                ? 'Ask anything about your writing — plot, characters, prose, craft.'
                : 'Select a document in the binder to give the AI context, or just ask a question.'}
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              {msg.isError ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    background: 'var(--bg-3)',
                    border: '1px solid var(--st-idea)',
                    borderRadius: 10,
                    maxWidth: '85%',
                    padding: '8px 12px',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: 'var(--st-idea)', flexShrink: 0, marginTop: 1 }}>⚠</span>
                  <span style={{ color: 'var(--text-2)' }}>{msg.content}</span>
                </div>
              ) : (
                <div
                  style={{
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-2)',
                    color: msg.role === 'user' ? 'var(--accent-fg)' : 'var(--text)',
                    borderRadius: 12,
                    maxWidth: msg.role === 'user' ? '75%' : '85%',
                    padding: '8px 12px',
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {isThinking && i === messages.length - 1
                    ? <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>AI is thinking…</span>
                    : msg.content}
                  {streaming && i === messages.length - 1 && msg.role === 'assistant' && !isThinking && (
                    <span style={{ opacity: 0.7, animation: 'pulse 1s infinite' }}>▌</span>
                  )}
                </div>
              )}
            </div>
          ))}
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
