# Konbini — Build Plan

> **Last updated:** 2026-07-29  
> **Current phase:** Phases 1–9 built. Remaining work is polish and the
> untested-as-units gap in `CLAUDE.md`, not missing features.

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

### Phase 1b — Full studio surfaces ✅

- [x] Corkboard — editable synopsis index cards
- [x] Outliner — read-only metadata table
- [x] Inspector — label, status, synopsis, word-count target, compile flag
- [x] Snapshots — take / list / restore + line-diff preview
- [x] Compile — subtree picker, Markdown + .docx export
- [x] In-document find — CM6 search panel (Ctrl/Cmd+F)
- [x] Project-wide search — `SearchModal` (⌘⇧F), and project-wide *replace* through the proposal pipeline
- [x] Focus mode: dims by paragraph block (contiguous non-blank lines around cursor)

### Phase 1c — Project lifecycle + chrome ✅

- [x] Launch screen — brand panel, new/open/recents
- [x] New Project modal — 4 templates, folder picker
- [x] Open Project — FS handle picker
- [x] Recent projects reopen directly: FSA `FileSystemDirectoryHandle`s are persisted in IndexedDB (`HandleStore`) keyed by project ID and resolved via `requestPermission({ mode: 'readwrite' })` on the recent-row click; falls back to the picker if the handle is gone/denied. OPFS + Electron reopen by location.
- [x] Preferences modal — theme, editor font, editor size, density; skins moved into their own Themes screen with a contrast-clamped derivation engine
- [x] Full keyboard map wired: ⌘⌥N (new folder), ⌘⇧D (new doc), ⌘⇧N (new scene), ⌘D (duplicate — acts on the whole multi-selection)
- [x] Right-click context menus across surfaces. `ContextMenu` lives in `components/common/`; shared `useNodeMenu` builder wired into Corkboard cards + Outliner rows (Open, New Doc/Scene, Duplicate, Snapshot, History, Trash); History + Snapshot version items get Restore/Compare/Delete menus. Editor menu wired via the single `runCowrite` seam (Cut/Copy/Paste, Select All, co-write commands when text is selected, Take Snapshot, Document History). Editor mode is `EDITOR_MENU_MODE` in `Editor.tsx` — currently `'selection'` (custom menu only with a selection, native spellcheck menu otherwise); flip to `'always'` for a custom menu on every right-click.
- [x] Binder: new-node inline rename flow — single effect seeds the title and focuses+selects the input on the next frame, fixing the post-create focus races
- [x] Status bar: show cursor position (line:col)
- [x] Word count: project total in status bar excludes Trash subtree

---

## Phase 2 — Proposal Spine + Prompt/Agent Registry + Co-write ✅

*(Design notes below are the original spec, kept for the reasoning. See the
progress tracker for what actually shipped.)*

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

## Phase 3 — Assisted Mode ✅

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

## Phase 4 — Autopilot ✅

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

## Phase 5 — Path to Paid 🔲

The studio is feature-complete for drafting; the gap to a product people pay for
is **trust, finishing, and a differentiator** — not more features. Monetization
shape: the app + local writing stays free, BYOK means we never resell tokens, so
the paid tiers are **sync, publish-grade export, and the premium AI revision
loop**. Built one at a time, each shippable on its own.

### 5.1 Publish-grade export ✅  *(EPUB author/metadata, Shunn + manuscript DOCX, book-layout print; cover image + paged page-numbers deferred)*
Turn "drafting toy" into "I shipped my novel." Extends the existing Compile
pipeline; **no new document-mutation path** (export is read-only over the bundle).
- **EPUB 3** — spine from the binder order, per-chapter XHTML, generated TOC/nav,
  metadata (title/author/language), embedded cover.
- **Print-ready PDF** — proper page layout (trim size, margins, running heads,
  page numbers, chapter breaks) via a print stylesheet + `window.print()`.
- **Shunn manuscript format** — standard agent-submission DOCX (monospaced,
  double-spaced, name/contact header, word-count rounding, `#` scene breaks).
- **Clean DOCX/Markdown** — already partly there; make it publish-clean.
- Scope boundary: reuse `include-in-compile` flags + binder order; a small
  export-settings surface (as a view tab); no WYSIWYG page designer in v1.

### 5.2 Anti-slop revision dashboard ✅  *(the moat — reason to pay)*
Surface the pieces that already exist (voice fingerprint, slop scoring, LLM judge,
reader panel, critic) as **one tangible quality view**: per-scene scores, flagged
weak spots, voice-drift vs. the fingerprint, tracked across drafts so a writer can
*see the manuscript getting better*.
- ✅ **Manuscript Quality view tab** — every scene scored by the LLM judge,
  overall + per-dimension breakdown, weak-first sort, manuscript average,
  evaluate-one / evaluate-all, click-to-open, staleness marker. Scores persist
  to `aux/quality.json` (survive reload). Shared `lib/judge.ts` runner reused
  by the Inspector.
- ✅ **Slop signal per scene** — a slop-proof column (flag count, severity-banded)
  beside the craft score, proof-one / proof-all, expandable flag detail. Shared
  `lib/slop.ts` runner; persists to `aux/slop.json`.
- ✅ **Voice-drift vs. fingerprint** — per-scene "does this still sound like *you*?"
  score (1–10) against `settings.voiceFingerprint`, gated on a fingerprint
  being set. New registry prompt `builtin:evaluation:voice-drift`, shared
  `lib/voice.ts`, persists to `aux/voice.json`.
- ✅ **Cross-draft trend** — each "Evaluate all" pass records a manuscript-craft
  point (`aux/quality-history.json`); the dashboard shows a sparkline + delta
  ("▲ +3.4 over N passes") so you watch the draft improve.

### 5.3 Cross-device sync & backup 🔲  *(retention — biggest infra lift)*

**The hard part is the manifest, not the transport.** The bundle is
`project.json` + `docs/<nodeId>.md` + `snapshots/` + `aux/*.json`.

- Prose already syncs perfectly: one `.md` per stable node ID, so two devices
  editing different scenes never conflict. Free from the format.
- `project.json` is the problem: one blob holding the node tree **and** settings
  **and** codex **and** debt, with only a project-level `modified` and **no
  per-node timestamp**. Whole-file last-writer-wins silently eats structural
  work (rename a chapter on the laptop + add a character on the desktop → one is
  lost). This is what 5.3 must actually solve.

**Transport — three tiers, each shippable alone; one shared merge engine.**
1. ✅ **Tier 0 — safe under an external syncer** (Dropbox/iCloud/Syncthing/git
   checkout). `window.api.sync.readBundle`/`applyMerge` + the Sync view tab:
   re-read the bundle, plan the merge, snapshot every changed doc, write
   `.conflict` files for real divergence. Zero infra.
2. ~~Tier 1 — git remote.~~ **Dropped.** Tier 0 already makes a git checkout
   safe: pull, and Konbini reconciles what landed. A dedicated integration would
   only automate fetch/push — a power-user nicety, not a novelist feature.
3. **Tier 2 — hosted, E2E-encrypted.** The subscription, and the *only* option
   that works on OPFS (Firefox/Safari), where there's no folder to point at.

**Merge design**
- **Prose:** per-document three-way merge — snapshots give us the common
  ancestor. If it won't apply cleanly, write the existing
  `<id>.conflict-<stamp>.md` and resolve through the changeset review UI.
  Never lose a word.
- **Manifest:** node-wise, not whole-file. Union by ID, newest-wins per node,
  tombstones so deletes don't resurrect. Tractable only because node IDs are
  stable and never reused (invariant 6).
- **Codex/debt:** move out of `settings` into their own files, or merge by
  entry ID — today they're collateral damage in every manifest conflict.
- **`aux/*`:** merge by key, newest wins. Derived data, low stakes.
- **Snapshot before applying any remote change** — same invariant as the AI
  proposal pipeline, extended to sync.

**Not CRDTs.** They'd change the on-disk representation, breaking "open the
`.md` in any editor" (philosophy 2), and they solve real-time co-editing, which
a solo novelist doesn't have. The real failure is "I forgot to sync before
writing on the other machine" — a divergent-version problem. Per-file 3-way
merge + preserve-both is the right weight.

**Prerequisites (needed regardless of transport)**
1. ✅ Extract the triplicated `applyOp` into one shared `shared/nodeOps.ts`
   (an I/O adapter per backend) — otherwise rev/timestamp bumps drift 3 ways.
2. ✅ Per-node `modified` + Lamport `rev` on `KNode`; `schemaVersion` 2 + migration.
3. ✅ Split codex/debt out of `settings` into `codex.json` / `debt.json` sidecars.
4. ✅ Device ID + sync log (`SyncService`, device-local in prefs — deliberately
   NOT in the bundle, which is the thing being synced) + the transport-agnostic
   merge engine in `shared/sync.ts` (`reconcileDoc`, `mergeNodes`, `planMerge`).
5. ✅ `.conflict` generalized from "external edit" to "sync divergence":
   `applyMerge` writes the preserved text and the Sync tab surfaces it.

**Build order:** ✅ Tier 0 + the merge engine + auto-detection (`sync.probe`
mtime scan on window focus/visibility, confirmed by `planMerge` so our own
autosaves never cry wolf). Tier 2 (hosted) reuses `planMerge` wholesale — it
only has to move bytes and hand a bundle in.

### 5.5 Density + typography audit ✅
- The control-height ramp (`--h-sm/md/lg`) was declared with a "no more
  hand-tuned magic numbers" comment and used **zero** times while the chrome
  hardcoded 38/42/28/30/34px. Now wired — and moved into the density block
  alongside new `--h-titlebar/toolbar/statusbar/docbar`, because Density only
  reached the binder before: picking Compact tightened the tree and left a fat
  toolbar above it. Balanced keeps the exact previous values, so nothing shifts
  by default.
- `font-variant-numeric: tabular-nums` on the remaining live counters (quality
  scores + word column, sync summary, stats chips, goal input) so numbers that
  tick while you write don't reflow their neighbours.

### 5.4 Frictionless import ✅  *(companion to 5.1 — lowers switching cost)*
- ✅ **Scrivener `.scriv`** — the actual switching cost for the target user.
  Auto-detected from the existing folder picker (a .scriv *is* a folder, so the
  `.scrivx` manifest gives it away). `shared/scrivener.ts` walks the binder into
  nested paths; `shared/rtf.ts` recovers prose from RTF including bold/italic as
  Markdown, unicode escapes and typographic punctuation. Synopses import to the
  corkboard (new optional `ImportDoc.synopsis`); empty leaves survive as outline
  stubs; Scrivener's own Trash is deliberately skipped. Handles v3
  (`Files/Data/<UUID>/`) and v2 (`Files/Docs/<id>.rtf`).
- ✅ **Google Docs** — already covered: Docs exports as `.docx`, which the
  folder import converts via mammoth. No separate path needed.
- 🔲 Optional later: `.zip` of a Scrivener bundle, and front-matter-aware
  Markdown mapping (title/synopsis from YAML).

---

## Phase 6 — The obvious missing pieces ✅

Gaps a writer hits on day one that have nothing to do with AI or services.
Ordered by how much each changes what the app *is*.

### 6.1 Anchored comments ✅
Margin notes attached to a span of prose — the markup layer the studio was
missing, and the natural home for AI critique (which currently lands in a panel
disconnected from the sentence it's about).

- `shared/comments.ts` — schema + the anchoring rules. Anchors carry the quoted
  text, not just offsets, because offsets go stale silently whenever the
  document changes while closed (snapshot restore, applied proposal, sync merge,
  external editor). `reanchor` re-locates by quote and picks the occurrence
  nearest the old position; when the quote is gone it marks the comment
  **orphaned** rather than pointing it at whatever text now occupies those
  offsets. Showing a note beside the wrong sentence is worse than detaching it.
- **Two mechanisms, different failures.** CodeMirror maps anchors through every
  change while the doc is open — the only thing that can survive a rewrite of
  the quoted text. `reanchor` is the recovery path for everything else.
- `comments.json` sidecar at the bundle root (with codex/debt — primary content,
  not the disposable `aux/` tier), so sync can merge notes independently of the
  manifest. Writer-initiated changes persist immediately; anchor drift (which
  fires on nearly every keystroke) is debounced and flushed on close.
- Comments rail panel: quote + note + resolve/edit/delete, orphans shown
  distinctly, click a highlight to focus its note and vice versa. ⌘⇧M, editor
  context menu, command palette.
- Deleting a node purges its comments centrally in `applyMutation` — the one
  place every structural mutation lands. Trashing keeps them (the node lives on).
- Fixed along the way: `Studio` forced the rail back to Inspector with AI off
  using a hand-written allowlist of non-AI panels, which made any newly added
  non-AI panel unreachable. Now derived from `shell/railTabs.ts`, shared with the
  tab strip.

### 6.2 Keywords + Collections ✅
The binder can be browsed but never queried. Keyword field on `KNode`, editor in
the Inspector, and saved Collections (saved searches) — "every scene with Mira,
POV Alex, status Draft, under 1,500 words". `labelColor` exists but only paints
corkboard cards. This is what stops the binder falling out of the writer's head
around 40k words.

### 6.3 Per-project spelling dictionary ✅
The editor delegates to native browser spellcheck, so invented names squiggle
forever with no persistent "add to dictionary". Cheap, and the Codex already
knows every proper noun in the book, so the dictionary can seed itself.

### 6.4 Read-aloud proofing ✅
Web Speech API — no dependency, no key, no service. Sentence highlight, rate and
voice control, play-from-cursor. Highest-yield revision technique there is, and
it pairs directly with the anti-slop dashboard. (⌘⇧L, not ⌘⇧U — on Linux
Ctrl+Shift+U is IBus's Unicode-input chord and eats the keypress before the app
ever sees it.)

### 6.5 Deadline math ✅
`lib/deadline.ts` turns a date and a word target into a daily number and an
honest answer to "am I behind?". The arithmetic is trivial; the part that
mattered was the baseline. Pacing from the project's creation date would tell
someone who sets a deadline mid-book that they were 40,000 words behind on the
day they made the promise — so a deadline stores `startWords`, and progress is
measured from there. Moving the date re-anchors, because that is a new promise,
not a debt to carry forward.

It paces **writing days**, not calendar days: a weekends-only author has six
sessions before a deadline three weeks out, not twenty-one, and the daily number
has to say so. The pace lives in the status bar (where you are while writing)
and in Stats, where a track shows written-so-far against a marker for where a
steady pace would have put you — the gap is the whole message.

### 6.6 Character rename completion ✅
Find & replace rewrote `[[Mira]]` in prose and stopped, which left the rest of
the project disagreeing with the manuscript: the scene still titled "Mira at the
River", the codex entry still filed under Mira, the synopsis on the corkboard,
the keyword the binder filters by — and, worst of the set, every comment, since
a comment recovers its position by its *quoted text* (`shared/comments.ts`).
Renaming the prose without the quote orphans the note rather than moving it.

`lib/rename.ts` plans the whole thing first — pure, no store, no I/O — and
`RenameModal` shows that inventory before anything happens. The preview *is* the
review: forty scenes would otherwise be forty changeset modals, which nobody
reads by the fourth. Every document is snapshotted before it is written, so
History undoes any of it, and "review each document's prose in Changeset first"
is a checkbox for authors who want the per-document diff anyway.

Two details worth keeping: whole-word is applied **per edge**, because `\b`
asserts a transition and `\bM\.V\.\b` can never match anything — that was a
latent bug in the shared matcher, so project-wide replace inherited the fix.
And keywords are matched case-insensitively and rewritten in the case the tag
already used (`pov-mira` → `pov-sera`), because tags are slugs; a case-sensitive
rename would otherwise leave the binder filtering on a name the book no longer
contains. Reachable from the palette and from a codex entry, where an author
actually is when they change their mind about a name.

### 6.9 Unit coverage for the untested layers ✅
`projectStore`, `MentionIndex`, `PromptRegistry`, `HistoryService` and the
project layer had never been tested as units. Writing those tests found four
bugs that a green `tsc` and a green suite had been hiding:

- **`builtin:evaluation:voice-drift` was two different prompts.** `get()` returns
  the first match, so the debt inbox's voice audit was unreachable — it rendered
  the *scorer's* template with the auditor's variables, sending an empty
  fingerprint and an empty scene, then parsing an array out of a `{score, note}`
  reply. The auditor now has its own id.
- **`PromptRegistry.all()` never listed user prompts**, so "Duplicate" created a
  prompt that persisted and was visible nowhere. `AgentRegistry` had always done
  it correctly; this had drifted.
- **`updateIndex` mutated the index it was given** — it copied the outer Maps but
  shared the Sets inside them, so updating rewrote history for anything still
  holding the previous index.
- **The electron build compiled tests into `electron-dist`**, shipping vitest
  into the packaged binary.

### 6.8 The last of the known debt ✅
Three items that had sat in `CLAUDE.md` as "cosmetic":

**Binder drag ignored the multi-selection.** Dragging three selected chapters
moved only the row under the pointer. It now drags whatever `actionTargets`
resolves — the same rule the context menu uses — and drops them contiguous and
in order. The moves run one at a time with the insertion index re-read from live
state between them: moving a node out of a position *before* the target shifts
every index after it, so counting would scatter the group. A folder in the
selection carries its own children, so descendants of another dragged node are
filtered out rather than pulled loose.

**A folder dropped into a split pane dead-ended** on a placeholder, which made
the drop look broken rather than unsupported. Scrivenings now renders in either
pane; clicking a scene header opens it in *that* pane rather than hijacking the
global selection, which is the only thing that made it main-pane-only.

**Exported values nothing imported** — 30 of them, now module-private. The ~49
exported *types* left are deliberate: most are the parameter or return type of an
exported function, and a function whose signature can't be named is worse than a
wide surface.

Also swept up: ⌘D (duplicate) was in the shortcuts list and the plan but was
never wired to anything.

### 6.7 Footnotes / endnotes ✅
This was the only place in the app that *lost* work: `rtf.ts` listed `footnote`
as a skip-destination, so importing a researched Scrivener manuscript silently
discarded every note in it.

`shared/footnotes.ts` is the one parser — ordinary Markdown syntax (`[^1]` in the
prose, `[^1]: the note` at the foot), because a `.konbini` bundle is plain
Markdown a writer can open anywhere, and a footnote has to survive being read by
something that has never heard of Konbini. The importer now writes that syntax;
DOCX emits real Word footnotes via `FootnoteReferenceRun` (numbered across the
whole document, not per chapter); EPUB emits `epub:type="noteref"` /
`"footnote"`, so a reader can pop the note up instead of jumping to the end and
finding its way back. Markdown export needed nothing — the notes already *are*
Markdown.

---

## Phase 7 — Audit remediation ✅

A full audit (`AUDIT.md`, with a status table at the top) found the codebase
structurally healthy but *operationally unproven*: the bugs it turned up were all
correct-in-isolation and wrong in the running app. Eleven of fourteen findings
are fixed; the three left open are cosmetic and listed in `CLAUDE.md`'s known
debt rather than buried in the report.

The two that changed how the project works:

- **Performance.** Typing cost ~128 ms/keystroke on a 300-node project — the app
  was unusable at the scale it is designed for. Now 14.3 ms, no long tasks.
  A memoised `wordCount`, a duplicate of it hiding in `Binder.tsx` that was
  eating 61.5% of CPU samples, and a memoised `BinderRow`.
- **An invariant smoke test that runs in CI.** `scripts/smoke.mjs` drives the
  real studio in a real browser and asserts invariants 1, 2, 4, 5 and 6 plus the
  WCAG floors and document structure — reading *persisted bytes* wherever the
  claim is about durability. It caught a real bug on its first full run.

Also: the binder became keyboard-drivable (full ARIA tree, roving tabindex,
type-ahead, ⌘⇧B to focus it), multi-select reached the outliner and corkboard,
and the muted text ramp now clears WCAG AA on every surface in all nine themes —
skins clamp their derived mix until the floor is met, because a percentage
cannot promise a ratio.

---

## Phase 8 — Voice as a first-class object ✅

The voice fingerprint is the most load-bearing string in the AI layer, and it
had exactly one way in: derive it from prose you had already written. Three
changes, in order of how much each unlocks:

### 8.1 Write a fingerprint from a description ✅
"Describe a voice…" in AI Settings and Foundation. Say how the prose should
sound, optionally paste a passage to emulate, edit the streamed result, save.
A separate registry prompt from the analyser — that one *reports* what it finds
in samples, this one has to *author* a voice and commit to specifics the brief
doesn't state.

### 8.2 Named voice profiles, per project and per document ✅
`settings.voiceFingerprint` became a list with one marked default, and a document
can point at another (`meta.voiceId`). `resolveVoice(project, docId)` is the
single read path; ContextBuilder resolves per document, so a dual-POV novel
drafts and scores each thread against the voice it is actually written in
instead of reading as constant drift. Legacy projects migrate on open; the old
field survives as a documented mirror so a `.konbini` bundle stays readable
without this app.

### 8.3 The assistant can propose settings changes ✅
`read_config` / `propose_config`, bounded by the whitelist in
`lib/agentConfig.ts`: standing instructions, voice fingerprints, prompt
templates — text the author would otherwise type. Provider, API key, model and
token budgets are **not** on that list. Off by default behind its own opt-in,
and `runAgent` derives whether to advertise the tools from whether the capability
is wired, so a tool can never be offered that the executor will refuse. Changes
go out as a `Proposal` carrying `configRef` and are applied by Studio's single
`onApply` — same diff, same accept/reject, no `.md` write and no snapshot.

### 8.4 Tools on every provider ✅
The tool loop shipped speaking only Anthropic's wire format, so "let the
assistant use tools" was tickable but inert on every other provider — a
capability gate that was really an implementation gap, and one that contradicted
this app's own promise to privilege no vendor. `agent.ts` is now one
provider-neutral loop plus two wire adapters: Anthropic's `tool_use` /
`tool_result` blocks, and the OpenAI-compatible `tools` / `tool_calls` /
`role:"tool"` format that OpenAI, Groq, Together, Fireworks, Mistral, DeepSeek,
OpenRouter, vLLM, LM Studio and Ollama all serve. `ToolDef` needed no change —
Anthropic's `input_schema` *is* OpenAI's `parameters`, both plain JSON Schema —
and `executeTool` was already provider-neutral, so every tool works on both
wires with one definition.

The OpenAI parser is deliberately forgiving, because compat servers diverge from
the spec here more than anywhere else: tool-call frames are keyed by `index`,
then by `id`, then by array position; `arguments` are accepted as an object as
well as a string; the legacy singular `function_call` is honoured; `message` is
accepted where the spec says `delta`. The loop stops on "no tools requested"
rather than on `finish_reason`, since several servers report `stop` while still
emitting a complete call, and refuses to run a call whose arguments were cut off
at the token ceiling. An endpoint that rejects `tools` or `stream_options`
outright retires that field and retries, so a model without function calling
still answers instead of erroring.

Verified end to end in `scripts/smoke.mjs` against a mocked OpenAI-compatible
endpoint that splits arguments across frames, drops `index`, and lies about
`finish_reason` — the assistant reads a document, proposes an edit, and the edit
is still gated by changeset review and snapshotted before it reaches disk.

---

## Phase 9 — Adventure mode ✅

Every AI feature here asks the author *"do you like this prose?"* None asks
*"what happens next?"* — which is where authorial intent actually lives. The
blank page stays blank, and Autopilot's answer (generate a chapter, then review
it) puts the human decision at the wrong altitude.

Adventure mode inverts that. The author describes the story — or points at a
manuscript already in progress — and the assistant writes a passage, then offers
a deck of **beats**: one-line story directions, not prose. The author edits one,
picks one, or types their own; the next passage renders and appends. Co-writing
at the beat level, with the human choosing the story and the model rendering the
sentences.

It is not a sandbox. It is project-wide, it drafts the actual book, and it lives
in its own view tab. So it writes into the manuscript, resumes across sessions,
and can start from work already written.

The risk it has to answer is philosophy #5: this is the feature most capable of
producing a lot of mediocre prose quickly. The mitigations are structural, not
cosmetic — options are beats rather than prose, the author's own beat is always
as easy to enter as a suggested one, every passage is snapshotted so a bad one
costs one keystroke, and no two turns ever run without a human choice.

**Defaults:** a paragraph (~120 words) per beat, customizable. Scene breaks are
proposed by the model as an `— end scene here —` card and confirmed by the
author, with an explicit "End scene" always available.

### 9.1 The invariant line — append-only
Adventure mode **only ever appends**; it never alters a word already in the
document. That is the real principle behind invariant 2, and why the existing
`create_document` tool already writes without a proposal: nothing is at risk.

- Appending a passage → `snapshot.take(…, 'auto')` → `updateContent()` →
  `doc.write()`. No changeset modal — a review gate every 120 words would destroy
  the feature, and there is nothing to review against.
- Anything that *replaces* prose — "revise this passage", "regenerate
  differently" — goes through `createProposal` → `queueProposal` →
  `ChangesetModal` → Studio's `onApply`, like every other AI edit.
- Step back (`⌘Z`) restores the pre-passage snapshot and re-offers the deck.

Worst case: one passage you didn't want, undone with one keystroke.

### 9.2 The runner — `lib/adventure.ts`
Session state (premise, target folder, active scene, spine doc, lengths, the
beat ledger, the rolling summary, the current deck) persisted to
`aux/adventure.json` on the chat-threads pattern. Losing it loses your place, not
your book — the prose is in the manuscript and the ledger is materialised as a
binder document.

`streamPassage` / `generateOptions` / `takeNotes` / `updateSummary`, each a thin
wrapper over `streamCompletion` + `buildContext` + `resolveVoice` — the same
ingredients `streamBeat` already composes. `parseOptions` / `parseNotes` are
pure, exported and unit-tested, tolerant in the style of `lib/parsers.ts`: never
throw, never fabricate. The rolling summary is what keeps turn 300 affordable.

Five registry templates (`builtin:adventure:{opening,passage,options,notes,
summary}`, feature `generate`), and one new `ContextFeature` — `'adventure'` —
whose budget is the scene tail verbatim + the summary + codex entries for
recently-mentioned entities + the fingerprint.

### 9.3 The tab — `views/AdventureView.tsx`
Two doors in: *start from a premise*, or *continue from here* (pick an existing
scene; the premise comes from the summary and codex). The second is what makes
it a drafting tool for the real book rather than a story generator.

The passage pane is **the real editor** — `<Editor docId={activeSceneId} />`,
which takes only a `docId` and already syncs external content changes for
snapshot restore. That one decision means the author can fix a clumsy sentence
the moment they see it, there is no second text surface to keep in sync, and
autosave, undo, live preview, slop underlines and comments all work untouched.
Invariant 4 holds by construction.

Below it the choice deck: editable one-line beats, an always-present "or write
your own…" field with equal visual weight, regenerate, length control. Beside
it, a notes inbox — new characters, places and facts the passage introduced, each
one click to file into the Codex, never filed silently. `1`–`9` picks, `⌘Z` steps
back, `Esc` aborts the stream. Passages stream into a ghost region and commit to
`updateContent` once, so a full-document dispatch doesn't fire per token.

### 9.4 The outline falls out for free
The ordered ledger of chosen beats *is* an outline. Each accepted beat appends a
line to a "Story spine" document in the target folder — append-only, near-zero
cost, and a book drafted this way arrives with its spine already written.
Accepting an `endScene` card creates the next scene document, carries the
finished scene's synopsis over from its beats, and moves the cursor there.

### 9.5 Held lines
Never two turns without a human choice — no auto-continue, no "run 10 beats".
Snapshot before every append, always. Stream the passage first, then fire
options, notes and summary together, so the author reads while they wait.

### 9.6 What shipped
`lib/adventure.ts` (runner + tolerant parsers, 31 unit tests), five registry
prompts under a new `adventure` feature, a `ContextFeature` of the same name
budgeted below `chat` because these calls fire hundreds of times per book and
the rolling summary already carries continuity, and the `adventure` view tab
(`views/AdventureView.tsx` + `ChoiceDeck` / `NotesInbox` / `AdventureSetup`).
Sessions persist to `aux/adventure.json` and resume on reload.

Nineteen smoke checks drive the whole loop in a real browser against a mocked
endpoint, reading persisted bytes: the passage lands on disk, the pre-passage
snapshot exists and holds the old text, the spine records the beat, the codex
candidate waits in the inbox until clicked, and stepping back un-writes the
manuscript *and* the outline together. Driving it also caught two defects the
type checker could not: step-back left an orphan beat in the spine, and ending
a scene by hand left the author facing an empty deck.

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

### Phase 3 — Assisted Mode ✅ COMPLETE
- Batch generators (cast, beat sheet, chapter draft, evaluate prose) ✅
- Slop scorer (CM6 wavy underlines, Proof button) ✅
- Reader panel, AI Chat, Autopilot runner, Writing Stats, Timeline drag, split editor, typewriter scroll ✅
- Reader panel → registry ✅ — personas were hardcoded in `ReaderModal` (invariant #3 debt); now each
  is a registry **`reader` agent** (`builtin:agent:reader:*`) tying a model/temperature to an editable
  persona **system prompt** (`builtin:reader:*`, feature `evaluation`). Instructions are editable in the
  Prompt Registry; agent `model: ''` falls back to the active provider's default so the panel works on
  any backend. `AgentRegistry` now surfaces user-added agents and has `byCategory`/`delete`/`duplicate`.
  Sane defaults (the original 4 personas) ship built-in.
- Agent config UI ✅ — the registry modal gained an **Agents** tab beside Prompts: list of agents,
  editor for name / emoji / description / category / system-prompt (picker) / model (blank = provider
  default) / temperature / max-tokens, with Save · Reset-to-default (builtins) · Duplicate · Delete
  (custom) · **+ New agent**. Per-agent model/temperature and new personas are now editable in-app;
  instructions stay on the Prompts tab. Closes the invariant-#3 cleanup end to end.
- Best of N / Elo ranking ✅ — `lib/Ranking.ts` (`rankVariants`): round-robin pairwise LLM judging
  (`builtin:evaluation:compare`, A/B side alternated to blunt position bias) with Elo scoring — the
  comparative counterpart to QualityGate's absolute scoring. `BestOfModal` generates N variants
  (2–4) of the selected scene at elevated temperature, ranks them, shows the leaderboard (Elo +
  W/L/T), and sends the chosen winner through changeset review. Toolbar (🏆) + command palette.
- Critic / professor loop ✅ — `builtin:evaluation:professor` gives a developmental, margin-notes
  critique of a scene (overall assessment + 2–5 ranked issue/suggestion notes, JSON). `CriticModal`
  shows it; the author **selects which notes** to act on, then "Draft revision" runs
  `builtin:revision:draft` against just those notes → changeset review (re-critique after applying).
  Explainable, author-steered critique — distinct from the gate's automated pass/fail. Toolbar (🎓)
  + command palette. Evaluation toolkit now spans absolute (gate), comparative (Elo), qualitative
  (reader panel), and developmental (critic).
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
- Voice-drift debt ✅ — `DebtService.checkVoiceDrift` audits a scene against the saved fingerprint
  (`builtin:evaluation:voice-drift`) and raises voice-layer debt items; `draftVoiceFix`
  (`builtin:revision:voice`) rewrites the scene to match the voice through changeset review.
  Surfaced in the Debt Inbox ("Check voice" + voice "Draft fix"). Completes the propagation-debt
  loop across canon / outline / voice.
- **Phase 3 complete.**

### Phase 4 — Autopilot ✅ COMPLETE (gated runner)
- `AutopilotRunner` (`AutopilotModal`): sequential node processing through changeset review ✅
- Gated runner ✅ — when a drafting prompt is selected, each generated draft runs through
  `runQualityGate` (score → auto-revise) **before** its proposal is queued; live phase/score
  indicator, falls back to the ungated draft on gate error. This is the produce → gate → advance
  pipeline: Foundation lays down outline/voice/canon, the runner drafts each scene against them and
  won't surface a draft for review until it clears the bar. Toggle in the runner config.
- Spend awareness ✅ — `AIClient` now captures real token usage from both stream formats (Anthropic
  `message_start`/`message_delta`; OpenAI `stream_options.include_usage`) and records it centrally;
  `lib/Pricing.ts` holds list prices (Opus 4.x $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5 per 1M;
  null for unknown/BYOK models); `aiStore` keeps a session tally (tokens, USD, calls, unpriced).
  Surfaced as a "Session usage" panel in AI Settings (with reset) and, in the Autopilot runner, a
  **pre-run cost estimate** (generation + gate loop) plus **live "spent this run"** during/after a run.
- Spend cap ✅ — a persisted USD ceiling (`aiStore.spendCapUSD`, 0 = none) set in the Autopilot
  config; the runner halts before starting a new scene once the run's cost crosses it (in-flight
  scene finishes), and the done screen reports the cap stop. Over-cap estimates are flagged before
  the run starts. Turns spend *awareness* into an enforced guardrail for autonomous runs.
- Resumable runs ✅ — a run persists its queue + per-scene progress to
  `project.settings.autopilotRun` (`AutopilotRunState`); after each proposal resolves, progress is
  saved. An interruption (Stop, spend cap, close, or browser refresh) leaves the state on disk;
  reopening the runner offers **Resume** (skips resolved scenes, restores prompt + gate choice) or
  **Discard**. Natural completion clears it. Long autonomous runs are now robust to interruption.
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
- Canon database ✅ — "Add world to Codex (canon)" (on by default) extracts the World Bible into
  structured **non-character** Codex entries (locations, items, lore, concepts) via
  `builtin:foundation:canon`, upserted into the same Codex the continuity checker, MentionIndex, and
  propagation debt already key off. Foundation now seeds the full bible — cast *and* world canon.
  Foundation generators are complete.
- **Phase 4 substantially complete.** Remaining open items tracked in NEXTUP.md.

### Konbini 1.0 Hardening ✅ COMPLETE
- Selection-scoped proposal apply — `Proposal.scope`/`selRange` + `ProposalService.spliceSelection`
  fixes a data-loss bug where applying an inline (selection) cowrite proposal overwrote the whole
  document.
- Provider-aware model resolution in `AIClient.streamCompletion` — templates carrying a
  hardcoded/foreign model id now fall back to the active provider's configured model.
- `AIClient` hygiene — `onAbort` callback on `StreamCallbacks`, shared `handleStreamError`, and a
  `streamToString` wrapper used by QualityGate/Autopilot/CowriteBar.
- Silent-failure fixes — `QualityGate.parseGateScore` returns `null` (not a fabricated 0) on
  unparseable/missing scores and `runQualityGate` throws; Autopilot's reader gate uses
  `Promise.allSettled` and surfaces partial-failure; removed the raw-template `systemPrompt`
  pollution in Autopilot drafting; `prefs.set` failures dispatch a toast.
- `ContextBuilder` scene-content truncation — oversized scenes keep the tail (paragraph-aligned,
  prefixed `[…earlier scene content truncated…]`) instead of being dropped outright.
- Autosave flush on doc switch/unmount (`useAutosave`); `Studio` flushes current content to disk
  before taking the pre-AI snapshot; `projectStore` undo/redo revert the optimistic state on IPC
  failure.
- `window.api.aux` — per-project files under `<bundle>/aux/<name>` (path-traversal guarded via
  `isValidAuxName`), implemented across all three backends.
- AI Chat is now a persistent **side panel** (`AssistantPanel`, replaces Inspector when open;
  `assistantOpen` in `shellStore`, toggle via Toolbar/⌘⇧A/command palette), built on the
  previously-unused `.assistant`/`.asst-*` styles in `ai.css`. Threads persist to
  `aux/chat.json` (one read per project mount, debounced writes), migrating any legacy
  per-document `chat:<projectId>:<nodeId>` localStorage threads on first load. `ChatModal` removed.
- Test infrastructure — `vitest` (node environment, `src/test/setup.ts` stubs `window.api`/
  `localStorage`/`navigator`); unit tests for `ProposalService`, `ContextBuilder`,
  `QualityGate.parseGateScore`, and `lib/parsers` (`parseReaderVerdict`/`parseBrainstormAlternatives`,
  extracted from `AutopilotModal`/`cowrite`).
- `electron`/`electron-builder`/`cross-env`/`@types/diff` moved to `devDependencies`.

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
