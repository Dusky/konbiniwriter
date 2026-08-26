// The two keymaps must not overlap.
//
// They did, invisibly, for the app's whole life: CodeMirror's defaultKeymap and
// Konbini's window handler both claimed ⌘/ and ⌘⇧K, CodeMirror ran first, and
// the author's line was commented out or deleted on the way to opening a modal
// that hid the damage. This test is the lock on the *class* — the instance fix
// is one filter.

import { describe, it, expect } from 'vitest'
import { KONBINI_CHORDS, isKonbiniChord } from './shortcuts'
import { editorKeymap } from '../components/editor/extensions'

// The real list the editor is built with, not a re-derivation of it. Asserting
// on a locally recomputed filter passes even when the app has stopped using it.
const editorBindings = editorKeymap

describe('the editor keymap', () => {
  it('binds none of the chords Konbini claims', () => {
    const bound = editorBindings.flatMap((b) => [b.key, b.mac]).filter(Boolean) as string[]
    const overlap = bound.filter((k) => KONBINI_CHORDS.includes(k))
    expect(overlap).toEqual([])
  })

  it('no longer lets ⌘/ comment out the line under the cursor', () => {
    // The exact bug: pressing ⌘/ to read the shortcuts wrapped the current line
    // in <!-- --> and autosave wrote it to disk.
    const toggle = editorBindings.find((b) => b.run?.name === 'toggleComment')
    expect(toggle).toBeUndefined()
  })

  it('no longer lets ⌘⇧K delete the line under the cursor', () => {
    const del = editorBindings.find((b) => b.run?.name === 'deleteLine')
    expect(del).toBeUndefined()
  })

  it('leaves every other editing command alone', () => {
    // The filter must be a scalpel: undo, redo, select-all and the search panel
    // are the editor's job and Konbini does not claim them.
    const names = editorBindings.map((b) => b.run?.name)
    for (const kept of ['selectAll', 'openSearchPanel', 'deleteGroupBackward', 'cursorDocEnd']) {
      expect(names).toContain(kept)
    }
    expect(editorBindings.length).toBeGreaterThan(40)
  })
})

describe('isKonbiniChord', () => {
  it('recognises a claimed chord', () => {
    expect(isKonbiniChord('Mod-/')).toBe(true)
    expect(isKonbiniChord('Shift-Mod-k')).toBe(true)
  })

  it('ignores anything else, including undefined', () => {
    expect(isKonbiniChord('Mod-a')).toBe(false)
    expect(isKonbiniChord(undefined)).toBe(false)
    expect(isKonbiniChord('')).toBe(false)
  })
})
