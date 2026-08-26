// The chords Konbini claims for itself.
//
// This list exists because CodeMirror's `defaultKeymap` also claims some of
// them, and CodeMirror listens on the editor DOM — so it wins the race, runs its
// command, and *then* the window handler in `App.tsx` runs too. Both happen, and
// the modal that opens covers the damage:
//
//   ⌘/       toggleComment  →  the line became `<!-- … -->`, and the Shortcuts
//                              modal opened on top of it
//   ⌘⇧K      deleteLine     →  the line was deleted, and the Codex panel opened
//
// Autosave then wrote both to disk. An author pressing ⌘/ to check a shortcut
// lost a line from their book, silently, and an HTML comment does not survive
// into compiled output.
//
// So this is the authority: `src/components/editor/extensions.ts` filters
// CodeMirror's keymap through it. Adding a shortcut here removes it from the
// editor automatically, which is what stops this class of bug coming back —
// `src/lib/shortcuts.test.ts` fails if the two ever overlap again.
//
// Notation is CodeMirror's (`Mod-` = ⌘ on macOS, Ctrl elsewhere), so the two
// lists can be compared without translation.

export const KONBINI_CHORDS: readonly string[] = [
  // Damaging collisions — these are the reason the file exists.
  'Mod-/',            // Keyboard Shortcuts        (was: toggleComment)
  'Shift-Mod-k',      // Codex panel               (was: deleteLine)
  // Harmless collisions: CodeMirror only moved the selection. Claimed anyway,
  // so that every shortcut the UI advertises is the only thing the chord does.
  'Mod-d',            // Duplicate selection       (was: selectNextOccurrence)
  'Mod-Shift-l',      // Read Aloud                (was: selectSelectionMatches)
]

/** True when CodeMirror must not bind this chord. */
export function isKonbiniChord(key: string | undefined): boolean {
  if (!key) return false
  return KONBINI_CHORDS.includes(key)
}
