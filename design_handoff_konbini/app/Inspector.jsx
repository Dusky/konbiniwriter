// ─────────────────────────────────────────────────────────────────────────────
// Inspector.jsx — right panel: label, status, synopsis, word target, live counts.
// ─────────────────────────────────────────────────────────────────────────────

function Inspector() {
  const node = useStore((s) => (s.selectedId ? s.nodes[s.selectedId] : null));
  const body = useStore((s) => (s.selectedId ? s.docs[s.selectedId] : null));
  const subWords = useStore((s) => s.selectedId ? subtreeWordCount(s, s.selectedId) : 0);

  if (!node) {
    return <aside className="inspector"><div className="insp-sec" style={{ color: 'var(--text-3)', fontSize: 12 }}>Nothing selected.</div></aside>;
  }
  const isFolder = node.type === 'folder';
  const words = isFolder ? subWords : wordCount(body?.content);
  const chars = isFolder ? 0 : charCount(body?.content);
  const target = node.meta.target || 0;
  const pct = target ? Math.min(100, Math.round((words / target) * 100)) : 0;
  const snaps = body?.snapshots?.length || 0;

  return (
    <aside className="inspector">
      <div className="insp-scroll">
        <div className="insp-sec">
          <h4>Synopsis</h4>
          <textarea className="ta" value={node.meta.synopsis}
            placeholder={isFolder ? 'What happens across this folder…' : 'One or two lines: what happens in this scene…'}
            onChange={(e) => actions.updateMeta(node.id, { synopsis: e.target.value })} />
        </div>

        <div className="insp-sec">
          <h4>Label</h4>
          <div className="pill-row">
            {LABEL_ORDER.map((k) => (
              <button key={k} className={'pill' + (node.meta.label === k ? ' on' : '')}
                onClick={() => actions.updateMeta(node.id, { label: k })}>
                {k !== 'none' && <span className="dot" style={{ background: LABELS[k].color }} />}
                {LABELS[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="insp-sec">
          <h4>Status</h4>
          <select className="sel" value={node.meta.status}
            onChange={(e) => actions.updateMeta(node.id, { status: e.target.value })}>
            {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
          </select>
        </div>

        {!isFolder && (
          <div className="insp-sec">
            <h4>Word Target</h4>
            <div className="row2">
              <div className="field" style={{ margin: 0 }}>
                <input className="inp" type="number" min="0" step="50" value={target}
                  onChange={(e) => actions.updateMeta(node.id, { target: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                {target ? `${pct}% of target` : 'no target set'}
              </div>
            </div>
            {target > 0 && <div className="meter" style={{ marginTop: 10 }}><i style={{ width: pct + '%' }} /></div>}
          </div>
        )}

        <div className="insp-sec">
          <h4>{isFolder ? 'Folder Totals' : 'Counts'}</h4>
          <div className="stat-grid">
            <div className="stat"><div className="n">{words.toLocaleString()}</div><div className="l">Words</div></div>
            {isFolder
              ? <div className="stat"><div className="n">{node.childIds.length}</div><div className="l">Items</div></div>
              : <div className="stat"><div className="n">{chars.toLocaleString()}</div><div className="l">Characters</div></div>}
          </div>
        </div>

        <div className="insp-sec">
          <h4>General</h4>
          <div className="field" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--text-3)' }}>Type</span>
            <span style={{ textTransform: 'capitalize' }}>{node.type}</span>
          </div>
          <div className="field" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-3)' }}>Include in Compile</span>
            <button className="pill" style={{ padding: '3px 10px' }}
              onClick={() => actions.updateMeta(node.id, { includeInCompile: !node.meta.includeInCompile })}>
              {node.meta.includeInCompile ? 'Yes' : 'No'}
            </button>
          </div>
          <div className="field" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-3)' }}>ID</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-3)' }}>{node.id}</span>
          </div>
        </div>

        {!isFolder && (
          <div className="insp-sec">
            <h4>Snapshots</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, height: 30 }}
                onClick={() => { actions.takeSnapshot(node.id); }}>Take Snapshot</button>
              <button className="btn ghost" style={{ height: 30 }}
                onClick={() => actions.setModal({ kind: 'snapshots', id: node.id })}>
                {snaps} saved
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

window.Inspector = Inspector;
