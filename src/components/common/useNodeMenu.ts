import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import type { MenuItem } from './ContextMenu'
import type { ID, NodeOp } from '@shared/types'

// Builds the standard right-click menu for a binder node, reused by the
// Corkboard and Outliner so structural actions stay consistent across views.
// (The Binder keeps its own variant because it also offers inline Rename and
// New Folder, which only make sense in the tree.)
export function useNodeMenu(): (nodeId: ID) => MenuItem[] {
  const project = useProjectStore((s) => s.project)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setView = useProjectStore((s) => s.setView)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const setRailPanel = useShellStore((s) => s.setRailPanel)

  return (nodeId: ID): MenuItem[] => {
    if (!project) return []
    const node = project.nodes[nodeId]
    if (!node) return []

    const isFolder = node.type === 'folder'
    const inTrash = node.parentId === project.trashId
    const siblingParent = isFolder ? nodeId : node.parentId

    const mutate = async (op: NodeOp) => {
      const result = await window.api.node.mutate(project.id, op)
      applyMutation(result)
    }

    return [
      { label: isFolder ? 'Open' : 'Open in Editor', action: () => { selectNode(nodeId); if (!isFolder) setView('editor') } },
      { label: '---', action: () => {} },
      { label: 'New Document', action: () => mutate({ type: 'create', parentId: siblingParent, nodeType: 'document' }) },
      { label: 'New Scene', action: () => mutate({ type: 'create', parentId: siblingParent, nodeType: 'scene' }) },
      { label: 'Duplicate', action: () => mutate({ type: 'duplicate', id: nodeId }) },
      { label: '---', action: () => {} },
      { label: 'History & Snapshots', action: () => { selectNode(nodeId); setRailPanel('history') }, disabled: isFolder },
      { label: '---', action: () => {} },
      inTrash
        ? { label: 'Delete Permanently', action: () => mutate({ type: 'delete', id: nodeId }), danger: true }
        : { label: 'Move to Trash', action: () => mutate({ type: 'trash', id: nodeId }), danger: true },
    ]
  }
}
