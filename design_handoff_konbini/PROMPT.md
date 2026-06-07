# Claude Code kickoff prompt

Paste the following into Claude Code from the root of your (empty or existing) repo, with this
`design_handoff_konbini/` folder present in the project.

---

You are building **Konbini**, a local-first, offline desktop writing studio (Scrivener-class)
for long-form fiction. Read `design_handoff_konbini/README.md` in full before writing code — it
is the spec. The HTML files in `design_handoff_konbini/` (`Konbini Write.html`, `app/`) are a
**design + behavior reference built in HTML/React**; do **not** ship them. Recreate their look
and behavior in a real app.

**Stack (decided — don't re-litigate):** Electron + TypeScript + React + Zustand. Editor =
CodeMirror 6 (markdown, live-styled so syntax is decorated/dimmed, not shown raw). Project
format = a folder **bundle** containing one `.md` per document + a `project.json` manifest.
Cross-platform: macOS / Windows / Linux.

**Non-negotiable architecture:**
- Clean main/renderer split. **ALL filesystem access lives in the main process** behind a typed
  IPC API — no `fs` in the renderer. A `ProjectService` in main owns reading/writing the bundle
  and manifest; the renderer holds view state only.
- Define the `Project` / `Node` / `DocBody` TypeScript types up front (copy them from the
  README). Treat `project.json` as the versioned serialization of those types; honor
  `schemaVersion` for migrations.
- Every node has a **stable, never-reused `id`** and an extensible `ext: {}` bag.
- The editor and any future AI feature mutate document text **only** through a single
  `updateContent(docId, content)` method — the one wrap point for autosave, snapshots, and a
  future diff/proposal layer. Keep this seam.

**Build order — ship the vertical slice FIRST, then iterate:**
1. **Vertical slice:** create a project; add nested folders/documents in the binder; click a
   doc and write; debounced autosave to the `.md`; close and reopen the project with work
   intact; toggle composition mode. Get this running and confirm it works before polishing.
2. Then: corkboard (editable synopses), outliner (read-only to start), inspector metadata,
   snapshots (take/list/restore inside the bundle), compile/export (subtree → concatenated
   markdown → `.docx`; keep the compile pipeline format-pluggable).
3. Then the project lifecycle + chrome: launch/welcome screen, New Project (templates) / Open /
   recent-projects, native menus, the keyboard map, macOS-vs-Windows window chrome.

**Out of scope now (leave seams, do NOT build):** no AI features yet — but design the data model
so a future "codex" (character/location/lore entities) and an AI **proposal/changeset review**
system can attach without a rewrite (stable IDs, extensible metadata, the isolated
`updateContent` mutation API). No epub/PDF, no cloud/accounts/telemetry. The AI layer shown in
the reference is **opt-in and comes later**; when built, AI must never edit without landing in
the changeset review first, and turning AI off must leave a fully usable zero-AI app.

**Fidelity:** high. Reproduce the layout, interactions, and the OKLCH design tokens from the
README / `app/theme.css`. Dark-first with a light variant; switchable editor font (mono/serif/
sans); violet accent.

**How to work:** First propose the folder structure, dependencies, and the `project.json` schema,
and wait for my OK before generating the full codebase. Then build the vertical slice, run it,
and confirm it works. Ask only on genuine forks; otherwise proceed with sensible defaults and
note them.
