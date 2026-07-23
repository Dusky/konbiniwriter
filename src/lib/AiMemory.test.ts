import { describe, it, expect } from 'vitest'
import { extractMemories, stripMemories, appendMemories } from './AiMemory'

describe('extractMemories', () => {
  it('pulls notes in order, trimmed and de-duped', () => {
    const text = 'Sure.\n<remember>Kai has a scar over the left eye</remember>\nMore.\n<remember> Kai has a scar over the left eye </remember>\n<remember>The city is always raining</remember>'
    expect(extractMemories(text)).toEqual([
      'Kai has a scar over the left eye',
      'The city is always raining',
    ])
  })

  it('returns [] when there is nothing to remember', () => {
    expect(extractMemories('Just a normal reply.')).toEqual([])
  })

  it('ignores empty remember blocks', () => {
    expect(extractMemories('<remember>   </remember>')).toEqual([])
  })
})

describe('stripMemories', () => {
  it('removes complete blocks and collapses the gap', () => {
    expect(stripMemories('Before.\n<remember>x</remember>\nAfter.')).toBe('Before.\n\nAfter.')
  })

  it('hides a trailing unclosed tag (mid-stream)', () => {
    expect(stripMemories('Here you go.\n<remember>partial note stil')).toBe('Here you go.')
  })
})

describe('appendMemories', () => {
  it('appends bullets to existing notes', () => {
    expect(appendMemories('Existing notes.', ['a', 'b'])).toBe('Existing notes.\n- a\n- b')
  })

  it('starts fresh when there are no existing notes', () => {
    expect(appendMemories('', ['a'])).toBe('- a')
  })

  it('is a no-op with no notes', () => {
    expect(appendMemories('keep', [])).toBe('keep')
  })
})
