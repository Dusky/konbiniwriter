import type { ID } from '@shared/types'

/**
 * Dragging a binder node somewhere that isn't the binder.
 *
 * The binder's own drag is a *reorder* — it means "put this node here in the
 * tree". Dropping onto an editor pane means something completely different:
 * "show this document there". A dedicated MIME type keeps the two apart, so a
 * pane can accept a node drag without the binder ever thinking a move happened,
 * and so an arbitrary text drag from another app isn't mistaken for one.
 */
const NODE_MIME = 'application/x-konbini-node'

/** Mark a drag as carrying a node. Call from onDragStart. */
export function setNodeDrag(dt: DataTransfer, id: ID): void {
  dt.setData(NODE_MIME, id)
  // Firefox refuses to start a drag without a standard type, and text/plain
  // also makes the id readable if it's dropped somewhere outside the app.
  dt.setData('text/plain', id)
  dt.effectAllowed = 'copyMove'
}

/**
 * Whether a drag in flight is carrying a node.
 *
 * Only the *types* are readable during dragover — browsers withhold the data
 * itself until drop — so this is the only check available while deciding
 * whether to show a drop affordance.
 */
export function isNodeDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(NODE_MIME)
}

/** Read the dragged node id. Only meaningful inside onDrop. */
export function getNodeDrag(dt: DataTransfer | null): ID | null {
  if (!dt) return null
  return dt.getData(NODE_MIME) || null
}
