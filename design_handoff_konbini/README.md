# Handoff: Konbini — Cross-Platform Writing Studio (Phase 1 + opt-in AI layer)

## Overview
Konbini is a local-first, offline desktop writing app (Scrivener-class) for long-form
fiction. The author owns their work as a portable **bundle** of Markdown files on disk.
This handoff covers the full prototype: the writing studio (Phase 1) **and** an opt-in AI
layer (Phase 2) that never edits without review.

Target stack (decided): **Electron + TypeScript + React + Zustand.** Editor: **CodeMirror 6**
(markdown, live-styled). Project format: a folder bundle of `.md` files + a `project.json`
manifest. macOS / Windows / Linux.

---

## About the design files
The files in this bundle are **design references created in HTML/React-via-Babel** — a
working prototype that shows intended look, layout, data model, and behavior. **They are not
production code to ship.** The task is to **recreate these designs in a real Electron + TS +
React + Zustand app**, using CodeMirror 6 for the editor and real filesystem access behind a
typed IPC layer.

The prototype simulates the on-disk bundle with `localStorage` (one slot per project). In the
real app, that persistence layer is replaced by the **project service in the main process**;
the renderer keeps view state only. Everything else — component structure, state shape,
interaction model, visual design — should be reproduced faithfully.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interactions are final. Recreate the UI
pixel-faithfully with the codebase's component patterns. Design tokens are listed at the end;
they live in `app/theme.css`, `app/ai.css`, `app/lifecycle.css` as CSS custom properties.

---

## Architecture (map the prototype to the real app)

```
┌─ MAIN PROCESS ─────────────────────────────┐     ┌─ RENDERER ───────────────────┐
│ ProjectService                             │     │ React + Zustand              │
│   • open/create/close bundle               │ IPC │   • view state only          │
│   • read/write project.json manifest       │◄───►│   • CodeMirror 6 editor      │
│   • read/write per-document .md files       │     │   • all surfaces (binder…)   │
│   • snapshots, compile, recent list        │     │   • AI layer (separate store)│
│   • ALL fs access lives here                │     │   • NO direct fs use         │
└────────────────────────────────────────────┘     └──────────────────────────────┘
```

Prototype → real mapping:
| Prototype file | Real-app equivalent |
|---|---|
| `app/store.jsx` (`store`, `actions`, `persist`) | Zustand store (renderer) + ProjectService (main). `persist()`/`loadProjectById()` → IPC calls. |
| `app/shell.jsx` (`shellStore`) | App-shell Zustand store: screen, platform, recents, layout, menus. |
| `app/ai-engine.jsx` (`aiStore`) | Separate AI store. Reads project store read-only; mutates docs **only** via `actions.updateContent`. |
| `localStorage` slots | Bundle folders on disk + a recents registry (e.g. app-data JSON). |

**The single document-mutation seam:** the editor and the AI layer both write document text
**only** through `actions.updateContent(docId, content)` (see `app/store.jsx`). Keep this in the
real app — it's the wrap point for autosave debouncing, snapshots-before-AI-edit, and the
future diff/proposal system. Nothing else may mutate `.md` content.

---

## Data model / `project.json` schema (the core contract)

`project.json` is the versioned serialization of these types. Treat `schemaVersion` as the
migration anchor. Document **content** lives in sibling `.md` files, **not** in the manifest.

```ts
type ID = string; // stable, unique, never reused (codex/AI references rely on this)

interface Project {
  schemaVersion: number;          // currently 1 — bump on shape change
  id: ID;
  title: string;
  created: string;                // ISO 8601
  modified: string;               // ISO 8601
  rootIds: ID[];                  // top-level binder nodes, ordered
  trashId: ID | null;             // the Trash folder node
  nodes: Record<ID, Node>;        // normalized binder tree (the manifest)
  docs:  Record<ID, DocBody>;     // per-document body + snapshots (content → .md on disk)
  settings: {
    location?: string;            // bundle path on disk
    template?: TemplateId;
    [k: string]: unknown;         // extensible
  };
  // ui is renderer view-state in the prototype; in the real app keep this OUT of
  // project.json (store last-open selection/view separately or in app data).
  ui?: UiState;
}

type NodeType = 'folder' | 'document' | 'scene';

interface Node {
  id: ID;
  type: NodeType;                 // folder = no body; document/scene = has a .md
  title: string;
  parentId: ID | null;
  childIds: ID[];                 // ordered children (drag-reorder writes this)
  expanded: boolean;              // binder disclosure state
  meta: DocMeta;
  ext: Record<string, unknown>;   // EXTENSIBILITY BAG — future codex refs, AI flags.
                                  // Adding fields here must never break older readers.
}

interface DocMeta {
  label: LabelId;                 // 'none'|'scene'|'chapter'|'note'|'character'|'idea'
  status: StatusId;               // 'idea'|'todo'|'inprogress'|'draft'|'revised'|'final'
  synopsis: string;               // index-card / corkboard text
  target: number;                 // word-count target (0 = none)
  includeInCompile: boolean;
}

interface DocBody {
  content: string;                // the Markdown — serialized to <nodeId>.md on disk
  snapshots: Snapshot[];          // stored inside the bundle
}

interface Snapshot {
  id: ID;
  title: string;                  // optional label, e.g. "before AI edit"
  takenAt: string;                // ISO
  content: string;
  words: number;
}
```

### Bundle on disk (proposed layout)
```
My Novel.konbini/
  project.json            # the manifest above (nodes, meta, ordering, settings)
  docs/
    <nodeId>.md           # one file per document/scene — human-readable, portable
    …
  snapshots/
    <nodeId>/<snapshotId>.md
```
Human-readable, portable, safe in Dropbox/iCloud. No proprietary DB for content.

### Enumerations (exact values + display)
- **Status:** `idea`→"Idea", `todo`→"To Do", `inprogress`→"In Progress", `draft`→"First Draft", `revised`→"Revised", `final`→"Final". Each has a dot color (see tokens `--st-*`).
- **Label:** `none`, `scene`, `chapter`, `note`, `character`, `idea` (colors in `app/store.jsx` `LABELS`).
- **Templates** (New Project): `blank`, `novel`, `screenplay`, `nonfiction` — each seeds a starting binder (`buildProjectFromTemplate` in `app/data.jsx`).

---

## Screens / Views

All studio surfaces share a 3-pane shell: **Binder** (left) · **Main** (center) · **Inspector**
or **Assistant** (right). Above: window chrome + toolbar (+ AI bar when AI is on). Below: status bar.

1. **Launch screen** (`app/Launch.jsx`) — the app entry point; no project is loaded until the
   user picks one. Brand panel + New Project / Open Project + Recent Projects (colored spine,
   path, word count, relative time). New Project modal = name + 4 template cards + bundle
   location. Open Project = mock file browser scoped to `.konbini`.
2. **Binder** (`app/Binder.jsx`) — nested tree (folders/documents/scenes), drag to
   reorder/reparent (drop *between* siblings or *into* folders; no cycles), inline rename,
   right-click context menu (new/rename/duplicate/snapshot/move-to-trash), live subtree word
   counts, status dots.
3. **Editor** (`app/Editor.jsx`) — CodeMirror 6 in the real app. Live-styled markdown
   (syntax decorated/dimmed, not raw), `[[wikilinks]]` styled, debounced autosave, Focus mode
   (dims inactive lines), Composition mode (full-screen centered column; paper/dark/sepia bg).
4. **Corkboard** (`app/Views.jsx`) — synopsis index cards for a folder's children; **synopsis is
   editable inline** (priority). Label color = pin color, status dot.
5. **Outliner** (`app/Views.jsx`) — table of documents with metadata columns (read-only start,
   per the brief; status editing currently lives in the Inspector).
6. **Inspector** (`app/Inspector.jsx`) — label, status, synopsis, word target + progress,
   live word/char counts, type, includeInCompile, the node's stable ID.
7. **Snapshots** (`app/Modals.jsx`) — take/list/restore; restore auto-snapshots current first
   (non-destructive). Shows a real line-diff vs current.
8. **Compile** (`app/Modals.jsx`) — pick a subtree, choose docs, concatenate in binder order,
   preview, export. **Pipeline is format-pluggable** (`COMPILE_FORMATS`): Markdown + Word now;
   epub/PDF slot in later without touching the gather stage.

### AI layer (opt-in; off = byte-for-byte Phase 1)
9. **AI bar / mode spine** (`app/App.jsx` `AIBar`) — Co-write / Assisted / Autopilot, surface
   tabs (Manuscript/Codex/Changes/Autopilot/Debt), running **BYOK cost tally**, gear→Settings.
10. **Changeset review** (`app/Changeset.jsx`) — **the keystone.** Every AI output collects
    here grouped by source; redline diff; **accept/reject per hunk and per group**; "Apply to
    binder" routes through `updateContent` (after a safety snapshot).
11. **Assistant panel** (`app/Assistant.jsx`) — context-scoped chat (doc/manuscript/project),
    co-write quick actions, selection toolbar (Rewrite/Expand/Describe/Tighten/Brainstorm).
12. **Codex** (`app/Codex.jsx`) — auto-detected entities (character/location/lore), AI summary,
    editable facts (editing raises propagation debt), continuity flags, live manuscript backlinks.
13. **Propagation-debt inbox** (`app/AISurfaces.jsx`) — downstream effects of a change across
    layers; each affected doc gets Open / Draft fix / Mark OK.
14. **Autopilot** (`app/AISurfaces.jsx`) — run launcher (scope, per-run checkpoint, spend cap),
    phase monitor, foundation quality gate, drafting queue (keep/retry), evaluation report
    (slop score, LLM-judge rubric, reader panel, adversarial cuts).
15. **AI Settings** (`app/AISurfaces.jsx`) — per-feature model routing, API keys, local Ollama,
    global on/off.
16. **Preferences** (`app/Menus.jsx` `PrefsModal`) — theme/font/size/density (minimal; a real
    native Preferences window is a known gap).

---

## Interactions & behavior
- **Autosave:** debounced ~700ms after last keystroke; status pill shows Saving…→Saved.
- **Drag & drop (binder):** top third of a folder = drop before, bottom third = after, middle =
  drop *into*; documents only before/after. Reject moves that would create a cycle.
- **Composition mode:** Esc exits; chrome reveals on hover; live word/target/char footer.
- **Changeset hunks:** default all-accepted; toggling re-renders the redline; rejected hunks
  show the original line, accepted show the new line.
- **AI off:** the entire AI layer (bar, panel, tabs, selection toolbar) is removed from the DOM;
  only a single "✦ AI" opt-in button remains in the toolbar.
- **Project switch:** AI proposals/debt/run reset so they never leak across manuscripts
  (`aiActions.resetForProject`).

## State management
- **Project store** (Zustand in real app): `Project` shape above + selection/view UI. Mutations
  via `actions.*`; document text via `updateContent` only.
- **Shell store:** `{ screen:'launch'|'studio', platform:'mac'|'windows'|'linux', recents[],
  layout:{binder,insp}, activeMenu, modal }`.
- **AI store (separate):** `{ enabled, mode, surface, scope, proposals[], reviewingId, chat[],
  debt[], run, draftQueue[], cost, routes, keys, features }`. Reads project read-only.
- **Per-project persistence:** each project saved to its own slot keyed by `id`; a pointer
  records last-opened; recents registry holds metadata. Real app: ProjectService + app-data.

---

## Lifecycle + suggested IPC surface
```ts
// main ↔ renderer, all fs behind this
project.create(opts: {title; template; location}): Project
project.open(path): Project
project.recents(): RecentEntry[]
project.close(id): void
doc.read(projectId, nodeId): string                 // .md content
doc.write(projectId, nodeId, content): void          // ← the updateContent seam lands here
node.mutate(projectId, op): void                     // create/rename/move/duplicate/trash → project.json
snapshot.take(projectId, nodeId, title?): Snapshot
snapshot.restore(projectId, nodeId, snapshotId): void
compile.run(projectId, rootId, includedIds, format): {blob; filename}
```

## Keyboard map (also the menu spec)
Rendered per-platform (`fmtKey` in `app/shell.jsx`); mac uses ⌘⇧⌥⌃ glyphs, Windows/Linux use
Ctrl/Shift/Alt words. All chords avoid ⌃⌘ so nothing collapses to "Ctrl+Ctrl" on Windows.

| Action | mac | Win/Linux |
|---|---|---|
| New Project | ⌘N | Ctrl+N |
| Open Project | ⌘O | Ctrl+O |
| New Folder | ⌘⌥N | Ctrl+Alt+N |
| New Document | ⌘⇧D | Ctrl+Shift+D |
| New Scene | ⌘⇧N | Ctrl+Shift+N |
| Take Snapshot | ⌘⇧S | Ctrl+Shift+S |
| Compile | ⌘⇧E | Ctrl+Shift+E |
| Close Project | ⌘W | Ctrl+W |
| Duplicate | ⌘D | Ctrl+D |
| Editor / Corkboard / Outliner | ⌘1 / ⌘2 / ⌘3 | Ctrl+1/2/3 |
| Toggle Binder / Inspector | ⌘⌥B / ⌘⌥I | Ctrl+Alt+B / Ctrl+Alt+I |
| Composition / Focus | ⌘⌥C / ⌘⌥O | Ctrl+Alt+C / Ctrl+Alt+O |
| Toggle Light/Dark | ⌘⌥T | Ctrl+Alt+T |
| AI Assistant | ⌘⇧A | Ctrl+Shift+A |
| Changeset Review | ⌘⇧R | Ctrl+Shift+R |
| Codex | ⌘⇧K | Ctrl+Shift+K |
| Slop Proof | ⌘⇧P | Ctrl+Shift+P |
| Keyboard Shortcuts | ⌘/ | Ctrl+/ |

Cross-platform chrome: **macOS** = global desktop menu bar above the window + traffic lights.
**Windows/Linux** = in-window menu bar + min/max/close buttons (red close on Win; round on Linux).

---

## Design tokens (from `app/theme.css`, dark default; light variant under `[data-theme=light]`)
Colors are OKLCH. Key tokens:
- **Backgrounds:** `--bg` oklch(.168 .006 285), `--bg-2` .198, `--bg-3` .232, `--sidebar` .150, `--editor-bg` .172, `--titlebar` .132.
- **Text:** `--text` oklch(.918 .006 285), `--text-2` .660, `--text-3` .470.
- **Borders:** `--border` oklch(.270 .006 285), `--border-2` .330.
- **Accent (default):** `--accent` oklch(0.64 0.11 300) (violet). Curated alts: 250 (blue), 150 (green), 75 (amber), 20 (red) — all same L/C, hue-varied. Drives selection/focus/AI spark.
- **Status dots `--st-*`:** idea oklch(.66 .12 20), todo .58/.008/285, inprogress .70 .12 75, draft .66 .10 250, revised .66 .10 300, final .68 .11 150.
- **Type:** UI = system sans (`--ui-font`); editor switchable mono **IBM Plex Mono** / serif **Spectral** / sans **IBM Plex Sans**; mono accents IBM Plex Mono. Editor size 14–22px (default 17).
- **Density** (`[data-density]`): row height 22 / 27 / 33px (compact/balanced/roomy).
- **Radii:** window 12, cards 4–14, controls 6–9, pills 999. **Shadows:** see `--shadow`.

## What's stubbed / NOT built (leave seams, don't ship as-is)
- **AI responses are simulated** (deterministic, no network): replace `chatReply`,
  `transformSelection`, `lineEditProposal`, the scorer/judge in `app/ai-data.jsx` with real
  Claude calls. No streaming/error/rate-limit/no-key states yet — design those.
- **`.docx` export** is Word-flavored HTML; swap in a real docx writer. No epub/PDF yet.
- **Codex entities** are hardcoded demo data — promote `Entity` + propagation-debt records into
  `project.json`'s schema (use the `ext` bag / a new top-level map) before building for real.
- **Preferences** window is minimal (shared with Tweaks); build a native one.
- **Outliner** is read-only by design (Phase 1).
- No accounts/cloud/telemetry — local-first only.

## Files (design reference — in this bundle under `app/`)
- `Konbini Write.html` — entry; loads everything in dependency order.
- `app/store.jsx` — project store, schema, actions, the `updateContent` seam.
- `app/data.jsx` — sample novel + template/stub builders.
- `app/shell.jsx` — app-shell store, menu defs, shortcut formatting, lifecycle.
- `app/Editor.jsx` · `Binder.jsx` · `Inspector.jsx` · `Views.jsx` · `Modals.jsx` — studio surfaces.
- `app/ai-data.jsx` · `ai-engine.jsx` — AI content + opt-in AI store, proposal/hunk engine, cost model.
- `app/Assistant.jsx` · `Changeset.jsx` · `Codex.jsx` · `AISurfaces.jsx` — AI surfaces.
- `app/Menus.jsx` · `Launch.jsx` — chrome, menus, lifecycle screens.
- `app/theme.css` · `ai.css` · `lifecycle.css` — all design tokens + styling.
