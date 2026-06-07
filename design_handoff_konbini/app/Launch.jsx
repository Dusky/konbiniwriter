// ─────────────────────────────────────────────────────────────────────────────
// Launch.jsx — the front door. Welcome window with recent projects, plus the
// New Project and Open Project flows. This is the app entry point: no project is
// loaded into the studio until the user picks one here.
// ─────────────────────────────────────────────────────────────────────────────

function spineColor(accent) { return accent || 'oklch(0.64 0.11 300)'; }

function RecentRow({ r }) {
  const tmpl = (window.PROJECT_TEMPLATES[r.template] || {}).label || 'Project';
  return (
    <div className="recent-row" onClick={() => shellActions.openProject(r.id)}>
      <div className="recent-spine" style={{ background: spineColor(r.accent) }} />
      <div className="recent-main">
        <div className="recent-title">{r.title}</div>
        <div className="recent-path">{r.location}</div>
      </div>
      <div className="recent-meta">
        <div className="rm-words">{r.words ? r.words.toLocaleString() + ' words' : '—'}</div>
        <div className="rm-when">{relTime(r.opened)}</div>
      </div>
      <button className="recent-x" title="Remove from recents" onClick={(e) => { e.stopPropagation(); shellActions.removeRecent(r.id); }}>✕</button>
    </div>
  );
}

function LaunchScreen() {
  const recents = useShell((s) => s.recents);
  const platform = useShell((s) => s.platform);
  return (
    <div className="launch-stage">
      <div className="launch-win">
        <div className="launch-left">
          <div className="ll-top">
            <div className="ll-mark">混</div>
            <div className="ll-name">Konbini</div>
            <div className="ll-tag">writing studio</div>
          </div>
          <div className="ll-actions">
            <button className="ll-btn primary" onClick={() => shellActions.setModal('new')}>
              <span className="llb-ic">＋</span>
              <span><b>New Project</b><small>Start a fresh manuscript</small></span>
            </button>
            <button className="ll-btn" onClick={() => shellActions.setModal('open')}>
              <span className="llb-ic">⌂</span>
              <span><b>Open Project…</b><small>Browse for a .konbini bundle</small></span>
            </button>
          </div>
          <div className="ll-foot">
            <span>Version 0.1 · local-first · offline</span>
            <div className="plat-switch" title="Preview platform chrome">
              {['mac', 'windows', 'linux'].map((p) => (
                <button key={p} className={platform === p ? 'on' : ''} onClick={() => shellActions.setPlatform(p)}>{p === 'mac' ? 'macOS' : p === 'windows' ? 'Windows' : 'Linux'}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="launch-right">
          <div className="lr-head">Recent Projects</div>
          <div className="lr-list">
            {recents.length === 0
              ? <div className="lr-empty">No recent projects.<br />Create one to get started.</div>
              : recents.map((r) => <RecentRow key={r.id} r={r} />)}
          </div>
        </div>
      </div>
      <ShellModals />
      <NewProjectModal />
      <OpenProjectModal />
    </div>
  );
}

// ── New Project ───────────────────────────────────────────────────────────────
function NewProjectModal() {
  const modal = useShell((s) => s.modal);
  const [title, setTitle] = React.useState('Untitled');
  const [tmpl, setTmpl] = React.useState('novel');
  const [loc, setLoc] = React.useState('~/Documents/Konbini');
  React.useEffect(() => { if (modal === 'new') { setTitle('Untitled'); setTmpl('novel'); } }, [modal]);
  if (modal !== 'new') return null;
  const close = () => shellActions.setModal(null);
  const create = () => shellActions.createProject({ title: title.trim() || 'Untitled', template: tmpl, location: loc });
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal np" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd"><h3>New Project</h3><span className="sub">creates a portable .konbini bundle on disk</span></div>
        <div className="modal-body">
          <div className="np-field">
            <label>Project name</label>
            <input className="inp" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
          </div>
          <div className="np-field">
            <label>Template</label>
            <div className="tmpl-grid">
              {Object.keys(window.PROJECT_TEMPLATES).map((k) => {
                const t = window.PROJECT_TEMPLATES[k];
                return (
                  <button key={k} className={'tmpl-card' + (tmpl === k ? ' on' : '')} onClick={() => setTmpl(k)}>
                    <span className="tc-glyph">{t.glyph}</span>
                    <span className="tc-label">{t.label}</span>
                    <span className="tc-desc">{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="np-field">
            <label>Location</label>
            <div className="loc-row">
              <span className="loc-path">{loc}/<b>{(title.trim() || 'Untitled')}</b>.konbini</span>
              <button className="btn sm" onClick={() => setLoc(loc === '~/Documents/Konbini' ? '~/iCloud/Writing' : '~/Documents/Konbini')}>Choose…</button>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>One .md file per document · human-readable · safe in Dropbox / iCloud</span>
          <div className="tb-spacer" />
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={create}>Create Project</button>
        </div>
      </div>
    </div>
  );
}

// ── Open Project (mock OS file browser scoped to .konbini bundles) ────────────
function OpenProjectModal() {
  const modal = useShell((s) => s.modal);
  const recents = useShell((s) => s.recents);
  const [sel, setSel] = React.useState(null);
  React.useEffect(() => { if (modal === 'open') setSel(null); }, [modal]);
  if (modal !== 'open') return null;
  const close = () => shellActions.setModal(null);
  const places = ['Documents/Konbini', 'iCloud/Writing', 'Dropbox/Scripts'];
  const open = () => { if (sel) shellActions.openProject(sel); };
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" style={{ maxWidth: 680, height: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd"><h3>Open Project</h3><span className="sub">.konbini bundles</span></div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 0, padding: 0 }}>
          <div className="open-side">
            <div className="os-group">Favorites</div>
            {places.map((p) => <div key={p} className="os-place"><span className="os-ic">▸</span>{p.split('/').pop()}</div>)}
          </div>
          <div className="open-main">
            <div className="open-crumb">Konbini ▸ all bundles</div>
            <div className="open-files">
              {recents.map((r) => (
                <button key={r.id} className={'open-file' + (sel === r.id ? ' sel' : '')}
                  onClick={() => setSel(r.id)} onDoubleClick={() => shellActions.openProject(r.id)}>
                  <span className="of-ic" style={{ color: spineColor(r.accent) }}>◳</span>
                  <span className="of-name">{r.title}.konbini</span>
                  <span className="of-meta">{r.words ? (r.words.toLocaleString() + ' w') : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>{sel ? recents.find((r) => r.id === sel).location : 'Select a bundle to open'}</span>
          <div className="tb-spacer" />
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!sel} onClick={open}>Open</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LaunchScreen, NewProjectModal, OpenProjectModal });
