# NEXTUP — backlog for the next session

Forward-looking punch list. Ordered by priority. `file:line` refs included so the
next session can act fast. (Architecture/feature roadmap lives in `PLAN.md`; this
is the "rough edges + what to build next" list.)

---

## P0 — Broken UX

### 1. Window decorations / no way to quit the app  ⟵ headline bug
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

---

## P1 — Depth / features flagged but not built

- **Reader-panel aggregate verdict** — each persona currently returns prose only.
  Have each also emit a score + "would keep reading," and show a panel summary
  (mean score, keep-reading tally). `src/components/modals/ReaderModal.tsx`.
- **Critic/judge agents into the Autopilot eval phase** — the runner gates drafts
  with `QualityGate`; wire the `critic`/`judge` agent categories (now registry-
  editable) into an optional deeper eval pass per scene.
- **Richer export** — confirm/extend Compile to DOCX/EPUB (the `docx` dep is
  already present). Check `src/components/modals/` compile + `StatsService`.

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
