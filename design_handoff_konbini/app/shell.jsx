// ─────────────────────────────────────────────────────────────────────────────
// shell.jsx — the application shell OUTSIDE any single project: launch screen,
// project lifecycle, cross-platform window chrome + native menu bar.
//
// shellStore is separate from the project store. It owns: which screen we're on
// (launch | studio), the mocked platform (mac | windows | linux), the recent-
// projects registry, layout visibility (binder/inspector), and menu/modal state.
// Persisted to konbini_shell_v1.
// ─────────────────────────────────────────────────────────────────────────────

const SHELL_LS = 'konbini_shell_v1';

function shellSeedRecents() {
  const now = Date.now();
  return [
    { id: 'proj-midnight-aisle', title: 'Midnight Aisle', location: '~/Documents/Konbini/Midnight Aisle.konbini', opened: now - 1000 * 60 * 12, words: 2480, template: 'novel', accent: 'oklch(0.64 0.11 300)' },
    { id: 'proj-hollow-house',  title: 'The Hollow House', location: '~/Documents/Konbini/Hollow House.konbini',  opened: now - 1000 * 60 * 60 * 26, words: 31420, template: 'novel', accent: 'oklch(0.62 0.12 250)' },
    { id: 'proj-last-train',    title: 'Last Train Home',  location: '~/iCloud/Writing/Last Train.konbini',        opened: now - 1000 * 60 * 60 * 24 * 5, words: 64880, template: 'novel', accent: 'oklch(0.66 0.11 150)' },
    { id: 'proj-saltglass',     title: 'Saltglass',        location: '~/Dropbox/Scripts/Saltglass.konbini',         opened: now - 1000 * 60 * 60 * 24 * 19, words: 8230, template: 'screenplay', accent: 'oklch(0.70 0.13 75)' },
  ];
}

function shellDefault() {
  return {
    screen: 'launch',          // launch | studio
    platform: 'mac',           // mac | windows | linux
    activeMenu: null,          // open top-level menu id
    modal: null,               // 'new' | 'open' | 'shortcuts' | 'about'
    layout: { binder: true, insp: true },
    recents: shellSeedRecents(),
  };
}
function shellLoad() {
  try {
    const raw = localStorage.getItem(SHELL_LS);
    if (raw) { const p = JSON.parse(raw); if (p && p.screen) return Object.assign(shellDefault(), p, { activeMenu: null, modal: null }); }
  } catch (e) {}
  return shellDefault();
}

const shellStore = (function () {
  let state = shellLoad();
  const listeners = new Set();
  return {
    get: () => state,
    set(u) { state = typeof u === 'function' ? u(state) : { ...state, ...u };
      try { localStorage.setItem(SHELL_LS, JSON.stringify({ ...state, activeMenu: null, modal: null })); } catch (e) {}
      listeners.forEach((l) => l()); },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
})();

function useShell(selector) {
  const sel = selector || ((s) => s);
  const [snap, setSnap] = React.useState(() => sel(shellStore.get()));
  React.useEffect(() => { const u = () => setSnap(sel(shellStore.get())); u(); return shellStore.subscribe(u); }, []);
  return snap;
}

function relTime(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + (Math.floor(d / 3600) === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(d / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const shellActions = {
  setPlatform(p) { shellStore.set((s) => ({ ...s, platform: p })); },
  openMenu(id) { shellStore.set((s) => ({ ...s, activeMenu: id })); },
  hoverMenu(id) { shellStore.set((s) => (s.activeMenu && s.activeMenu !== id ? { ...s, activeMenu: id } : s)); },
  closeMenu() { shellStore.set((s) => (s.activeMenu ? { ...s, activeMenu: null } : s)); },
  setModal(m) { shellStore.set((s) => ({ ...s, modal: m, activeMenu: null })); },
  toggleBinder() { shellStore.set((s) => ({ ...s, layout: { ...s.layout, binder: !s.layout.binder } })); },
  toggleInsp() { shellStore.set((s) => ({ ...s, layout: { ...s.layout, insp: !s.layout.insp } })); },

  // ── lifecycle ──────────────────────────────────────────────────────────────
  touchRecent(id, patch) {
    shellStore.set((s) => {
      const ex = s.recents.find((r) => r.id === id);
      const rest = s.recents.filter((r) => r.id !== id);
      const entry = Object.assign({ id, opened: Date.now() }, ex || {}, patch || {}, { opened: Date.now() });
      return { ...s, recents: [entry, ...rest].slice(0, 10) };
    });
  },
  openProject(id) {
    const cur = store.get();
    if (cur.id !== id) {
      if (!actions.openById(id)) {
        // no slot yet → build the stub backing this recent
        actions.loadProject(window.buildStubProject(id));
      }
      if (window.aiActions) window.aiActions.resetForProject(id);
    }
    shellActions.touchRecent(id, { title: store.get().title, words: window.subtreeWordCount ? null : null });
    shellStore.set((s) => ({ ...s, screen: 'studio', modal: null, activeMenu: null }));
  },
  createProject({ title, template, location }) {
    const p = window.buildProjectFromTemplate(title, template, location);
    actions.loadProject(p);
    if (window.aiActions) window.aiActions.resetForProject(p.id);
    shellActions.touchRecent(p.id, { title: p.title, location: (location || '~/Documents/Konbini') + '/' + (title || 'Untitled') + '.konbini', template, words: 0, accent: 'oklch(0.64 0.11 300)' });
    shellStore.set((s) => ({ ...s, screen: 'studio', modal: null, activeMenu: null }));
  },
  closeProject() {
    // current project already persisted to its slot; return to the front door
    shellStore.set((s) => ({ ...s, screen: 'launch', activeMenu: null, modal: null }));
  },
  removeRecent(id) { shellStore.set((s) => ({ ...s, recents: s.recents.filter((r) => r.id !== id) })); },
};

// ── native menu definitions (also the keyboard-shortcut spec) ─────────────────
// key tokens: mod (⌘/Ctrl) · shift · alt (⌥/Alt) · ctrl (⌃/Ctrl) · then the key
const MENU_DEFS = [
  { id: 'app', label: 'Konbini', macOnly: true, items: [
    { label: 'About Konbini', act: 'about' },
    { sep: true },
    { label: 'Preferences…', key: 'mod+,', act: 'prefs' },
    { sep: true },
    { label: 'Hide Konbini', key: 'mod+h', disabled: true },
    { label: 'Quit Konbini', key: 'mod+q', act: 'quit' },
  ] },
  { id: 'file', label: 'File', items: [
    { label: 'New Project…', key: 'mod+n', act: 'new' },
    { label: 'Open Project…', key: 'mod+o', act: 'open' },
    { label: 'Open Recent', submenu: 'recents' },
    { sep: true },
    { label: 'New Folder', key: 'mod+alt+n', act: 'newFolder' },
    { label: 'New Document', key: 'mod+shift+d', act: 'newDoc' },
    { label: 'New Scene', key: 'mod+shift+n', act: 'newScene' },
    { sep: true },
    { label: 'Take Snapshot', key: 'mod+shift+s', act: 'snapshot' },
    { label: 'Compile…', key: 'mod+shift+e', act: 'compile' },
    { sep: true },
    { label: 'Close Project', key: 'mod+w', act: 'close' },
  ] },
  { id: 'edit', label: 'Edit', items: [
    { label: 'Undo', key: 'mod+z', disabled: true },
    { label: 'Redo', key: 'mod+shift+z', disabled: true },
    { sep: true },
    { label: 'Cut', key: 'mod+x', disabled: true },
    { label: 'Copy', key: 'mod+c', disabled: true },
    { label: 'Paste', key: 'mod+v', disabled: true },
    { sep: true },
    { label: 'Rename', key: 'enter', act: 'rename' },
    { label: 'Duplicate', key: 'mod+d', act: 'duplicate' },
    { label: 'Move to Trash', key: 'delete', act: 'trash' },
    { sep: true },
    { label: 'Find in Document…', key: 'mod+f', disabled: true },
    { label: 'Find in Project…', key: 'mod+shift+f', disabled: true },
  ] },
  { id: 'view', label: 'View', items: [
    { label: 'Editor', key: 'mod+1', act: 'vEditor' },
    { label: 'Corkboard', key: 'mod+2', act: 'vCork' },
    { label: 'Outliner', key: 'mod+3', act: 'vOutline' },
    { sep: true },
    { label: 'Toggle Binder', key: 'mod+alt+b', act: 'tBinder' },
    { label: 'Toggle Inspector', key: 'mod+alt+i', act: 'tInsp' },
    { sep: true },
    { label: 'Composition Mode', key: 'mod+alt+c', act: 'compose' },
    { label: 'Focus Mode', key: 'mod+alt+o', act: 'focus' },
    { sep: true },
    { label: 'Toggle Light / Dark', key: 'mod+alt+t', act: 'theme' },
  ] },
  { id: 'format', label: 'Format', items: [
    { label: 'Bold', key: 'mod+b', disabled: true },
    { label: 'Italic', key: 'mod+i', disabled: true },
    { sep: true },
    { label: 'Heading 1', key: 'mod+alt+1', disabled: true },
    { label: 'Heading 2', key: 'mod+alt+2', disabled: true },
    { label: 'Heading 3', key: 'mod+alt+3', disabled: true },
    { sep: true },
    { label: 'Block Quote', key: 'mod+alt+q', disabled: true },
    { label: 'Bullet List', key: 'mod+alt+u', disabled: true },
  ] },
  { id: 'tools', label: 'Tools', items: [
    { label: 'AI Assistant', key: 'mod+shift+a', act: 'ai' },
    { label: 'Changeset Review', key: 'mod+shift+r', act: 'changes' },
    { label: 'Codex', key: 'mod+shift+k', act: 'codex' },
    { label: 'Slop Proof', key: 'mod+shift+p', act: 'proof' },
    { sep: true },
    { label: 'Project Statistics…', act: 'stats', disabled: true },
  ] },
  { id: 'help', label: 'Help', items: [
    { label: 'Konbini Help', disabled: true },
    { label: 'Keyboard Shortcuts', key: 'mod+/', act: 'shortcuts' },
    { sep: true },
    { label: 'About Konbini', act: 'about' },
  ] },
];

function fmtKey(combo, platform) {
  if (!combo) return '';
  const mac = platform === 'mac';
  const map = mac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '⏎', delete: '⌫', ',': ',', '/': '/' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', enter: 'Enter', delete: 'Del', ',': ',', '/': '/' };
  const parts = combo.split('+').map((tok) => map[tok] || tok.toUpperCase());
  const dedup = parts.filter((p, i) => i === 0 || p !== parts[i - 1]); // collapse Ctrl+Ctrl on Windows
  return mac ? dedup.join('') : dedup.join('+');
}

Object.assign(window, { shellStore, useShell, shellActions, MENU_DEFS, fmtKey, relTime });
