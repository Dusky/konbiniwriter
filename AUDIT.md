# Konbini — codebase audit

**Date:** 2026-07-27 · **Commit:** `c37c8f6` · **Method:** static analysis + Playwright
probes against a running dev server, including a synthetic 300-node / 211k-word
project written directly into OPFS.

Every claim below is marked with how it was established. `SUSPECTED` means I
could not verify it and says what would settle it.

---

## 0. Status — what has since been fixed

Worked through in commits `8cbcc08` … `12fd4f9`. The findings below are left as
written so the reasoning stays readable; this table is the current state.

| ID | Finding | Status |
|---|---|---|
| C1 | Typing costs ~128 ms/keystroke at 300 nodes | **Fixed** — 128 ms → 14.3 ms, long tasks gone. Memoised `wordCount`, removed a shadowing duplicate in `Binder.tsx` (61.5% of CPU samples), memoised `BinderRow`. |
| H1 | Binder is keyboard-inaccessible | **Fixed** — full ARIA tree: roving tabindex, ↑↓/Home/End/←→/Enter/Space/F2/Escape/Menu key, Shift+↑↓ sweeps a selection, type-ahead. ⌘⇧B focuses the tree. |
| H2 | No multi-select in outliner/corkboard | **Fixed** — shared `useNodeSelect`. Two bugs found underneath: a plain click ejected you to the editor, and the corkboard kept its browsed folder in the selection so a bulk trash would have taken the chapter. |
| M1 | `--text-3` fails WCAG AA | **Fixed** — and it was broader: `--dim`, `--hl-quote` and Sepia's `--text-2` failed too. Floors now measured against the worst surface, and skins clamp their derived mix until the floor is met. |
| M2 | Node ids not collision-safe across devices | **Fixed** — `uid()` mixes per-process entropy from `crypto.getRandomValues`. |
| M3 | Three invariants unguarded | **Fixed** — `scripts/smoke.mjs`, 33 checks driving the real app, in CI. It immediately caught `_newId` leaking into `project.json`. |
| M4 | Raw control bytes hide `Scrivenings.tsx` from grep | **Fixed** — unicode escapes. (This file had the same bytes and was also binary to `grep`.) |
| M5 | Aux score caches never pruned | **Fixed** — purged in `applyMutation` beside the comment purge. |
| L1 | `CLAUDE.md` known-debt section is wrong | **Fixed** — replaced with the outstanding debt; the CSS token list is complete and the contrast rule is written down. |
| L2 | 2 dead exports | **Fixed** — `clearThemeVars` deleted; `MANIFEST_FILE` now actually used by the 15 call sites that hardcoded the string. |
| L3 | 23 module-only exports | Open — cosmetic, recorded in `CLAUDE.md`. |
| L4 | No landmarks, no `<h1>` | **Fixed** — header/nav/main/aside/footer, project title as the one h1, asserted in the smoke test. |
| L5 | Folder dropped into a split pane dead-ends | Open — recorded in `CLAUDE.md`. |
| L6 | Binder drag ignores a multi-selection | Open — recorded in `CLAUDE.md`. |

---

## 1. Summary

The architecture is in good shape. The seams described in `CLAUDE.md` are real
and enforced, the three storage backends have genuinely converged, dead code is
almost nil (2 unused exports out of ~350), and the data layer survived every
corruption scenario I threw at it. This is not a codebase with rot in it.

It has one serious problem and one embarrassing one.

| # | The five things that matter | Severity |
|---|---|---|
| 1 | **Typing costs ~128 ms/keystroke in a 300-node project.** Word counts are recomputed over the entire manuscript on every keystroke. The app is unusable at the scale it is designed for. | Critical |
| 2 | **The binder is completely keyboard-inaccessible.** Rows are `<div>`s with no `tabindex`, no `role`, no arrow-key navigation. The app's headline claim is "keyboard-first". | High |
| 3 | **`--text-3` fails WCAG at 2.79:1.** Used for hints, paths, counts, timestamps throughout. | Medium |
| 4 | **Zero landmarks, zero `<h1>`, no component tests, no store tests.** 3 of the 7 invariants have no automated guard. | Medium |
| 5 | **`CLAUDE.md`'s "Known debt" section is factually wrong** — the debt it describes was already paid. Guidance that misdescribes the code actively misleads. | Low |

**Overall read:** structurally healthy, operationally unproven. The bugs found
this session (and in the sessions before it) share one signature — the code was
correct in isolation and wrong in the running app. The gap is not code quality;
it is that almost nothing is exercised at realistic scale or by keyboard.

---

## 2. Findings

### Critical

#### C1 · Typing is unusably slow at target scale
**Where:** `src/components/shell/StatusBar.tsx:36-40`, `src/components/binder/Binder.tsx:186`
(`subtreeWordCount`), `src/store/projectStore.ts:updateContent`

**Verified:** built a 300-node / 211,200-word bundle in OPFS, opened it, and
measured real `insertText` latency.

| Measurement | Result |
|---|---|
| Per keystroke, folders expanded (313 rows) | **128 ms** |
| Per keystroke, folders collapsed (13 rows) | **80 ms** |
| Long tasks observed | 112–149 ms, one per keystroke |
| Binder DOM mutations per keystroke | **0** (pure React reconciliation) |
| `wordCount` over 300 docs, isolated | **26.9 ms** |
| Binder folder-row subtree counts, isolated | **13.3 ms** |

`StatusBar` computes `totalWords` by walking every root and word-counting every
document's full text — on every render, with no `useMemo`. `Binder` calls
`subtreeWordCount` per folder row, re-walking the same subtrees. Both re-render
on every keystroke because `updateContent` replaces the `project` object
identity.

**What breaks:** at 150k words the editor drops well below usable typing
latency (>100 ms is perceptible lag; the target is <16 ms). This is the scale
the product exists to serve.

**Fix:** cache word counts per document, invalidated on content change — a
`Map<ID, number>` in the store updated inside `updateContent`, with
`subtreeWordCount` summing cached leaves. Memoise `totalWords`. Consider
`React.memo` on binder rows.
**Size:** ~half a day. High confidence, well-contained.

---

### High

#### H1 · The binder cannot be reached or driven by keyboard
**Where:** `src/components/binder/Binder.tsx` (row markup)

**Verified:** 30 real `Tab` presses from `document.body`. Tab stops reached:
`tb-btn`, `bf-toggle`, `icon-btn`, `tab-x`, `resizer`, `cm-content`. **No binder
row.** With a row selected, `ArrowDown` does not move the selection. Row
semantics: `{tag: "DIV", tabindex: null, role: null}`; the scroller has no
`role="tree"`.

**What breaks:** the primary navigation surface of a self-described
keyboard-first app is mouse-only, and invisible to screen readers. The
multi-select added in `c37c8f6` is mouse-only for the same reason.

**Fix:** roving `tabindex` on rows, `role="tree"`/`treeitem"`/`aria-expanded`,
arrow-key navigation (↑↓ move, ←→ collapse/expand, Enter opens, Shift+↑↓
extends selection).
**Size:** ~half a day.

#### H2 · Outliner and Corkboard have no multi-select
**Where:** `src/components/views/Outliner.tsx`, `Corkboard.tsx`

**Verified:** grep — neither calls `toggleSelect` or `selectRange`.

**What breaks:** they share `useNodeMenu`, so they *would* render the
multi-selection menu, but a selection can only be built in the binder. The bulk
actions are effectively binder-only, which is not obvious from the UI.
**Size:** ~2 hours (reuse the same three handlers).

---

### Medium

#### M1 · `--text-3` fails WCAG AA
**Verified:** canvas-rasterised contrast against `--bg` in the default dark theme.

| Token | Ratio | AA (4.5) | AA Large (3.0) |
|---|---|---|---|
| `--text` | 14.96 | pass | pass |
| `--text-2` | 5.55 | pass | pass |
| `--text-3` | **2.79** | **fail** | **fail** |

`--text-3` carries hints, folder paths in the doc picker, keyword counts, the
filter tally, timestamps, and the measure readout. It fails even the large-text
threshold.
**Fix:** raise lightness until ≥4.5:1; check every theme, not just the default.
**Size:** ~1 hour including a theme sweep.

#### M2 · Node IDs are not collision-safe across devices
**Where:** `src/shared/utils.ts:3-8`

```ts
let _uid = 0
export function uid(prefix='id') { _uid += 1; return `${prefix}-${Date.now().toString(36)}-${_uid.toString(36)}` }
```

The counter resets to 0 on every reload and carries no per-device entropy. Two
devices creating a node in the same millisecond with the same counter value
produce **the same ID**. Sync merges per-node by ID.

**Verified:** by reading the implementation. The collision itself is
`SUSPECTED` — I did not construct one. Settling it: simulate two devices from
a cold start creating nodes in a tight loop and compare ID sets.

**What breaks:** a collision silently merges two different scenes into one.
Invariant 6 ("node IDs are stable and never reused") is not actually guaranteed.
**Fix:** mix in the existing device id from `SyncService`, or 4 bytes of
`crypto.getRandomValues`. **Size:** ~15 minutes.

#### M3 · Three invariants have no automated guard
**Verified:** `find` — 26 test files, **0 component tests, 0 store tests**.

| Invariant | Guarded? |
|---|---|
| 1 · AI off ⇒ no AI in DOM | no test (verified manually today) |
| 2 · No AI write bypasses the proposal pipeline | no test |
| 4 · `updateContent` is the only mutation seam | no test |
| 5 · Pre-AI snapshot mandatory | no test (code path verified by reading) |
| 6 · Stable node IDs | no test — and see M2 |

Untested modules of consequence: `projectStore.ts` (~950 lines, the heart of
the app), all three project services, `HistoryService`, `MentionIndex`,
`PromptRegistry`, `theme.ts`.
**Fix:** the AI-off and snapshot invariants are cheap to assert in a Playwright
smoke test that runs in CI. **Size:** ~half a day for the high-value ones.

#### M4 · `Scrivenings.tsx` contains raw control bytes and is invisible to grep
**Where:** `src/components/editor/scriveningsSep.ts` separator literals, embedded
at `Scrivenings.tsx:1657,1673,1693`

**Verified:** `file` reports `data`, not text. `grep` silently skipped the file
during my first invariant sweep — I only caught the `updateContent` call inside
it by re-running with `-a`.

**What breaks:** every `grep`-based check — mine, yours, and any future
tooling — silently excludes a 12.9 kB component. That is how invariant
violations hide.
**Fix:** use `'\u0000'` / `'\u0001'` escapes instead of literal bytes.
**Size:** 5 minutes.

#### M5 · Aux score caches are never pruned
**Where:** `src/store/projectStore.ts:840-863`

`judgeResults`, `slopResults`, `voiceResults` are keyed by node id and written
to `aux/*.json`. Comments *are* purged when a node is deleted
(`applyMutation`); these are not.
**Verified:** grep — no delete/filter/purge path references them.
**Impact:** slow unbounded growth of disposable files. Low real risk (aux is the
throwaway tier), but it is an inconsistency with the comment purge right beside it.
**Size:** ~15 minutes.

---

### Low

| ID | Finding | Where | Verified |
|---|---|---|---|
| L1 | `CLAUDE.md` "Known debt" claims aiStore/shellStore/StatsService/RecentsService/PromptRegistry still use `localStorage` directly. All five now use `window.api.prefs` (0 `localStorage` refs, 45 `api.prefs` refs). | `CLAUDE.md` | grep |
| L2 | 2 genuinely unused exports: `clearThemeVars` (`lib/theme.ts`), `MANIFEST_FILE` (`shared/bundle.ts`). | — | AST-ish scan |
| L3 | 23 exports used only inside their own module (`slopField`, `NODE_MIME`, `DEFAULT_PROMPTS`, …). Cosmetic; widens the public surface for no reason. | — | scan |
| L4 | No landmark elements and no `<h1>` anywhere. Screen-reader users get no document structure. | shell components | DOM query |
| L5 | Dropping a **folder** into a split pane dead-ends on a placeholder; Scrivenings is main-pane-only. | `EditorPane.tsx:147` | read + known |
| L6 | Drag moves only the grabbed row, ignoring a multi-selection. | `Binder.tsx` onDragStart | read |

---

## 3. Verified working

Actively confirmed sound — not assumed:

- **Invariant 1 (AI off ⇒ no AI).** With AI disabled: no AI-labelled control in
  the DOM, rail tabs are `[Inspector, Comments, History]`, the editor context
  menu has no co-write entry, the command palette lists no AI commands, and
  **zero network requests** to any AI provider (route interceptor on
  `anthropic|openai|/chat/completions|/v1/messages`).
- **Invariant 2 & 5 (proposal pipeline + mandatory snapshot).** Only 4 call
  sites reach `doc.write`, all legitimate. The apply path in `Studio.tsx:172-182`
  correctly does flush → snapshot → `updateContent` → write.
- **Invariant 4.** `updateContent` has exactly 5 callers, all UI-level; nothing
  mutates `project.docs` directly.
- **Invariant 7.** No component touches `localStorage`, `showDirectoryPicker`,
  `fs`, or `ipcRenderer`. The only `localStorage` uses are inside the seam
  implementation itself.
- **Invariant 3.** No hardcoded prompt strings outside the registry.
- **Crash-safety of writes — all three backends.** I expected to report the
  browser backends as unsafe and was wrong. Empirically: with a `createWritable`
  open and partial data written, a concurrent read still returns the *previous
  complete* content, and `abort()` leaves the original intact. Chromium's FSA is
  swap-file backed, so writes commit atomically on `close()`. Node uses explicit
  tmp+rename. `SUSPECTED` for Firefox/Safari OPFS — settling it needs those
  engines.
- **Corruption resilience.** Opened cleanly with: corrupt `comments.json`,
  corrupt `codex.json`, a deleted `.md` file, and a legacy `schemaVersion: 1`
  manifest (which migrated to v2 on disk as designed). Only a truncated
  `project.json` fails to open — expected, and unreachable given atomic writes.
- **Backend parity.** 31 methods compared across the three services; every
  divergence is by design (`openByHandle`/`getHandleDisplayName` FSA-only,
  `onConflict` Electron-only and optional in the type, recents/dialogs supplied
  by preload).
- **Dead code.** Effectively none.
- **Accessible names.** 44 visible buttons, 0 unnamed; 4 inputs, 0 unlabelled.
- **Modal semantics.** Command palette is `role="dialog"`, `aria-modal="true"`,
  focus inside on open.

---

## 4. Gaps & feature opportunities

Ranked by value ÷ effort.

| Opportunity | Value | Effort | Note |
|---|---|---|---|
| **Word-count cache** | very high | S | Unblocks C1; also speeds Stats, Compile, Outliner |
| **Binder keyboard navigation** | very high | M | Fixes H1; makes multi-select keyboard-usable |
| **Deadline math** (6.5, planned) | high | S | Data already exists; pure arithmetic |
| **Character rename** (6.6, planned) | high | S | Renaming a character currently leaves the binder stale |
| **Multi-select in outliner/corkboard** | high | S | Fixes H2 |
| **Drag a multi-selection** | medium | M | Needs an insertion-order design decision |
| **Virtualised binder** | medium | M | Only worth it after the word-count cache; 313 rows reconcile fine once cheap |
| **Snapshot diff across arbitrary points** | medium | M | Snapshots exist; only per-doc line diff today |
| **Footnotes** | medium | M | Currently *lossy* — `rtf.ts` discards Scrivener footnotes on import |
| **Compile presets** | medium | S | Re-selecting format + subtree every export is friction |
| **Session/sprint timer** | low | S | Streaks exist; a timer is the natural companion |

### Top three recommendations

1. **Word-count cache.** One contained change that turns the app from unusable
   to fast at its own target scale. Nothing else on this list matters as much.
2. **Binder keyboard navigation.** The product's central claim is currently
   untrue, and it is a half-day fix.
3. **A CI smoke test that asserts the invariants.** Every serious bug this
   session was invisible to `tsc` and `vitest` and obvious within ten seconds of
   driving the real app. That asymmetry will keep producing bugs until something
   automated drives the real app.

### Worth deleting

Nothing substantial. This codebase has been kept tight — the extraction work
(`nodeOps`, `bundle`, `query`, `railTabs`) has consistently removed duplication
rather than adding layers. The only cuts available are 2 dead exports and 23
over-broad ones, which is noise.

---

## 5. Suggested order of work

1. **C1 word-count cache** — biggest user-visible win, well-understood, low risk.
2. **M2 node-id entropy** — 15 minutes, and it closes a silent data-corruption
   path in a feature (sync) that already ships.
3. **M4 control bytes** — 5 minutes, and it stops future greps lying to us.
4. **H1 binder keyboard nav** — then **H2**, which becomes trivial after it.
5. **M1 contrast** — quick, and it touches every theme so better done before more
   themes exist.
6. **M3 invariant smoke test** — the durable fix for the pattern behind most of
   the above.
7. Then resume feature work: 6.5 deadline math, 6.6 character rename.

`M5`, `L1`–`L6` are cleanup; fold them into whatever work touches those files.

---

## Appendix · How things were measured

| Probe | What it did |
|---|---|
| `audit1.mjs` | AI-off DOM sweep, network interception, editor menu, palette |
| `audit2.mjs` | Built 300-node/211k-word OPFS bundle; open time, render, filter, typing |
| `audit3.mjs` | Per-keystroke profile, MutationObserver, longtask observer, collapsed-vs-expanded |
| `audit4.mjs` | Isolated `wordCount` cost for StatusBar total and binder subtree rows |
| `audit5a/b.mjs` | Corrupt sidecars, missing doc, legacy schema, truncated manifest |
| `atomic.mjs` | FSA `createWritable` atomicity under an uncommitted write |
| `a11y.mjs` | Accessible names, labels, landmarks, dialog semantics, contrast |
| `kb.mjs` | 30 real Tab presses, binder arrow-key navigation, row semantics |

Scripts are in the session scratchpad, not the repo.
