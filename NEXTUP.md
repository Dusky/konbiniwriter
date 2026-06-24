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

### 2. UX-bug sweep (modal close/escape behavior) — ✅ FIXED
- ChangesetModal backdrop now inert (Apply/Discard must be explicit).
- Global Escape → `setModal(null)`, excluding generative modals.
- Foundation / BestOf / Critic backdrops inert.
- WindowControls maximize-glyph desync — ✅ FIXED.
- Launch `.win-bar` drag-strip clip — ✅ FIXED (min height 640).
- `ReaderModal` closes on backdrop click by choice (results cheap/re-runnable).

---

## P1 — Features shipped this session

- **EPUB export** — ✅ done. `buildEpub()` in `src/shared/epubBuilder.ts`;
  all three backends wire it via dynamic import. CompileModal has the format button.
- **localStorage → prefs seam** — ✅ done. `aiStore`, `shellStore`, `StatsService`,
  `RecentsService`, `PromptRegistry` all use `window.api.prefs` now.
- **Reader-panel aggregate verdict** — ✅ done.
- **Chat persistence** — ✅ done. Per-document threads in `aux/chat.json`, unlimited
  history, migrated from the earlier per-document prefs keys.
- **AI Chat as a side panel** — ✅ done. `AssistantPanel` replaces the modal, lives in
  the inspector grid slot (Toolbar/⌘⇧A/command palette toggle).
- **Chat ContextBuilder** — ✅ done. Chat now uses the full 6-tier context
  (voice fingerprint, codex, siblings) instead of a raw docContent slice.
- **Brainstorm picker** — ✅ done. 5 alternatives in an inline picker panel;
  "Use" on one creates the proposal.
- **Configurable context budgets** — ✅ done. Per-feature token overrides in
  AI Settings; ContextBuilder reads them automatically.
- **Context inspector in Chat** — ✅ done. Collapsible tier breakdown showing
  token counts and truncation warnings.

---

## P2 — Good next bets

- **Voice fingerprint refresh** — generated once at Foundation time, never
  updated. A "Refresh from selection" button in the voice fingerprint UI would
  let authors keep it current as prose evolves.
- **Reader panel in Autopilot gate** — panel is isolated from the Autopilot
  quality gate. No way to require "reader panel passes" before a proposal queues.
- **Slop auto-run** — currently manual toolbar button. Debounced auto-run
  (e.g. 30s idle) + keyboard shortcut would make it feel ambient.
- **Codex: scan chapter for new entries** — no way to say "I've written 5
  chapters, what new entities/facts should be in the codex?"
- **Temperature per-invocation** — editing the registry is the only way to
  change temperature. A slider on the CowriteBar for power users.

---

## Notes
- Both builds (`npm run build`, `npm run electron:compile`) are green.
- CI release workflow + app icon in place (`.github/workflows/release.yml`).
- Electron-specific features (window controls, file paths) best verified via
  `npm run dev` + `npm run electron:dev`.
