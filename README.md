# Konbini

A local-first, offline writing studio for long-form fiction. Scrivener-class features, clean Markdown bundle format, opt-in AI layer.

**Status:** Phase 1 — writing studio running. Zero AI. Open in Chrome/Edge at `localhost:5173`.

---

## Setup

```bash
npm install
npm run dev        # → http://localhost:5173
npm run build      # production build → dist/
```

Requires **Chrome or Edge** (for the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)). Firefox doesn't support it yet.

---

## What works now

- **Launch screen** — New Project (4 templates, including seeded "Midnight Aisle" demo novel), Open Project, recent projects
- **Binder** — nested folder/document/scene tree, drag-and-drop reorder/reparent, inline rename, right-click context menu, status dots, word counts
- **Editor** — CodeMirror 6, live-styled Markdown (headings, bold, italic, blockquote, code, `[[wikilinks]]`), focus mode (dims inactive lines), composition mode (full-screen), Ctrl/Cmd+F in-document search
- **Autosave** — debounced 700ms after last keystroke, writes `.md` files to disk
- **Inspector** — label, status, synopsis, word-count target + progress bar, include-in-compile flag
- **Corkboard** — editable synopsis index cards per folder
- **Outliner** — read-only table of all documents with metadata
- **Snapshots** — take, list, restore (auto-snapshots current before restoring), line-diff preview
- **Compile** — subtree document picker, Markdown + Word (.docx) export
- **Theme** — dark/light toggle, OKLCH design tokens throughout

## What's next

See [PLAN.md](./PLAN.md) for the full phase-by-phase plan.  
See [docs/](./docs/) for architecture, data model, AI design, and known-gap mitigations.

---

## Project format

Projects are portable folder bundles on disk:

```
My Novel.konbini/
  project.json        ← manifest (nodes, metadata, ordering)
  docs/
    <nodeId>.md       ← one file per document, human-readable
  snapshots/
    <nodeId>/
      <snapshotId>.md
```

No database. No proprietary format. Safe in Dropbox / iCloud.

---

## Six invariants that don't bend

1. **AI off = zero AI in DOM.** With the global AI toggle off, no AI component renders and no AI code runs.
2. **No AI write reaches `.md` directly.** All AI output → proposal → changeset review → `updateContent()` only.
3. **Every prompt and agent is registry-editable.** Hardcoded prompt strings are bugs.
4. **`updateContent()` is the only document-mutation seam.** Nothing else writes `.md` content.
5. **Pre-AI snapshot is mandatory.** `ProposalService.apply()` always snapshots before writing.
6. **Node IDs are stable and never reused.** Codex entities and AI proposal references depend on this.

---

## Electron migration

The app is intentionally designed for a zero-friction Electron migration:

1. Add `src/preload/index.ts` — same `KonbiniAPI` interface via `contextBridge`
2. Add `src/main/` — `NodeProjectService` using `fs/promises` (same interface as `BrowserProjectService`)
3. Rename `vite.config.ts` → `electron.vite.config.ts`, add Electron entries
4. Add `electron-builder.yml`

Zero component changes required. The `window.api` abstraction is the seam.

---

## Docs

| Document | What it covers |
|---|---|
| [PLAN.md](./PLAN.md) | Phase build order, current status, all invariants |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Why every major decision was made |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) | Types, schemas, bundle format in full |
| [docs/AI_DESIGN.md](./docs/AI_DESIGN.md) | Phase 2–4 AI architecture: proposal spine, registries, pipeline |
| [docs/GAPS.md](./docs/GAPS.md) | Known architectural gaps with concrete mitigation designs |
