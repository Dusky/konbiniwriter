# NEXTUP — backlog for the next session

Forward-looking punch list. Ordered by priority. `file:line` refs included so the
next session can act fast. (Architecture/feature roadmap lives in `PLAN.md`; this
is the "rough edges + what to build next" list.)

---

## P0 — Broken UX

### 1. Window decorations / no way to quit the app  — ✅ FIXED
Shared `WindowControls` (`src/components/shell/WindowControls.tsx`) renders
minimize / maximize-restore / close-window wired to `window.api.shell.*`, shown
in the Studio titlebar and on a draggable Launch-screen strip (`.win-bar`).
Electron-only, hidden on macOS (native traffic lights remain). The old "✕ Close"
is relabeled **"✕ Close project"**. Original report below for reference.

<details><summary>Original diagnosis</summary>
**Symptom:** clicking "✕ Close" returns you to the project-selection screen, and
from there the app is unquittable — only Alt+F4 (or ⌘Q) works.

**Root cause (fully diagnosed):**
- The Electron window is frameless — `frame: false`, `titleBarStyle: 'hidden'`
  (`electron/main.ts:20-21`) — so there are **no OS window controls**.
- The custom `Titlebar` (`src/components/shell/Titlebar.tsx`) renders a single
  **"✕ Close"** button whose handler is `handleClose` → `unloadProject()` +
  `setScreen('launch')` (`Titlebar.tsx:12-17`). That's "close *project*," not
  "close *window*."
- The `Titlebar` only mounts inside `Studio`. `App` routes
  `screen === 'launch' ? <Launch/> : <Studio/>` (`src/App.tsx:129`), and
  **`Launch` renders no titlebar at all** — so on the launch screen there's no
  drag region and no controls whatsoever.
- `window.api.shell.{minimize,maximize,close}` + the IPC handlers
  (`shell:minimize/maximize/close`, `electron/main.ts:62-67`;
  `electron/preload.ts:148-151`) **exist but are never called by any renderer
  component** (verified: zero `api.shell` usages in `src/`).

**Fix sketch:**
- Add a real window-controls cluster (minimize / maximize-restore / close-window)
  wired to `window.api.shell.*`, rendered on **both** Launch and Studio (a shared
  frameless titlebar, or render `Titlebar` on the launch screen too).
- Separate the two actions: keep **"✕ Close project"** (back to launch) only when
  a project is open; always show the **close-window** control.
- Only show the min/max/close cluster under Electron — the browser `shell` stub
  min/max are no-ops (`src/lib/browserApi.ts:88-95`); browser `close()` already
  calls `window.close()`. Gate on an Electron check.
- The launch titlebar also needs `-webkit-app-region: drag`
  (`src/styles/theme.css:392`) so the frameless window is movable from launch.
- Consider macOS: with `titleBarStyle: 'hidden'` the native traffic lights may
  still render on mac — verify per-platform so controls don't double up.
</details>

### 2. UX-bug sweep (modal close/escape behavior) — ✅ FIXED
Same "no way to close / lose work on a stray action" family as the window bug.
- **ChangesetModal discarded the proposal on backdrop click** (`onClick … onDiscard`).
  A stray click outside a review threw away the generated (often gated/expensive)
  draft — and in an Autopilot run, advanced past that scene. Backdrop is now inert;
  Apply/Discard must be explicit. (`ChangesetModal.tsx`)
- **No Escape-to-close anywhere** — `App.tsx` `handleKey` bailed on `!mod` before
  Escape was ever read; only CommandPalette/SearchModal handled it. Added a global
  Escape → `setModal(null)`, excluding the generative modals (foundation/bestof/
  critic — hold unsaved AI output) and palette/search (own their Escape).
- **Generative modals lost content on a backdrop click** — Foundation / BestOf /
  Critic now have inert backdrops (dismiss via their explicit Cancel/Close), so a
  misclick can't wipe generated concept/variants/critique.

**Remaining sweep notes (minor, not yet fixed):**
- `WindowControls` maximize glyph can desync if the window is maximized via OS
  double-click/shortcut (state only polled on mount). Cosmetic.
- Launch `.win-bar` drag strip could clip the top ~32px of `.launch-win` on very
  short windows (< ~620px tall); no interactive element sits there in the common
  case. Low likelihood.
- `ReaderModal` still closes on backdrop click (results are cheap/re-runnable —
  left as-is for now).

---

## P1 — Depth / features flagged but not built

- **Reader-panel aggregate verdict** — ✅ done. Each reader ends with a
  `VERDICT: <0-100> | keep/drop` line (parsed, stripped from the prose); the
  header shows panel avg score + keep tally, each tab shows its own verdict chip.
- **Critic/judge agents into the Autopilot eval phase** — the runner already gates
  drafts with `QualityGate` (effectively a judge), so this is optional and partly
  overlaps. If pursued: seed default `critic`/`judge` agents and offer a deeper
  per-scene eval pass distinct from the numeric gate. Lower priority.
- **Export — EPUB only** — Compile already does **Markdown, Word (.docx), and
  Print/PDF** (`CompileModal.tsx`; docx wired in `BrowserProjectService.ts` /
  `OPFSProjectService.ts` / `NodeProjectService`). Remaining gap: **EPUB**, which
  needs a zip dep (JSZip) + OPF/container/XHTML scaffolding. Deferred — real chunk,
  low marginal value over PDF/DOCX.

## P2 — Known debt (don't expand; migrate when convenient)

- **Direct `localStorage`** instead of the `window.api` seam, in: `aiStore`,
  `shellStore`, `StatsService`, `RecentsService`, `PromptRegistry`,
  `AISettingsModal`. Documented debt in `CLAUDE.md`; route new prefs through the
  seam and migrate these opportunistically.

---

## Notes
- Both builds (`npm run build`, `npm run electron:compile`) are green as of the
  last session. CI release workflow + app icon are in place
  (`.github/workflows/release.yml`).
- The window bug is best verified in the actual Electron app
  (`npm run dev` + `npm run electron:dev`), not the browser build.
