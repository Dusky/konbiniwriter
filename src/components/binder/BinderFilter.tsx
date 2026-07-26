import React, { useMemo, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { allKeywords, keywordCounts, isEmptyQuery, normalizeKeyword, runQuery } from '@shared/query'
import type { NodeQuery } from '@shared/query'
import { STATUS_META, STATUS_ORDER, LABEL_META, LABEL_ORDER } from '@shared/utils'
import type { StatusId, LabelId } from '@shared/types'
import Icon from '../common/Icon'

/** Toggle a value in/out of an any-of filter list. */
function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const cur = list ?? []
  const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]
  return next.length ? next : undefined
}

/**
 * The binder's filter panel and saved Collections.
 *
 * Everything here builds a `NodeQuery` (see shared/query.ts); nothing evaluates
 * it. A Collection is just that query, named and kept, so re-running last
 * week's question costs one click instead of rebuilding the filter.
 */
export default function BinderFilter(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const query = useProjectStore((s) => s.binderQuery)
  const setQuery = useProjectStore((s) => s.setBinderQuery)
  const clearQuery = useProjectStore((s) => s.clearBinderQuery)
  const collections = useProjectStore((s) => s.collections)
  const activeCollectionId = useProjectStore((s) => s.activeCollectionId)
  const applyCollection = useProjectStore((s) => s.applyCollection)
  const saveCollection = useProjectStore((s) => s.saveCollection)
  const deleteCollection = useProjectStore((s) => s.deleteCollection)

  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const keywords = useMemo(() => (project ? allKeywords(project) : []), [project])
  const counts = useMemo(() => (project ? keywordCounts(project) : new Map()), [project])
  const active = !isEmptyQuery(query)
  const patch = (p: Partial<NodeQuery>) => setQuery({ ...query, ...p })

  // "3 of 19" — a filtered binder that doesn't say what it's hiding reads as a
  // project that lost most of its chapters.
  const tally = useMemo(() => {
    if (!project || !active) return null
    return { shown: runQuery(project, query).length, total: runQuery(project, {}).length }
  }, [project, query, active])

  const commitSave = () => {
    const trimmed = name.trim()
    if (trimmed) saveCollection(trimmed, query)
    setNaming(false)
    setName('')
  }

  return (
    <div className="bf">
      <div className="bf-bar">
        <button
          className={`bf-toggle${open || active ? ' on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="Filter the binder"
        >
          <Icon name="text-search" size={13} />
          <span>Filter</span>
          {active && <span className="bf-dot" />}
        </button>
        {tally && <span className="bf-tally">{tally.shown} of {tally.total}</span>}
        {active && (
          <button className="bf-clear" onClick={clearQuery} title="Clear the filter">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      {collections.length > 0 && (
        <div className="bf-cols">
          {collections.map((c) => (
            <span key={c.id} className={`bf-col${activeCollectionId === c.id ? ' on' : ''}`}>
              <button className="bf-col-name" onClick={() => applyCollection(c.id)} title="Apply this collection">
                {c.name}
              </button>
              <button
                className="bf-col-x"
                aria-label={`Delete collection ${c.name}`}
                title="Delete collection"
                onClick={() => deleteCollection(c.id)}
              ><Icon name="x" size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="bf-panel">
          <input
            className="bf-text"
            placeholder="Text in title, synopsis or body…"
            value={query.text ?? ''}
            onChange={(e) => patch({ text: e.target.value || undefined })}
          />

          {keywords.length > 0 && (
            <div className="bf-group">
              <div className="bf-lbl">Keywords</div>
              <div className="bf-chips">
                {keywords.map((k) => {
                  const on = (query.keywords ?? []).some((x) => normalizeKeyword(x) === normalizeKeyword(k))
                  return (
                    <button
                      key={k}
                      className={`bf-chip${on ? ' on' : ''}`}
                      onClick={() => patch({ keywords: toggle(query.keywords, k) })}
                    >
                      {k}<span className="bf-n">{counts.get(normalizeKeyword(k)) ?? 0}</span>
                    </button>
                  )
                })}
              </div>
              {(query.keywords?.length ?? 0) > 1 && (
                <div className="bf-hint">Showing only nodes with all {query.keywords!.length} keywords.</div>
              )}
            </div>
          )}

          <div className="bf-group">
            <div className="bf-lbl">Status</div>
            <div className="bf-chips">
              {STATUS_ORDER.map((st) => (
                <button
                  key={st}
                  className={`bf-chip${(query.statuses ?? []).includes(st as StatusId) ? ' on' : ''}`}
                  onClick={() => patch({ statuses: toggle(query.statuses, st as StatusId) })}
                >
                  <span className="dot" style={{ background: STATUS_META[st].color }} />
                  {STATUS_META[st].label}
                </button>
              ))}
            </div>
          </div>

          <div className="bf-group">
            <div className="bf-lbl">Label</div>
            <div className="bf-chips">
              {LABEL_ORDER.filter((lb) => lb !== 'none').map((lb) => (
                <button
                  key={lb}
                  className={`bf-chip${(query.labels ?? []).includes(lb as LabelId) ? ' on' : ''}`}
                  onClick={() => patch({ labels: toggle(query.labels, lb as LabelId) })}
                >
                  <span className="dot" style={{ background: LABEL_META[lb].color }} />
                  {LABEL_META[lb].label}
                </button>
              ))}
            </div>
          </div>

          <div className="bf-group">
            <div className="bf-lbl">Words</div>
            <div className="bf-range">
              <input
                className="bf-num" type="number" min={0} placeholder="min"
                value={query.minWords ?? ''}
                onChange={(e) => patch({ minWords: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
              <span>–</span>
              <input
                className="bf-num" type="number" min={0} placeholder="max"
                value={query.maxWords ?? ''}
                onChange={(e) => patch({ maxWords: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="bf-group">
            <div className="bf-lbl">In compile</div>
            <div className="bf-chips">
              {([['Included', true], ['Excluded', false]] as const).map(([label, val]) => (
                <button
                  key={label}
                  className={`bf-chip${query.includeInCompile === val ? ' on' : ''}`}
                  onClick={() => patch({ includeInCompile: query.includeInCompile === val ? undefined : val })}
                >{label}</button>
              ))}
            </div>
          </div>

          <div className="bf-foot">
            {naming ? (
              <input
                className="bf-text"
                autoFocus
                placeholder="Collection name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSave()
                  if (e.key === 'Escape') { setNaming(false); setName('') }
                }}
              />
            ) : (
              <button className="btn sm" disabled={!active} onClick={() => setNaming(true)}>
                Save as Collection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
