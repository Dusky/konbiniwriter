// ─────────────────────────────────────────────────────────────────────────────
// Views.jsx — Corkboard (editable synopsis index cards) + Outliner (table).
// ─────────────────────────────────────────────────────────────────────────────

function resolveFolder(s) {
  const sel = s.selectedId ? s.nodes[s.selectedId] : null;
  if (!sel) return s.rootIds.find((id) => s.nodes[id].type === 'folder') || null;
  if (sel.type === 'folder') return sel.id;
  return sel.parentId || null;
}

function CorkCard({ id }) {
  const node = useStore((s) => s.nodes[id]);
  const selected = useStore((s) => s.selectedId === id);
  const words = useStore((s) => node && node.type !== 'folder' ? wordCount(s.docs[id]?.content) : subtreeWordCount(s, id));
  if (!node) return null;
  const status = STATUS[node.meta.status];
  const labelColor = LABELS[node.meta.label]?.color;
  return (
    <div className={'card' + (selected ? ' sel' : '')}
      style={{ '--card-label': labelColor && labelColor !== 'transparent' ? labelColor : 'var(--border-2)' }}
      onClick={() => actions.select(id)}
      onDoubleClick={() => { actions.select(id); if (node.type !== 'folder') actions.setView('editor'); }}>
      <div className="pin" />
      <div className="ct">
        <span className="t">{node.title}</span>
        <span className="st" style={{ background: status.color }} title={status.label} />
      </div>
      <textarea className="cs" value={node.meta.synopsis}
        placeholder="Write a synopsis…"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => actions.updateMeta(id, { synopsis: e.target.value })} />
      <div className="cf">
        <span>{node.type}</span>
        <span style={{ marginLeft: 'auto' }}>{words.toLocaleString()} w</span>
      </div>
    </div>
  );
}

function CorkboardView() {
  const folderId = useStore((s) => resolveFolder(s));
  const folder = useStore((s) => folderId ? s.nodes[folderId] : null);
  const crumbs = useStore((s) => {
    if (!folderId) return [];
    const path = []; let cur = s.nodes[folderId];
    while (cur) { path.unshift(cur.title); cur = cur.parentId ? s.nodes[cur.parentId] : null; }
    return path;
  });
  if (!folder) return <div className="main"><div className="empty-state"><div>No folder to pin.</div></div></div>;
  const children = folder.childIds;
  return (
    <div className="main">
      <div className="doc-bar"><span className="crumb"><Icons.Cork /> &nbsp;{crumbs.join('  ›  ')} &nbsp;·&nbsp; {children.length} cards</span></div>
      <div className="cork">
        {children.length === 0
          ? <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>This folder is empty. Add a scene to pin it here.</div>
          : <div className="cork-grid">{children.map((id) => <CorkCard key={id} id={id} />)}</div>}
      </div>
    </div>
  );
}

// ── Outliner ─────────────────────────────────────────────────────────────────
function OutlinerView() {
  const rootId = useStore((s) => resolveFolder(s));
  const rows = useStore((s) => {
    if (!rootId) return [];
    const out = [];
    const walk = (ids, depth) => {
      for (const id of ids) {
        const n = s.nodes[id]; if (!n) continue;
        out.push({ id, depth, node: n });
        if (n.type === 'folder') walk(n.childIds, depth + 1);
      }
    };
    walk(s.nodes[rootId].childIds, 0);
    return out;
  });
  const sel = useStore((s) => s.selectedId);
  const docsWords = useStore((s) => s.docs);
  const wc = (id, n) => n.type === 'folder' ? subtreeWordCount(store.get(), id) : wordCount(docsWords[id]?.content);

  const rootTitle = useStore((s) => rootId ? s.nodes[rootId].title : '');

  return (
    <div className="main">
      <div className="doc-bar"><span className="crumb"><Icons.Outline /> &nbsp;Outliner · {rootTitle}</span></div>
      <div className="outl">
        <table className="otable">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>Title</th>
              <th style={{ width: 110 }}>Label</th>
              <th style={{ width: 130 }}>Status</th>
              <th className="num" style={{ width: 70 }}>Words</th>
              <th className="num" style={{ width: 70 }}>Target</th>
              <th style={{ width: 90 }}>Progress</th>
              <th>Synopsis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, depth, node }) => {
              const w = wc(id, node);
              const t = node.meta.target || 0;
              const pct = t ? Math.min(100, Math.round((w / t) * 100)) : 0;
              const label = LABELS[node.meta.label];
              const status = STATUS[node.meta.status];
              return (
                <tr key={id} className={sel === id ? 'sel' : ''} onClick={() => actions.select(id)}>
                  <td>
                    <span className="o-title" style={{ paddingLeft: depth * 16 }}>
                      {nodeIcon(node, true)}{node.title}
                    </span>
                  </td>
                  <td>{node.meta.label !== 'none'
                    ? <span className="badge"><span className="dot" style={{ background: label.color }} />{label.label}</span>
                    : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                  <td>
                    <span className="badge"><span className="dot" style={{ background: status.color }} />{status.label}</span>
                  </td>
                  <td className="num" style={{ color: 'var(--text)' }}>{w.toLocaleString()}</td>
                  <td className="num">{t ? t.toLocaleString() : '—'}</td>
                  <td>{t ? <span className="mini-meter"><i style={{ width: pct + '%' }} /></span> : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                  <td><div className="o-syn">{node.meta.synopsis || <span style={{ color: 'var(--text-3)' }}>—</span>}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { CorkboardView, OutlinerView, resolveFolder });
