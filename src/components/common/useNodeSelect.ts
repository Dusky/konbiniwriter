import { useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import type { ID } from '@shared/types'

/**
 * The binder's click-to-select semantics, for the other views that show the
 * same nodes.
 *
 * Selection lives in the store and the context menu already understands
 * multi-selection (`useNodeMenu` builds a bulk menu whenever more than one node
 * is selected), so the only thing the outliner and corkboard were missing was a
 * click handler that can *build* one. Without it, the bulk actions were
 * binder-only in a way nothing in the UI explained.
 */
export function useNodeSelect(opts?: {
  /**
   * Ids the view can actually show.
   *
   * The corkboard browses the folder that is currently *selected*, so a
   * selection built there can start out holding the containing folder — and a
   * bulk trash would then take the whole chapter, from a menu that only listed
   * cards. When a scope is given, a selection that reaches outside it is
   * treated as not-a-selection: the click starts a fresh one.
   */
  rangeScope?: ID[]
  /** Keep the current view when a plain click selects a document. */
  keepView?: boolean
}): {
  /** Shift extends, ⌘/Ctrl toggles, a plain click collapses to one. */
  onSelectClick: (id: ID, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void
  /** Right-clicking outside the selection acts on what you clicked. */
  promoteForMenu: (id: ID) => void
} {
  const scope = opts?.rangeScope
  const keepView = opts?.keepView ?? false
  const selectNode = useProjectStore((s) => s.selectNode)
  const selectRange = useProjectStore((s) => s.selectRange)
  const toggleSelect = useProjectStore((s) => s.toggleSelect)

  // True when the live selection holds something this view can't show, so
  // extending or toggling would silently act on it.
  const strays = useCallback(() => {
    if (!scope) return false
    return useProjectStore.getState().selectedIds.some((x) => !scope.includes(x))
  }, [scope])

  const onSelectClick = useCallback((id: ID, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey) {
      const anchor = useProjectStore.getState().selectedId
      if (strays() || !anchor || (scope && !scope.includes(anchor))) selectNode(id, { keepView })
      else selectRange(id)
    } else if (e.metaKey || e.ctrlKey) {
      if (strays()) selectNode(id, { keepView })
      else toggleSelect(id)
    } else selectNode(id, { keepView })
  }, [selectNode, selectRange, toggleSelect, scope, keepView, strays])

  const promoteForMenu = useCallback((id: ID) => {
    const cur = useProjectStore.getState().selectedIds
    if (strays() || !cur.includes(id)) selectNode(id, { keepView })
  }, [selectNode, keepView, strays])

  return { onSelectClick, promoteForMenu }
}
