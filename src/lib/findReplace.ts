// findReplace.ts — the matcher shared by project search and project-wide replace.
// Regex-backed so case-sensitivity and whole-word fall out naturally (and a regex
// mode is trivial to expose later). Replacement is applied literally — a function
// replacer avoids `$1`/`$&` interpretation in the replacement string.

export interface MatchOptions { caseSensitive?: boolean; wholeWord?: boolean }

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a global matcher for `query`, or null if the query is empty/invalid.
 *
 * Whole-word anchors are applied per edge, not unconditionally: `\b` asserts a
 * *transition*, so wrapping a query that starts or ends in punctuation ("M.V.",
 * "—said") in `\b` produces a regex that can never match anything. Anchoring
 * only the edges that are word characters gives `\bMira\b` for a name and a
 * bare pattern for one the boundary can't describe.
 */
export function makeMatcher(query: string, opts: MatchOptions = {}): RegExp | null {
  if (!query) return null
  let pattern = escapeRegExp(query)
  if (opts.wholeWord) {
    pattern = (/^\w/.test(query) ? '\\b' : '') + pattern + (/\w$/.test(query) ? '\\b' : '')
  }
  try {
    return new RegExp(pattern, 'g' + (opts.caseSensitive ? '' : 'i'))
  } catch {
    return null
  }
}

/** Count matches of a global matcher in `content`. */
export function countMatches(content: string, matcher: RegExp): number {
  const m = content.match(matcher)
  return m ? m.length : 0
}

/** Replace every match with `replacement`, treated as a literal string. */
export function replaceWith(content: string, matcher: RegExp, replacement: string): string {
  return content.replace(matcher, () => replacement)
}
