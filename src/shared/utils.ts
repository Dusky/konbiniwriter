// shared/utils.ts — pure helpers, no Node/DOM deps

let _uid = 0

export function uid(prefix = 'id'): string {
  _uid += 1
  return `${prefix}-${Date.now().toString(36)}-${_uid.toString(36)}`
}

export function stripMd(s: string): string {
  return (s || '')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/[#>*_~\-[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function wordCount(s: string): number {
  const t = stripMd(s)
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

export function charCount(s: string): number {
  return (s || '').length
}

// Validates names for window.api.aux.* (project "aux" files, e.g. chat.json).
// Guards against path traversal — no slashes, dots-only, or leading dot.
const AUX_NAME_RE = /^[\w][\w.-]*$/
export function isValidAuxName(name: string): boolean {
  return AUX_NAME_RE.test(name) && !name.includes('..')
}

export function relTime(ms: number): string {
  const d = (Date.now() - ms) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) {
    const h = Math.floor(d / 3600)
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  }
  const days = Math.floor(d / 86400)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** Platform-specific key chord formatting. */
export function fmtKey(combo: string, platform: string): string {
  const mac = platform === 'darwin'
  const map: Record<string, string> = mac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '⏎', delete: '⌫' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', enter: 'Enter', delete: 'Del' }
  const parts = combo.split('+').map((t) => map[t] ?? t.toUpperCase())
  const dedup = parts.filter((p, i) => i === 0 || p !== parts[i - 1])
  return mac ? dedup.join('') : dedup.join('+')
}

export const STATUS_META = {
  idea:       { label: 'Idea',         color: 'var(--st-idea)' },
  todo:       { label: 'To Do',        color: 'var(--st-todo)' },
  inprogress: { label: 'In Progress',  color: 'var(--st-prog)' },
  draft:      { label: 'First Draft',  color: 'var(--st-draft)' },
  revised:    { label: 'Revised',      color: 'var(--st-rev)' },
  final:      { label: 'Final',        color: 'var(--st-final)' },
} as const

export const STATUS_ORDER = ['idea', 'todo', 'inprogress', 'draft', 'revised', 'final'] as const

export const LABEL_META = {
  none:      { label: 'No Label',  color: 'transparent' },
  scene:     { label: 'Scene',     color: 'oklch(0.62 0.11 300)' },
  chapter:   { label: 'Chapter',   color: 'oklch(0.62 0.10 250)' },
  note:      { label: 'Note',      color: 'oklch(0.64 0.09 190)' },
  character: { label: 'Character', color: 'oklch(0.66 0.12 70)' },
  idea:      { label: 'Idea',      color: 'oklch(0.64 0.12 20)' },
} as const

export const LABEL_ORDER = ['none', 'scene', 'chapter', 'note', 'character', 'idea'] as const
