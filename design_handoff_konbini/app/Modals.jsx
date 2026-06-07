// ─────────────────────────────────────────────────────────────────────────────
// Modals.jsx — Snapshots (take/list/restore + line diff) and Compile/Export.
// The compile pipeline is intentionally modular: FORMATS registry → add formats
// later (epub/pdf) without touching the gather/concatenate stage.
// ─────────────────────────────────────────────────────────────────────────────

function lineDiff(oldText, newText) {
  const A = oldText.split('\n'), B = newText.split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: 'ctx', v: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', v: A[i] }); i++; }
    else { out.push({ t: 'add', v: B[j] }); j++; }
  }
  while (i < n) out.push({ t: 'del', v: A[i++] });
  while (j < m) out.push({ t: 'add', v: B[j++] });
  return out;
}

function timeAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SnapshotsModal({ id }) {
  const node = useStore((s) => s.nodes[id]);
  const body = useStore((s) => s.docs[id]);
  const snaps = body?.snapshots || [];
  const [selSnap, setSelSnap] = React.useState(snaps[0]?.id || null);
  React.useEffect(() => { if (!snaps.find((x) => x.id === selSnap)) setSelSnap(snaps[0]?.id || null); }, [snaps.length]);
  const snap = snaps.find((x) => x.id === selSnap);
  const diff = snap ? lineDiff(snap.content, body.content) : [];
  const close = () => actions.setModal(null);

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <h3><Icons.Camera /> &nbsp;Snapshots</h3>
          <span className="sub">{node?.title}</span>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => actions.takeSnapshot(id)}>Take Snapshot</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, padding: 0 }}>
          <div style={{ borderRight: '0.5px solid var(--border)', padding: '14px 14px', overflowY: 'auto' }}>
            {snaps.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>No snapshots yet. Take one to checkpoint this document.</div>}
            {snaps.map((sn) => (
              <div key={sn.id} className={'snap-item' + (sn.id === selSnap ? ' sel' : '')} onClick={() => setSelSnap(sn.id)}>
                <div className="si-main">
                  <div className="si-t">{sn.title || 'Snapshot'}</div>
                  <div className="si-m">{timeAgo(sn.takenAt)} · {sn.words.toLocaleString()} words</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 16px', overflowY: 'auto' }}>
            {snap ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Changes since this snapshot</div>
                  <div style={{ flex: 1 }} />
                  <button className="btn ghost" onClick={() => actions.deleteSnapshot(id, snap.id)}><Icons.Trash /> Delete</button>
                  <button className="btn primary" onClick={() => actions.restoreSnapshot(id, snap.id)}><Icons.Restore /> Restore</button>
                </div>
                <div className="snap-diff">
                  {diff.map((d, k) => (
                    <div key={k} className={d.t === 'add' ? 'add' : d.t === 'del' ? 'del' : ''}>
                      {d.t === 'add' ? '+ ' : d.t === 'del' ? '− ' : '  '}{d.v || '\u00a0'}
                    </div>
                  ))}
                  {diff.every((d) => d.t === 'ctx') && <div style={{ color: 'var(--text-3)' }}>Identical to current text.</div>}
                </div>
              </>
            ) : <div style={{ color: 'var(--text-3)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>Select a snapshot to compare.</div>}
          </div>
        </div>
        <div className="modal-foot">
          <div className="tb-spacer" />
          <button className="btn" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Compile / Export ─────────────────────────────────────────────────────────
function gatherCompile(s, rootId, included) {
  // walk subtree in binder order, emit folder titles as headings + included docs
  const parts = [];
  const walk = (ids, depth) => {
    for (const id of ids) {
      const n = s.nodes[id]; if (!n) continue;
      if (n.type === 'folder') {
        if (n.id !== rootId) parts.push({ heading: n.title, depth });
        walk(n.childIds, depth + 1);
      } else if (included.has(id)) {
        parts.push({ content: (s.docs[id]?.content || '').trim(), title: n.title });
      }
    }
  };
  walk([rootId], 0);
  return parts;
}

const COMPILE_FORMATS = {
  markdown: {
    label: 'Markdown', ext: 'md', mime: 'text/markdown',
    render: (parts) => parts.map((p) => p.heading != null
      ? '#'.repeat(Math.min(6, p.depth + 1)) + ' ' + p.heading
      : p.content).filter(Boolean).join('\n\n'),
  },
  // Word: emit Word-readable HTML (.doc). Real app swaps in a true .docx writer.
  word: {
    label: 'Word', ext: 'doc', mime: 'application/msword',
    render: (parts) => {
      const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const md2html = (md) => md.split('\n').map((l) => {
        const h = l.match(/^(#{1,6})\s+(.*)/);
        if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
        if (!l.trim()) return '';
        return `<p>${esc(l).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\[\[([^\]]+)\]\]/g, '$1')}</p>`;
      }).join('\n');
      const bodyHtml = parts.map((p) => p.heading != null
        ? `<h${Math.min(6, p.depth + 1)}>${esc(p.heading)}</h${Math.min(6, p.depth + 1)}>`
        : md2html(p.content)).join('\n');
      return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5} h1{font-size:20pt} h2{font-size:16pt}</style></head><body>${bodyHtml}</body></html>`;
    },
  },
};

function download(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function CompileModal() {
  const s0 = store.get();
  const rootId = s0.rootIds.find((id) => s0.nodes[id].type === 'folder' && s0.nodes[id].id === 'manuscript') || s0.rootIds.find((id) => s0.nodes[id].type === 'folder');
  const nodes = useStore((st) => st.nodes);
  const docsAll = useStore((st) => st.docs);

  // flattened doc list under root
  const docList = React.useMemo(() => {
    const out = [];
    const walk = (ids, depth) => ids.forEach((id) => {
      const n = nodes[id]; if (!n) return;
      out.push({ id, depth, node: n });
      if (n.type === 'folder') walk(n.childIds, depth + 1);
    });
    walk(nodes[rootId].childIds, 0);
    return out;
  }, [nodes, rootId]);

  const [included, setIncluded] = React.useState(() => {
    const set = new Set();
    docList.forEach(({ id, node }) => { if (node.type !== 'folder' && node.meta.includeInCompile) set.add(id); });
    return set;
  });
  const [fmt, setFmt] = React.useState('markdown');
  const toggle = (id) => setIncluded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const parts = gatherCompile(store.get(), rootId, included);
  const rendered = COMPILE_FORMATS[fmt].render(parts);
  const wordTotal = [...included].reduce((a, id) => a + wordCount(docsAll[id]?.content), 0);
  const close = () => actions.setModal(null);
  const projTitle = useStore((st) => st.title);

  const doExport = () => {
    const f = COMPILE_FORMATS[fmt];
    download(projTitle.replace(/\s+/g, '_') + '.' + f.ext, f.mime, f.render(parts));
  };

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <h3><Icons.Compile /> &nbsp;Compile</h3>
          <span className="sub">{projTitle} · {included.size} documents · {wordTotal.toLocaleString()} words</span>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0, padding: 0 }}>
          <div className="tree-pick" style={{ borderRight: '0.5px solid var(--border)', padding: '14px', overflowY: 'auto' }}>
            <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Contents</div>
            {docList.map(({ id, depth, node }) => (
              <div key={id} className="tp-row" style={{ paddingLeft: depth * 14 + 6 }}>
                {node.type === 'folder'
                  ? <><span style={{ width: 15 }} />{nodeIcon(node, true)}<span style={{ color: 'var(--text-2)', fontWeight: 600, fontSize: 12.5 }}>{node.title}</span></>
                  : <><input type="checkbox" checked={included.has(id)} onChange={() => toggle(id)} />{nodeIcon(node, true)}<span style={{ fontSize: 12.5 }}>{node.title}</span></>}
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Format</span>
              <div className="seg">
                {Object.keys(COMPILE_FORMATS).map((k) => (
                  <button key={k} className={fmt === k ? 'on' : ''} onClick={() => setFmt(k)}>{COMPILE_FORMATS[k].label}</button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Preview</span>
            </div>
            <div className="compile-preview" style={{ flex: 1 }}>{
              fmt === 'word'
                ? parts.map((p) => p.heading != null ? p.heading : p.content).filter(Boolean).join('\n\n').slice(0, 4000)
                : rendered.slice(0, 4000)
            }{rendered.length > 4000 ? '\n\n…' : ''}</div>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Concatenated in binder order. Pipeline is format-pluggable.</span>
          <div className="tb-spacer" />
          <button className="btn ghost" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(COMPILE_FORMATS.markdown.render(parts)); }}>Copy Markdown</button>
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={doExport}>Export .{COMPILE_FORMATS[fmt].ext}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SnapshotsModal, CompileModal, lineDiff, COMPILE_FORMATS });
