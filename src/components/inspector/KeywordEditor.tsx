import React, { useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { allKeywords, normalizeKeyword, normalizeKeywords } from '@shared/query'
import Icon from '../common/Icon'

interface Props {
  keywords: string[]
  onChange: (keywords: string[]) => void
}

/**
 * Token editor for a node's keywords.
 *
 * Suggestions come from keywords already in use across the project, because the
 * failure mode that makes tagging useless is spelling the same tag three ways.
 * Clicking a token filters the binder by it — the tag is only worth applying if
 * it's one click from the thing it's for.
 */
export default function KeywordEditor({ keywords, onChange }: Props): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const setBinderQuery = useProjectStore((s) => s.setBinderQuery)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const existing = useMemo(() => (project ? allKeywords(project) : []), [project])
  const have = new Set(keywords.map(normalizeKeyword))

  const suggestions = useMemo(() => {
    const q = normalizeKeyword(draft)
    return existing
      .filter((k) => !have.has(normalizeKeyword(k)))
      .filter((k) => !q || normalizeKeyword(k).includes(q))
      .slice(0, 8)
    // `have` is derived from `keywords`, which is already a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, draft, keywords])

  const add = (raw: string) => {
    const next = normalizeKeywords([...keywords, raw])
    if (next.length !== keywords.length) onChange(next)
    setDraft('')
    inputRef.current?.focus()
  }

  const remove = (k: string) => onChange(keywords.filter((x) => x !== k))

  return (
    <div className="kw">
      <div className="kw-tokens">
        {keywords.map((k) => (
          <span key={k} className="kw-tok">
            <button
              className="kw-tok-name"
              title={`Filter the binder by "${k}"`}
              onClick={() => setBinderQuery({ keywords: [k] })}
            >{k}</button>
            <button
              className="kw-tok-x"
              aria-label={`Remove keyword ${k}`}
              title="Remove"
              onClick={() => remove(k)}
            ><Icon name="x" size={11} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="kw-input"
          value={draft}
          placeholder={keywords.length ? 'Add…' : 'Add a keyword…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (draft.trim()) add(draft) }
            // Backspace on an empty field peels the last token off, the way
            // every other token input behaves.
            else if (e.key === 'Backspace' && !draft && keywords.length) remove(keywords[keywords.length - 1])
          }}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="kw-sugg">
          {suggestions.map((k) => (
            <button key={k} className="kw-sugg-item" onClick={() => add(k)}>{k}</button>
          ))}
        </div>
      )}
    </div>
  )
}
