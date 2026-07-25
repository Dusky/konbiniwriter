// scrivener.ts — import a Scrivener `.scriv` project.
//
// A .scriv is a folder, which is lucky: the same directory picker that already
// imports a folder of Markdown can hand us one, and we detect it by the
// `.scrivx` manifest inside.
//
// Layout (v2 and v3 differ only in where the prose lives):
//   MyNovel.scriv/
//     MyNovel.scrivx            XML: the binder tree, titles, UUIDs
//     Files/Data/<UUID>/content.rtf     ← v3
//     Files/Data/<UUID>/synopsis.txt    ← v3 corkboard synopsis
//     Files/Docs/<ID>.rtf               ← v2
//
// Deliberately dependency-free and DOM-free: shared/ is imported by Electron
// main as well as the renderer, and a tiny purpose-built reader is easier to
// trust here than pulling in an XML library for one file format.

import type { ImportDoc } from './types'
import { rtfToText } from './rtf'

// ── Minimal XML ──────────────────────────────────────────────────────────────

export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')   // last, so "&amp;lt;" doesn't become "<"
}

/**
 * Parse the subset of XML a .scrivx uses: elements, attributes, text, CDATA,
 * comments, self-closing tags. No namespaces, DTDs or entities beyond the
 * predefined five — none of which Scrivener emits.
 */
export function parseXml(src: string): XmlNode | null {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) break

    if (lt > i) {
      const text = decodeEntities(src.slice(i, lt))
      if (text.trim()) stack[stack.length - 1].text += text
    }

    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3 || src.length; continue }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt)
      stack[stack.length - 1].text += src.slice(lt + 9, end === -1 ? undefined : end)
      i = end === -1 ? src.length : end + 3
      continue
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      i = src.indexOf('>', lt) + 1 || src.length
      continue
    }

    const gt = src.indexOf('>', lt)
    if (gt === -1) break
    const raw = src.slice(lt + 1, gt).trim()

    if (raw.startsWith('/')) {                       // closing
      if (stack.length > 1) stack.pop()
      i = gt + 1
      continue
    }

    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1).trim() : raw
    const sp = body.search(/\s/)
    const tag = sp === -1 ? body : body.slice(0, sp)
    const attrs: Record<string, string> = {}
    if (sp !== -1) {
      const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g
      let am: RegExpExecArray | null
      const attrSrc = body.slice(sp)
      while ((am = attrRe.exec(attrSrc))) {
        attrs[(am[1] ?? am[3]).toLowerCase()] = decodeEntities(am[2] ?? am[4] ?? '')
      }
    }
    const node: XmlNode = { tag, attrs, children: [], text: '' }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
    i = gt + 1
  }
  return root.children.length ? root : null
}

const childrenNamed = (n: XmlNode, tag: string): XmlNode[] =>
  n.children.filter((c) => c.tag.toLowerCase() === tag.toLowerCase())
const firstNamed = (n: XmlNode, tag: string): XmlNode | undefined => childrenNamed(n, tag)[0]

// ── Detection ────────────────────────────────────────────────────────────────

/** True when a picked folder looks like a Scrivener project. */
export function isScrivenerBundle(paths: string[]): boolean {
  return paths.some((p) => /\.scrivx$/i.test(p))
}

/** Path of the `.scrivx` manifest within the picked folder. */
export function findScrivxPath(paths: string[]): string | undefined {
  // Prefer the shallowest match — the manifest sits at the bundle root.
  return paths.filter((p) => /\.scrivx$/i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0]
}

// ── Import ───────────────────────────────────────────────────────────────────

export interface ScrivenerImport {
  title: string
  docs: ImportDoc[]
  /** Binder items that had no readable text (folders are expected here). */
  emptyCount: number
}

/** Titles become path segments, so they must not introduce fake nesting. */
function safeSegment(s: string): string {
  const cleaned = s.replace(/[/\\]/g, '-').replace(/\s+/g, ' ').trim()
  return cleaned || 'Untitled'
}

/**
 * Turn a Scrivener bundle into importable documents.
 *
 * @param files relative path (POSIX, from the bundle root) → file contents.
 *              RTF and XML are both text, so the caller can read everything
 *              with `File.text()`.
 */
export function parseScrivener(files: Map<string, string>): ScrivenerImport | { error: string } {
  const paths = [...files.keys()]
  const scrivxPath = findScrivxPath(paths)
  if (!scrivxPath) return { error: 'No .scrivx manifest found — is this a Scrivener project folder?' }

  const xml = parseXml(files.get(scrivxPath) ?? '')
  if (!xml) return { error: 'The .scrivx manifest could not be read.' }

  const projectNode = firstNamed(xml, 'ScrivenerProject') ?? xml
  const binder = firstNamed(projectNode, 'Binder')
  if (!binder) return { error: 'The .scrivx manifest has no <Binder>.' }

  // Index the data files once: UUID/ID → contents, tolerant of v2 vs v3 layout.
  const byId = new Map<string, { rtf?: string; synopsis?: string }>()
  for (const p of paths) {
    let m = /(?:^|\/)Files\/Data\/([^/]+)\/(content\.rtf|synopsis\.txt)$/i.exec(p)
    if (m) {
      const slot = byId.get(m[1]) ?? {}
      if (m[2].toLowerCase() === 'content.rtf') slot.rtf = files.get(p)
      else slot.synopsis = files.get(p)
      byId.set(m[1], slot)
      continue
    }
    m = /(?:^|\/)Files\/Docs\/(\d+)\.rtf$/i.exec(p)          // v2 prose
    if (m) { const slot = byId.get(m[1]) ?? {}; slot.rtf = files.get(p); byId.set(m[1], slot); continue }
    m = /(?:^|\/)Files\/Docs\/(\d+)_synopsis\.txt$/i.exec(p) // v2 synopsis
    if (m) { const slot = byId.get(m[1]) ?? {}; slot.synopsis = files.get(p); byId.set(m[1], slot) }
  }

  const docs: ImportDoc[] = []
  let emptyCount = 0

  const walk = (item: XmlNode, trail: string[]) => {
    const id = item.attrs['uuid'] || item.attrs['id'] || ''
    const type = (item.attrs['type'] || '').toLowerCase()
    const title = safeSegment(firstNamed(item, 'Title')?.text ?? 'Untitled')

    // Scrivener's own Trash is deliberately not imported.
    if (type === 'trashfolder') return

    const data = byId.get(id)
    const body = data?.rtf ? rtfToText(data.rtf) : ''
    const synopsis = data?.synopsis?.trim()

    const kids = firstNamed(item, 'Children')
    const childItems = kids ? childrenNamed(kids, 'BinderItem') : []

    if (body.trim()) {
      docs.push({ path: [...trail, `${title}.md`].join('/'), content: body, synopsis })
    } else if (childItems.length === 0) {
      // A leaf with no prose still deserves to exist — it's an outline stub the
      // writer created, and silently dropping it would lose structure.
      emptyCount++
      docs.push({ path: [...trail, `${title}.md`].join('/'), content: '', synopsis })
    }

    for (const child of childItems) walk(child, [...trail, title])
  }

  for (const item of childrenNamed(binder, 'BinderItem')) walk(item, [])

  if (docs.length === 0) return { error: 'The binder had no importable documents.' }

  const title = scrivxPath.split('/').pop()!.replace(/\.scrivx$/i, '') || 'Imported Project'
  return { title, docs, emptyCount }
}
