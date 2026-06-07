// ─────────────────────────────────────────────────────────────────────────────
// AISurfaces.jsx — Propagation-debt inbox (keystone), Autopilot (launcher +
// run monitor + drafting queue + unified evaluation report), and BYOK Settings.
// ─────────────────────────────────────────────────────────────────────────────

// ══ PROPAGATION-DEBT INBOX ═══════════════════════════════════════════════════
// The work is five co-evolving layers (voice/world/character/outline/prose) plus
// canon. A change in one creates downstream debt; this inbox surfaces & resolves it.
const LAYER_META = {
  canon:     { label: 'Canon',     color: 'oklch(0.62 0.15 20)' },
  character: { label: 'Character', color: 'oklch(0.66 0.12 70)' },
  location:  { label: 'World',     color: 'oklch(0.64 0.09 190)' },
  lore:      { label: 'Lore',      color: 'oklch(0.62 0.11 300)' },
  voice:     { label: 'Voice',     color: 'oklch(0.66 0.10 250)' },
  outline:   { label: 'Outline',   color: 'oklch(0.66 0.10 300)' },
};

function DebtItem({ d }) {
  const [open, setOpen] = React.useState(true);
  const lm = LAYER_META[d.layer] || LAYER_META.canon;
  const unresolved = d.affected.filter((a) => !a.resolved).length;
  const done = unresolved === 0;
  return (
    <div className={'debt-item' + (done ? ' done' : '')}>
      <div className="debt-hd" onClick={() => setOpen(!open)}>
        <span className="debt-layer" style={{ '--lc': lm.color }}>{lm.label}</span>
        <div className="debt-title">{d.title}</div>
        <span className={'debt-count' + (done ? ' ok' : '')}>{done ? 'resolved' : unresolved + ' to review'}</span>
        <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); aiActions.dismissDebt(d.id); }} title="Dismiss">✕</button>
      </div>
      {open && (
        <div className="debt-body">
          <p className="debt-detail">{d.detail}</p>
          <div className="debt-affected">
            {d.affected.map((a) => {
              const title = store.get().nodes[a.docId]?.title || (CODEX[a.docId] ? CODEX[a.docId].name : a.docId);
              return (
                <div key={a.docId} className={'aff-row' + (a.resolved ? ' resolved' : '')}>
                  <span className="aff-dot" />
                  <div className="aff-main">
                    <div className="aff-t">{title}</div>
                    <div className="aff-n">{a.note}</div>
                  </div>
                  {a.resolved ? <span className="aff-done">✓ reviewed</span> : (
                    <div className="aff-acts">
                      <button className="btn ghost sm" onClick={() => { if (store.get().nodes[a.docId]) { actions.select(a.docId); aiActions.setSurface(null); } }}>Open</button>
                      <button className="btn ghost sm" onClick={() => { aiActions.propose({ docId: a.docId, command: 'lineedit', label: 'Propagation fix', group: 'Propagation fixes', silentReview: true }); aiActions.resolveAffected(d.id, a.docId); }}>Draft fix</button>
                      <button className="btn sm" onClick={() => aiActions.resolveAffected(d.id, a.docId)}>Mark OK</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PropagationView() {
  const debt = useAI((s) => s.debt);
  const open = debt.filter((d) => d.affected.some((a) => !a.resolved));
  const resolved = debt.filter((d) => !d.affected.some((a) => !a.resolved));
  if (debt.length === 0) {
    return (
      <div className="main">
        <div className="surface-hd"><span className="hd-ic">⇄</span> <b>Propagation debt</b></div>
        <div className="ai-empty">
          <div className="ae-spark">⇄</div>
          <div className="ae-title">Everything is in sync</div>
          <div className="ae-sub">Your story is five co-evolving layers — voice, world, characters, outline, prose — plus canon cutting across them. When you (or the AI) change one, anything downstream that references it shows up here as debt to review. Try editing a fact in the Codex.</div>
          <div className="ae-actions"><button className="btn" onClick={() => aiActions.setSurface('codex')}>Open Codex</button></div>
        </div>
      </div>
    );
  }
  return (
    <div className="main">
      <div className="surface-hd"><span className="hd-ic">⇄</span> <b>Propagation debt</b>
        <span className="hd-sub">{open.length} open · downstream effects of changes across layers</span></div>
      <div className="debt-scroll">
        {open.map((d) => <DebtItem key={d.id} d={d} />)}
        {resolved.length > 0 && <div className="debt-resolved-hd">Resolved</div>}
        {resolved.map((d) => <DebtItem key={d.id} d={d} />)}
      </div>
    </div>
  );
}

// ══ AUTOPILOT ════════════════════════════════════════════════════════════════
function AutopilotLauncher() {
  const [target, setTarget] = React.useState('pipeline'); // pipeline | single
  const [single, setSingle] = React.useState('draft');
  const [checkpoint, setCheckpoint] = React.useState('pause'); // pause | straight
  const [scope, setScope] = React.useState('cloud');
  const [cap, setCap] = React.useState(200);
  const phases = target === 'pipeline' ? PIPELINE : PIPELINE.filter((p) => p.id === single);
  const est = phases.reduce((a, p, i) => a + estimateCost('foundation', scope === 'local' ? 'ollama-local' : 'claude-sonnet') * (3 + i), 0);
  return (
    <div className="launcher">
      <div className="lc-hd"><span className="hd-ic">◇</span><b>New Autopilot run</b></div>
      <div className="lc-grid">
        <div className="lc-field">
          <label>What to run</label>
          <div className="seg">
            <button className={target === 'pipeline' ? 'on' : ''} onClick={() => setTarget('pipeline')}>Whole pipeline</button>
            <button className={target === 'single' ? 'on' : ''} onClick={() => setTarget('single')}>Single automation</button>
          </div>
          {target === 'single' && (
            <select className="sel" value={single} onChange={(e) => setSingle(e.target.value)} style={{ marginTop: 8 }}>
              {PIPELINE.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.desc}</option>)}
            </select>
          )}
        </div>
        <div className="lc-field">
          <label>Between phases</label>
          <div className="seg">
            <button className={checkpoint === 'pause' ? 'on' : ''} onClick={() => setCheckpoint('pause')}>Pause for my approval</button>
            <button className={checkpoint === 'straight' ? 'on' : ''} onClick={() => setCheckpoint('straight')}>Run straight through</button>
          </div>
          <div className="hint">{checkpoint === 'pause' ? 'You review and approve each phase before the next begins.' : 'Runs end-to-end, then one review at the end. Everything still lands as proposals.'}</div>
        </div>
        <div className="lc-field">
          <label>Model scope</label>
          <div className="seg">
            <button className={scope === 'cloud' ? 'on' : ''} onClick={() => setScope('cloud')}>Cloud (BYOK)</button>
            <button className={scope === 'local' ? 'on' : ''} onClick={() => setScope('local')}>Local (Ollama)</button>
          </div>
        </div>
        <div className="lc-field">
          <label>Spend cap</label>
          <div className="cap-row">
            <input type="range" min="20" max="1000" step="20" value={cap} onChange={(e) => setCap(+e.target.value)} />
            <span className="cap-val">{fmtDollars(cap)}</span>
          </div>
        </div>
      </div>
      <div className="lc-phases">
        {phases.map((p) => <div className="lc-phase" key={p.id}><span className="lp-ic">{p.icon}</span>{p.label}</div>)}
      </div>
      <div className="lc-foot">
        <div className="lc-est">Estimated cost <b>≈ {fmtDollars(est)}</b> · hard cap {fmtDollars(cap)}</div>
        <div className="tb-spacer" />
        <button className="btn primary" onClick={() => aiActions.startRun({ scope, checkpoint, cap, target, single })}>Start run</button>
      </div>
    </div>
  );
}

function DraftingQueue() {
  const q = useAI((s) => s.draftQueue);
  if (!q.length) return null;
  const ST = { queued: 'queued', drafting: 'drafting', scored: 'scored', kept: 'kept', retrying: 'retrying' };
  return (
    <div className="dq">
      <div className="dq-hd">Drafting queue</div>
      {q.map((c) => (
        <div className="dq-row" key={c.docId}>
          <span className={'dq-status ' + c.status}>{ST[c.status] || c.status}</span>
          <span className="dq-title">{c.title}</span>
          <div className="tb-spacer" />
          {c.retries > 0 && <span className="dq-retry">retry ×{c.retries}</span>}
          {c.score != null && <span className="dq-score" style={{ '--s': c.score }}>{c.score}<small>/100</small></span>}
        </div>
      ))}
    </div>
  );
}

function RunMonitor() {
  const run = useAI((s) => s.run);
  const cost = useAI((s) => s.cost);
  if (!run) return null;
  return (
    <div className="run-monitor">
      <div className="rm-hd">
        <span className={'rm-state ' + run.status}>{run.status}</span>
        <b>Autopilot · {run.checkpoint === 'pause' ? 'checkpoint mode' : 'straight-through'}</b>
        <div className="tb-spacer" />
        <span className="cost-chip live">spent {fmtDollars(run.spent)} / cap {fmtDollars(run.cap)}</span>
        {run.status === 'running' && <button className="btn danger sm" onClick={() => aiActions.stopRun()}>■ Stop</button>}
        {run.status === 'paused' && <button className="btn primary sm" onClick={() => aiActions.resumeRun()}>Approve & continue</button>}
        {(run.status === 'done' || run.status === 'stopped') && <button className="btn sm" onClick={() => aiActions.clearRun()}>Clear</button>}
      </div>
      <div className="rm-phases">
        {run.phases.map((p, i) => (
          <div key={p.id} className={'rm-phase ' + p.status}>
            <span className="rmp-ic">{PIPELINE[i].icon}</span>
            <div className="rmp-main"><div className="rmp-label">{p.label}</div><div className="rmp-desc">{PIPELINE[i].desc}</div></div>
            <span className="rmp-state">{p.status === 'done' ? '✓' : p.status === 'running' ? '…' : ''}</span>
          </div>
        ))}
      </div>
      {run.phases.find((p) => p.id === 'foundation' && p.status === 'done') && <FoundationGate />}
      <DraftingQueue />
      {run.log.length > 0 && <div className="rm-log">{run.log.map((l, i) => <div key={i}>· {l}</div>)}</div>}
      {run.status === 'paused' && <div className="rm-pause-note">Paused at a checkpoint. Review the phase output, then approve to continue — or stop the run.</div>}
    </div>
  );
}

function FoundationGate() {
  const score = 86;
  return (
    <div className="found-gate">
      <div className="fg-hd">Foundation quality gate</div>
      <div className="fg-bar"><i style={{ width: score + '%' }} /><span className="fg-thresh" style={{ left: '80%' }} /></div>
      <div className="fg-row"><span className="fg-pass">PASS · {score}/100</span><span className="muted">threshold 80 — loops until cleared</span></div>
    </div>
  );
}

function AutopilotView() {
  const run = useAI((s) => s.run);
  return (
    <div className="main">
      <div className="surface-hd"><span className="hd-ic">◇</span> <b>Autopilot</b>
        <span className="hd-sub">opt-in background automations · everything returns as proposals</span></div>
      <div className="autopilot-scroll">
        {run ? <RunMonitor /> : <AutopilotLauncher />}
        <EvalReport />
      </div>
    </div>
  );
}

// ── unified EVALUATION report ─────────────────────────────────────────────────
function EvalReport() {
  const sel = useStore((s) => s.selectedId);
  const node = useStore((s) => s.selectedId ? s.nodes[s.selectedId] : null);
  const body = useStore((s) => s.selectedId ? s.docs[s.selectedId] : null);
  const isDoc = node && node.type !== 'folder';
  const [ran, setRan] = React.useState(false);
  if (!isDoc) return (
    <div className="eval-report"><div className="er-hd">Evaluation report</div><div className="muted" style={{ padding: 14 }}>Select a document to evaluate.</div></div>
  );
  const text = body?.content || '';
  const slop = scoreProse(text);
  const judge = judgeReport(text);
  return (
    <div className="eval-report">
      <div className="er-hd"><span className="hd-ic">⊛</span> Evaluation report <span className="muted">· {node.title}</span>
        <div className="tb-spacer" />
        {!ran && <button className="btn sm" onClick={() => { setRan(true); aiActions.addCost(estimateCost('judge', aiStore.get().routes.judge)); }}>Run evaluation</button>}
      </div>
      {!ran ? <div className="muted" style={{ padding: 14 }}>Runs the slop scorer, LLM judge, reader panel, and adversarial editor against this document.</div> : (
        <div className="er-body">
          <div className="er-cards">
            <div className="er-card"><div className="erc-n" style={{ color: slop.score >= 75 ? 'var(--st-final)' : 'var(--st-prog)' }}>{slop.score}</div><div className="erc-l">Slop score /100</div></div>
            <div className="er-card"><div className="erc-n">{judge.overall.toFixed(1)}</div><div className="erc-l">Judge /10</div></div>
            <div className="er-card"><div className="erc-n">{slop.flags.length}</div><div className="erc-l">Flagged spans</div></div>
            <div className="er-card"><div className="erc-n">#{2}</div><div className="erc-l">Elo rank of 5</div></div>
          </div>
          <div className="er-sec"><div className="er-sec-hd">LLM judge rubric</div>
            {judge.rubric.map((r) => (
              <div className="rub-row" key={r.k}><span className="rub-k">{r.k}</span><span className="rub-bar"><i style={{ width: (r.v * 10) + '%' }} /></span><span className="rub-v">{r.v}</span><span className="rub-note">{r.note}</span></div>
            ))}
          </div>
          <div className="er-sec"><div className="er-sec-hd">Reader panel</div>
            <div className="reader-grid">
              {READERS.map((r) => (
                <div className="reader-card" key={r.name}><div className="rd-top"><span className="rd-glyph">{r.glyph}</span><span className="rd-name">{r.name}</span></div><div className="rd-take">{r.take}</div><div className="rd-verdict">{r.verdict}</div></div>
              ))}
            </div>
          </div>
          <div className="er-sec"><div className="er-sec-hd">Adversarial editor <span className="muted">· suggested cuts</span></div>
            <button className="btn ghost sm" onClick={() => aiActions.propose({ docId: sel, command: 'tighten', label: 'Apply adversarial cuts', group: 'Adversarial cuts' })}>Apply cuts as a proposal →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ SETTINGS · model routing (BYOK) ══════════════════════════════════════════
function SettingsView() {
  const routes = useAI((s) => s.routes);
  const keys = useAI((s) => s.keys);
  const features = useAI((s) => s.features);
  const enabled = useAI((s) => s.enabled);
  const cost = useAI((s) => s.cost);
  const FEAT = [
    ['inline', 'Inline co-write tools'], ['chat', 'Chat with manuscript'], ['scorer', 'Slop scorer'],
    ['judge', 'LLM judge'], ['draft', 'Chapter drafting'], ['foundation', 'Foundation generation'],
  ];
  return (
    <div className="main">
      <div className="surface-hd"><Icons.Insp /> <b>AI settings · model routing</b>
        <span className="hd-sub">bring your own key · you pay per call</span></div>
      <div className="settings-scroll">
        <div className="set-sec">
          <h4>Global</h4>
          <div className="set-row"><span>AI features</span><div className="tb-spacer" /><button className={'toggle' + (enabled ? ' on' : '')} onClick={() => aiActions.enable(!enabled)}><span /></button></div>
          <div className="set-row"><span>Session spend</span><div className="tb-spacer" /><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDollars(cost)}</b></div>
        </div>
        <div className="set-sec">
          <h4>API keys</h4>
          {['Anthropic', 'OpenAI', 'Ollama'].map((v) => (
            <div className="key-row" key={v}>
              <span className="key-v">{v}</span>
              <input className="inp" type={v === 'Ollama' ? 'text' : 'password'} placeholder={v === 'Ollama' ? 'http://localhost:11434' : 'sk-…'} defaultValue={keys[v]} onBlur={(e) => aiActions.setKey(v, e.target.value)} />
              <span className={'key-state' + ((keys[v] && keys[v].length) ? ' ok' : '')}>{(keys[v] && keys[v].length) ? '● connected' : '○ not set'}</span>
            </div>
          ))}
        </div>
        <div className="set-sec">
          <h4>Per-feature routing</h4>
          {FEAT.map(([k, label]) => (
            <div className="route-row" key={k}>
              <button className={'toggle sm' + (features[k] ? ' on' : '')} onClick={() => aiActions.setFeature(k, !features[k])}><span /></button>
              <span className="route-label">{label}</span>
              <div className="tb-spacer" />
              <select className="sel sm" value={routes[k]} disabled={!features[k]} onChange={(e) => aiActions.setRoute(k, e.target.value)}>
                {Object.keys(MODELS).map((m) => <option key={m} value={m}>{MODELS[m].label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PropagationView, AutopilotView, SettingsView, EvalReport });
