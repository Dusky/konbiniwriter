// ─────────────────────────────────────────────────────────────────────────────
// Assistant.jsx — quiet right-side slide-over: context-scoped chat, quick
// co-write actions, and the in-editor selection toolbar. Mode-aware.
// ─────────────────────────────────────────────────────────────────────────────

function CiteChips({ cites }) {
  if (!cites || !cites.length) return null;
  return (
    <div className="cites">
      {cites.map((c) => (
        <button key={c.id} className="cite-chip" onClick={() => { if (store.get().nodes[c.id]) { actions.select(c.id); actions.setView('editor'); aiActions.setSurface(null); } }}>{c.title}</button>
      ))}
    </div>
  );
}

const SCOPES = [
  { id: 'doc', label: 'This doc' },
  { id: 'manuscript', label: 'Manuscript' },
  { id: 'project', label: 'Whole project' },
];

function AssistantPanel() {
  const enabled = useAI((s) => s.enabled);
  const open = useAI((s) => s.panelOpen);
  const chat = useAI((s) => s.chat);
  const thinking = useAI((s) => s.thinking);
  const scope = useAI((s) => s.scope);
  const mode = useAI((s) => s.mode);
  const pending = useAI((s) => s.proposals.filter((p) => p.status === 'pending').length);
  const selId = useStore((s) => s.selectedId);
  const selNode = useStore((s) => s.selectedId ? s.nodes[s.selectedId] : null);
  const isDoc = selNode && selNode.type !== 'folder';
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef(null);

  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [chat.length, thinking]);
  if (!enabled || !open) return null;

  const send = () => { if (draft.trim()) { aiActions.chat(draft); setDraft(''); } };
  const oneOrSet = mode === 'cowrite' ? 'just this one' : 'the whole set';

  return (
    <div className="assistant">
      <div className="asst-hd">
        <span className="asst-mark">✦</span>
        <div className="asst-title">Assistant</div>
        <button className="icon-btn" onClick={() => aiActions.togglePanel()} title="Close"><CloseX /></button>
      </div>

      {pending > 0 && (
        <button className="asst-review" onClick={() => aiActions.setSurface('changes')}>
          <span className="ar-spark">✦</span> {pending} change{pending === 1 ? '' : 's'} waiting in changeset review
          <span className="ar-go">Review →</span>
        </button>
      )}

      <div className="asst-actions">
        <div className="asst-sec-row"><span className="asst-sec">Co-write</span><span className="asst-mode-hint">{mode} mode · default “{oneOrSet}”</span></div>
        <button className="asst-act" disabled={!isDoc || !!thinking}
          onClick={() => aiActions.propose({ docId: selId, command: 'lineedit', label: 'Line edit' })}>
          <span className="aa-spark">✦</span> Line-edit “{isDoc ? selNode.title : 'this scene'}”
          <span className="aa-cost">{fmtCost(estimateCost('lineedit', 'claude-haiku'))}</span>
        </button>
        <div className="asst-act-row">
          <button className="asst-act sm" disabled={!isDoc || !!thinking} onClick={() => aiActions.propose({ docId: selId, command: 'tighten', label: 'Tighten prose' })}>Tighten</button>
          <button className="asst-act sm" disabled={!isDoc || !!thinking} onClick={() => aiActions.propose({ docId: selId, command: 'expand', label: 'Expand' })}>Expand</button>
          <button className="asst-act sm" disabled={!isDoc} onClick={() => aiActions.proof(selId)}>Proof</button>
        </div>
      </div>

      <div className="asst-scope">
        <span className="scope-label">Context scope</span>
        <div className="scope-seg">
          {SCOPES.map((s) => <button key={s.id} className={scope === s.id ? 'on' : ''} onClick={() => aiActions.setScope(s.id)}>{s.label}</button>)}
        </div>
      </div>

      <div className="asst-chat" ref={scrollRef}>
        {chat.length === 0 && !thinking && (
          <div className="asst-empty">
            <p>Ask about your manuscript — characters, timeline, continuity, POV. I only see what's in your <b>{SCOPES.find((s) => s.id === scope).label.toLowerCase()}</b> scope.</p>
            <div className="sugg">{CHAT_SUGGESTIONS.map((s) => <button key={s} onClick={() => aiActions.chat(s)}>{s}</button>)}</div>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>
            {m.role === 'ai' && <span className="msg-mark">✦</span>}
            <div className="msg-body"><div className="msg-text">{m.text}</div>{m.role === 'ai' && <CiteChips cites={m.cites} />}</div>
          </div>
        ))}
        {thinking && <div className="msg ai"><span className="msg-mark">✦</span><div className="msg-body"><div className="thinking"><i></i><i></i><i></i></div></div></div>}
      </div>

      <div className="asst-input">
        <textarea value={draft} placeholder="Ask about your manuscript…" rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="send-btn" onClick={send} disabled={!draft.trim()} title="Send">↑</button>
      </div>
    </div>
  );
}

function CloseX() {
  return React.createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
    React.createElement('path', { d: 'M4 4l8 8M12 4l-8 8' }));
}

// ── in-editor selection toolbar (co-write invocation) ─────────────────────────
function SelectionToolbar() {
  const enabled = useAI((s) => s.enabled);
  const [tb, setTb] = React.useState(null);
  React.useEffect(() => {
    if (!enabled) { setTb(null); return; }
    const onUp = (e) => {
      const ta = e.target.closest && e.target.closest('.cm textarea');
      if (!ta) { setTimeout(() => setTb(null), 1); return; }
      const start = ta.selectionStart, end = ta.selectionEnd;
      const text = ta.value.slice(start, end);
      if (!text || text.trim().length < 2) { setTb(null); return; }
      const node = store.get().nodes[store.get().selectedId];
      if (!node || node.type === 'folder') return;
      setTb({ x: e.clientX, y: e.clientY, start, end, text, docId: store.get().selectedId });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [enabled]);
  if (!enabled || !tb) return null;
  const run = (command, label) => { aiActions.propose({ docId: tb.docId, command, label, selection: { start: tb.start, end: tb.end, text: tb.text } }); setTb(null); };
  const x = Math.min(Math.max(tb.x - 150, 12), window.innerWidth - 320);
  const y = Math.max(tb.y - 52, 60);
  return (
    <div className="sel-tb" style={{ left: x, top: y }} onMouseDown={(e) => e.preventDefault()}>
      <span className="sel-spark">✦</span>
      <button onClick={() => run('rewrite', 'Rewrite selection')}>Rewrite</button>
      <button onClick={() => run('expand', 'Expand selection')}>Expand</button>
      <button onClick={() => run('describe', 'Add detail')}>Describe</button>
      <button onClick={() => run('tighten', 'Tighten selection')}>Tighten</button>
      <button className="muted" onClick={() => { aiActions.chat('Brainstorm alternatives for: “' + tb.text.slice(0, 80) + '”'); aiActions.openPanel(); setTb(null); }}>Brainstorm</button>
    </div>
  );
}

Object.assign(window, { AssistantPanel, SelectionToolbar });
