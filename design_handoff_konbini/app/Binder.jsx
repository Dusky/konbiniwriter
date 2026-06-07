// ─────────────────────────────────────────────────────────────────────────────
// Binder.jsx — left sidebar tree: nesting, selection, inline rename,
// drag reorder/reparent, context menu, footer add buttons.
// ─────────────────────────────────────────────────────────────────────────────

function nodeIcon(node, open) {
  if (node.type === 'folder') return open ? <Icons.FolderOpen /> : <Icons.Folder />;
  if (node.type === 'scene') return <Icons.Scene />;
  return <Icons.Doc />;
}

function TreeRow({ id, depth, dnd, setDnd, onContext }) {
  const node = useStore((s) => s.nodes[id]);
  const selected = useStore((s) => s.selectedId === id);
  const renaming = useStore((s) => s.ui.renaming === id);
  const childCount = node ? node.childIds.length : 0;
  const subWords = useStore((s) => (node && node.type !== 'folder') ? wordCount(s.docs[id]?.content) : subtreeWordCount(s, id));
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  if (!node) return null;
  const isFolder = node.type === 'folder';
  const status = STATUS[node.meta.status];

  const commit = (val) => {
    const t = (val ?? '').trim();
    if (t) actions.rename(id, t);
    store.set((s) => ({ ...s, ui: { ...s.ui, renaming: null } }));
  };

  const onDragStart = (e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); setDnd({ dragId: id, overId: null, pos: null }); };
  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!dnd.dragId || dnd.dragId === id) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    let pos = 'before';
    if (isFolder) { pos = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into'; }
    else { pos = y < 0.5 ? 'before' : 'after'; }
    if (dnd.overId !== id || dnd.pos !== pos) setDnd((d) => ({ ...d, overId: id, pos }));
  };
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    const dragId = dnd.dragId; if (!dragId || dragId === id) { setDnd({ dragId: null, overId: null, pos: null }); return; }
    const s = store.get();
    let parent, index;
    if (dnd.pos === 'into') { parent = id; index = null; }
    else {
      parent = node.parentId;
      const sibs = (parent == null ? s.rootIds : s.nodes[parent].childIds).filter((x) => x !== dragId);
      index = sibs.indexOf(id) + (dnd.pos === 'after' ? 1 : 0);
    }
    actions.move(dragId, parent, index);
    setDnd({ dragId: null, overId: null, pos: null });
  };

  const showInto = dnd.overId === id && dnd.pos === 'into';
  const showBefore = dnd.overId === id && dnd.pos === 'before';
  const showAfter = dnd.overId === id && dnd.pos === 'after';

  return (
    <div>
      {showBefore && <div className="drop-line" style={{ marginLeft: depth * 15 + 22 }} />}
      <div
        className={'tree-row' + (selected ? ' sel' : '') + (showInto ? ' drop-into' : '')}
        style={{ paddingLeft: depth * 15 + 4 }}
        draggable={!renaming}
        onClick={() => actions.select(id)}
        onDoubleClick={() => { if (!isFolder) return; }}
        onContextMenu={(e) => { e.preventDefault(); onContext(e, id); }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={() => setDnd({ dragId: null, overId: null, pos: null })}
      >
        <span className={'tw-twist' + (node.expanded ? ' open' : '')}
              onClick={(e) => { e.stopPropagation(); if (isFolder) actions.toggleExpand(id); }}>
          {isFolder && childCount > 0 ? <Icons.Chevron /> : null}
        </span>
        <span className="tw-icon" style={{ color: isFolder ? 'var(--text-3)' : 'var(--text-2)' }}>{nodeIcon(node, node.expanded)}</span>
        <span className="tw-label" onDoubleClick={(e) => { e.stopPropagation(); store.set((s) => ({ ...s, ui: { ...s.ui, renaming: id } })); }}>
          {renaming
            ? <input ref={inputRef} defaultValue={node.title}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(e.target.value); if (e.key === 'Escape') commit(node.title); }} />
            : node.title}
        </span>
        {!renaming && subWords > 0 && <span className="tw-count">{subWords.toLocaleString()}</span>}
        {!renaming && !isFolder && node.meta.status !== 'todo' &&
          <span className="tw-status" style={{ background: status.color }} title={status.label} />}
      </div>
      {isFolder && node.expanded && node.childIds.map((cid) => (
        <TreeRow key={cid} id={cid} depth={depth + 1} dnd={dnd} setDnd={setDnd} onContext={onContext} />
      ))}
      {showAfter && <div className="drop-line" style={{ marginLeft: depth * 15 + 22 }} />}
    </div>
  );
}

function ContextMenu({ menu, onClose }) {
  React.useEffect(() => {
    const h = () => onClose();
    window.addEventListener('click', h);
    window.addEventListener('contextmenu', h);
    return () => { window.removeEventListener('click', h); window.removeEventListener('contextmenu', h); };
  }, []);
  if (!menu) return null;
  const { x, y, id } = menu;
  const node = store.get().nodes[id];
  const isFolder = node.type === 'folder';
  const inTrash = node.parentId === store.get().trashId || id === store.get().trashId;
  const act = (fn) => (e) => { e.stopPropagation(); fn(); onClose(); };
  const newInParent = (type) => actions.create(isFolder ? id : node.parentId, type);

  return (
    <div className="ctx" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 320) }}
         onClick={(e) => e.stopPropagation()}>
      <div className="sub">New inside {isFolder ? '“' + node.title + '”' : 'folder'}</div>
      <button onClick={act(() => newInParent('folder'))}><Icons.NewFolder /> New Folder</button>
      <button onClick={act(() => newInParent('document'))}><Icons.NewDoc /> New Document</button>
      <button onClick={act(() => newInParent('scene'))}><Icons.Scene /> New Scene</button>
      <hr />
      <button onClick={act(() => store.set((s) => ({ ...s, selectedId: id, ui: { ...s.ui, renaming: id } })))}><Icons.Edit /> Rename</button>
      <button onClick={act(() => actions.duplicate(id))}><Icons.Dup /> Duplicate</button>
      {!isFolder && <button onClick={act(() => { actions.takeSnapshot(id); actions.select(id); actions.setModal({ kind: 'snapshots', id }); })}><Icons.Camera /> Take Snapshot</button>}
      <hr />
      <button className="danger" onClick={act(() => actions.remove(id))}>
        <Icons.Trash /> {inTrash ? 'Delete Permanently' : 'Move to Trash'}
      </button>
    </div>
  );
}

function Binder() {
  const rootIds = useStore((s) => s.rootIds);
  const projTitle = useStore((s) => s.title);
  const [dnd, setDnd] = React.useState({ dragId: null, overId: null, pos: null });
  const [menu, setMenu] = React.useState(null);
  const sel = useStore((s) => s.selectedId);

  const onContext = (e, id) => setMenu({ x: e.clientX, y: e.clientY, id });
  const addAtSelection = (type) => {
    const s = store.get();
    const cur = s.selectedId ? s.nodes[s.selectedId] : null;
    const parent = cur ? (cur.type === 'folder' ? cur.id : cur.parentId) : null;
    actions.create(parent, type);
  };

  return (
    <aside className="binder">
      <div className="binder-hd">Binder</div>
      <div className="binder-scroll"
           onDragOver={(e) => { if (dnd.dragId) e.preventDefault(); }}
           onDrop={(e) => { /* drop on empty space → root end */ if (dnd.dragId) { actions.move(dnd.dragId, null, null); setDnd({ dragId: null, overId: null, pos: null }); } }}>
        {rootIds.map((id) => (
          <TreeRow key={id} id={id} depth={0} dnd={dnd} setDnd={setDnd} onContext={onContext} />
        ))}
      </div>
      <div className="binder-foot">
        <button className="icon-btn" title="New Folder" onClick={() => addAtSelection('folder')}><Icons.NewFolder /></button>
        <button className="icon-btn" title="New Document" onClick={() => addAtSelection('document')}><Icons.NewDoc /></button>
        <button className="icon-btn" title="New Scene" onClick={() => addAtSelection('scene')}><Icons.Scene /></button>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="Delete" onClick={() => sel && actions.remove(sel)}><Icons.Trash /></button>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </aside>
  );
}

Object.assign(window, { Binder, nodeIcon });
