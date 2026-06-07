# Architecture

Why every major decision was made. Read this before changing something structural.

---

## Runtime: webapp-first, Electron-ready

**Decision:** Ship as a webapp using the File System Access API. Design Electron as a future swap, not a future rewrite.

**Why not start with Electron:** Electron adds significant build and dev complexity (two TypeScript configs, IPC layer, native binary download, code signing). The File System Access API gives real disk read/write from the browser in Chrome/Edge today. Starting in the browser means running with `npm run dev` and refreshing — no waiting for electron-vite rebuilds.

**Why not stay web-only:** Browser sessions can't maintain filesystem permissions without explicit user gestures. Each session requires re-granting access. A native Electron app maintains this transparently. For a long-session writing tool used daily, that friction is unacceptable. The webapp is the dev and testing target; Electron is the ship target.

**The migration seam:** `window.api` is the bridge. Every component calls `window.api.project.create()`, `window.api.doc.write()`, etc. In the webapp, `src/lib/browserApi.ts` assigns a `BrowserProjectService`-backed implementation to `window.api` at startup. In Electron, the preload script's `contextBridge` assigns an IPC-backed implementation. The components are identical; only the implementation changes.

```
Browser runtime:
  main.tsx imports browserApi.ts → window.api = BrowserProjectService
  
Electron runtime:
  preload/index.ts → contextBridge.exposeInMainWorld('api', { IPC-backed impl })
  main.tsx (same file) → window.api already set by preload
```

---

## Bundle format: `.konbini/` folder

**Decision:** Plain Markdown files + a JSON manifest, in a folder named `Title.konbini`.

**Why not a single file:** Single-file formats (SQLite, ZIP) are harder to inspect, harder to resolve merge conflicts, and can't be read by other tools. A folder lets writers open `.md` files in any editor and use git for version control.

**Why not a DB:** A SQLite file in a Dropbox folder is a crash-corruption risk (SQLite WAL files don't sync well). Markdown files are just text; any sync service handles them correctly.

**Why `.konbini` extension on the folder:** macOS and Windows treat folder extensions as "bundle" types (like `.app`, `.xcodeproj`). The File System Access API's directory picker can be shown filtered to these. In Finder, the bundle looks like a single file; in Terminal, it's a directory.

**Manifest vs content split:** `project.json` stores structure (nodes, metadata, ordering) but NOT document content. Content lives in `docs/<nodeId>.md`. This means:
- `project.json` is small and fast to write on structural mutations (rename, move, reorder)
- Autosave only writes the specific `.md` file that changed, not the entire manifest
- The manifest is human-readable as a structural record even if the `.md` files are missing

**Snapshot format:** Same principle. Snapshot content is in `snapshots/<nodeId>/<snapshotId>.md`. The manifest only stores snapshot metadata (id, title, timestamp, word count). This keeps `project.json` small regardless of how many snapshots exist.

---

## Editor: CodeMirror 6

**Decision:** CodeMirror 6 with custom markdown highlighting extensions.

**Why CM6 over ProseMirror:** ProseMirror requires a schema definition and has a complex document model. CM6's text model is simpler (it's fundamentally a text editor with decorations), which matches the use case: write Markdown, style it, don't enforce a schema. ProseMirror's strength (structured content) is a drawback here.

**Why CM6 over Tiptap/Milkdown:** These are ProseMirror abstractions that add more complexity, not less. They're also designed for rich-text (bold, italic via toolbar) not Markdown-as-text. We want the author to see and type Markdown syntax, just with the syntax decorated/dimmed rather than hidden.

**Live-preview vs ghost-mode:** The handoff specifies "syntax decorated/dimmed, not shown raw." This means `# ` is visible but dimmed (`color: var(--hl-marker)`), while the heading text is colored and enlarged. This is different from Typora's ghost-mode (which hides syntax). The decoration approach is implemented via `HighlightStyle` mapping Lezer tokens to CSS classes (`cm-h1`, `cm-mk`, `cm-em`, etc.).

**Scrolling model:** CM6 in a scrolling container uses `overflow: visible` on the scroller (not `overflow: auto`). The `editor-wrap` div does the scrolling. This allows the search panel to be positioned at the top of the editor-wrap, not floating over content.

---

## State management: Zustand

**Decision:** Two Zustand stores — `projectStore` (project data + view state) and `shellStore` (app chrome, screen, modals).

**Why two stores:** The project store and the shell store have different lifetimes. The shell store persists through project close/open cycles. The project store is reset when a new project is loaded. Keeping them separate means `shellStore.recents` isn't accidentally cleared when `projectStore.unloadProject()` is called.

**Why no Redux:** Redux is appropriate for large teams where strong conventions prevent state bugs. For this codebase, Zustand's simplicity (no reducers, no action creators, no connect HOC) is the right tradeoff.

**Why not React Context:** Context triggers re-renders in all consumers when anything changes. Zustand's selector-based subscription (`useProjectStore(s => s.selectedId)`) only re-renders when the selected slice changes.

**The AI store (Phase 2):** A third Zustand store — `aiStore` — will hold AI state: enabled flag, proposals, run state, cost tally, debt items. It's separate from the project store so the project store has zero AI imports (AI off = AI code never runs).

---

## The `updateContent` seam

The single most important invariant in the codebase.

```
projectStore.updateContent(docId, content)
  → updates in-memory store (immediate, for live word count etc.)
  → sets saveStatus: 'saving'

useAutosave (debounced 700ms)
  → window.api.doc.write(projectId, docId, content)
  → BrowserProjectService.writeDoc() → FileSystemWritableFileStream.write()
  → setSaveStatus('saved')
```

**Why one seam:** The editor, snapshot restore, and AI proposal apply all write through this same function. It's the only wrap point for:
1. Autosave debouncing
2. "Saving..." status indicator
3. Snapshot-before-AI (Phase 2: `ProposalService.apply()` calls `snapshot.take()` then `doc.write()`)
4. The diff/proposal layer (Phase 2: AI output goes through `Proposal` first, applies via this seam)

If content could be written through two different paths, the invariants above can't be enforced without repeating the logic.

---

## The proposal/changeset architecture

**Core invariant:** AI never writes to a `.md` file directly. Every AI output — from a single sentence rewrite to a full novel draft — is expressed as a `Proposal` that the author must review before it is committed.

**Why proposals, not immediate writes:** Writers are not undo-happy — they're often surprised by what they wrote and want to compare before accepting. A proposal gives them a redline diff with per-hunk granularity. "Accept this word change but not that sentence cut" is a real need.

**Changeset review as the keystone:** The changeset review surface is built in Phase 2 before any AI feature. It's not a consequence of AI features — it's the prerequisite. Every AI feature is just "call an API, make a Proposal, send it to changeset review." The review surface does all the hard UX work.

**Hunk-level accept/reject:** The diff is computed from `original` and `proposed` using a line-level LCS diff (same algorithm as the snapshot diff preview). Each contiguous block of additions/deletions is a "hunk." The author can accept or reject each hunk independently. The result is spliced back together and committed via `updateContent`.

---

## PromptRegistry architecture

**Core invariant:** Every AI prompt is defined in an editable template. There are no hardcoded prompt strings in TypeScript.

**Why:** Three reasons:
1. **Tunability.** The defaults the app ships with won't be perfect for every author's voice or genre. An author writing horror needs different "slop scorer" thresholds than one writing cozy mystery. Making every prompt editable is the difference between a tool and a platform.
2. **Transparency.** Authors should be able to see exactly what instruction is being sent on their behalf. A hidden system prompt is a trust violation.
3. **Debuggability.** When an AI output is bad, the first question is "what prompt generated this?" If the answer is "it's hardcoded in the source," the author can't fix it.

**Override stack:** The three-tier override lets an author customize globally (applies to all projects) or per-project (e.g., different voice guidelines for different novels) without having to modify every template. App defaults are never deleted — "reset to default" removes the override, restoring the original.

**Variable injection:** `{{variable}}` placeholders are resolved at call time by the `ContextBuilder`. The prompt editor shows a variable picker listing available vars with documentation. This makes it clear what context the AI has access to, and what adding/removing a variable costs in tokens.

---

## MentionIndex

**Why this is necessary, not optional:**

"Codex backlinks" means the Codex can show which scenes mention a character. "Propagation debt" means when you change a canon fact, the app knows which scenes reference that fact. "AI context selection" means the `ContextBuilder` can include only the codex cards relevant to the current scene, not the entire codex (which would blow past context windows).

All three of these require the app to know `entityAlias → Set<docId>`. Without this index, the alternatives are:
- Scan all `.md` files on demand (slow, blocks the UI, can't handle large projects)
- Hardcode which scenes reference which entities (requires manual tagging — defeats the purpose)
- Use AI to detect references (expensive, slow, loses the real-time quality)

The index is cheap to maintain: it's rebuilt on `updateContent` with a debounced 50ms delay. For a 100k-word novel with 30 entities, a rebuild takes ~10ms in JavaScript (string scan). The index is not persisted — it's always rebuilt from doc content on open, so it's always accurate.

---

## Token budgeting

**Why this has to be designed before generators:**

Every generator needs to decide what context to include. If each generator makes its own ad-hoc decision ("include the whole codex," "include just the current scene"), the app will:
1. Blow past context windows on larger novels
2. Be inconsistent (one generator knows about characters, another doesn't)
3. Be hard to tune (there's no single place to adjust what's included)

The `ContextBuilder` is the single place where this decision is made. It assembles context according to a priority order (full scene → chapter synopsis → relevant codex cards → outline excerpt → canon → voice fingerprint) and truncates at the token budget from the top. Each tier is removable if it doesn't fit. Every generator calls `ContextBuilder.for(docId, feature, budget)` and gets a `ContextPacket` back.

The token budget is a per-feature setting in the `PromptRegistry` (`maxTokens`). The `ContextBuilder` uses this to decide how much context to include.
