# Known Gaps & Mitigations

Five architectural gaps identified before Phase 2 starts. Each has a concrete mitigation design.

---

## Gap 1: Reference/dependency index (MentionIndex)

### The problem

Codex backlinks, propagation-debt inbox, and AI context selection all silently assume the app knows which documents reference which entities. Without a maintained index, these features either don't work or require expensive full-manuscript scans at runtime.

"3 scenes reference stale canon" — by what mechanism does the app know this? If it's a regex scan at debt-raise time, it works for small projects but blocks the UI for a 100k-word novel. If it's cached somewhere, it needs to be maintained. If it's AI-detected, it's slow and expensive. The answer has to be a maintained index.

### The mitigation

A `MentionIndex` class in the project store, rebuilt on every `updateContent` (debounced 50ms). See [AI_DESIGN.md](./AI_DESIGN.md#mentionindex) for the full design.

**When to build:** At the start of Phase 2, before Codex or debt inbox. The index must exist before any feature that depends on it.

**What it can't do:** Resolve pronouns, handle misspellings, understand context. These are LLM problems, solved on-demand. The mechanical index handles the common case (literal alias matching) efficiently.

**Integration points:**
- Codex backlink panel: `mentionIndex.getMentions(entityId)` → list of docs + counts
- Debt inbox: `debtService.findAffected(event)` → uses `mentionIndex.getMentions()`
- ContextBuilder: `mentionIndex.getEntitiesInDoc(docId)` → codex cards to include in context

---

## Gap 2: Token budgeting (ContextBuilder)

### The problem

The moment you inject codex + outline + canon + surrounding scenes into a generator, you exceed the context window. A 100k-word novel won't fit. Every generator that makes its own ad-hoc decision about what context to include will be inconsistent, untunable, and will silently fail on larger projects.

This isn't a "Phase 4 problem." It's a Phase 2 problem — the first co-write calls hit it immediately.

### The mitigation

A `ContextBuilder` with a tiered assembly model and a token budget. See [AI_DESIGN.md](./AI_DESIGN.md#contextbuilder) for the full design.

**The key insight:** Not every token of context is equally useful. The full document content and chapter synopsis are always relevant. The third character's full fact sheet probably isn't. The builder fills the budget with the highest-value context first.

**When to build:** Phase 2, immediately after `MentionIndex`. The `ContextBuilder` depends on the index (for relevant codex card selection).

**Token estimation:** Use `Math.ceil(text.length / 4)` as a conservative approximation (actual BPE tokenization is model-specific but this is within 20% for English prose). For exact budgeting in Phase 3+, swap in the model's actual tokenizer.

**Budget source:** The `PromptTemplate.maxTokens` field. Each template declares its total context budget. The `ContextBuilder` respects this. The template editor shows a token-budget bar when editing.

---

## Gap 3: Data durability

### The problem

Three scenarios that can corrupt or silently lose an author's work:

**A. Mid-write crash.** If the app crashes while `FileSystemWritableFileStream.write()` is in progress, the `.md` file may be partially written. The browser's File System Access API mitigates this by writing to a temp file and swapping atomically — but this is browser-implementation-specific and not guaranteed.

**B. No pre-AI snapshot enforcement.** The design says `ProposalService.apply()` must always snapshot before writing. But "must" is a convention without enforcement. If any code path calls `doc.write()` without snapshotting first, the author has no recovery.

**C. External edits.** The author opens a `.md` file in another editor (or Dropbox syncs a conflict copy) while Konbini has the project open. The next autosave overwrites the external change.

### The mitigation

**A. Atomic writes:** The File System Access API's `createWritable()` is atomic in Chromium (temp file + rename). For Electron/Node.js: use `fs.promises.writeFile(path + '.tmp', content)` then `fs.promises.rename(path + '.tmp', path)`. The `NodeProjectService` must use this pattern — never `fs.writeFile(path, content)` directly.

**B. Pre-AI snapshot as a compile-time invariant:** `ProposalService.apply()` calls `snapshot.take()` as its first line. To make it impossible to skip: the `apply()` method is the only public API for committing proposals. No other code should call `doc.write()` with AI-generated content. This is enforced by code review convention in Phase 1–2; a linter rule can flag `doc.write` calls outside `ProposalService` in Phase 3.

**C. External change detection:** On project open, record the `project.json` last-modified timestamp. Before any write, compare the current mtime against the recorded one. If it changed, show a dialog: "This project was modified outside Konbini. Reload? (Your unsaved changes will be preserved as a snapshot.)" Implementation: poll the mtime every 30 seconds in a background timer, or use a file watcher (Electron `fs.watch`, browser File System Access API doesn't support watching).

**Priority:** B is highest priority (catastrophic if missed). A is covered by the browser/Electron implementation choice. C is Phase 2+ polish.

---

## Gap 4: Unified undo + provenance

### The problem

**Undo:** CodeMirror 6 maintains its own undo stack (per-document, text-only). An accepted AI changeset dispatches a CM6 transaction, which is recorded in CM6's history. But structural mutations (rename, move, create node) are NOT in the CM6 history. There's no single `Cmd-Z` that covers both.

**Provenance:** When an author looks at a passage and wonders "did AI write this?", there's currently no answer. The `Proposal` object that generated it is in `aiStore.proposals` (session-only, not persisted). After the session ends, the provenance is lost.

### The mitigation

**Undo:**

Two-level undo:
1. CM6 handles text-level undo (Cmd-Z within an editor session). This is correct for normal writing.
2. A `CommandHistory` (lightweight Zustand slice) records structural mutations as inverse ops:
   ```typescript
   type InverseOp = { type: 'undoCreate'; id: string } | { type: 'undoRename'; id: string; prevTitle: string } | ...
   ```
   Cmd-Z in the binder (when the editor is not focused) pops from `CommandHistory`.

For AI edits: the pre-AI snapshot is the undo mechanism. "Undo AI edit" = "restore the most recent snapshot." This is simpler than integrating AI edits into CM6 history and handles the case where a large Autopilot run changed many documents at once.

**Provenance:**

The `Proposal` object already carries `promptId`, `agentId`, `model`, `temperature`, `contextFingerprint`, `costCents`. These are present from Phase 2.

For persistence: store applied proposal metadata (not the full diff) in `project.json` under `aiHistory: ProposalSummary[]` (capped at 100 entries). Each summary:
```typescript
interface ProposalSummary {
  id: string
  docId: string
  command: ProposalCommand
  label: string
  appliedAt: string
  model: string
  promptId: string
}
```

In the Inspector, an "AI edits" section shows the history for the current document. Clicking a summary shows the proposal metadata. This makes it possible to answer "what AI model wrote this paragraph and with what prompt" months later.

**Priority:** Provenance is cheap to add and costly to retrofit (the data doesn't exist if you don't capture it). Add it in Phase 2 when proposals are first built. Undo is Phase 2 polish.

---

## Gap 5: Project-wide search

### The problem

A Scrivener-class writing studio without project-wide search is embarrassing. An author looking for every mention of "the back door" should not have to open each document manually.

### The mitigation

**In-document find:** Already done — CM6 `@codemirror/search` is integrated. `Ctrl/Cmd+F` opens the find panel.

**Project-wide search:** Two phases:

**Phase 1c (basic, no index):** Scan `projectStore.docs[*].content` in memory. Works fine for projects up to ~50 documents. Show results as a list of doc titles + snippets. Clicking a result opens the document and jumps to the match.

```typescript
function searchProject(query: string, project: Project): SearchResult[] {
  const results: SearchResult[] = []
  const re = new RegExp(escapeRegex(query), 'gi')
  for (const [nodeId, body] of Object.entries(project.docs)) {
    const matches = [...body.content.matchAll(re)]
    if (matches.length === 0) continue
    const node = project.nodes[nodeId]
    results.push({
      docId: nodeId,
      docTitle: node?.title ?? nodeId,
      matches: matches.map(m => ({
        index: m.index!,
        snippet: body.content.slice(Math.max(0, m.index! - 60), m.index! + 60 + query.length)
      }))
    })
  }
  return results.sort((a, b) => b.matches.length - a.matches.length)
}
```

**Phase 3 (index-backed):** Share the `MentionIndex` infrastructure. Add a general-purpose inverted index for arbitrary terms (not just entity aliases). Enables instant search on large projects.

**UI:** A search bar in the binder header (or a dedicated panel). Results appear in a list below the search bar, replacing the binder tree while active. Press Escape to close.

---

## Deferred (not gaps — conscious decisions)

These are real concerns but don't block any phase if deferred.

**Streaming output:** Phase 2 generators can be blocking (show spinner, get result). Streaming is a UX improvement for long outputs. Design: the `callAI()` wrapper supports both blocking and streaming modes; the `ProposalService` uses blocking in Phase 2, switches to streaming in Phase 3 when draft outputs are long enough to benefit.

**Linux keychain fallback:** `keytar` (which wraps libsecret/gnome-keyring) is flaky on some Linux setups. Fallback: AES-256-GCM encrypted file in `userData/konbini/.keys`, key derived from machine fingerprint. Low priority until Electron phase.

**Lazy loading:** Current design eagerly loads all `.md` files on project open. For projects with >100 documents or >1MB of content, this is noticeable. Fix: only load `.md` content when a document is selected; the binder uses `docs[id].content === ''` as the unloaded sentinel. The `useAutosave` hook won't fire for unloaded documents. Implement when first observed as a performance problem.

**Unicode/CJK word counting:** `text.split(/\s+/).length` is wrong for Japanese and Chinese. For CJK, word count is character count (or character count / 2). The word-count function in `utils.ts` should detect CJK ranges and switch counting strategies. Relevant given the name — low priority but worth noting.

**Code signing + notarization:** Required to distribute a macOS/Windows Electron app without security warnings. Not needed for development. Implement as the last step before any public release.

**Testing strategy for BrowserProjectService:** This is the one module where a bug eats an author's book. It needs integration tests with a mock `FileSystemDirectoryHandle` (not unit tests with mocked primitives). The File System Access API is available in Node 22+ via `--experimental-fs`. Alternatively, use a virtual filesystem in tests. Priority: add at least smoke-test coverage before shipping.
