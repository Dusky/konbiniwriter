# Konbini — Architecture & Build Plan

> **Status:** Phase 1 vertical slice (writing studio, zero AI) — webapp running, bundle format
> established, IPC seam in place via `window.api` abstraction.

---

## What's been decided (don't re-litigate)

| Decision | Rationale |
|---|---|
| React + Zustand + CodeMirror 6 | Standard, well-understood, CM6 is the only serious option for live-preview MD |
| Webapp-first, Electron-later | Dev velocity; File System Access API gives real disk access in Chrome today; `window.api` abstraction makes migration a one-file swap |
| Bundle format: `.konbini/` folder | Plain Markdown files + `project.json` manifest; Dropbox/iCloud safe; human-readable; no proprietary DB |
| AI is opt-in, off by default | With AI off the app is byte-for-byte Phase 1. The toggle gate is architectural, not a CSS flag |
| All AI output lands in changeset review before any `.md` is touched | Enforced by routing every AI write through `updateContent()` |
| Every prompt/agent is in an editable registry | Hardcoded prompts anywhere are a bug |

---

## Current file layout

```
konbiniwrite/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── PLAN.md                    ← this file
└── src/
    ├── main.tsx               # mounts React; imports browserApi first
    ├── App.tsx                # screen router + keyboard shortcuts
    ├── env.d.ts               # window.api type declaration
    │
    ├── shared/                # imported by BOTH lib/ and components/
    │   ├── types.ts           # ALL canonical types (Project, Node, Proposal, PromptTemplate…)
    │   ├── utils.ts           # uid, wordCount, fmtKey, STATUS_META, LABEL_META
    │   └── templates.ts      # buildProjectFromTemplate (blank/novel/screenplay/nonfiction)
    │                          # novel template seeds the full "Midnight Aisle" demo project
    │
    ├── lib/                   # data layer — swapped for Electron preload on migration
    │   ├── browserApi.ts      # implements KonbiniAPI using BrowserProjectService;
    │   │                      # assigned to window.api at startup
    │   ├── BrowserProjectService.ts  # File System Access API; read/write .konbini bundles
    │   └── RecentsService.ts  # localStorage-backed recents registry
    │
    ├── store/
    │   ├── projectStore.ts    # Zustand: Project state + tree helpers + updateContent seam
    │   └── shellStore.ts      # Zustand: screen, theme, layout, modal, recents
    │
    ├── components/
    │   ├── Studio.tsx         # 3-pane shell (binder | editor | inspector)
    │   ├── shell/
    │   │   ├── Titlebar.tsx
    │   │   ├── Toolbar.tsx    # view seg, toggles, snapshot/compile buttons, AI spark (disabled)
    │   │   └── StatusBar.tsx
    │   ├── binder/
    │   │   ├── Binder.tsx     # tree, drag-drop (HTML5 DnD), footer add buttons
    │   │   ├── TreeRow.tsx    # (inline in Binder.tsx for now)
    │   │   └── ContextMenu.tsx
    │   ├── editor/
    │   │   ├── EditorPane.tsx # routes to Editor / Corkboard / Outliner
    │   │   ├── Editor.tsx     # CodeMirror 6 mount; syncs focusMode state field
    │   │   ├── extensions.ts  # CM6 extensions: markdown, live-style HL, wikilinks, focus mode
    │   │   └── CompositionMode.tsx
    │   ├── inspector/
    │   │   └── Inspector.tsx  # status, label, synopsis, word-count target, include-in-compile
    │   ├── views/
    │   │   ├── Corkboard.tsx  # editable synopsis cards
    │   │   └── Outliner.tsx   # read-only table
    │   ├── modals/
    │   │   ├── NewProjectModal.tsx
    │   │   ├── SnapshotModal.tsx   # take/list/restore + line-diff preview
    │   │   ├── CompileModal.tsx    # subtree picker + markdown/docx export
    │   │   ├── ShortcutsModal.tsx
    │   │   └── AboutModal.tsx
    │   └── launch/
    │       └── Launch.tsx     # brand panel + new/open + recents list
    │
    ├── hooks/
    │   └── useAutosave.ts     # debounced 700ms → window.api.doc.write
    │
    └── styles/
        ├── theme.css          # OKLCH design tokens, dark/light, density, CM6 resets
        ├── ai.css             # AI layer tokens (loaded now, gated in DOM by aiStore.enabled)
        └── lifecycle.css      # launch screen, chrome variants, menus
```

---

## The `window.api` contract (migration seam)

```typescript
interface KonbiniAPI {
  project: { create, open, recents, close, removeRecent, showOpenDialog, showSaveDialog }
  doc:     { read, write }          // write = the updateContent seam
  node:    { mutate }               // all structural ops go through here
  snapshot:{ take, restore, list, delete }
  compile: { run }
  shell:   { platform, minimize, maximize, close, isMaximized }
}
```

**Browser:** `src/lib/browserApi.ts` assigns `window.api` using `BrowserProjectService`
(File System Access API).

**Electron (future):** `src/preload/index.ts` assigns `window.api` via `contextBridge` + IPC.
No component changes required.

---

## Bundle format (on disk)

```
My Novel.konbini/
  project.json          # manifest: nodes, meta, ordering, settings
                        # docs[].content = "" (content lives in .md files)
                        # docs[].snapshots[] = metadata only (content in snapshot files)
  docs/
    <nodeId>.md         # one per document/scene; human-readable
  snapshots/
    <nodeId>/
      <snapshotId>.md
```

`project.json` schema: `schemaVersion: 1`. Bump on breaking shape changes.
`ProjectService` reads `schemaVersion` on open and runs migration functions before returning.

---

## The single document-mutation seam

```
User types in CM6
  → EditorView.updateListener fires
  → projectStore.updateContent(docId, content)    ← sets saveStatus: 'saving'
  → useAutosave debounces 700ms
  → window.api.doc.write(projectId, docId, content)
  → BrowserProjectService.writeDoc() → FileSystemWritableFileStream

AI proposal accepted (Phase 2)
  → applySegments(buildSegments(original, proposed), acceptedHunks)
  → window.api.doc.write(...)                     ← same path
```

Nothing else may write `.md` content. This is what makes "AI never silently overwrites" a
structural guarantee rather than a convention.

---

## Known gaps — prioritized

### Tier 1: Block Phase 2 if not designed first

**1. Reference / dependency index (`MentionIndex`)**

Every headline Phase 2+ feature silently assumes the app knows which documents reference which
entities. Codex backlinks, propagation-debt inbox ("3 scenes reference stale canon"), and
AI context selection all depend on this. Without it those features are lies.

Design: an inverted map `entityAlias → Set<docId>` maintained in the store. Rebuilt by a
debounced worker on `updateContent`. Used by:
- Codex backlink panel
- Debt inbox ("which docs reference this changed fact?")
- AI `ContextBuilder` ("which codex cards are relevant to this scene?")

Build this as its own layer at the start of Phase 2, before Codex or debt.

**2. Context / token budgeting (`ContextBuilder`)**

Injecting codex + outline + canon + surrounding scenes into a generator will blow past context
windows for any real novel. This needs a strategy before generators are written, because it
changes the shape of every generator and every pipeline step.

Design: tiered assembly with a token budget.
```
ContextBuilder.for(docId, feature) → ContextPacket
  full scene content        (always)
  chapter synopsis          (always)
  parent/sibling synopses   (if budget allows)
  codex cards               (entities mentioned in scene, via MentionIndex)
  outline excerpt           (N levels, truncated)
  voice fingerprint         (foundation output, if available)
  canon snapshot            (foundation output, if available)
```
Each tier knows its token cost. The builder fills budget top-down and truncates at the margin.
The `MentionIndex` is what makes "entities mentioned in scene" retrievable without scanning.

Both `MentionIndex` and `ContextBuilder` belong in Phase 2, in the same sprint as the
proposal spine and `PromptRegistry`.

**3. Atomic writes + pre-AI snapshot guarantee**

Current `writeText()` in `BrowserProjectService` uses `createWritable()` → `write()` → `close()`,
which the browser implements as a temp-file swap (atomic at the FS level). This is correct.

Gaps to close before Phase 2 ships:
- `applySegments` in the proposal layer MUST call `snapshot.take()` before calling
  `doc.write()`. This is noted in the architecture but not yet enforced as a hard invariant.
  Make it impossible to skip: `ProposalService.apply()` always snapshots first.
- External-change detection (user edits a `.md` in another editor, or Dropbox syncs
  underneath): track `project.json` mtime; warn if it changed since we opened. Out of scope
  for Phase 1, but the hook is the `schemaVersion` / `modified` field.

**4. Unified undo + provenance**

CM6 has its own undo stack. An accepted changeset currently dispatches a CM6 transaction
(content sync), which lands in CM6 history correctly. But:
- Structural mutations (rename, move, create) are NOT in the CM6 history.
- We need a single `Cmd-Z` history that covers both.

Design: structural mutations go through a lightweight `CommandHistory` (Zustand slice) that
records inverse ops. CM6 covers text. The editor's undo shortcut first tries CM6; if at the
bottom of its stack it pops from `CommandHistory`.

Provenance: `Proposal` already has `promptId` and `agentId`. Add `model`, `temperature`,
`contextFingerprint` (hash of the context packet used) in Phase 2. Cheap to carry forward
from day one; miserable to reconstruct later.

### Tier 2: Plan now, build when the feature is built

**5. Project-wide search + in-document find**

Table stakes for a writing studio; embarrassing to ship without. In-document find is a single
CM6 extension (`@codemirror/search`, one line). Project-wide search scans `docs[*].content`
in the store — simple for Phase 1 scale, index-backed later.

Add in-document find to Phase 1c. Add project-wide search to Phase 2 alongside the `MentionIndex`
(they share the same inverted-index infrastructure).

**6. Autopilot long-run mechanics**

Streaming output into the proposal UI, real cancellation (the STOP button must cancel the
in-flight fetch, not just stop rendering), a job queue, resumability if the app closes mid-run.
Long pipelines cannot be fire-and-pray. Design the `AutopilotRunner` as a stateful class with
explicit phase transitions before building Phase 4.

**7. BYOK first-run onboarding**

A new user has no API key. The entire AI layer is dead until they paste one. The onboarding
flow must: show a welcome state when AI is first enabled, walk through key entry, and
*validate* the key with a cheap test call before accepting it. Also: the Linux keychain
(libsecret/gnome-keyring) is notoriously flaky — design a fallback to an encrypted local
store so keys don't silently fail to persist on Linux.

**8. Scale: lazy loading + virtualization**

A novel is hundreds of documents. Current approach loads all `.md` content eagerly on open.
This must change before the store grows past ~50 documents:
- Lazy-load doc bodies: only fetch `.md` content when a document is selected
- Virtualize binder/outliner (only render visible rows)
- Build search against an index rather than scanning in-memory content

Design the lazy-load seam now (the `window.api.doc.read` call already exists; just don't call
it eagerly). Virtualization can wait until the binder has real performance pain.

**9. The default prompt library is content, not code**

"Ships well-tuned defaults" hides a real authoring deliverable: someone has to write and tune
dozens of prompts, the four reader persona definitions, the judge rubric, the slop lexicon
thresholds, and the anti-slop drafting instructions. This is what determines whether the app
feels good on first launch. Budget it as a distinct work item in Phase 3/4.

### Tier 3: Consciously deferred

- Code signing / notarization / auto-update (required to distribute; not required to build)
- Testing strategy for `BrowserProjectService` (it's the one module where a bug eats a novel;
  needs integration tests with a mock FileSystem, not unit tests)
- Unicode/CJK word counting (space-splitting is wrong for Japanese; relevant given the name)
- License audit if any pipeline logic is ported from existing autonovel-style projects
- epub/PDF export (out of scope per spec; leave pluggable seam in `CompileService`)

---

## Phase build order

### Phase 1 — The Writing Studio (zero AI; must stand alone) ✅ COMPLETE

**1a — Vertical slice** ✅
- Create project → binder → click doc → write → debounced autosave to `.md` → close/reopen
  with work intact → toggle composition mode.

**1b — Full studio surfaces** ✅
- Corkboard (editable synopses) ✅
- Outliner (read-only) ✅
- Inspector (label, status, synopsis, target, compile flag) ✅
- Snapshots (take/list/restore + line-diff preview) ✅
- Compile/export: subtree → markdown → `.docx` ✅
- In-document find (`@codemirror/search`, `Mod-F` in editor) ✅
- Project-wide search (in-memory scan, `Mod+Shift+F`) ✅

**1c — Project lifecycle + chrome** ✅
- New Project modal (templates) ✅
- Open / recents on launch screen ✅
- Preferences modal (theme, font, size, density, accent) ✅ (`Mod+,`)
- Full keyboard map wired ✅ (Mod+O, Mod+W, Mod+Shift+D/N, Mod+Alt+N, Mod+,)

### Phase 2 — Proposal Spine + Prompt/Agent Registry + Co-write 🔲 STARTED

*Build these in order — each unblocks the next.*

1. **`MentionIndex`** — inverted entity→docs map, rebuilt on `updateContent`, exposed in store ✅
2. **`ContextBuilder`** — tiered context assembly with token budget; uses `MentionIndex` ✅
3. **Changeset review surface** — proposal data model, diff engine, accept/reject per hunk,
   apply seam → `updateContent`, group-level accept/reject, "Apply to binder" ✅
4. **`PromptRegistry` + `AgentRegistry`** — JSON-backed, override stack ✅
   (app defaults → user global → per-project), management UI (browse/edit/duplicate/
   reset/export/import), variable documentation
5. **Codex** — character/location/lore entities, AI summary, editable facts, backlinks via
   `MentionIndex`, continuity flags, propagation-debt seeds from fact edits
6. **AI settings** — BYOK key entry + validation, per-feature model routing, global toggle,
   Ollama local option
7. **Co-write mode** — selection toolbar (Rewrite/Expand/Tighten/Describe/Brainstorm),
   single-element inline generation, each → proposal → changeset review

### Phase 3 — Assisted Mode 🔲

- Batch generators (whole cast, full beat sheet, all locations, draft-this-chapter) — each
  returns a reviewable set via changeset review; each pulls prompt from registry
- On-demand evaluation: slop scorer (flagged spans inline + counts), LLM-judge rubric,
  reader panel (4 personas), adversarial cuts
- Rubric, banned-word lists, persona definitions, score thresholds: all registry-editable
- Every generator offers "just this one" vs "the whole set"; every element drivable three
  ways (by hand / AI-from-prompt / AI-from-context)
- Project-wide search (index-backed, shares MentionIndex infrastructure)

### Phase 4 — Autopilot 🔲

- `AutopilotRunner`: stateful, phase-transition model, real cancellation, resumable
- Run launcher: scope, per-run checkpoint ("pause between phases" vs "run to review"),
  spend cap, cost estimate before, live tally + STOP during
- Pipeline phases (all prompts/thresholds from registry):
  - **Foundation**: seed → world bible → character registry → outline + foreshadowing ledger
    → canon database → voice fingerprint → quality-score gate (loops to threshold)
  - **Drafting**: per-chapter anti-slop drafting, batch sequential, keep-or-retry queue
    with status/score/retry-count visible
  - **Evaluation**: slop scorer → LLM judge → adversarial editor → Elo ranking →
    reader panel → critic+professor loop with visible stop condition
  - **Revision**: auto revision briefs → rewrite-from-brief → batch cut applicator
- **Propagation-debt inbox**: five co-evolving layers (voice/world/characters/outline/prose)
  + canon; a change in one creates downstream debt surfaced for review/resolve; applies to
  author edits AND AI changes; resolves into changeset review
- Export extras (cover studio, audiobook studio, typeset PDF): build last and lightly

### Electron packaging (any phase, when needed) 🔲

1. Add `src/preload/index.ts` — same `KonbiniAPI` interface, `contextBridge` + IPC
2. Add `src/main/` — `ProjectService` using `fs/promises` (same interface as `BrowserProjectService`)
3. Update `vite.config.ts` → `electron.vite.config.ts` (rename only; rename config filename)
4. Add `electron-builder.yml`
5. No component changes required

---

## Design tokens (quick reference)

All in `src/styles/theme.css`. Colors are OKLCH throughout.

| Token | Value |
|---|---|
| `--accent` (default) | `oklch(0.64 0.11 300)` — violet |
| `--bg` (dark) | `oklch(0.168 0.006 285)` |
| `--text` (dark) | `oklch(0.918 0.006 285)` |
| Editor font | IBM Plex Mono (default) / Spectral / IBM Plex Sans |
| Editor size | 17px default, 14–22px range |
| Density rows | compact 22px / balanced 27px / roomy 33px |

Accent hue alts (same L/C): blue 250 · green 150 · amber 75 · red 20.

---

## Non-negotiable invariants (repeat here so they don't drift)

1. **AI off = zero AI in DOM.** With `aiStore.enabled = false`, no AI component renders.
2. **No AI write reaches `.md` directly.** Every AI output → proposal → changeset review →
   `updateContent` only.
3. **Every prompt/agent is registry-editable.** Hardcoded prompt strings are bugs.
4. **`updateContent()` is the only doc mutation seam.** Nothing else writes `.md` content.
5. **Pre-AI snapshot is mandatory.** `ProposalService.apply()` always snapshots before writing.
6. **Stable IDs forever.** Node IDs are never reused; codex and AI references rely on them.
