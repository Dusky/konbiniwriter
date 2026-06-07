// ─────────────────────────────────────────────────────────────────────────────
// Menus.jsx — cross-platform window chrome + native menu bar + the action
// dispatcher that also powers global keyboard shortcuts. One MENU_DEFS table
// drives the menus, the dropdowns, the shortcut spec, and the keymap.
// ─────────────────────────────────────────────────────────────────────────────

// project-store selection-aware "new X" parent resolution (mirrors the binder)
function _addAt(type) {
  const s = store.get();
  const cur = s.selectedId ? s.nodes[s.selectedId] : null;
  const parent = cur ? (cur.type === 'folder' ? cur.id : cur.parentId) : null;
  actions.create(parent, type);
}

function menuAction(act) {
  const s = store.get();
  const sel = s.selectedId;
  const isDoc = sel && s.nodes[sel] && s.nodes[sel].type !== 'folder';
  const tw = window.__tweaks;
  switch (act) {
    case 'new': return shellActions.setModal('new');
    case 'open': return shellActions.setModal('open');
    case 'close': case 'quit': return shellActions.closeProject();
    case 'prefs': return shellActions.setModal('prefs');
    case 'about': return shellActions.setModal('about');
    case 'shortcuts': return shellActions.setModal('shortcuts');
    case 'newFolder': return _addAt('folder');
    case 'newDoc': return _addAt('document');
    case 'newScene': return _addAt('scene');
    case 'snapshot': if (isDoc) { actions.takeSnapshot(sel); actions.setModal({ kind: 'snapshots', id: sel }); } return;
    case 'compile': return actions.setModal({ kind: 'compile' });
    case 'rename': if (sel) store.set((st) => ({ ...st, ui: { ...st.ui, renaming: sel } })); return;
    case 'duplicate': if (sel) actions.duplicate(sel); return;
    case 'trash': if (sel) actions.remove(sel); return;
    case 'vEditor': return actions.setView('editor');
    case 'vCork': return actions.setView('corkboard');
    case 'vOutline': return actions.setView('outliner');
    case 'tBinder': return shellActions.toggleBinder();
    case 'tInsp': return shellActions.toggleInsp();
    case 'compose': if (isDoc) actions.setComposition(true); return;
    case 'focus': return store.set((st) => ({ ...st, ui: { ...st.ui, focusMode: !st.ui.focusMode } }));
    case 'theme': if (tw) tw.setTweak('theme', tw.t.theme === 'dark' ? 'light' : 'dark'); return;
    case 'ai': if (!aiStore.get().enabled) { aiActions.enable(true); } else { aiActions.togglePanel(); } return;
    case 'changes': aiActions.enable(true); aiActions.setSurface('changes'); return;
    case 'codex': aiActions.enable(true); aiActions.setSurface('codex'); return;
    case 'proof': aiActions.enable(true); if (isDoc) aiActions.proof(sel); return;
    default: return;
  }
}

// ── window controls (traffic lights / windows buttons) ────────────────────────
function WindowControls({ platform }) {
  if (platform === 'windows' || platform === 'linux') {
    return (
      <div className={'win-ctl ' + platform}>
        <button className="wc min" title="Minimize"><svg viewBox="0 0 12 12"><path d="M2 6h8" /></svg></button>
        <button className="wc max" title="Maximize"><svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" /></svg></button>
        <button className="wc close" title="Close" onClick={() => shellActions.closeProject()}><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg></button>
      </div>
    );
  }
  return (
    <div className="lights">
      <button className="light r" title="Close" onClick={() => shellActions.closeProject()} />
      <button className="light y" title="Minimize" />
      <button className="light g" title="Zoom" />
    </div>
  );
}

// ── one dropdown ──────────────────────────────────────────────────────────────
function MenuDropdown({ def, platform, recents }) {
  return (
    <div className="menu-dd" onClick={(e) => e.stopPropagation()}>
      {def.items.map((it, i) => {
        if (it.sep) return <div className="menu-sep" key={i} />;
        if (it.submenu === 'recents') {
          return (
            <div className="menu-item has-sub" key={i}>
              <span className="mi-label">Open Recent</span><span className="mi-sub-arrow">›</span>
              <div className="menu-dd submenu">
                {recents.length === 0 && <div className="menu-item disabled"><span className="mi-label">No recent projects</span></div>}
                {recents.map((r) => (
                  <button className="menu-item" key={r.id} onClick={() => { shellActions.openProject(r.id); shellActions.closeMenu(); }}>
                    <span className="mi-label">{r.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <button className={'menu-item' + (it.disabled ? ' disabled' : '')} key={i}
            onClick={() => { if (it.disabled) return; shellActions.closeMenu(); if (it.act) menuAction(it.act); }}>
            <span className="mi-label">{it.label}</span>
            {it.key && <span className="mi-key">{fmtKey(it.key, platform)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── the menu bar (mac: lives in a global desktop bar; win/linux: in-window) ───
function MenuStrip({ platform, activeMenu, recents, inWindow }) {
  const defs = MENU_DEFS.filter((m) => !(m.macOnly && platform !== 'mac'));
  return (
    <div className="menu-strip">
      {defs.map((def) => (
        <div className="menu-top-wrap" key={def.id}>
          <button className={'menu-top' + (def.id === 'app' ? ' app' : '') + (activeMenu === def.id ? ' open' : '')}
            onClick={(e) => { e.stopPropagation(); shellStore.get().activeMenu === def.id ? shellActions.closeMenu() : shellActions.openMenu(def.id); }}
            onMouseEnter={() => shellActions.hoverMenu(def.id)}>
            {def.label}
          </button>
          {activeMenu === def.id && <MenuDropdown def={def} platform={platform} recents={recents} />}
        </div>
      ))}
    </div>
  );
}

// macOS global menu bar (sits above the window, full desktop width)
function MacMenuBar() {
  const platform = useShell((s) => s.platform);
  const activeMenu = useShell((s) => s.activeMenu);
  const recents = useShell((s) => s.recents);
  if (platform !== 'mac') return null;
  return (
    <div className="mac-menubar" onClick={() => shellActions.closeMenu()}>
      <span className="mac-logo"></span>
      <MenuStrip platform="mac" activeMenu={activeMenu} recents={recents} />
      <div className="tb-spacer" />
      <span className="mac-clock">{new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}  ·  3:33</span>
    </div>
  );
}

// the window's own titlebar (chrome differs per platform)
function ChromeTitlebar() {
  const platform = useShell((s) => s.platform);
  const activeMenu = useShell((s) => s.activeMenu);
  const recents = useShell((s) => s.recents);
  const title = useStore((s) => s.title);
  const saving = useStore((s) => s.ui.saveStatus === 'saving');
  const winChrome = platform !== 'mac';
  return (
    <div className={'titlebar ' + platform}>
      {platform === 'mac' && <WindowControls platform="mac" />}
      {winChrome && <span className="win-appname">Konbini</span>}
      {winChrome && <MenuStrip platform={platform} activeMenu={activeMenu} recents={recents} />}
      <div className="proj">
        <span className="wm">コンビニ</span>
        <b>{title}</b>
        <span className="save-pill-inline">{saving ? 'saving…' : 'saved'}</span>
      </div>
      <div className="tb-spacer" />
      {winChrome && <WindowControls platform={platform} />}
    </div>
  );
}

// ── modals: Shortcuts reference, About, Preferences ───────────────────────────
function ShellModals() {
  const modal = useShell((s) => s.modal);
  const platform = useShell((s) => s.platform);
  if (!modal) return null;
  const close = () => shellActions.setModal(null);
  if (modal === 'shortcuts') {
    return (
      <div className="modal-bg" onClick={close}>
        <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-hd"><h3>Keyboard Shortcuts</h3><span className="sub">{platform === 'mac' ? 'macOS' : 'Windows / Linux'}</span></div>
          <div className="modal-body sc-grid">
            {MENU_DEFS.filter((m) => !m.macOnly || platform === 'mac').map((m) => (
              <div className="sc-col" key={m.id}>
                <div className="sc-head">{m.label}</div>
                {m.items.filter((it) => it.key).map((it, i) => (
                  <div className="sc-row" key={i}><span>{it.label}</span><span className="mi-key">{fmtKey(it.key, platform)}</span></div>
                ))}
              </div>
            ))}
          </div>
          <div className="modal-foot"><div className="tb-spacer" /><button className="btn" onClick={close}>Done</button></div>
        </div>
      </div>
    );
  }
  if (modal === 'about') {
    return (
      <div className="modal-bg" onClick={close}>
        <div className="about" onClick={(e) => e.stopPropagation()}>
          <div className="about-mark">混</div>
          <div className="about-name">Konbini</div>
          <div className="about-ver">Writing Studio · Version 0.1 (prototype)</div>
          <div className="about-desc">A local-first writing studio. Your words live in a portable bundle of Markdown files on your disk — yours, offline, forever. AI is an opt-in layer you can switch off entirely.</div>
          <button className="btn" onClick={close}>Close</button>
        </div>
      </div>
    );
  }
  if (modal === 'prefs') return <PrefsModal close={close} />;
  return null;
}

function PrefsModal({ close }) {
  const tw = window.__tweaks;
  const [, force] = React.useState(0);
  if (!tw) return null;
  const set = (k, v) => { tw.setTweak(k, v); force((n) => n + 1); };
  const t = tw.t;
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd"><h3>Preferences</h3><span className="sub">applies immediately</span></div>
        <div className="modal-body">
          <div className="pref-row"><span>Appearance</span><div className="seg">
            {['dark', 'light'].map((v) => <button key={v} className={t.theme === v ? 'on' : ''} onClick={() => set('theme', v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div></div>
          <div className="pref-row"><span>Editor font</span><div className="seg">
            {['mono', 'serif', 'sans'].map((v) => <button key={v} className={t.editorFont === v ? 'on' : ''} onClick={() => set('editorFont', v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div></div>
          <div className="pref-row"><span>Editor size</span><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min="14" max="22" step="1" value={t.editorSize} onChange={(e) => set('editorSize', +e.target.value)} style={{ accentColor: 'var(--accent)' }} />
            <b style={{ minWidth: 38, textAlign: 'right' }}>{t.editorSize}px</b>
          </div></div>
          <div className="pref-row"><span>Binder density</span><div className="seg">
            {['compact', 'balanced', 'roomy'].map((v) => <button key={v} className={t.density === v ? 'on' : ''} onClick={() => set('density', v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div></div>
          <div className="pref-note">In the shipping app these live in a native Preferences window; the prototype shares them with the Tweaks panel.</div>
        </div>
        <div className="modal-foot"><div className="tb-spacer" /><button className="btn" onClick={close}>Done</button></div>
      </div>
    </div>
  );
}

// ── global keyboard shortcuts (built from the same MENU_DEFS) ─────────────────
function useGlobalShortcuts() {
  const platform = useShell((s) => s.platform);
  const screen = useShell((s) => s.screen);
  React.useEffect(() => {
    const keymap = [];
    MENU_DEFS.forEach((m) => m.items.forEach((it) => { if (it.key && it.act && !it.disabled) keymap.push({ combo: it.key, act: it.act }); }));
    const handler = (e) => {
      if (screen !== 'studio') return;
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'textarea' || tag === 'input' || e.target.isContentEditable;
      for (const { combo, act } of keymap) {
        const toks = combo.split('+');
        const key = toks[toks.length - 1];
        if (key === 'enter' || key === 'delete') continue; // contextual, skip global
        const needMod = toks.includes('mod'), needShift = toks.includes('shift'), needAlt = toks.includes('alt'), needCtrl = toks.includes('ctrl');
        const mod = platform === 'mac' ? e.metaKey : e.ctrlKey;
        const ctrl = e.ctrlKey;
        if (needMod !== mod) continue;
        if (needShift !== e.shiftKey) continue;
        if (needAlt !== e.altKey) continue;
        if (needCtrl && !ctrl) continue;
        let k = e.key.toLowerCase();
        if (k === ' ') k = 'space';
        if (k !== key) continue;
        // don't steal plain typing; all our combos require mod/ctrl/alt
        if (!needMod && !needCtrl && !needAlt) continue;
        if (typing && (act === 'rename')) continue;
        e.preventDefault();
        menuAction(act);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [platform, screen]);
}

Object.assign(window, { WindowControls, MacMenuBar, ChromeTitlebar, ShellModals, menuAction, useGlobalShortcuts });
