# Konbini — Build Plan

> **Last updated:** 2026-06-07  
> **Current phase:** 1a complete, 1b built (needs polish), 1c partial

---

## Decisions made — don't re-litigate

| Decision | Chosen | Why |
|---|---|---|
| Stack | React + Zustand + CodeMirror 6 | Proven; CM6 is the only real choice for live-preview Markdown |
| Runtime | Webapp-first (File System Access API), Electron-later | Dev velocity; `window.api` abstraction makes migration a one-file swap |
| Bundle format | `.konbini/` folder of Markdown files + `project.json` | Portable, human-readable, Dropbox/iCloud safe, no proprietary DB |
| AI gate | Opt-in, off by default | Studio is complete and fully usable with zero AI |
| AI output path | Always → proposal → changeset review → `updateContent()` | Enforced architecturally; AI never silently overwrites |
| Prompt storage | Editable registry (JSON), not hardcoded strings | Hardcoded prompts are bugs; users must be able to tune defaults |

---

## Phase status

### Phase 1a — Vertical slice ✅

- [x] Create project via File System Access API
- [x] Binder: nested tree, disclosure, selection
- [x] Click document → CM6 editor opens with content
- [x] Type → debounced autosave → `.md` file written to disk
- [x] Close and reopen: work intact (bundle on disk)
- [x] Composition mode (full-screen, Esc exits, chrome on hover)

### Phase 1b — Full studio surfaces ✅ (built, needs polish)

- [x] Corkboard — editable synopsis index cards
- [x] Outliner — read-only metadata table
- [x] Inspector — label, status, synopsis, word-count target, compile flag
- [x] Snapshots — take / list / restore + line-diff preview
- [x] Compile — subtree picker, Markdown + .docx export
- [x] In-document find — CM6 search panel (Ctrl/Cmd+F)
- [ ] Project-wide search — scan all docs by keyword (Phase 2 shares index infrastructure)
- [x] Focus mode: dims by paragraph block (contiguous non-blank lines around cursor)

### Phase 1c — Project lifecycle + chrome 🔲

- [x] Launch screen — brand panel, new/open/recents
- [x] New Project modal — 4 templates, folder picker
- [x] Open Project — FS handle picker
- [x] Recent projects reopen directly: FSA `FileSystemDirectoryHandle`s are persisted in IndexedDB (`HandleStore`) keyed by project ID and resolved via `requestPermission({ mode: 'readwrite' })` on the recent-row click; falls back to the picker if the handle is gone/denied. OPFS + Electron reopen by location.
- [ ] Preferences modal — theme, editor font (mono/serif/sans), editor size (14–22px), density (compact/balanced/roomy)
- [ ] Full keyboard map wired: ⌘⌥N (new folder), ⌘⇧D (new doc), ⌘⇧N (new scene), ⌘D (duplicate)
- [x] Right-click context menus across surfaces. `ContextMenu` lives in `components/common/`; shared `useNodeMenu` builder wired into Corkboard cards + Outliner rows (Open, New Doc/Scene, Duplicate, Snapshot, History, Trash); History + Snapshot version items get Restore/Compare/Delete menus. Editor menu wired via the single `runCowrite` seam (Cut/Copy/Paste, Select All, co-write commands when text is selected, Take Snapshot, Document History). Editor mode is `EDITOR_MENU_MODE` in `Editor.tsx` — currently `'selection'` (custom menu only with a selection, native spellcheck menu otherwise); flip to `'always'` for a custom menu on every right-click.
- [x] Binder: new-node inline rename flow — single effect seeds the title and focuses+selects the input on the next frame, fixing the post-create focus races
- [x] Status bar: show cursor position (line:col)
- [x] Word count: project total in status bar excludes Trash subtree

---

## Phase 2 — Proposal Spine + Prompt/Agent Registry + Co-write 🔲

Build in this order. Each unlocks the next.

### 2.1 MentionIndex

An inverted map from entity alias → Set\<docId\>. Rebuilt asynchronously on every `updateContent` call. Lives in the project store as a derived structure (not persisted — rebuilds on open from doc content).

```typescript
interface MentionIndex {
  // entity id → [{docId, count, positions}]
  byEntity: Map<string, Array<{ docId: string; count: number }>>
  // docId → [entity ids mentioned]
  byDoc: Map<string, string[]>
  // rebuild from all docs (called on open, debounced on updateContent)
  rebuild(docs: Record<string, DocBody>, entities: Record<string, Entity>): void
}
```

Used by: Codex backlink panel, propagation-debt inbox, `ContextBuilder`.

### 2.2 ContextBuilder

Assembles the context packet for any AI call. Token-budget aware. Uses `MentionIndex` to select relevant codex cards.

```typescript
interface ContextPacket {
  scene: string           // full doc content (always)
  chapterSynopsis: string // parent synopsis
  outlineExcerpt: string  // N levels of synopses, truncated to budget
  codexCards: Entity[]    // entities mentioned in scene (via MentionIndex)
  voiceFingerprint?: string  // from Foundation phase
  canon?: string          // from Foundation phase
  tokenCount: number
}

class ContextBuilder {
  static for(docId: string, feature: PromptFeature, budget: number): ContextPacket
}
```

### 2.3 Changeset review surface

The keystone. All AI output lands here. No AI write bypasses it.

**Data model:**

```typescript
interface Proposal {
  id: string
  docId: string
  docTitle: string
  command: ProposalCommand        // 'rewrite'|'expand'|'tighten'|'draft'|...
  label: string                   // "Rewrite selection"
  group: string                   // groups proposals: "Co-write"|"Autopilot · Revision"
  original: string                // full doc content before
  proposed: string                // full doc content after
  createdAt: string
  accepted: number[]              // hunk indices currently accepted (default = all)
  nHunks: number
  status: 'pending'|'applied'|'discarded'
  seq: number
  // provenance (from day one — cheap to carry, miserable to retrofit)
  promptId: string                // → PromptRegistry
  agentId?: string                // → AgentRegistry
  model: string
  temperature: number
  contextFingerprint: string      // hash of ContextPacket used
  costCents: number
}

// Diff segments (computed at render time, never stored)
type DiffSegment =
  | { type: 'ctx'; lines: string[] }
  | { type: 'hunk'; idx: number; del: string[]; add: string[] }
```

**Apply seam** (enforced invariant — no exceptions):
```
ProposalService.apply(proposalId)
  → snapshot.take(docId, 'before AI edit')   ← mandatory, always
  → applySegments(buildSegments(original, proposed), accepted)
  → window.api.doc.write(projectId, docId, result)
  → updateContent(docId, result)
  → maybeRaiseDebt(proposal)
```

**UI:** Two-column panel. Left rail: proposals grouped by source, each showing doc title + hunk count + accept/reject badges. Right: redline diff with per-hunk Accept/Reject toggles. Group-level "Accept All" / "Reject All". Footer: "Apply to binder" button (commits all pending-accepted through the seam).

### 2.4 PromptRegistry + AgentRegistry

Single source of truth for every AI instruction. Override stack: app defaults → user global → per-project.

```typescript
interface PromptTemplate {
  id: string              // e.g. "inline.rewrite", "eval.judge.rubric"
  name: string
  description: string
  feature: PromptFeature  // 'inline'|'chat'|'codex'|'batch'|'evaluation'|'autopilot'
  phase?: AutopilotPhase  // 'foundation'|'draft'|'eval'|'revise'
  model: string           // default model for this prompt
  temperature: number
  maxTokens?: number
  template: string        // text with {{variable}} placeholders
  variables: PromptVariable[]  // documented context vars
  isBuiltin: boolean
  parentId?: string       // if user override of a builtin
  createdAt: string
  modifiedAt: string
}

interface PromptVariable {
  name: string            // e.g. "selection", "codex.characters"
  description: string     // shown in prompt editor variable picker
  example?: string
}
```

**Context variables available to templates:**

| Variable | Provides |
|---|---|
| `{{selection}}` | Selected text in editor |
| `{{document}}` | Full current document markdown |
| `{{document.title}}` | Node title |
| `{{document.synopsis}}` | Node synopsis |
| `{{outline}}` | Recursive synopsis tree |
| `{{manuscript}}` | Concatenated compile subtree |
| `{{codex}}` | Full entity store JSON |
| `{{codex.characters}}` | Character entities only |
| `{{codex.locations}}` | Location entities only |
| `{{codex.lore}}` | Lore entities only |
| `{{voiceFingerprint}}` | Foundation output |
| `{{canon}}` | Canon database (foundation output) |
| `{{scene.synopsis}}` | Current scene synopsis |
| `{{chapter.synopsis}}` | Parent chapter synopsis |
| `{{slop.flags}}` | Scorer flag list (for revision) |

**Storage:**
- App defaults: `resources/prompts/registry.json` + `resources/prompts/agents.json` (shipped, read-only)
- User global: `userData/konbini/prompt-overrides.json`
- Per-project: `<bundle>/ai-overrides.json` (sidecar to `project.json`)

**Management UI (Prompt & Agent Library):** Browse all prompts grouped by feature. Each shows: name, description, template text, model, temperature, available variables. Actions: Edit, Duplicate, Reset to Default, Export, Import.

### 2.5 Codex

Story bible for character/location/lore entities.

```typescript
interface Entity {
  id: string
  type: 'character' | 'location' | 'lore'
  name: string
  aliases: string[]         // used by MentionIndex for scan
  summary: string           // AI-generated, editable
  facts: Record<string, string>  // structured key-value facts
  flags: ContinuityFlag[]   // AI-detected potential issues
  linkedDocId?: string      // associated binder document
}

interface ContinuityFlag {
  severity: 'warn' | 'info'
  text: string
  docId?: string
}
```

Editing an entity fact raises propagation debt (see Phase 4).

Codex entities stored in `project.json` under a top-level `codex` key (uses the `ext` bag at node level for backlinks).

### 2.6 AI Settings + BYOK

- Global AI toggle (off by default)
- Per-feature toggles (inline, chat, scorer, judge, draft, foundation)
- Per-feature model routing
- API key entry + validation (test call before accepting)
- Ollama local option
- Running cost tally (per-session)
- Linux keychain fallback: if `keytar` fails, fall back to an AES-256-GCM encrypted JSON file in `userData` with the key derived from a machine fingerprint

### 2.7 Co-write mode

**Selection toolbar** — appears on text selection:
- Rewrite, Expand, Tighten, Describe, Brainstorm
- Each calls the relevant `PromptRegistry` template with `{{selection}}` + `{{document}}` + codex context
- Each returns a proposal → changeset review

**Inline generation** — from the binder footer or context menu:
- "Draft this scene" (for empty/stub scenes)
- "Generate character note"
- Returns a proposal, not a direct write

---

## Phase 3 — Assisted Mode 🔲

### Batch generators

Each generator:
1. Pulls its prompt from `PromptRegistry`
2. Assembles context via `ContextBuilder`
3. Returns a **set of proposals** (one per document), not a direct write
4. All land in changeset review, grouped by generator name

Generators:
- **Full cast** — generate a character note for each named character detected in manuscript
- **Beat sheet** — generate scene synopses for all empty synopsis fields
- **All locations** — generate location notes for each location detected
- **Draft this chapter** — draft all empty scenes in selected chapter

Each offers "just this one" vs "the whole set" at invocation time.

### On-demand evaluation

Run against any selection or document. All thresholds and rubrics are registry-editable.

**Slop scorer** — mechanical, no LLM needed:
- Lexicon: clichés, banned filler words, filter words ("she felt", "she noticed"), telling-not-showing phrases, sentence-length uniformity
- Flags shown as inline highlights (coloured underlines by category)
- Counts per category + overall score (0–100, higher = cleaner)
- Lexicon is a `PromptTemplate` with type "evaluation.slop.lexicon" (editable list)

**LLM judge** — rubric-based scoring:
- Rubric categories: prose quality, voice adherence, character distinctiveness, beat coverage
- Each scored 1–10 with a brief note
- Full rubric is a `PromptTemplate` with type "evaluation.judge.rubric"

**Reader panel** — four persona perspectives:
- Genre Fan, Lit-Fic Reader, The Skeptic, Speed Reader
- Each is an `AgentTemplate` with a system prompt defining their reading priorities
- Each returns a one-paragraph take + verdict

**Adversarial editor** — suggests specific cuts:
- Applies filler/filter lexicon, returns ranked cut list with context
- Author approves each cut → flows into changeset review

---

## Phase 4 — Autopilot 🔲

### AutopilotRunner

A stateful class with explicit phase transitions. Not fire-and-pray.

```typescript
type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'stopped' | 'error'
type PhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface AutopilotRun {
  id: string
  scope: 'full' | 'chapter' | 'scene'
  checkpoint: 'pause'    // pause between phases for author review
            | 'straight' // run to completion, one final review
  spendCapCents: number
  startedAt: number
  status: RunStatus
  phaseIdx: number
  phases: Array<{ id: PipelinePhaseId; label: string; status: PhaseStatus; log: string[] }>
  spentCents: number
  proposals: string[]    // proposal IDs created by this run
}
```

Real cancellation: every generator call is an `AbortController`-wrapped fetch. The STOP button calls `runner.stop()` which calls `controller.abort()` on the in-flight request. The run record is preserved with status `'stopped'`; spent cost is accurate.

Resumability: if the app closes mid-run, the run record is in `aiStore` (persisted to `localStorage`). On next open, the user is shown the incomplete run and can resume from the last completed phase.

### Pipeline phases

All prompts, thresholds, and stop conditions are in `PromptRegistry`/`AgentRegistry`. None are hardcoded.

**Foundation**
1. Seed concept — expand a premise into a story concept
2. World bible — setting, rules, atmosphere
3. Character registry — cast with roles, arcs, relationships
4. Outline + beat sheet — chapter/scene breakdown with foreshadowing ledger
5. Canon database — facts that must be consistent (names, dates, rules)
6. Voice fingerprint — prose style guide derived from author samples
7. Quality gate — score the outline; if below threshold, loop back to step 4

**Drafting**
- Per-chapter drafting under anti-slop rules (voice fingerprint + slop lexicon injected)
- Sequential (not parallel) to maintain narrative continuity
- Keep-or-retry: each draft is scored; if below gate threshold, auto-retry up to N times
- Drafting queue UI: shows each chapter with status (queued / drafting / kept / retrying), score, retry count

**Evaluation**
- Slop scorer → LLM judge → adversarial cuts → Elo ranking across chapters → reader panel → critic+professor loop
- Stop condition for critic+professor loop: configurable — "until no major issues" or "N iterations max". Defined in `AgentRegistry`.

**Revision**
- Auto revision briefs: for each chapter with evaluation issues, generate a brief describing what to change
- Rewrite-from-brief: apply each brief to produce a revised draft
- Batch cut applicator: apply adversarial cuts in bulk
- All output → proposals → changeset review

### Propagation-debt inbox

Five co-evolving layers: **voice / world / characters / outline / prose** + **canon** cutting across all.

A change in any layer creates downstream debt:
- Author edits an entity fact in Codex → canon changes → scenes referencing that fact are stale
- Author edits a scene → voice may have drifted → voice fingerprint needs update
- AI revises prose → outline synopsis may be stale

Debt is raised by `DebtService.raise(event)` and stored in `aiStore.debt`.

Each debt item:
```typescript
interface DebtItem {
  id: string
  layer: 'voice' | 'world' | 'character' | 'outline' | 'prose' | 'canon'
  title: string          // e.g. "Canon changed: store has eight aisles"
  detail: string         // what changed and why it creates debt
  source: string         // entity id or doc id that caused the change
  affected: Array<{
    docId: string
    note: string         // e.g. "Mentions the ninth aisle as the anomaly"
    resolved: boolean
  }>
  createdAt: string
}
```

Author resolves each affected document:
- **Open** — jump to that document
- **Draft fix** — generate a targeted revision proposal via co-write
- **Mark OK** — acknowledge and close

Everything resolves through changeset review. Debt from AI changes is raised by `ProposalService.apply()` → `DebtService.maybeRaiseFromProposal()`.

### Export extras (build last, build lightly)

- **Cover studio** — basic canvas with title/author/image, export PNG
- **Audiobook studio** — chapter concatenation with pause markers, export text for TTS pipeline
- **Typeset PDF** — basic page layout, export via browser `window.print()` with a print stylesheet

---

## Electron packaging (any phase, when needed)

1. `src/preload/index.ts` — `contextBridge.exposeInMainWorld('api', { ... })` with the same `KonbiniAPI` interface
2. `src/main/index.ts` — BrowserWindow, menu, IPC registration
3. `src/main/services/NodeProjectService.ts` — same interface as `BrowserProjectService`, uses `fs/promises`
4. `src/main/ipc/` — one handler file per IPC group
5. `electron.vite.config.ts` — replaces `vite.config.ts` (add main/preload entries)
6. `electron-builder.yml` — packaging config

Zero changes to any component or store. The `window.api` assignment in `src/main.tsx` switches from `browserApi.ts` to the preload.

---

## Non-negotiable invariants

These are structural guarantees, not conventions. Violating any of them breaks a core promise to the author.

1. **AI off = zero AI in DOM.** With `aiStore.enabled = false`, no AI component renders and no AI code path executes. The studio must be byte-for-byte identical to Phase 1 with AI off.

2. **No AI write reaches `.md` directly.** Every AI output — from a single inline rewrite to a full Autopilot run — flows through: AI call → `Proposal` → changeset review → `ProposalService.apply()` → `updateContent()`. Nothing else. The `BrowserProjectService.writeDoc()` / `window.api.doc.write()` path is the only door.

3. **Every prompt and agent is registry-editable.** The `PromptRegistry` and `AgentRegistry` are the single source of truth. A hardcoded prompt string anywhere in TypeScript is a bug. Every generator, evaluator, and pipeline phase must pull its instruction text, model, and parameters from the registry at call time.

4. **`updateContent()` is the only document-mutation seam.** The editor, snapshot restore, and AI proposal apply all write document text through this function. It is the wrap point for autosave debouncing, snapshot-before-AI, and the diff/proposal layer. Nothing else may mutate `.md` content.

5. **Pre-AI snapshot is mandatory, no exceptions.** `ProposalService.apply()` must call `snapshot.take(docId, 'before AI edit')` before calling `doc.write()`. This cannot be skipped even for "small" changes. The snapshot is the safety net that makes AI edits truly non-destructive.

6. **Node IDs are stable and never reused.** Once assigned, a node ID is permanent for the lifetime of the project. Codex entity backlinks, AI proposal history, and snapshot associations all depend on this. Deleting a node deletes its ID; that ID is never assigned to a new node.

---

## Progress tracker

### Phase 1 — The Writing Studio (zero AI; stands alone) ✅ COMPLETE
- Vertical slice: create → binder → write → debounced autosave to `.md` → reopen intact → composition mode ✅
- Corkboard (editable synopses), Outliner, Inspector (label/status/synopsis/target/compile flag) ✅
- Snapshots (take/list/restore + line-diff preview), Compile/export subtree → markdown/`.docx` ✅
- In-document find (`Mod-F`), project-wide search (`Mod+Shift+F`) ✅
- New Project modal, Open/recents, Preferences (`Mod+,`), full keyboard map ✅

### Phase 2 — Proposal Spine + Registries + Co-write ✅ COMPLETE
- `MentionIndex` (entity→docs, rebuilt on `updateContent`) ✅
- `ContextBuilder` (tiered context, token budget) ✅
- Changeset review (proposal model, diff engine, per-hunk + group accept/reject → `updateContent`) ✅
- `PromptRegistry` + `AgentRegistry` (JSON-backed, app→user→project override stack, management UI) ✅
- Codex (entities, editable facts, aliases, backlinks, category browser) ✅
- AI settings (BYOK key + validation, multi-provider, global toggle) ✅
- Co-write mode (Rewrite/Expand/Tighten/Describe/Brainstorm → proposal → review) ✅

### Phase 3 — Assisted Mode 🔲 STARTED
- Batch generators (cast, beat sheet, chapter draft, evaluate prose) ✅
- Slop scorer (CM6 wavy underlines, Proof button) ✅
- Reader panel, AI Chat, Autopilot runner, Writing Stats, Timeline drag, split editor, typewriter scroll ✅
- Propagation-debt inbox (v1) ✅ — editing a Codex fact raises a `DebtItem` (via
  `DebtService.fromFactChange` + `MentionIndex`) listing scenes that reference the
  entity; the inbox (toolbar badge + `debt` modal) offers Open / Draft fix (registry
  prompt `builtin:revision:canon` → proposal → changeset review) / Mark OK per doc.
  Persisted in `project.settings.debt`.
- Prose→outline debt (heuristic) ✅ — applying a whole-doc revision (`draft`/`revision`/`batch`)
  that changes prose substantially (≥40 words or ≥30%) raises an outline-layer "synopsis may be
  stale" item (Open / Mark OK, no AI) via `DebtService.maybeRaiseFromProposal` at the apply seam.
- Debt auto-resolve on apply ✅ — a draft-fix proposal carries a `debtRef`; applying it
  (not drafting it) resolves the originating affected doc at the apply seam. Discarding leaves
  it open.
- LLM-judged canon-contradiction debt ✅ — on-demand "Check current scene" in the debt inbox
  (`DebtService.checkContinuity` + registry prompt `builtin:evaluation:continuity`) asks the
  model which referenced Codex facts the prose contradicts; each flag becomes a canon-layer
  DebtItem with a draft-fix that reconciles prose → canon. Opt-in (manual trigger) — no
  per-apply API cost.
- Structural undo/redo ✅ — past/future stacks in `projectStore`; ⌘Z / ⌘⇧Z / ⌘Y (when the
  editor isn't focused), binder footer buttons + command palette. Persisted through a new
  `setTree` node op so store, service, and on-disk manifest stay in sync (docs/content untouched).
- Remaining: cross-layer debt (voice drift)

### Phase 4 — Autopilot 🔲 STARTED (gated runner)
- `AutopilotRunner` (`AutopilotModal`): sequential node processing through changeset review ✅
- Gated runner ✅ — when a drafting prompt is selected, each generated draft runs through
  `runQualityGate` (score → auto-revise) **before** its proposal is queued; live phase/score
  indicator, falls back to the ungated draft on gate error. This is the produce → gate → advance
  pipeline: Foundation lays down outline/voice/canon, the runner drafts each scene against them and
  won't surface a draft for review until it clears the bar. Toggle in the runner config.
- Outline → scaffold → draft handoff ✅ — "Scaffold → draft" in `FoundationModal` parses the gated
  outline (`builtin:foundation:outline-parse`) into chapters, creates a document per chapter
  (title + synopsis metadata) under a **Manuscript** folder, then opens the Autopilot runner
  pre-selected on those nodes with the chapter drafter chosen (via `autopilotPreset`). One path from
  seed → foundation → a folder of gated chapter drafts. Chapter prose still arrives as proposals.
- Foundation (v1) ✅ — `FoundationModal`: seed → concept → world bible → cast, chained in-memory
  (each step feeds the next), editable previews, registry prompts `builtin:foundation:*`. "Send to
  project" creates a **Foundation** folder + a doc per part and queues each as a proposal
  (`original: ''`) through changeset review. Toolbar (❖ Foundation) + command palette.
  "Add cast to Codex" (on by default) extracts structured character entries via
  `builtin:foundation:codex` and upserts them into the Codex (lighting up MentionIndex +
  continuity checks).
- Foundation outline + voice fingerprint ✅ — added an **Outline** step (`builtin:foundation:outline`,
  doc via proposal) and a **Voice Fingerprint** (`builtin:foundation:voice`) derived from existing
  prose (or the concept if none yet), saved to `project.settings.voiceFingerprint` and injected by
  `ContextBuilder` as a context tier so co-write/batch/autopilot prompts follow the voice.
- Voice-drift debt ✅ — `DebtService.checkVoiceDrift` audits a scene against the saved fingerprint
  (`builtin:evaluation:voice-drift`) and raises voice-layer debt items; `draftVoiceFix`
  (`builtin:revision:voice`) rewrites the scene to match the voice through changeset review.
  Surfaced in the Debt Inbox ("Check voice" + voice "Draft fix"). Completes the propagation-debt
  loop across canon / outline / voice.
- Quality gate ✅ — reusable **eval → revise control loop** extracted to `lib/QualityGate.ts`
  (`runQualityGate(initial, cfg)`: scorer prompt returns `{overall,issues,suggestions}` JSON →
  reviser prompt rewrites against the critique → re-score, up to `maxRounds`; returns the final
  text + score + pass/fail). Pure of the document seam — callers route the result through the
  proposal pipeline.
  - **Outline gate** (`FoundationModal`): `builtin:evaluation:outline-gate` +
    `builtin:foundation:outline-revise`, auto-revise toggle + manual "Score outline".
  - **Draft gate** (`BatchGeneratorModal`, chapter drafts): `builtin:evaluation:draft-gate`
    (prose craft + anti-slop) + `builtin:revision:draft`; scores & auto-revises the draft before it
    reaches changeset review, with a live phase indicator.
  This is the gate primitive Autopilot's phase transitions reuse — swap prompts, not machinery.
- Remaining Foundation: canon database step; then drive the gate from the Autopilot runner.
- Remaining: phase-transition model (foundation→draft→eval→revise), canon DB + voice fingerprint
  steps + quality gate, spend cap + cost estimate, resumable runs, Elo ranking, critic/professor loops

### Electron packaging ✅ COMPLETE
- `electron/main.ts` (BrowserWindow, IPC, native dialogs) ✅
- `electron/preload.ts` (`contextBridge` exposing `KonbiniAPI`, recents in userData) ✅
- `electron/NodeProjectService.ts` (`fs/promises`, real paths) ✅
- Firefox/Safari fallback: `OPFSProjectService` (browser storage) ✅
- Scripts: `electron:dev`, `electron:build`; `electron-builder` config in `package.json` ✅
- App icon (`build/icon.png`, brand ✦) wired per-platform ✅
- CI release ✅ — `.github/workflows/release.yml`: 3-OS matrix (Linux AppImage / macOS dmg /
  Windows nsis), `electron-builder --publish always` to a GitHub Release on a `v*` tag
  (manual `workflow_dispatch` = build-only dry run). Binaries never live in git — they're
  release assets. To cut a release: `git tag v0.1.0 && git push origin v0.1.0`.

---

## Design tokens (quick ref)

All in `src/styles/theme.css`. Colors are OKLCH throughout.

| Token | Dark value | Light value |
|---|---|---|
| `--accent` | `oklch(0.64 0.11 300)` violet | same |
| `--bg` | `oklch(0.168 0.006 285)` | `oklch(0.965 0.003 90)` |
| `--text` | `oklch(0.918 0.006 285)` | `oklch(0.245 0.008 285)` |
| `--st-idea` | `oklch(0.66 0.12 20)` red | same |
| `--st-final` | `oklch(0.68 0.11 150)` green | same |
| Editor font | IBM Plex Mono (default) / Spectral / IBM Plex Sans | same |

Accent hue alternates (same lightness/chroma): blue 250 · green 150 · amber 75 · red 20.
