// agentTools.ts — the tool set the chat assistant can call to work across the
// whole project. Reads are direct; mutations go through the app's existing
// reviewable seams (edits → the changeset proposal pipeline, new docs → the
// node-mutation seam) so "the author is always in control" still holds.

import type { Project, ID } from '@shared/types'
import { retrieve } from './RetrievalService'

// Anthropic tool-definition shape.
export interface ToolDef {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'search_manuscript',
    description: 'Search the whole manuscript for passages relevant to a query. Use this to find where something was established before writing or answering.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for' } }, required: ['query'] },
  },
  {
    name: 'list_documents',
    description: 'List the project outline — every folder and document with its title, so you know what exists and how it is organized.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_document',
    description: 'Read the full text of one document by its title.',
    input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'remember',
    description: 'Save a durable fact, preference, or decision to the project notes so it is available in every future conversation. Use only for lasting, reusable facts.',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
  },
  {
    name: 'create_document',
    description: 'Create a new document in the binder, optionally inside an existing folder and with starting content. Use for new scenes, chapters, or notes.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        parent: { type: 'string', description: 'Title of an existing folder to place it under (optional).' },
        content: { type: 'string', description: 'Initial content (optional).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'propose_edit',
    description: 'Propose replacing a document\'s full text with a revised version. This does NOT write directly — it queues a change for the author to review and accept or reject. Use for rewrites/revisions of existing prose.',
    input_schema: {
      type: 'object',
      properties: {
        document: { type: 'string', description: 'Title of the document to edit.' },
        new_text: { type: 'string', description: 'The complete revised document text.' },
      },
      required: ['document', 'new_text'],
    },
  },
]

/** Capabilities the executors need, supplied by the chat UI (which owns store access). */
export interface AgentToolContext {
  project: Project
  appendNote: (note: string) => void
  createDocument: (title: string, parentTitle: string | undefined, content: string) => Promise<void>
  proposeEdit: (docId: ID, docTitle: string, original: string, proposed: string) => void
}

/** A short human label for the "used a tool" indicator in chat. */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'search_manuscript': return `Searched: "${String(input.query ?? '')}"`
    case 'list_documents': return 'Listed the project outline'
    case 'get_document': return `Read "${String(input.title ?? '')}"`
    case 'remember': return `Remembered: ${String(input.note ?? '')}`
    case 'create_document': return `Created "${String(input.title ?? '')}"`
    case 'propose_edit': return `Proposed an edit to "${String(input.document ?? '')}" (review it in Changeset)`
    default: return `Used ${name}`
  }
}

function findDoc(project: Project, title: string): { id: ID; title: string } | null {
  const want = title.trim().toLowerCase()
  for (const node of Object.values(project.nodes)) {
    if (node.type !== 'folder' && node.title.trim().toLowerCase() === want) return { id: node.id, title: node.title }
  }
  return null
}

function outline(project: Project): string {
  const lines: string[] = []
  const walk = (ids: ID[], depth: number) => {
    for (const id of ids) {
      const n = project.nodes[id]
      if (!n) continue
      lines.push(`${'  '.repeat(depth)}${n.type === 'folder' ? '▸' : '·'} ${n.title}`)
      if (n.childIds.length) walk(n.childIds, depth + 1)
    }
  }
  walk(project.rootIds, 0)
  return lines.join('\n')
}

export async function executeTool(name: string, input: Record<string, unknown>, ctx: AgentToolContext): Promise<string> {
  const { project } = ctx
  switch (name) {
    case 'search_manuscript': {
      const query = String(input.query ?? '').trim()
      if (!query) return 'No query provided.'
      const hits = retrieve(project, query, { limit: 6, maxChars: 6000 })
      if (hits.length === 0) return 'No relevant passages found.'
      return hits.map((h) => `[from "${h.title}"]\n${h.text}`).join('\n\n')
    }
    case 'list_documents':
      return outline(project) || 'The project is empty.'
    case 'get_document': {
      const found = findDoc(project, String(input.title ?? ''))
      if (!found) return `No document titled "${input.title}". Use list_documents to see exact titles.`
      const content = project.docs[found.id]?.content ?? ''
      return content.trim() ? content : '(this document is empty)'
    }
    case 'remember': {
      const note = String(input.note ?? '').trim()
      if (!note) return 'Nothing to remember.'
      ctx.appendNote(note)
      return `Saved to project notes: ${note}`
    }
    case 'create_document': {
      const title = String(input.title ?? '').trim()
      if (!title) return 'A title is required.'
      const parent = input.parent ? String(input.parent) : undefined
      await ctx.createDocument(title, parent, String(input.content ?? ''))
      return `Created document "${title}"${parent ? ` under "${parent}"` : ''}.`
    }
    case 'propose_edit': {
      const found = findDoc(project, String(input.document ?? ''))
      if (!found) return `No document titled "${input.document}". Use list_documents to see exact titles.`
      const original = project.docs[found.id]?.content ?? ''
      const proposed = String(input.new_text ?? '')
      if (proposed.trim() === original.trim()) return 'The proposed text is identical to the current text — nothing to change.'
      ctx.proposeEdit(found.id, found.title, original, proposed)
      return `Queued an edit to "${found.title}" for the author to review in Changeset.`
    }
    default:
      return `Unknown tool: ${name}`
  }
}
