import React, { useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import { useAIStore } from '../../store/aiStore'
import { streamCompletion, type AIMessage } from '../../lib/AIClient'
import { buildContext, renderContext, estimateTokens } from '../../lib/ContextBuilder'
import { composeCustomInstructions } from '../../lib/CustomInstructions'
import { MEMORY_INSTRUCTION, extractMemories, stripMemories, appendMemories } from '../../lib/AiMemory'
import { runAgent } from '../../lib/agent'
import { toolLabel, type AgentToolContext } from '../../lib/agentTools'
import { createProposal } from '../../lib/ProposalService'
import { resolveConfigSlot, configDocId } from '../../lib/agentConfig'
import Icon from '../common/Icon'
import ConfirmDialog from '../common/ConfirmDialog'
import ContextMenu, { type MenuItem } from '../common/ContextMenu'
import { kbd } from '../../lib/kbd'
import type { Project } from '@shared/types'
import { uid } from '@shared/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  /** Durable notes this reply saved to project memory (for the UI indicator). */
  memories?: string[]
  /** Human labels for tools this reply used (for the UI indicator). */
  toolUses?: string[]
  /**
   * The document that was open when this was asked.
   *
   * A thread now spans documents, so scrolling back through one is confusing
   * without it — "make this tighter" means nothing three files later.
   */
  docTitle?: string
}

type ChatThreads = Record<string, Message[]>

const CHAT_FILE = 'chat.json'
const WRITE_DEBOUNCE_MS = 1000

/**
 * The thread every project starts in.
 *
 * Threads used to be keyed by the open document, which meant opening a file to
 * look at it swapped your conversation out from under you, and getting the
 * conversation back dragged the editor to wherever that chat had started. One
 * assistant you can walk through the manuscript with is the point; the open
 * document is *context*, not the conversation's identity.
 *
 * Existing per-document threads keep their node-id keys, so nothing is lost and
 * chat.json stays readable by an older build — they just become named threads.
 */
const DEFAULT_THREAD = '__project__'

/** Which thread the panel was last in, per project. */
const threadPrefKey = (projectId: string) => `konbini:chat:thread:${projectId}`

/**
 * What to call a thread in the list.
 *
 * Threads migrated from the per-document era keep their document's title, so
 * nothing a writer saved looks renamed. Threads started since name themselves
 * from their opening question, which is more use than the title of whichever
 * file happened to be open at the time.
 */
function threadLabel(key: string, msgs: Message[], project: Project | null): string {
  if (key === DEFAULT_THREAD) return 'Project-wide'
  const node = project?.nodes[key]
  if (node) return node.title
  const first = msgs.find((m) => m.role === 'user')?.content ?? ''
  const line = stripMemories(first).replace(/\s+/g, ' ').trim()
  if (!line) return 'Untitled chat'
  return line.length > 48 ? line.slice(0, 47) + '…' : line
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
    fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-lg)', maxWidth: 160,
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
  const aiToolsEnabled = useAIStore((s) => s.aiToolsEnabled)
  const aiConfigToolsEnabled = useAIStore((s) => s.aiConfigToolsEnabled)
  const service = useAIStore((s) => s.service)
  const agentCommand = useAIStore((s) => s.agentCommand)
  const agentActive = service === 'agent'
  const setAiInstructions = useProjectStore((s) => s.setAiInstructions)
  const addDictionaryWord = useProjectStore((s) => s.addDictionaryWord)
  const upsertCodexEntry = useProjectStore((s) => s.upsertCodexEntry)
  const setToast = useShellStore((s) => s.setToast)
  // Native function-calling, on whichever provider is configured — `runAgent`
  // speaks both Anthropic's tool_use blocks and the OpenAI-compatible
  // tool_calls format. A model that can't call tools still answers; it just
  // never asks for one, and the loop falls through to a plain reply.
  const toolsActive = aiToolsEnabled
  const configToolsActive = toolsActive && aiConfigToolsEnabled

  const [threads, setThreads] = useState<ChatThreads>({})
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showThreads, setShowThreads] = useState(false)
  // The conversation you are in, independent of the document you are looking at.
  const [activeThreadId, setActiveThreadId] = useState<string>(DEFAULT_THREAD)
  const abortRef = useRef<AbortController | null>(null)
  const agentAbortRef = useRef<{ abort: () => void } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadsRef = useRef<ChatThreads>({})
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const key = activeThreadId
  const messages = threads[key] ?? []

  // Restore the last thread when a project opens, so reopening the app puts you
  // back in the conversation you were having rather than a blank one.
  useEffect(() => {
    if (!project) return
    const saved = window.api.prefs.get(threadPrefKey(project.id))
    setActiveThreadId(saved || DEFAULT_THREAD)
  }, [project?.id])

  const switchThread = (id: string) => {
    setActiveThreadId(id)
    if (project) window.api.prefs.set(threadPrefKey(project.id), id)
  }

  // Every saved chat thread, so switching documents never hides past chats:
  // opening one navigates to its document (or the project-wide thread).
  const threadEntries = React.useMemo(() => {
    return Object.entries(threads)
      .filter(([, msgs]) => msgs.length > 0)
      .map(([k, msgs]) => ({
        key: k,
        label: threadLabel(k, msgs, project),
        count: msgs.length,
        preview: stripMemories(msgs[msgs.length - 1]?.content ?? '').replace(/\s+/g, ' ').slice(0, 72),
      }))
      .sort((a, b) => (a.key === key ? -1 : b.key === key ? 1 : a.label.localeCompare(b.label)))
  }, [threads, project, key])

  // Switches the conversation only. It deliberately does NOT move the editor:
  // wanting to re-read what you discussed yesterday is not wanting to be
  // navigated somewhere.
  function openThread(k: string) {
    switchThread(k)
    setShowThreads(false)
  }

  function newThread() {
    switchThread(uid('chat'))
    setShowThreads(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

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

  // Write the current threads to disk now, cancelling any pending debounce.
  const flushChat = React.useCallback(() => {
    if (!project || !loaded) return
    if (writeTimerRef.current) { clearTimeout(writeTimerRef.current); writeTimerRef.current = null }
    window.api.aux.write(project.id, CHAT_FILE, JSON.stringify(threadsRef.current)).catch((e: Error) => useShellStore.getState().setToast('Chat history could not be saved: ' + e.message))
  }, [project?.id, loaded])

  // Persist immediately whenever a turn finishes (streaming → idle) instead of
  // waiting out the debounce — so a completed exchange is on disk even if the
  // app is quit right after.
  useEffect(() => { if (!streaming) flushChat() }, [streaming, flushChat])

  // Backstop: flush on window/tab close (hard quit skips React unmount).
  useEffect(() => {
    const onHide = () => flushChat()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [flushChat])

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

  // ── Transcript context menu ────────────────────────────────────────────────
  //
  // The chat is where names and coinages get invented, so it is the wrong place
  // to have no way to act on a word. Right-clicking a selection files it to the
  // dictionary or the codex, searches the manuscript for it, or copies it as a
  // wikilink — the same verbs the editor offers, on the same selection rules.
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number; text: string; message: string } | null>(null)

  function openChatMenu(e: React.MouseEvent) {
    e.preventDefault()
    const selected = (window.getSelection()?.toString() ?? '').trim()
    // The message under the pointer, so "Copy message" works without selecting.
    const body = (e.target as HTMLElement | null)?.closest('.msg-body')?.textContent ?? ''
    setChatMenu({ x: e.clientX, y: e.clientY, text: selected, message: body.trim() })
  }

  // Memoised, like the editor's menu: a fresh array on every render remounts the
  // menu under the pointer, so a click never lands on a stable element.
  const chatMenuItems = React.useMemo<MenuItem[]>(() => {
    const m = chatMenu
    if (!m) return []
    const items: MenuItem[] = []
    const short = m.text.length > 28 ? `${m.text.slice(0, 28)}…` : m.text
    if (m.text) {
      items.push({ label: 'Copy', icon: 'copy', hint: kbd('mod+c'), action: () => { void navigator.clipboard.writeText(m.text) } })
      // A single word is a spelling the proofer will otherwise keep flagging.
      if (!/\s/.test(m.text)) {
        items.push({ label: `Add “${short}” to Dictionary`, icon: 'book', action: () => {
          addDictionaryWord(m.text)
          setToast(`“${m.text}” added to the project dictionary`, 'success')
        } })
      }
      items.push(
        { label: `Add “${short}” to Codex`, icon: 'notebook', disabled: !project, action: () => {
          const now = new Date().toISOString()
          upsertCodexEntry({
            id: uid(), name: m.text, aliases: [], category: 'character',
            summary: '', facts: [], createdAt: now, modifiedAt: now, aiGenerated: false,
          })
          useShellStore.getState().setRailPanel('codex')
        } },
        { label: 'Copy as Wikilink', action: () => { void navigator.clipboard.writeText(`[[${m.text}]]`) } },
        { label: 'Search Project for Selection', icon: 'search', action: () => {
          useProjectStore.getState().setBinderQuery({ text: m.text })
        } },
        { label: '---' },
      )
    }
    if (m.message) {
      items.push({ label: 'Copy Message', icon: 'copy', action: () => { void navigator.clipboard.writeText(m.message) } })
    }
    items.push(
      { label: 'New Conversation', icon: 'plus', action: newThread },
      { label: 'Clear This Conversation', icon: 'trash', danger: true, disabled: messages.length === 0, action: () => setConfirmClear(true) },
    )
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMenu, project, messages.length, addDictionaryWord, upsertCodexEntry, setToast])

  function buildSystemPrompt(): string {
    const base = 'You are a creative writing assistant. Help the author with story questions, character development, plot, prose, and craft. Be specific and direct.'
    const parts = [base]
    const custom = composeCustomInstructions()
    if (custom) parts.push(custom)
    // Memory sentinel only when tools are off (with tools, `remember` is a tool).
    if (aiMemoryEnabled && project && !toolsActive) parts.push(MEMORY_INSTRUCTION)
    if (contextPacket) { const ctx = renderContext(contextPacket); if (ctx) parts.push(ctx) }
    if (attached.text) parts.push(attached.text)
    return parts.join('\n\n')
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming || !project) return

    const threadId = key
    // Stamp which document was in context: a thread spans files now, so
    // "tighten this" needs to say what "this" was.
    const userMsg: Message = { role: 'user', content: text, docTitle: hasContext ? contextLabel : undefined }
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

    // Local agent path: run the configured CLI agent in the project folder. It
    // edits files directly on disk; when it finishes we reload the project.
    if (agentActive) {
      if (!window.api.agent) {
        updateLastAssistant((last) => ({ ...last, content: 'The local agent runs only in the Konbini desktop app.', isError: true }))
        setStreaming(false)
        return
      }
      const handle = window.api.agent.run(
        { projectId: project.id, command: useAIStore.getState().agentCommand, prompt: text },
        {
          onChunk: (chunk) => updateLastAssistant((last) => ({ ...last, content: last.content + chunk })),
          onDone: async (code) => {
            updateLastAssistant((last) => ({ ...last, content: last.content || `(agent exited with code ${code})` }))
            setStreaming(false)
            try {
              const loc = useProjectStore.getState().project?.settings.location
              if (loc) {
                const reloaded = await window.api.project.open(loc)
                useProjectStore.getState().loadProject(reloaded)
                useShellStore.getState().setToast('Agent finished — project reloaded from disk.', 'info')
              }
            } catch { /* reload best-effort */ }
          },
          onError: (err) => { updateLastAssistant((last) => ({ ...last, content: err, isError: true })); setStreaming(false) },
          onAbort: () => setStreaming(false),
        },
      )
      agentAbortRef.current = handle
      return
    }

    // Tool-using path: the agent can search, read, create, and propose edits
    // across the project. Tool actions route through the reviewable seams.
    if (toolsActive) {
      const ctx: AgentToolContext = {
        project: useProjectStore.getState().project as Project,
        appendNote: (note) => {
          const cur = (useProjectStore.getState().project?.settings.aiInstructions as string | undefined) ?? ''
          setAiInstructions(appendMemories(cur, [note]))
        },
        createNode: async (nodeType, title, parentId, content) => {
          const proj = useProjectStore.getState().project
          if (!proj) return
          const result = await window.api.node.mutate(proj.id, { type: 'create', nodeType, title, parentId })
          useProjectStore.getState().applyMutation(result)
          const newId = Object.values(result.nodes).find((n) => n.ext['_newId'])?.id
          if (newId && content) {
            useProjectStore.getState().updateContent(newId, content)
            // updateContent only touches the store. Autosave runs for the
            // *active* editor only, so a document the AI just created — which
            // isn't open — would keep its text in memory and write nothing to
            // disk, leaving a blank .md and losing the draft on reload.
            await window.api.doc.write(proj.id, newId, content)
          }
        },
        proposeEdit: (docId, docTitle, original, proposed) => {
          const proposal = createProposal({ docId, docTitle, command: 'revision', label: `AI edit · ${docTitle}`, group: 'chat', original, proposed, scope: 'document' })
          useProjectStore.getState().queueProposal(proposal)
        },
        // Spread rather than set unconditionally: `runAgent` decides whether to
        // advertise the config tools by whether these are present, so an
        // author who hasn't opted in leaves the model unaware they exist.
        ...(configToolsActive ? {
          readConfig: (target: string, key?: string) => {
            const slot = resolveConfigSlot(target, key, {
              project: useProjectStore.getState().project,
              globalInstructions: useAIStore.getState().customInstructions ?? '',
            })
            return 'error' in slot ? slot : slot.current
          },
          proposeConfig: (target: string, key: string | undefined, newText: string, why: string) => {
            const slot = resolveConfigSlot(target, key, {
              project: useProjectStore.getState().project,
              globalInstructions: useAIStore.getState().customInstructions ?? '',
            })
            if ('error' in slot) return slot
            if (newText.trim() === slot.current.trim()) {
              return { error: 'That is identical to the current text — nothing to change.' }
            }
            useProjectStore.getState().queueProposal(createProposal({
              docId: configDocId(slot),
              docTitle: slot.label,
              command: 'revision',
              label: why.trim() ? `${slot.label} — ${why.trim()}` : `Change ${slot.label}`,
              group: 'chat-config',
              original: slot.current,
              proposed: newText,
              scope: 'document',
              configRef: { target: slot.target, key: slot.key },
            }))
            return `Queued a change to ${slot.label} for the author to review in Changeset. It is not in effect yet.`
          },
        } : {}),
      }
      const seenTools: string[] = []
      await runAgent(
        apiMessages,
        { maxTokens: chatMaxTokens, temperature: 0.7, systemPrompt: buildSystemPrompt(), signal: abortRef.current.signal, ctx },
        {
          onChunk: (chunk) => updateLastAssistant((last) => ({ ...last, content: last.content + chunk })),
          onToolUse: (name, inp) => { seenTools.push(toolLabel(name, inp)); updateLastAssistant((last) => ({ ...last, toolUses: [...seenTools] })) },
          onDone: (full) => { updateLastAssistant((last) => ({ ...last, content: full || last.content })); setStreaming(false) },
          onError: (err) => { updateLastAssistant((last) => ({ ...last, content: err.message, isError: true })); setStreaming(false) },
          onAbort: () => setStreaming(false),
        },
      )
      return
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
    agentAbortRef.current?.abort()
    agentAbortRef.current = null
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
        <span className="asst-mark"><Icon name="sparkle" /></span>
        <span className="asst-title" title={threadLabel(key, messages, project)}>
          Assistant
          <span className="asst-thread-name">{threadLabel(key, messages, project)}</span>
        </span>
        <div className="asst-hd-tools">
        <button
          className="linkish sm"
          onClick={newThread}
          title="Start a new conversation"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Icon name="plus" size={12} /> New
        </button>
        {threadEntries.length > 0 && (
          <button
            className={`linkish sm${showThreads ? ' on' : ''}`}
            onClick={() => setShowThreads((v) => !v)}
            title="Browse saved chats"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="clock" size={13} /> Chats ({threadEntries.length})
          </button>
        )}
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
      </div>

      {showThreads && (
        <div style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg)', maxHeight: 260, overflowY: 'auto' }}>
          <div className="hint" style={{ padding: '6px 14px 2px' }}>
            Switching a conversation doesn't move the editor.
          </div>
          {threadEntries.map((t) => (
            <button key={t.key} className={`asst-thread${t.key === key ? ' on' : ''}`} onClick={() => openThread(t.key)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                <span className="hint">{t.count} msg{t.count === 1 ? '' : 's'}</span>
              </div>
              {t.preview && <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{t.preview}</div>}
            </button>
          ))}
        </div>
      )}

      {agentActive && (
        <div style={{ padding: '6px 14px', borderBottom: '0.5px solid var(--border)', background: 'oklch(0.22 0.05 20)', fontSize: 11, color: 'var(--st-idea)', lineHeight: 1.4 }}>
          ⚠ Local-agent mode: each message runs <code style={{ fontFamily: 'var(--mono)' }}>{agentCommand}</code> in your project folder and edits files <b>directly</b> — no Changeset review. The project reloads when it finishes.
        </div>
      )}

      {!agentActive && project && (
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
              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 'var(--r-lg)', border: '1px dashed var(--border-2)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}
            >
              <option value="">+ Add file</option>
              {addableDocs.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
            </select>
          )}
        </div>
      )}

      {chatMenu && (
        <ContextMenu
          x={chatMenu.x}
          y={chatMenu.y}
          onClose={() => setChatMenu(null)}
          items={chatMenuItems}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear Chat"
          message="This deletes this conversation. Your other chats are untouched. This cannot be undone."
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
                  <Icon name={tier.included ? 'check' : 'x'} size={12} />
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

      <div className="asst-chat" onContextMenu={openChatMenu}>
        {messages.length === 0 && (
          <div className="asst-empty">
            {hasContext
              ? <>Ask anything about <em>{contextLabel}</em> — plot, characters, prose, craft.
                  Open another document and this same conversation follows you there.</>
              : 'Ask anything. Open a document and it becomes context for this conversation automatically.'}
          </div>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1
          const isStreamingThis = streaming && isLast && msg.role === 'assistant'
          // Only when it changes: a marker on every message in a single-file
          // stretch is noise, but the moment the subject moves you need to see it.
          const prevDoc = messages.slice(0, i).reverse().find((m) => m.role === 'user')?.docTitle
          const showDoc = msg.role === 'user' && msg.docTitle && msg.docTitle !== prevDoc
          return (
            <React.Fragment key={i}>
            {showDoc && (
              <div className="asst-doc-mark">
                <Icon name="document" size={11} /> {msg.docTitle}
              </div>
            )}
            <div className={`msg ${msg.role === 'user' ? 'user' : 'ai'}`}>
              {msg.role === 'assistant' && <span className="msg-mark"><Icon name="sparkle" /></span>}
              <div className="msg-body">
                {msg.isError ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: 'var(--st-idea)', flexShrink: 0, marginTop: 1 }}><Icon name="warning" size={14} /></span>
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
                    {msg.role === 'assistant' && msg.toolUses && msg.toolUses.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-3)' }}>
                        {msg.toolUses.map((t, ti) => (
                          <div key={ti} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}><Icon name="tool" size={12} /></span>
                            <span>{t}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.memories && msg.memories.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-3)' }}>
                        {msg.memories.map((m, mi) => (
                          <div key={mi} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}><Icon name="sparkle" size={12} /></span>
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
            </React.Fragment>
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
          ? <button className="send-btn" onClick={stop} title="Stop"><Icon name="stop" size={14} /></button>
          : <button className="send-btn" onClick={send} disabled={!input.trim()} title="Send"><Icon name="send" size={16} /></button>
        }
      </div>
    </div>
  )
}
