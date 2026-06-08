# CLAUDE.md — Konbini

Guidance for AI agents (and humans) working in this repository. Read this
before making changes. `PLAN.md` holds the detailed architecture and phase
roadmap; this file is the orientation layer and the rules that never bend.

---

## What Konbini is

Konbini is a **local-first, full-featured writing studio for long-form
fiction** — a Scrivener-class workstation with a deeply integrated AI layer.
The vision spans the entire writing lifecycle:

- **Simple assistance** — inline co-writing (rewrite, expand, tighten,
  describe, brainstorm), an AI chat that knows your manuscript, prose
  proofing.
- **Assisted authoring** — batch generators (cast lists, beat sheets,
  chapter drafts), reader-panel evaluation, slop scoring.
- **Full Autopilot** — the north star: take a story from a single seed all
  the way to a finished, revised novel. Foundation (world bible, character
  registry, outline, canon, voice fingerprint) → drafting → multi-agent
  evaluation (LLM judge, adversarial editor, reader panel, critic/professor
  loops) → revision agents → export.

Every layer is opt-in. A novelist who wants a clean text editor gets exactly
that; a novelist who wants an AI co-author gets a studio that can draft and
revise a book.

It ships as a **browser app** (Chrome/Edge via File System Access, Firefox/
Safari via OPFS) and as an **Electron desktop app** (real files on disk).

---

## Design philosophy

1. **The author is always in control.** AI is a power tool, never an
   autopilot you can't see or stop. Every AI change is reviewable, reversible,
   and snapshot-protected before it touches a word of the manuscript.

2. **Local-first, your data is yours.** Projects are plain folders
   (`.konbini` bundles) of Markdown files + a JSON manifest. No cloud, no
   lock-in. You can open the `.md` files in any editor. BYOK for AI — users
   bring their own API keys and can point at any provider/model.

3. **The studio stands alone without AI.** With AI disabled, Konbini is a
   complete, first-class writing app. AI is additive, never load-bearing for
   the core writing experience.

4. **One seam per concern.** Platform I/O goes through `window.api`. Document
   mutation goes through `updateContent()`. AI output goes through the
   proposal/changeset pipeline. Prompts come from the registry. These seams
   are the architecture — respect them and the app stays portable and safe.

5. **Quality over slop.** The AI features exist to help authors write *better*
   prose, not more mediocre prose. Anti-slop scoring, evaluation agents, and
   revision loops are first-class, not afterthoughts.

6. **Craft in the details.** OKLCH color throughout, keyboard-first,
   composition/focus/typewriter modes, no jank. This is a tool writers live
   inside for months.

---

## Non-negotiable invariants

These are structural guarantees. Violating any one breaks a core promise.

1. **AI off = zero AI in DOM.** With `aiStore.enabled = false`, no AI
   component renders and no AI code path executes.

2. **No AI write reaches `.md` directly.** Every AI output flows through:
   AI call → `Proposal` → changeset review → `ProposalService.apply()` →
   `updateContent()`. The `window.api.doc.write()` path is the only door.

3. **Every prompt and agent is registry-editable.** `PromptRegistry` and
   `AgentRegistry` are the single source of truth. A hardcoded prompt string
   in TypeScript is a bug.

4. **`updateContent()` is the only document-mutation seam.** Editor, snapshot
   restore, and AI apply all write through it.

5. **Pre-AI snapshot is mandatory.** `ProposalService.apply()` snapshots
   before `doc.write()`. No exceptions, even for "small" changes.

6. **Node IDs are stable and never reused.** Backlinks, proposal history, and
   snapshots depend on it.

7. **`window.api` is the only platform-I/O seam.** Components never touch
   `localStorage`, `fs`, `showDirectoryPicker`, or `ipcRenderer` directly.
   (Known debt: a few stores still use `localStorage` for preferences — see
   below. Don't add more.)

---

## Architecture map

```
src/
  shared/        Canonical data model (types.ts), pure utils, templates.
                 Imported by BOTH renderer and Electron main — keep DOM/Node-free.
  lib/
    browserApi.ts            Assigns window.api in the browser. Auto-selects
                             backend: FSA (Chrome/Edge) → BrowserProjectService,
                             else OPFS (Firefox/Safari) → OPFSProjectService.
    BrowserProjectService.ts File System Access API backend (real disk, Chromium).
    OPFSProjectService.ts    Origin Private File System backend (Firefox/Safari).
    AIClient.ts              Multi-provider streaming (Anthropic + OpenAI-compatible).
    ContextBuilder, MentionIndex, ProposalService, StatsService, etc.
  store/         Zustand 5 stores (projectStore, shellStore, aiStore).
  components/    React UI. Calls window.api.* and store actions only.
electron/
  main.ts              Main process: BrowserWindow, IPC, native dialogs.
  preload.ts           contextBridge implementing KonbiniAPI via Node fs/promises.
  NodeProjectService.ts Node backend (real paths) — mirrors BrowserProjectService.
```

### The three backends, one interface

All three implement the same project-layer interface and are swapped behind
`window.api`:

| Runtime | Backend | Storage | Open recents by |
|---|---|---|---|
| Chrome/Edge | `BrowserProjectService` | real disk (FSA) | re-pick folder (handles aren't persistable) |
| Firefox/Safari | `OPFSProjectService` | browser-internal (OPFS) | location string directly |
| Electron | `NodeProjectService` (preload) | real disk (`fs`) | location path directly |

The renderer never knows which one is active.

---

## Conventions

- **CSS tokens** (in `src/styles/theme.css`, OKLCH): valid are `--text`,
  `--text-2`, `--text-3`, `--bg`, `--bg-2`, `--bg-3`, `--border`,
  `--border-2`, `--accent`, `--accent-fg`, `--st-idea`, `--st-prog`,
  `--st-final`, `--st-draft`. **Never invent tokens** like `--text-1`,
  `--ui-2`, `--accent-ok`, `--accent-danger` — they don't exist.
- **Zustand 5**: `subscribe` takes a single listener arg (no selector
  overload). State resets (focus/composition/split) belong in both
  `loadProject` and `unloadProject`.
- **Streaming components** must abort on unmount:
  `useEffect(() => () => abortRef.current?.abort(), [])`.
- **TypeScript strict**. `npm run build` (renderer) and
  `npm run electron:compile` (Electron) must both pass with zero errors
  before committing.

---

## Build & run

```bash
npm install                 # use --legacy-peer-deps if peer conflicts arise
npm run dev                 # Vite dev server (browser) at localhost:5173

# Electron (two terminals):
npm run dev                 # terminal 1: Vite
npm run electron:dev        # terminal 2: compile electron/ + launch window

npm run build               # typecheck + production web build
npm run electron:build      # web build + electron-builder package
```

Electron note: `electron-dist/package.json` pins `{"type":"commonjs"}` so the
compiled CJS output runs under the root `"type":"module"`. The
`electron:compile` script regenerates it every run.

---

## Known debt (don't expand it)

- A few modules still read/write `localStorage` directly instead of going
  through `window.api` (aiStore, shellStore, StatsService, RecentsService,
  PromptRegistry). Acceptable for now; route new preferences through the seam
  and migrate these when convenient.

---

## Workflow

- Develop on the assigned feature branch; commit with clear messages; push.
- Don't create PRs unless asked. Don't push to `main`.
- After changes, verify both builds pass. Keep `PLAN.md`'s progress tracker
  current when you complete a phase item.
