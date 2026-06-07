// ─────────────────────────────────────────────────────────────────────────────
// Codex.jsx — the story bible. Entity cards + detail view. NOT a passive wiki:
// it's the generators' output target, shows live manuscript backlinks, AI
// summaries, continuity flags, and editing a canon fact raises propagation debt.
// ─────────────────────────────────────────────────────────────────────────────

function CodexCard({ eid, onOpen }) {
  const ent = CODEX[eid];
  const mentions = useStore((s) => scanMentions(ent, s));
  const total = mentions.reduce((a, m) => a + m.count, 0);
  const t = ENTITY_TYPE[ent.type];
  const flagN = ent.flags.length;
  return (
    <button className="codex-card" onClick={() => onOpen(eid)} style={{ '--etype': t.color }}>
      <div className="cc-top">
        <span className="cc-glyph">{ent.glyph}</span>
        <span className="cc-type" style={{ color: t.color }}>{t.label}</span>
        {flagN > 0 && <span className="cc-flag" title={flagN + ' continuity flag(s)'}>{flagN}</span>}
      </div>
      <div className="cc-name">{ent.name}</div>
      <div className="cc-summary">{ent.summary}</div>
      <div className="cc-foot">
        <span>{total} mention{total === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>{mentions.length} doc{mentions.length === 1 ? '' : 's'}</span>
      </div>
    </button>
  );
}

function CodexDetail({ eid, onClose }) {
  const ent = CODEX[eid];
  const mentions = useStore((s) => scanMentions(ent, s));
  const t = ENTITY_TYPE[ent.type];
  const [fields, setFields] = React.useState(ent.fields);
  const commitFact = (key, value) => {
    if (value !== ent.fields[key]) { ent.fields[key] = value; aiActions.editEntityFact(eid, key, value); }
  };
  return (
    <div className="codex-detail">
      <div className="cdet-hd">
        <button className="icon-btn" onClick={onClose} title="Back">←</button>
        <span className="cc-glyph lg" style={{ color: t.color }}>{ent.glyph}</span>
        <div>
          <div className="cdet-name">{ent.name}</div>
          <div className="cdet-type" style={{ color: t.color }}>{t.label}</div>
        </div>
        <div className="tb-spacer" />
        <button className="btn ghost sm" onClick={() => aiActions.propose({ docId: ent.linkId || mentions[0]?.docId, command: 'lineedit', label: 'Expand ' + ent.name, group: 'Codex generation' })} disabled={!ent.linkId && !mentions.length}>
          <span style={{ color: 'var(--accent)' }}>✦</span> Generate detail
        </button>
      </div>

      <div className="cdet-scroll">
        <div className="cdet-sec">
          <h4>AI summary · what we know so far</h4>
          <p className="cdet-summary">{ent.summary}</p>
        </div>

        <div className="cdet-sec">
          <h4>Attributes <span className="edit-hint">editing a fact raises propagation debt</span></h4>
          <div className="fact-grid">
            {Object.keys(fields).map((k) => (
              <div className="fact" key={k}>
                <div className="fact-k">{k}</div>
                <input className="fact-v" defaultValue={fields[k]} onBlur={(e) => commitFact(k, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
              </div>
            ))}
          </div>
        </div>

        {ent.flags.length > 0 && (
          <div className="cdet-sec">
            <h4>Continuity flags</h4>
            {ent.flags.map((f, i) => (
              <div key={i} className={'flag ' + f.severity}>
                <span className="flag-dot" />
                <div>
                  <div className="flag-text">{f.text}</div>
                  {f.docId && <button className="linkish sm" onClick={() => { if (store.get().nodes[f.docId]) { actions.select(f.docId); aiActions.setSurface(null); } }}>{store.get().nodes[f.docId]?.title || f.docId} →</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="cdet-sec">
          <h4>Manuscript backlinks</h4>
          {mentions.length === 0 ? <div className="muted">No mentions in the manuscript yet.</div> : (
            <div className="backlinks">
              {mentions.map((m) => (
                <button key={m.docId} className="backlink" onClick={() => { actions.select(m.docId); actions.setView('editor'); aiActions.setSurface(null); }}>
                  {nodeIcon(store.get().nodes[m.docId], true)}
                  <span className="bl-t">{m.title}</span>
                  <span className="bl-c">{m.count}×</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodexView() {
  const [open, setOpen] = React.useState(null);
  const enabled = useAI((s) => s.enabled);
  // group by type
  const byType = { character: [], location: [], lore: [] };
  CODEX_ORDER.forEach((id) => byType[CODEX[id].type].push(id));

  if (open) return (
    <div className="main"><CodexDetail eid={open} onClose={() => setOpen(null)} /></div>
  );

  return (
    <div className="main">
      <div className="surface-hd">
        <Icons.Book /> <b>Codex</b>
        <span className="hd-sub">{CODEX_ORDER.length} entities · auto-detected from your manuscript</span>
        <div className="tb-spacer" />
        <button className="btn ghost sm" onClick={() => aiActions.openPanel()}><span style={{ color: 'var(--accent)' }}>✦</span> Generate whole cast</button>
      </div>
      <div className="codex-scroll">
        {['character', 'location', 'lore'].map((tp) => (
          <div className="codex-group" key={tp}>
            <div className="codex-group-hd"><span className="cg-dot" style={{ background: ENTITY_TYPE[tp].color }} />{ENTITY_TYPE[tp].label}s <span className="muted">· {byType[tp].length}</span></div>
            <div className="codex-grid">
              {byType[tp].map((id) => <CodexCard key={id} eid={id} onOpen={setOpen} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { CodexView, CodexDetail });
