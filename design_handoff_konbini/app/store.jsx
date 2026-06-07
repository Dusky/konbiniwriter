// ─────────────────────────────────────────────────────────────────────────────
// store.jsx — project data model + normalized store + actions
//
// SCHEMA (this doubles as the project.json serialization spec for the real app):
//
//   Project {
//     schemaVersion: number          // bump when shape changes
//     id: string                     // stable project id
//     title: string
//     created: ISO, modified: ISO
//     rootIds: string[]              // top-level binder node ids, ordered
//     nodes: { [id]: Node }          // normalized binder tree
//     docs:  { [id]: DocBody }       // per-document content + snapshots
//     settings: { ... }              // future-proof bag
//   }
//   Node {  // one .md file OR a folder; lives in project.json manifest
//     id, type: 'folder'|'document'|'scene',
//     title, parentId|null, childIds: string[],
//     expanded: bool,
//     meta: { label, status, synopsis, target, includeInCompile },
//     ext: {}                        // EXTENSIBLE bag — future codex refs, AI flags
//   }
//   DocBody { content: string, snapshots: Snapshot[] }   // .md text on disk
//   Snapshot { id, title, takenAt: ISO, content: string, words: number }
//
// Stable unique ids on every node = seam for a future "codex" + AI proposal layer.
// The editor mutates docs ONLY through updateContent() — a single document-
// mutation API a future diff/proposal system can wrap without a rewrite.
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const LS_KEY = 'konbini_project_v1';

const STATUS = {
  idea:       { label: 'Idea',        color: 'var(--st-idea)' },
  todo:       { label: 'To Do',       color: 'var(--st-todo)' },
  inprogress: { label: 'In Progress', color: 'var(--st-prog)' },
  draft:      { label: 'First Draft', color: 'var(--st-draft)' },
  revised:    { label: 'Revised',     color: 'var(--st-rev)' },
  final:      { label: 'Final',       color: 'var(--st-final)' },
};
const STATUS_ORDER = ['idea', 'todo', 'inprogress', 'draft', 'revised', 'final'];

const LABELS = {
  none:      { label: 'No Label',  color: 'transparent' },
  scene:     { label: 'Scene',     color: 'oklch(0.62 0.11 300)' },
  chapter:   { label: 'Chapter',   color: 'oklch(0.62 0.10 250)' },
  note:      { label: 'Note',      color: 'oklch(0.64 0.09 190)' },
  character: { label: 'Character', color: 'oklch(0.66 0.12 70)' },
  idea:      { label: 'Idea',      color: 'oklch(0.64 0.12 20)' },
};
const LABEL_ORDER = ['none', 'scene', 'chapter', 'note', 'character', 'idea'];

// ── word / char counting ─────────────────────────────────────────────────────
function stripMd(s) {
  return (s || '')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/[#>*_~\-\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function wordCount(s) {
  const t = stripMd(s);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}
function charCount(s) { return (s || '').length; }

let _uid = 0;
function uid(prefix) {
  _uid += 1;
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + (_uid).toString(36);
}

// ── persistence (simulates writing each project bundle to disk) ──────────────
// Each project persists to its own slot (konbini_proj_<id>); a pointer records
// the last-opened project. This makes the recent-projects flow real: close a
// project, open another, come back — your work is intact.
function slotKey(id) { return 'konbini_proj_' + id; }
const OPEN_PTR = 'konbini_open_id';
function persist(state) {
  try {
    state.modified = new Date().toISOString();
    localStorage.setItem(slotKey(state.id), JSON.stringify(state));
    localStorage.setItem(OPEN_PTR, state.id);
  } catch (e) { /* quota — ignore in prototype */ }
}
function loadProjectById(id) {
  try {
    const raw = localStorage.getItem(slotKey(id));
    if (raw) { const p = JSON.parse(raw); if (p && p.schemaVersion === SCHEMA_VERSION && p.nodes) return p; }
  } catch (e) {}
  return null;
}
function loadInitial() {
  try {
    // migrate the old single-slot key if present
    const legacy = localStorage.getItem(LS_KEY);
    if (legacy) { const p = JSON.parse(legacy); if (p && p.nodes) { localStorage.removeItem(LS_KEY); localStorage.setItem(slotKey(p.id), legacy); localStorage.setItem(OPEN_PTR, p.id); } }
    const openId = localStorage.getItem(OPEN_PTR);
    if (openId) { const p = loadProjectById(openId); if (p) return p; }
  } catch (e) { /* fall through to sample */ }
  return buildSampleProject();
}

// ── minimal external store ───────────────────────────────────────────────────
const store = (function () {
  let state = loadInitial();
  const listeners = new Set();
  return {
    get: () => state,
    set(updater) {
      const next = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
      state = next;
      persist(state);
      listeners.forEach((l) => l());
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
})();

function useStore(selector) {
  const sel = selector || ((s) => s);
  const [snap, setSnap] = React.useState(() => sel(store.get()));
  React.useEffect(() => {
    const update = () => setSnap(sel(store.get()));
    update();
    return store.subscribe(update);
  }, []);
  return snap;
}

// ── tree helpers ─────────────────────────────────────────────────────────────
function childIdsOf(state, id) {
  return id == null ? state.rootIds : (state.nodes[id]?.childIds || []);
}
function descendantIds(state, id, acc) {
  acc = acc || [];
  for (const cid of (state.nodes[id]?.childIds || [])) {
    acc.push(cid);
    descendantIds(state, cid, acc);
  }
  return acc;
}
function isAncestor(state, maybeAncestor, id) {
  let cur = state.nodes[id];
  while (cur && cur.parentId != null) {
    if (cur.parentId === maybeAncestor) return true;
    cur = cur.nodes ? null : state.nodes[cur.parentId];
  }
  return false;
}
function flattenVisible(state) {
  // returns [{id, depth}] respecting expanded state, in binder order
  const out = [];
  const walk = (ids, depth) => {
    for (const id of ids) {
      const n = state.nodes[id];
      if (!n) continue;
      out.push({ id, depth });
      if (n.type === 'folder' && n.expanded) walk(n.childIds, depth + 1);
    }
  };
  walk(state.rootIds, 0);
  return out;
}
function subtreeWordCount(state, id) {
  const node = state.nodes[id];
  if (!node) return 0;
  let total = 0;
  if (node.type !== 'folder') total += wordCount(state.docs[id]?.content);
  for (const cid of node.childIds) total += subtreeWordCount(state, cid);
  return total;
}

// ── actions ──────────────────────────────────────────────────────────────────
let _saveTimer = null;
const actions = {
  select(id) { store.set((s) => ({ ...s, selectedId: id, ui: { ...s.ui, view: s.nodes[id]?.type === 'folder' ? (s.ui.view === 'editor' ? 'corkboard' : s.ui.view) : 'editor' } })); },
  setView(view) { store.set((s) => ({ ...s, ui: { ...s.ui, view } })); },
  setComposition(on) { store.set((s) => ({ ...s, ui: { ...s.ui, composition: on } })); },
  setModal(modal) { store.set((s) => ({ ...s, ui: { ...s.ui, modal } })); },
  toggleExpand(id) {
    store.set((s) => ({ ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], expanded: !s.nodes[id].expanded } } }));
  },
  setExpanded(id, val) {
    store.set((s) => ({ ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], expanded: val } } }));
  },

  // The ONE document-mutation entry point. A future proposal/diff layer wraps this.
  updateContent(id, content) {
    store.set((s) => ({
      ...s,
      docs: { ...s.docs, [id]: { ...(s.docs[id] || { snapshots: [] }), content } },
      ui: { ...s.ui, saveStatus: 'saving' },
    }));
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      store.set((s) => ({ ...s, ui: { ...s.ui, saveStatus: 'saved', lastSaved: new Date().toISOString() } }));
    }, 700);
  },

  updateMeta(id, patch) {
    store.set((s) => ({ ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], meta: { ...s.nodes[id].meta, ...patch } } } }));
  },
  rename(id, title) {
    store.set((s) => ({ ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], title } } }));
  },

  create(parentId, type, atIndex) {
    const id = uid(type);
    const titleDefault = type === 'folder' ? 'New Folder' : type === 'scene' ? 'New Scene' : 'New Document';
    store.set((s) => {
      const nodes = { ...s.nodes };
      nodes[id] = {
        id, type, title: titleDefault, parentId: parentId,
        childIds: [], expanded: type === 'folder',
        meta: { label: type === 'scene' ? 'scene' : 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: type !== 'folder' },
        ext: {},
      };
      const docs = { ...s.docs };
      if (type !== 'folder') docs[id] = { content: '', snapshots: [] };
      let rootIds = s.rootIds;
      if (parentId == null) {
        rootIds = [...s.rootIds];
        rootIds.splice(atIndex == null ? rootIds.length : atIndex, 0, id);
      } else {
        const pc = [...nodes[parentId].childIds];
        pc.splice(atIndex == null ? pc.length : atIndex, 0, id);
        nodes[parentId] = { ...nodes[parentId], childIds: pc, expanded: true };
      }
      return { ...s, nodes, docs, rootIds, selectedId: id, ui: { ...s.ui, view: type === 'folder' ? 'corkboard' : 'editor', renaming: id } };
    });
    return id;
  },

  duplicate(id) {
    store.set((s) => {
      const nodes = { ...s.nodes };
      const docs = { ...s.docs };
      const cloneRec = (srcId, parentId) => {
        const src = s.nodes[srcId];
        const nid = uid(src.type);
        nodes[nid] = { ...src, id: nid, parentId, childIds: [], title: src.title + ' copy', meta: { ...src.meta }, ext: { ...src.ext } };
        if (s.docs[srcId]) docs[nid] = { content: s.docs[srcId].content, snapshots: [] };
        nodes[nid].childIds = src.childIds.map((c) => cloneRec(c, nid));
        return nid;
      };
      const src = s.nodes[id];
      const newId = cloneRec(id, src.parentId);
      if (src.parentId == null) {
        const rootIds = [...s.rootIds];
        rootIds.splice(rootIds.indexOf(id) + 1, 0, newId);
        return { ...s, nodes, docs, rootIds, selectedId: newId };
      }
      const pc = [...nodes[src.parentId].childIds];
      pc.splice(pc.indexOf(id) + 1, 0, newId);
      nodes[src.parentId] = { ...nodes[src.parentId], childIds: pc };
      return { ...s, nodes, docs, selectedId: newId };
    });
  },

  remove(id) {
    store.set((s) => {
      const toTrash = s.trashId && id !== s.trashId && !isAncestor(s, s.trashId, id) && s.nodes[id].parentId !== s.trashId;
      const detach = (st) => {
        const n = st.nodes[id];
        const nodes = { ...st.nodes };
        if (n.parentId == null) {
          return { ...st, rootIds: st.rootIds.filter((x) => x !== id) };
        }
        nodes[n.parentId] = { ...nodes[n.parentId], childIds: nodes[n.parentId].childIds.filter((x) => x !== id) };
        return { ...st, nodes };
      };
      if (toTrash) {
        let st = detach(s);
        const nodes = { ...st.nodes };
        nodes[id] = { ...nodes[id], parentId: st.trashId };
        nodes[st.trashId] = { ...nodes[st.trashId], childIds: [...nodes[st.trashId].childIds, id], expanded: true };
        return { ...st, nodes, selectedId: st.selectedId === id ? null : st.selectedId };
      }
      // permanent delete (already in trash)
      let st = detach(s);
      const kill = [id, ...descendantIds(s, id)];
      const nodes = { ...st.nodes };
      const docs = { ...st.docs };
      kill.forEach((k) => { delete nodes[k]; delete docs[k]; });
      return { ...st, nodes, docs, selectedId: kill.includes(st.selectedId) ? null : st.selectedId };
    });
  },

  move(id, newParentId, atIndex) {
    store.set((s) => {
      if (id === newParentId) return s;
      if (newParentId != null && descendantIds(s, id).includes(newParentId)) return s; // no cycles
      const node = s.nodes[id];
      const nodes = { ...s.nodes };
      let rootIds = [...s.rootIds];
      // detach
      if (node.parentId == null) rootIds = rootIds.filter((x) => x !== id);
      else nodes[node.parentId] = { ...nodes[node.parentId], childIds: nodes[node.parentId].childIds.filter((x) => x !== id) };
      // attach
      if (newParentId == null) {
        let idx = atIndex == null ? rootIds.length : atIndex;
        rootIds.splice(idx, 0, id);
      } else {
        const pc = [...(nodes[newParentId].childIds)];
        let idx = atIndex == null ? pc.length : atIndex;
        pc.splice(idx, 0, id);
        nodes[newParentId] = { ...nodes[newParentId], childIds: pc, expanded: true };
      }
      nodes[id] = { ...nodes[id], parentId: newParentId };
      return { ...s, nodes, rootIds };
    });
  },

  takeSnapshot(id, title) {
    store.set((s) => {
      const body = s.docs[id];
      if (!body) return s;
      const snap = { id: uid('snap'), title: title || '', takenAt: new Date().toISOString(), content: body.content, words: wordCount(body.content) };
      return { ...s, docs: { ...s.docs, [id]: { ...body, snapshots: [snap, ...(body.snapshots || [])] } } };
    });
  },
  restoreSnapshot(id, snapId) {
    store.set((s) => {
      const body = s.docs[id];
      const snap = (body.snapshots || []).find((x) => x.id === snapId);
      if (!snap) return s;
      // auto-snapshot current before restoring (non-destructive seam)
      const preserve = { id: uid('snap'), title: 'before restore', takenAt: new Date().toISOString(), content: body.content, words: wordCount(body.content) };
      return { ...s, docs: { ...s.docs, [id]: { ...body, content: snap.content, snapshots: [preserve, ...body.snapshots] } } };
    });
  },
  deleteSnapshot(id, snapId) {
    store.set((s) => {
      const body = s.docs[id];
      return { ...s, docs: { ...s.docs, [id]: { ...body, snapshots: body.snapshots.filter((x) => x.id !== snapId) } } };
    });
  },

  setProjectTitle(title) { store.set((s) => ({ ...s, title })); },

  // ── lifecycle: load / create projects (per-project persistence) ──────────
  loadProject(project) {
    // current project is already persisted on every set(); just swap in the new one
    store.set(() => project);
  },
  openById(id) {
    if (store.get().id === id) return true;
    const p = loadProjectById(id);
    if (p) { store.set(() => p); return true; }
    return false;
  },

  resetProject() {
    localStorage.removeItem(LS_KEY);
    store.set(() => buildSampleProject());
  },
};

Object.assign(window, {
  store, useStore, actions,
  STATUS, STATUS_ORDER, LABELS, LABEL_ORDER,
  wordCount, charCount, uid,
  childIdsOf, descendantIds, flattenVisible, subtreeWordCount,
  SCHEMA_VERSION, loadProjectById,
});
