import { describe, it, expect } from 'vitest'
import { parseVoice, voiceSourceFor, gatherProseSamples } from './voice'

describe('voiceSourceFor', () => {
  it('prefers prose that exists over a description of it', () => {
    expect(voiceSourceFor({ samples: 'She waited.', brief: 'literary noir' }))
      .toEqual({ from: 'samples', samples: 'She waited.' })
  })

  it('authors from the brief when there is no prose yet', () => {
    expect(voiceSourceFor({ samples: '', brief: 'literary noir' }))
      .toEqual({ from: 'brief', brief: 'literary noir', reference: '' })
  })

  it('carries a reference passage through', () => {
    expect(voiceSourceFor({ brief: 'noir', reference: 'The rain kept on.' }))
      .toEqual({ from: 'brief', brief: 'noir', reference: 'The rain kept on.' })
  })

  it('treats whitespace-only input as absent, not as content', () => {
    // An empty textarea yields '\n' or '  '. Sent as a brief, that produces a
    // style guide invented out of nothing and saved over the real one.
    expect(voiceSourceFor({ samples: '   \n ', brief: 'noir' }))
      .toEqual({ from: 'brief', brief: 'noir', reference: '' })
    expect(voiceSourceFor({ samples: '  ', brief: ' \n' })).toBeNull()
  })

  it('returns null with nothing to work from', () => {
    expect(voiceSourceFor({})).toBeNull()
  })
})

describe('gatherProseSamples', () => {
  const project = {
    nodes: {
      a: { type: 'scene', meta: { includeInCompile: true } },
      b: { type: 'scene', meta: { includeInCompile: false } },
      c: { type: 'folder', meta: { includeInCompile: true } },
      d: { type: 'scene', meta: { includeInCompile: true } },
    },
    docs: {
      a: { content: 'Chapter one prose.' },
      b: { content: 'A note to self about the plot.' },
      c: { content: '' },
      d: { content: '   ' },
    },
  }

  it('takes compiled prose only — notes are writing *about* the book', () => {
    const out = gatherProseSamples(project)
    expect(out).toContain('Chapter one prose.')
    expect(out).not.toContain('A note to self')
  })

  it('skips folders and blank documents', () => {
    expect(gatherProseSamples(project).trim()).toBe('Chapter one prose.')
  })

  it('respects the size limit', () => {
    const big = {
      nodes: { a: { type: 'scene', meta: { includeInCompile: true } } },
      docs: { a: { content: 'x'.repeat(9000) } },
    }
    expect(gatherProseSamples(big, 100).length).toBe(100)
  })

  it('returns empty for a project with no prose at all', () => {
    const empty = {
      nodes: { a: { type: 'folder', meta: { includeInCompile: true } } },
      docs: { a: { content: '' } },
    }
    expect(gatherProseSamples(empty).trim()).toBe('')
  })
})

describe('parseVoice', () => {
  it('parses score + note and clamps to 1–10', () => {
    expect(parseVoice('{"score": 8, "note": "nails the dry wit"}')).toEqual({ score: 8, note: 'nails the dry wit' })
    expect(parseVoice('prefix {"score": 12, "note": "x"} suffix')?.score).toBe(10)
    expect(parseVoice('{"score": -3, "note": "y"}')?.score).toBe(1)
  })
  it('returns null when unreadable or score missing', () => {
    expect(parseVoice('no json')).toBeNull()
    expect(parseVoice('{"note":"x"}')).toBeNull()
    expect(parseVoice('{"score":"high"}')).toBeNull()
  })
})
