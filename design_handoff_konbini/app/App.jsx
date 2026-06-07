// ─────────────────────────────────────────────────────────────────────────────
// App.jsx — shell: titlebar, toolbar, body grid, status bar, composition mode,
// modals, and the Tweaks panel. Loaded last; mounts the app.
// ─────────────────────────────────────────────────────────────────────────────

const EDITOR_FONTS = {
  mono:  "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace",
  serif: "'Spectral', Georgia, 'Times New Roman', serif",
  sans:  "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
};
const COMP_BG = {
  dark:  { '--comp-bg': 'oklch(0.16 0.012 285)', '--comp-text': 'oklch(0.86 0.01 285)' },
  paper: { '--comp-bg': 'oklch(0.95 0.012 90)',  '--comp-text': 'oklch(0.28 0.01 60)' },
  sepia: { '--comp-bg': 'oklch(0.90 0.035 75)',  '--comp-text': 'oklch(0.32 0.03 50)' },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "oklch(0.64 0.11 300)",
  "editorFont": "mono",
  "editorSize": 17,
  "theme": "dark",
  "density": "balanced",
  "compBg": "dark"
}/*EDITMODE-END*/;

// ── titlebar ─────────────────────────────────────────────────────────────────
function Titlebar() {
  const title = useStore((s) => s.title);
  const saveStatus = useStore((s) => s.ui.saveStatus);
  const lastSaved = useStore((s) => s.ui.lastSaved);
  const [editing, setEditing] = React.useState(false);
  const saving = saveStatus === 'saving';
  return (
    <div className="titlebar">
      <div className="lights"><span className="light r" /><span className="light y" /><span className="light g" /></div>
      <div className="proj">
        <span className="wm">コンビニ</span>
        {editing
          ? <input autoFocus defaultValue={title} className="inp" style={{ width: 180, height: 22, padding: '0 6px' }}
              onBlur={(e) => { actions.setProjectTitle(e.target.value.trim() || title); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          : <b onDoubleClick={() => setEditing(true)}>{title}</b>}
        <span style={{ color: 'var(--text-3)' }}>— writing studio</span>
      </div>
      <div className={'save-pill' + (saving ? ' saving' : '')}>
        <span className="save-dot" />
        {saving ? 'Saving…' : 'Saved to disk'}
      </div>
    </div>
  );
}

// ── toolbar ──────────────────────────────────────────────────────────────────
function Toolbar() {
  const view = useStore((s) => s.ui.view);
  const focusMode = useStore((s) => s.ui.focusMode);
  const sel = useStore((s) => s.selectedId);
  const hasDoc = useStore((s) => sel && s.nodes[sel] && s.nodes[sel].type !== 'folder');
  const layout = useShell((s) => s.layout);
  return (
    <div className="toolbar">
      <div className="tb-group">
        <button className={'tb-btn' + (layout.binder ? ' on' : '')} title="Toggle Binder" onClick={() => shellActions.toggleBinder()}><Icons.Sidebar /></button>
      </div>
      <div className="tb-sep" />
      <div className="tb-group seg">
        <button className={view === 'editor' ? 'on' : ''} onClick={() => actions.setView('editor')}>Editor</button>
        <button className={view === 'corkboard' ? 'on' : ''} onClick={() => actions.setView('corkboard')}>Corkboard</button>
        <button className={view === 'outliner' ? 'on' : ''} onClick={() => actions.setView('outliner')}>Outliner</button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button className={'tb-btn' + (focusMode ? ' on' : '')} title="Focus (dim inactive lines)" onClick={() => store.set((s) => ({ ...s, ui: { ...s.ui, focusMode: !s.ui.focusMode } }))}><Icons.Focus /> Focus</button>
        <button className="tb-btn" title="Composition Mode" disabled={!hasDoc} onClick={() => actions.setComposition(true)}><Icons.Expand /> Compose</button>
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <button className="tb-btn" title="Snapshots" disabled={!hasDoc} onClick={() => actions.setModal({ kind: 'snapshots', id: sel })}><Icons.Camera /></button>
        <button className="tb-btn" title="Compile / Export" onClick={() => actions.setModal({ kind: 'compile' })}><Icons.Compile /> Compile</button>
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <AIToolbarButton />
        <button className={'tb-btn' + (layout.insp ? ' on' : '')} title="Toggle Inspector" onClick={() => shellActions.toggleInsp()}><Icons.Insp /></button>
      </div>
    </div>
  );
}

// ── AI: toolbar button (enable / assistant toggle) ────────────────────────────
function AIToolbarButton() {
  const enabled = useAI((s) => s.enabled);
  const panelOpen = useAI((s) => s.panelOpen);
  if (!enabled) return <button className="tb-btn ai-enable" title="Enable AI assistance (opt-in)" onClick={() => aiActions.enable(true)}><span className="ai-spark">✦</span> AI</button>;
  return <button className={'tb-btn' + (panelOpen ? ' on' : '')} title="Toggle Assistant" onClick={() => aiActions.togglePanel()}><span className="ai-spark">✦</span> Assistant</button>;
}

// ── AI: the persistent mode spine + surface tabs + cost (only when enabled) ───
function AIBar() {
  const enabled = useAI((s) => s.enabled);
  const mode = useAI((s) => s.mode);
  const surface = useAI((s) => s.surface);
  const cost = useAI((s) => s.cost);
  const pending = useAI((s) => s.proposals.filter((p) => p.status === 'pending').length);
  const debtN = useAI((s) => s.debt.filter((d) => d.affected.some((a) => !a.resolved)).length);
  const run = useAI((s) => s.run);
  if (!enabled) return null;
  const MODES = [{ id: 'cowrite', label: 'Co-write' }, { id: 'assisted', label: 'Assisted' }, { id: 'autopilot', label: 'Autopilot' }];
  const tab = (id, label, badge) => (
    <button className={'ai-tab' + (surface === id ? ' on' : '')} onClick={() => aiActions.setSurface(id)}>{label}{badge ? <span className="ai-badge">{badge}</span> : null}</button>
  );
  return (
    <div className="ai-bar">
      <div className="ai-modes">
        {MODES.map((m) => <button key={m.id} className={'ai-mode' + (mode === m.id ? ' on' : '')} onClick={() => aiActions.setMode(m.id)}>{m.label}</button>)}
      </div>
      <div className="ai-tabs">
        <button className={'ai-tab' + (surface == null ? ' on' : '')} onClick={() => aiActions.setSurface(null)}>Manuscript</button>
        {tab('codex', 'Codex')}
        {tab('changes', 'Changes', pending || null)}
        {tab('autopilot', 'Autopilot', run && run.status === 'running' ? '●' : null)}
        {tab('debt', 'Debt', debtN || null)}
      </div>
      <div className="tb-spacer" />
      {run && run.status === 'running' && <button className="btn danger sm" onClick={() => aiActions.stopRun()}>■ Stop run</button>}
      <span className="cost-chip" title="Session spend (BYOK)">{fmtDollars(cost)} this session</span>
      <button className={'ai-tab gear' + (surface === 'settings' ? ' on' : '')} title="Model routing & keys" onClick={() => aiActions.setSurface('settings')}>⚙</button>
    </div>
  );
}

// ── status bar ───────────────────────────────────────────────────────────────
function StatusBar() {
  const node = useStore((s) => s.selectedId ? s.nodes[s.selectedId] : null);
  const body = useStore((s) => s.selectedId ? s.docs[s.selectedId] : null);
  const sub = useStore((s) => s.selectedId ? subtreeWordCount(s, s.selectedId) : 0);
  const saveStatus = useStore((s) => s.ui.saveStatus);
  if (!node) return <div className="statusbar"><span>Ready</span></div>;
  const isFolder = node.type === 'folder';
  const words = isFolder ? sub : wordCount(body?.content);
  const chars = isFolder ? 0 : charCount(body?.content);
  const target = node.meta.target || 0;
  const pct = target ? Math.round((words / target) * 100) : 0;
  return (
    <div className="statusbar">
      <span style={{ textTransform: 'capitalize', color: 'var(--text-2)' }}>{node.type}</span>
      <span>·</span>
      <span>{node.title}</span>
      <div className="sb-r">
        {target > 0 && <span>{pct}% of {target.toLocaleString()}</span>}
        <span><b>{words.toLocaleString()}</b> words</span>
        {!isFolder && <span><b>{chars.toLocaleString()}</b> chars</span>}
        <span>{saveStatus === 'saving' ? 'Autosaving…' : 'Autosaved'}</span>
      </div>
    </div>
  );
}

// ── composition mode ─────────────────────────────────────────────────────────
function Composition({ compBg }) {
  const node = useStore((s) => s.selectedId ? s.nodes[s.selectedId] : null);
  const body = useStore((s) => s.selectedId ? s.docs[s.selectedId] : null);
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') actions.setComposition(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  if (!node || node.type === 'folder') { actions.setComposition(false); return null; }
  const words = wordCount(body?.content);
  const target = node.meta.target || 0;
  const pct = target ? Math.min(100, Math.round((words / target) * 100)) : 0;
  return (
    <div className="comp" style={COMP_BG[compBg]}>
      <div className="comp-top">
        <Icons.Book /><b style={{ fontWeight: 600 }}>{node.title}</b>
        <span style={{ opacity: .6 }}>composition mode</span>
      </div>
      <button className="comp-exit" onClick={() => actions.setComposition(false)}>Exit · Esc</button>
      <div className="comp-scroll">
        <div className="comp-col">
          <MarkdownEditor docId={node.id} focusMode autofocus key={'comp-' + node.id} />
        </div>
      </div>
      <div className="comp-foot">
        <span>{words.toLocaleString()} words</span>
        {target > 0 && <span>{pct}% of {target.toLocaleString()} target</span>}
        <span>{charCount(body?.content).toLocaleString()} characters</span>
      </div>
    </div>
  );
}

// ── main area router ─────────────────────────────────────────────────────────
function MainArea() {
  const view = useStore((s) => s.ui.view);
  const surface = window.useAI ? useAI((s) => s.enabled ? s.surface : null) : null;
  if (surface === 'changes') return <ChangesetView />;
  if (surface === 'codex') return <CodexView />;
  if (surface === 'autopilot') return <AutopilotView />;
  if (surface === 'debt') return <PropagationView />;
  if (surface === 'settings') return <SettingsView />;
  if (view === 'outliner') return <OutlinerView />;
  if (view === 'corkboard') return <CorkboardView />;
  return <EditorView />;
}

// ── modals ───────────────────────────────────────────────────────────────────
function Modals() {
  const modal = useStore((s) => s.ui.modal);
  if (!modal) return null;
  if (modal.kind === 'snapshots') return <SnapshotsModal id={modal.id} />;
  if (modal.kind === 'compile') return <CompileModal />;
  return null;
}

// ── app ──────────────────────────────────────────────────────────────────────
function TweaksUI({ t, setTweak, aiEnabled, platform }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme" />
      <TweakRadio label="Appearance" value={t.theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} onChange={(v) => setTweak('theme', v)} />
      <TweakColor label="Accent" value={t.accent}
        options={['oklch(0.64 0.11 300)', 'oklch(0.62 0.12 250)', 'oklch(0.66 0.11 150)', 'oklch(0.70 0.13 75)', 'oklch(0.62 0.15 20)']}
        onChange={(v) => setTweak('accent', v)} />
      <TweakRadio label="Binder density" value={t.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'balanced', label: 'Balanced' }, { value: 'roomy', label: 'Roomy' }]} onChange={(v) => setTweak('density', v)} />

      <TweakSection label="Writing surface" />
      <TweakRadio label="Editor font" value={t.editorFont} options={[{ value: 'mono', label: 'Mono' }, { value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]} onChange={(v) => setTweak('editorFont', v)} />
      <TweakSlider label="Editor size" value={t.editorSize} min={14} max={22} step={1} unit="px" onChange={(v) => setTweak('editorSize', v)} />

      <TweakSection label="Composition mode" />
      <TweakRadio label="Background" value={t.compBg} options={[{ value: 'dark', label: 'Dark' }, { value: 'paper', label: 'Paper' }, { value: 'sepia', label: 'Sepia' }]} onChange={(v) => setTweak('compBg', v)} />

      <TweakSection label="Platform chrome" />
      <TweakRadio label="Window style" value={platform} options={[{ value: 'mac', label: 'macOS' }, { value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }]} onChange={(v) => shellActions.setPlatform(v)} />

      <TweakSection label="AI assistance" />
      <TweakToggle label="Enable AI layer (opt-in)" value={aiEnabled} onChange={(v) => aiActions.enable(v)} />
      <TweakButton label="Reset AI session" secondary onClick={() => aiActions.resetAI()} />

      <TweakSection label="Project" />
      <TweakButton label="Back to launch screen" secondary onClick={() => shellActions.closeProject()} />
    </TweaksPanel>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const composition = useStore((s) => s.ui.composition);
  const screen = useShell((s) => s.screen);
  const platform = useShell((s) => s.platform);
  const layout = useShell((s) => s.layout);
  const activeMenu = useShell((s) => s.activeMenu);
  const aiEnabled = useAI((s) => s.enabled);
  const asstOpen = useAI((s) => s.enabled && s.panelOpen);

  useGlobalShortcuts();

  React.useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--accent', t.accent);
    r.style.setProperty('--editor-font', EDITOR_FONTS[t.editorFont]);
    r.style.setProperty('--editor-size', t.editorSize + 'px');
    r.setAttribute('data-theme', t.theme);
    r.setAttribute('data-density', t.density);
    window.__tweaks = { t, setTweak }; // bridge for menu/preferences actions
  }, [t, setTweak]);

  // close an open menu on any outside click
  React.useEffect(() => {
    if (!activeMenu) return;
    const h = () => shellActions.closeMenu();
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [activeMenu]);

  if (screen === 'launch') {
    return (
      <React.Fragment>
        <LaunchScreen />
        <TweaksUI t={t} setTweak={setTweak} aiEnabled={aiEnabled} platform={platform} />
      </React.Fragment>
    );
  }

  const bodyClass = 'body' + (layout.binder ? '' : ' no-binder') + (layout.insp ? '' : ' no-insp');

  return (
    <React.Fragment>
      <div className={'os-shell plat-' + platform}>
        {platform === 'mac' && <MacMenuBar />}
        <div className="stage">
          <div className="win">
            <ChromeTitlebar />
            <Toolbar />
            <AIBar />
            <div className={bodyClass + (asstOpen ? ' asst-open' : '')}>
              {layout.binder ? <Binder /> : <div />}
              <MainArea />
              {asstOpen ? <AssistantPanel /> : (layout.insp ? <Inspector /> : <div />)}
            </div>
            <StatusBar />
          </div>
        </div>
      </div>

      {composition && <Composition compBg={t.compBg} />}
      <Modals />
      <ShellModals />
      <SelectionToolbar />
      <TweaksUI t={t} setTweak={setTweak} aiEnabled={aiEnabled} platform={platform} />
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
