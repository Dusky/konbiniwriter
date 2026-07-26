import { useProjectStore } from '../../store/projectStore'
import { useShellStore } from '../../store/shellStore'
import type { MenuItem } from './ContextMenu'
import type { ID, NodeOp, StatusId, LabelId } from '@shared/types'
import { STATUS_META, STATUS_ORDER, LABEL_META, LABEL_ORDER } from '@shared/utils'
import { kbd } from '../../lib/kbd'

interface Options {
  /**
   * Start an inline rename. Only the binder can actually show the input, so
   * surfaces without one omit this and the item doesn't appear — better than a
   * menu item that quietly does nothing.
   */
  onRename?: (id: ID) => void
  /** Ask for confirmation before a permanent delete (the binder's dialog). */
  onConfirmDelete?: (id: ID) => void
}

/**
 * The right-click menu for a binder node, shared by the Binder, Corkboard and
 * Outliner so the same node offers the same actions wherever it's shown.
 *
 * Status and Label are submenus rather than a trip to the Inspector: changing
 * a scene's status is the single most common metadata edit in a drafting
 * session, and it shouldn't cost a panel switch.
 */
export function useNodeMenu(opts: Options = {}): (nodeId: ID) => MenuItem[] {
  const project = useProjectStore((s) => s.project)
  const selectNode = useProjectStore((s) => s.selectNode)
  const setView = useProjectStore((s) => s.setView)
  const applyMutation = useProjectStore((s) => s.applyMutation)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const addSnapshot = useProjectStore((s) => s.addSnapshot)
  const setSplitId = useProjectStore((s) => s.setSplitId)
  const splitOpen = useProjectStore((s) => s.splitOpen)
  const toggleSplit = useProjectStore((s) => s.toggleSplit)
  const setBinderQuery = useProjectStore((s) => s.setBinderQuery)
  const actionTargets = useProjectStore((s) => s.actionTargets)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const setToast = useShellStore((s) => s.setToast)

  return (nodeId: ID): MenuItem[] => {
    if (!project) return []
    const node = project.nodes[nodeId]
    if (!node) return []

    const mutate = async (op: NodeOp) => {
      try {
        applyMutation(await window.api.node.mutate(project.id, op))
      } catch (e) {
        setToast('Change could not be saved: ' + (e as Error).message)
      }
    }

    const copy = (text: string, what: string) => {
      navigator.clipboard.writeText(text)
        .then(() => setToast(`${what} copied`, 'info'))
        .catch(() => setToast('Clipboard is not available'))
    }

    // Right-clicking inside a multi-selection acts on all of it. This has to
    // come AFTER mutate/copy are initialised: returning earlier would leave
    // those `const` bindings in the temporal dead zone, and every action in the
    // multi menu — which only reads them when clicked — would throw.
    const targets = actionTargets(nodeId)
    if (targets.length > 1) return manyMenu(targets)

    const isFolder = node.type === 'folder'
    const inTrash = node.parentId === project.trashId
    const siblingParent = isFolder ? nodeId : node.parentId

    const setMeta = (patch: Parameters<typeof updateMeta>[1]) => {
      updateMeta(nodeId, patch)
      void mutate({ type: 'updateMeta', id: nodeId, patch })
    }

    const takeSnapshot = async () => {
      try {
        addSnapshot(nodeId, await window.api.snapshot.take(project.id, nodeId))
        setToast('Snapshot taken', 'info')
      } catch (e) {
        setToast('Snapshot failed: ' + (e as Error).message)
      }
    }

    const openInSplit = () => {
      if (!splitOpen) toggleSplit()
      setSplitId(nodeId)
    }

    /**
     * The menu for a multi-selection. Deliberately only the actions that mean
     * something applied to many nodes at once — no Rename, no Open, no
     * snapshots of a folder. Metadata edits and trashing go through the batch
     * ops so the whole selection is one round trip and one manifest write.
     */
    function manyMenu(ids: ID[]): MenuItem[] {
      const titles = ids.map((i) => project!.nodes[i]?.title).filter(Boolean) as string[]
      const allInTrash = ids.every((i) => project!.nodes[i]?.parentId === project!.trashId)
      const anyCompiled = ids.some((i) => project!.nodes[i]?.meta.includeInCompile)
      return [
        { label: `${ids.length} items selected`, header: true },
        {
          label: 'Set Status',
          icon: 'gauge',
          items: STATUS_ORDER.map((st) => ({
            label: STATUS_META[st].label,
            action: () => void mutate({ type: 'updateMetaMany', ids, patch: { status: st as StatusId } }),
          })),
        },
        {
          label: 'Set Label',
          icon: 'sticky-note',
          items: LABEL_ORDER.map((lb) => ({
            label: LABEL_META[lb].label,
            action: () => void mutate({ type: 'updateMetaMany', ids, patch: { label: lb as LabelId } }),
          })),
        },
        {
          // One switch for the lot: if any are in, the action is to take them
          // all out, which is what "toggle" has to mean for a mixed selection.
          label: anyCompiled ? 'Exclude from Compile' : 'Include in Compile',
          action: () => void mutate({ type: 'updateMetaMany', ids, patch: { includeInCompile: !anyCompiled } }),
        },
        { label: '---' },
        { label: 'Copy Titles', action: () => copy(titles.join('\n'), `${titles.length} titles`) },
        { label: 'Copy as Wikilinks', action: () => copy(titles.map((t) => `[[${t}]]`).join('\n'), `${titles.length} wikilinks`) },
        { label: '---' },
        allInTrash
          ? {
              label: `Delete ${ids.length} Permanently`,
              icon: 'trash',
              danger: true,
              action: () => void mutate({ type: 'deleteMany', ids }),
            }
          : {
              label: `Move ${ids.length} to Trash`,
              icon: 'trash',
              danger: true,
              action: () => void mutate({ type: 'trashMany', ids }),
            },
      ]
    }

    const items: MenuItem[] = [
      {
        label: isFolder ? 'Open' : 'Open in Editor',
        icon: isFolder ? 'folder-open' : 'document',
        action: () => { selectNode(nodeId); if (!isFolder) setView('editor') },
      },
      { label: 'Open in Split', icon: 'columns', hint: kbd('mod+\\'), action: openInSplit },
      { label: '---' },
    ]

    // Metadata, without a trip to the Inspector.
    items.push(
      {
        label: 'Status',
        icon: 'gauge',
        items: STATUS_ORDER.map((st) => ({
          label: STATUS_META[st].label,
          checked: node.meta.status === st,
          action: () => setMeta({ status: st as StatusId }),
        })),
      },
      {
        label: 'Label',
        icon: 'sticky-note',
        items: LABEL_ORDER.map((lb) => ({
          label: LABEL_META[lb].label,
          checked: node.meta.label === lb,
          action: () => setMeta({ label: lb as LabelId }),
        })),
      },
      {
        label: 'Include in Compile',
        checked: node.meta.includeInCompile,
        action: () => setMeta({ includeInCompile: !node.meta.includeInCompile }),
      },
    )

    const keywords = node.meta.keywords ?? []
    if (keywords.length) {
      items.push({
        label: 'Filter by Keyword',
        icon: 'text-search',
        items: keywords.map((k) => ({ label: k, action: () => setBinderQuery({ keywords: [k] }) })),
      })
    }

    items.push(
      { label: '---' },
      { label: 'New Document', icon: 'plus', hint: kbd('mod+shift+d'), action: () => mutate({ type: 'create', parentId: siblingParent, nodeType: 'document' }) },
      { label: 'New Scene', icon: 'plus', hint: kbd('mod+shift+n'), action: () => mutate({ type: 'create', parentId: siblingParent, nodeType: 'scene' }) },
      { label: 'New Folder', icon: 'folder', hint: kbd('mod+alt+n'), action: () => mutate({ type: 'create', parentId: siblingParent, nodeType: 'folder' }) },
      { label: '---' },
    )

    if (opts.onRename) items.push({ label: 'Rename', icon: 'edit', action: () => opts.onRename!(nodeId) })
    items.push({ label: 'Duplicate', icon: 'copy', action: () => mutate({ type: 'duplicate', id: nodeId }) })

    items.push(
      { label: '---' },
      { label: 'Take Snapshot', icon: 'clock', disabled: isFolder, action: takeSnapshot },
      { label: 'History & Snapshots', icon: 'history', hint: kbd('mod+shift+s'), disabled: isFolder, action: () => { selectNode(nodeId); setRailPanel('history') } },
      { label: 'Comments', icon: 'comment', disabled: isFolder, action: () => { selectNode(nodeId); setRailPanel('comments') } },
      { label: '---' },
      { label: 'Copy Title', action: () => copy(node.title, 'Title') },
      // A wikilink is how one document points at another, so the clipboard is
      // the shortest path from "that scene" to a reference in this one.
      { label: 'Copy as Wikilink', action: () => copy(`[[${node.title}]]`, 'Wikilink') },
      { label: '---' },
      inTrash
        ? {
            label: 'Delete Permanently',
            icon: 'trash',
            danger: true,
            action: () => opts.onConfirmDelete ? opts.onConfirmDelete(nodeId) : mutate({ type: 'delete', id: nodeId }),
          }
        : { label: 'Move to Trash', icon: 'trash', danger: true, action: () => mutate({ type: 'trash', id: nodeId }) },
    )

    return items
  }
}
