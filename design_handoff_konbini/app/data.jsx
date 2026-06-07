// ─────────────────────────────────────────────────────────────────────────────
// data.jsx — sample project ("MIDNIGHT AISLE", a J-horror novel)
// Loaded BEFORE store.jsx (store's loadInitial() calls buildSampleProject()).
// Stable string ids so the seed is deterministic.
// ─────────────────────────────────────────────────────────────────────────────

function buildSampleProject() {
  const nodes = {};
  const docs = {};

  // helper to declare a node + optional body
  const N = (id, type, title, parentId, meta, content) => {
    nodes[id] = {
      id, type, title, parentId, childIds: [],
      expanded: type === 'folder',
      meta: Object.assign({ label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: type !== 'folder' }, meta || {}),
      ext: {},
    };
    if (type !== 'folder') docs[id] = { content: content || '', snapshots: [] };
  };
  const kids = (pid, ids) => { nodes[pid].childIds = ids; };

  // ── Manuscript ──────────────────────────────────────────────────────────
  N('manuscript', 'folder', 'Manuscript', null, { label: 'none', status: 'inprogress', synopsis: 'A night-shift clerk at an all-night convenience store discovers the store keeps a customer it never rang up.' });

  N('p1', 'folder', 'Part One — Graveyard Shift', 'manuscript', { label: 'none', status: 'draft', synopsis: 'Reiko takes the 11pm–7am shift. The store is quiet. It is never quiet for long.' });
  N('c1', 'folder', 'Chapter 1 — The Bell', 'p1', { label: 'chapter', status: 'revised', synopsis: 'The door chime that rings when no one comes in.' });

  N('s1', 'scene', 'The first customer', 'c1',
    { label: 'scene', status: 'final', target: 900,
      synopsis: 'Reiko clocks in at 11pm. A salaryman buys an umbrella though the sky is clear. The door chimes after he leaves — twice.' },
`# The first customer

The fluorescent lights of the **Sunny-Mart** never fully warmed up. They flickered to life at a frequency just below comfort, a hum [[Reiko]] had stopped hearing on her third night and started hearing again on her thirtieth.

Eleven o'clock. She tied the apron, counted the till, and watched the rain that wasn't falling.

The first customer came at 11:14. A salaryman, tie loosened, eyes the colour of old tea. He set a clear vinyl umbrella on the counter and said nothing.

"It's not raining," she said.

"Not yet." He paid in coins, exact to the yen, and left without a bag.

The door chimed as it closed behind him.

Then it chimed again.

*Nobody came in.*

> Note to self — the second chime. Keep it small. Don't explain it. The reader should hear it before they understand it.

She told herself it was the wind. There was no wind. She wrote the time in the logbook the way [[The Night Manager]] had taught her, and underlined it twice without deciding why.`);

  N('s2', 'scene', 'Aisle Nine', 'c1',
    { label: 'scene', status: 'draft', target: 1100,
      synopsis: 'Restocking at 3am, Reiko finds an aisle the floor plan does not list. The bento at the back has tomorrow\'s date.' },
`# Aisle Nine

The store had eight aisles. [[Reiko]] had counted them on her first night the way you count exits.

At 3:02 she went to restock the cold case and found a ninth.

It began where the mop closet should have been, narrow and over-lit, the shelves running back further than the building could hold. Onigiri. Egg sandwiches. A single bento at the very back, wrapped, labelled in a neat hand.

The date on the label was *tomorrow*.

> She should put it back. She does not put it back. — fix this beat, too fast.

[[Aisle Nine]] was cold in the way a held breath is cold. When she stepped out, the mop closet was a mop closet again, and the floor plan taped behind the register still showed eight.`);

  kids('c1', ['s1', 's2']);

  N('c2', 'folder', 'Chapter 2 — Regulars', 'p1', { label: 'chapter', status: 'draft', synopsis: 'The customers who only come after midnight.' });
  N('s3', 'scene', 'The Woman in White', 'c2',
    { label: 'scene', status: 'inprogress', target: 1000,
      synopsis: 'Every night at 3:33 a woman in a white coat buys one bottle of milk and asks if the bathroom is occupied. It always is.' },
`# The Woman in White

She arrived at 3:33, the way she always arrived at 3:33.

[[The Woman in White]] took one bottle of milk from the case — never two — and set it on the counter without meeting [[Reiko]]'s eyes.

"Is the bathroom occupied?"

Reiko looked at the key on its wooden paddle, hanging on its hook where it always hung.

"No," she said. "It's free."

The woman smiled at something just past Reiko's shoulder. "It's occupied," she said, and left the milk, and left.`);
  N('s4', 'scene', 'Nori-san', 'c2',
    { label: 'scene', status: 'todo', target: 1200,
      synopsis: 'The old man who reads the same magazine every night and warns Reiko never to answer the back door.' });
  kids('c2', ['s3', 's4']);
  kids('p1', ['c1', 'c2']);

  N('p2', 'folder', 'Part Two — Closing Time', 'manuscript', { label: 'none', status: 'todo', synopsis: 'The store cannot close. Reiko tries anyway.' });
  N('c3', 'folder', 'Chapter 3 — Stocktake', 'p2', { label: 'chapter', status: 'idea', synopsis: 'Counting everything in the store, including the things that count back.' });
  N('s5', 'scene', 'Inventory of the missing', 'c3',
    { label: 'scene', status: 'idea', target: 1500,
      synopsis: 'Reiko reconciles the stock and finds items sold to customers who were never there — and her own name on a delivery manifest.' });
  kids('c3', ['s5']);
  kids('p2', ['c3']);
  kids('manuscript', ['p1', 'p2']);

  // ── Characters (codex seam — future entity store) ─────────────────────────
  N('characters', 'folder', 'Characters', null, { synopsis: 'Cast. (Future home of the codex.)' });
  N('ch_reiko', 'document', 'Reiko Tanaka', 'characters',
    { label: 'character', status: 'draft', synopsis: '22, art-school dropout, took the night shift to avoid sleeping. The reader\'s anchor.' },
`# Reiko Tanaka

**Age** 22 · **Role** night-shift clerk, narrator

Took the graveyard shift at the Sunny-Mart because the daylight hours had started to feel borrowed. Notices everything; trusts none of it. Keeps a logbook.

- Wants: to get through the shift.
- Needs: to stop pretending she doesn't see [[Aisle Nine]].
- Fear: the back door.`);
  N('ch_manager', 'document', 'The Night Manager', 'characters',
    { label: 'character', status: 'todo', synopsis: 'Trained Reiko in a single shift, then was never rostered again. The logbook is in his handwriting.' });
  N('ch_woman', 'document', 'The Woman in White', 'characters',
    { label: 'character', status: 'todo', synopsis: 'Arrives at 3:33. Buys milk. Asks about the bathroom. Do not follow her.' });
  kids('characters', ['ch_reiko', 'ch_manager', 'ch_woman']);

  // ── Research ──────────────────────────────────────────────────────────────
  N('research', 'folder', 'Research', null, { synopsis: 'Worldbuilding & references.' });
  N('r1', 'document', 'Konbini floor plan', 'research',
    { label: 'note', status: 'draft', synopsis: 'Eight aisles. Register at front-left. Mop closet where Aisle Nine appears. Back door (never answer it).' });
  N('r2', 'document', 'Urban legends', 'research',
    { label: 'note', status: 'draft', synopsis: 'Aka Manto (red/blue paper). Kuchisake-onna. Hanako-san. The 3:33 hour.' },
`# Urban legends — source notes

Threads to braid in, never to explain outright:

- **Aka Manto** — the voice in the stall asking *red paper or blue paper?* Either answer kills. → the bathroom beat.
- **Kuchisake-onna** — "Am I pretty?" The mask. → save for Part Two.
- **The 3:33 hour** — ushimitsu doki, the hour of the ox. → [[The Woman in White]] arrives here.`);
  kids('research', ['r1', 'r2']);

  // ── Trash ──────────────────────────────────────────────────────────────────
  N('trash', 'folder', 'Trash', null, { synopsis: 'Deleted items live here until emptied.' });

  return {
    schemaVersion: 1,
    id: 'proj-midnight-aisle',
    title: 'Midnight Aisle',
    created: new Date('2026-01-09T23:00:00').toISOString(),
    modified: new Date().toISOString(),
    rootIds: ['manuscript', 'characters', 'research', 'trash'],
    trashId: 'trash',
    nodes,
    docs,
    selectedId: 's1',
    settings: {},
    ui: { view: 'editor', composition: false, modal: null, saveStatus: 'saved', lastSaved: new Date().toISOString(), renaming: null },
  };
}

window.buildSampleProject = buildSampleProject;

// ─────────────────────────────────────────────────────────────────────────────
// Project templates (New Project flow) + stub generators (Recent projects).
// Each builds a fresh, valid Project of the same shape as the sample.
// ─────────────────────────────────────────────────────────────────────────────
function _emptyProject(id, title) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, id, title, created: now, modified: now,
    rootIds: [], trashId: null, nodes: {}, docs: {},
    selectedId: null, settings: {},
    ui: { view: 'editor', composition: false, modal: null, saveStatus: 'saved', lastSaved: now, renaming: null },
  };
}
function _mk(p, id, type, title, parentId, meta, content) {
  p.nodes[id] = {
    id, type, title, parentId, childIds: [],
    expanded: type === 'folder',
    meta: Object.assign({ label: 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: type !== 'folder' }, meta || {}),
    ext: {},
  };
  if (type !== 'folder') p.docs[id] = { content: content || '', snapshots: [] };
  return id;
}

const PROJECT_TEMPLATES = {
  blank:      { label: 'Blank',        glyph: '◷', desc: 'An empty binder. Just a manuscript folder and trash.' },
  novel:      { label: 'Novel',        glyph: '本', desc: 'Manuscript ▸ Part ▸ Chapter ▸ Scene, plus Characters & Research.' },
  screenplay: { label: 'Screenplay',   glyph: '幕', desc: 'Acts and Scenes with a Characters folder.' },
  nonfiction: { label: 'Non-fiction',  glyph: '論', desc: 'Front matter, Parts and Chapters, plus a Sources folder.' },
};

function buildProjectFromTemplate(title, template, location) {
  const id = window.uid('proj');
  const p = _emptyProject(id, title || 'Untitled');
  p.settings.location = location || '~/Documents/Konbini';
  p.settings.template = template;
  const trash = _mk(p, 'trash-' + id, 'folder', 'Trash', null, { synopsis: 'Deleted items.' });

  if (template === 'novel') {
    const ms = _mk(p, 'ms-' + id, 'folder', 'Manuscript', null, { status: 'inprogress' });
    const part = _mk(p, 'pt-' + id, 'folder', 'Part One', ms, {});
    const ch = _mk(p, 'ch-' + id, 'folder', 'Chapter 1', part, { label: 'chapter' });
    const sc = _mk(p, 'sc-' + id, 'scene', 'Opening scene', ch, { label: 'scene', target: 1000, synopsis: 'The hook.' }, '# Opening scene\n\n');
    p.nodes[ch].childIds = [sc]; p.nodes[part].childIds = [ch]; p.nodes[ms].childIds = [part];
    const chars = _mk(p, 'chars-' + id, 'folder', 'Characters', null, {});
    const prot = _mk(p, 'prot-' + id, 'document', 'Protagonist', chars, { label: 'character' }, '# Protagonist\n\n');
    p.nodes[chars].childIds = [prot];
    const res = _mk(p, 'res-' + id, 'folder', 'Research', null, {});
    p.rootIds = [ms, chars, res, trash];
    p.selectedId = sc;
  } else if (template === 'screenplay') {
    const sp = _mk(p, 'sp-' + id, 'folder', 'Screenplay', null, {});
    const a1 = _mk(p, 'a1-' + id, 'folder', 'Act I', sp, {});
    const s1 = _mk(p, 's1-' + id, 'scene', 'INT. SOMEWHERE — NIGHT', a1, { label: 'scene' }, 'INT. SOMEWHERE — NIGHT\n\n');
    p.nodes[a1].childIds = [s1]; p.nodes[sp].childIds = [a1, _mk(p, 'a2-' + id, 'folder', 'Act II', sp, {}), _mk(p, 'a3-' + id, 'folder', 'Act III', sp, {})];
    const chars = _mk(p, 'spc-' + id, 'folder', 'Characters', null, {});
    p.rootIds = [sp, chars, trash];
    p.selectedId = s1;
  } else if (template === 'nonfiction') {
    const fm = _mk(p, 'fm-' + id, 'document', 'Front matter', null, {}, '# Title\n\n');
    const body = _mk(p, 'bd-' + id, 'folder', 'Part One', null, {});
    const c1 = _mk(p, 'c1-' + id, 'document', 'Chapter 1', body, { target: 3000 }, '# Chapter 1\n\n');
    p.nodes[body].childIds = [c1];
    const src = _mk(p, 'src-' + id, 'folder', 'Sources', null, {});
    p.rootIds = [fm, body, src, trash];
    p.selectedId = c1;
  } else {
    const ms = _mk(p, 'ms-' + id, 'folder', 'Manuscript', null, {});
    const d = _mk(p, 'd1-' + id, 'document', 'Untitled', ms, {}, '');
    p.nodes[ms].childIds = [d];
    p.rootIds = [ms, trash];
    p.selectedId = d;
  }
  p.trashId = trash;
  return p;
}

// Stub projects backing the seeded "recent" entries (so opening one isn't empty).
function buildStubProject(id) {
  const STUBS = {
    'proj-hollow-house': { title: 'The Hollow House', template: 'novel',
      scene: ['The inheritance', '# The inheritance\n\nThe house came to her the way bad news comes — by certified mail, on a Tuesday. [[Margaret]] signed for it twice.\n\nThe key was warm.'] },
    'proj-last-train':   { title: 'Last Train Home', template: 'novel',
      scene: ['Platform 0', '# Platform 0\n\nThere is no Platform 0 at Shinjuku. The board said otherwise at 1:04 a.m., and [[Kenji]] was tired enough to believe it.'] },
    'proj-saltglass':    { title: 'Saltglass', template: 'screenplay',
      scene: ['INT. LIGHTHOUSE — DAWN', 'INT. LIGHTHOUSE — DAWN\n\nThe lamp is dark. It has been dark for a hundred years. It turns on anyway.'] },
  };
  const meta = STUBS[id] || { title: 'Untitled', template: 'blank', scene: null };
  const p = buildProjectFromTemplate(meta.title, meta.template, '~/Documents/Konbini');
  p.id = id; // pin the id so the recent entry matches its slot
  if (meta.scene && p.selectedId) {
    p.nodes[p.selectedId].title = meta.scene[0];
    p.docs[p.selectedId].content = meta.scene[1];
  }
  return p;
}

Object.assign(window, { PROJECT_TEMPLATES, buildProjectFromTemplate, buildStubProject });
