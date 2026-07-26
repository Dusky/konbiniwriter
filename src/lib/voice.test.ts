import { describe, it, expect } from 'vitest'
import {
  parseVoice, voiceSourceFor, gatherProseSamples,
  migrateVoiceProfiles, resolveVoice, voiceProfileFor, makeVoiceProfile, DEFAULT_VOICE_NAME,
} from './voice'
import type { Project, ProjectSettings } from '@shared/types'

const noir = makeVoiceProfile('Noir', 'Short declaratives.')
const warm = makeVoiceProfile('Warm', 'Long looping sentences.')

function projectWith(settings: Partial<ProjectSettings>, meta: Record<string, string | undefined> = {}): Project {
  const nodes: Project['nodes'] = {}
  for (const [id, voiceId] of Object.entries(meta)) {
    nodes[id] = {
      id, type: 'scene', title: id, parentId: null, childIds: [], expanded: true,
      meta: { label: 'scene', status: 'draft', synopsis: '', target: 0, includeInCompile: true, voiceId },
      ext: {}, rev: 1, modified: '',
    }
  }
  return {
    schemaVersion: 2, id: 'p', title: 'P', created: '', modified: '',
    rootIds: [], trashId: null, nodes, docs: {},
    settings: { location: 'x', ...settings },
  }
}

describe('migrateVoiceProfiles', () => {
  it('promotes a legacy single fingerprint to one named profile', () => {
    const patch = migrateVoiceProfiles({ location: 'x', voiceFingerprint: 'Short declaratives.' })
    expect(patch?.voiceProfiles).toHaveLength(1)
    expect(patch?.voiceProfiles?.[0]?.name).toBe(DEFAULT_VOICE_NAME)
    expect(patch?.voiceProfiles?.[0]?.fingerprint).toBe('Short declaratives.')
    expect(patch?.activeVoiceId).toBe(patch?.voiceProfiles?.[0]?.id)
  })

  it('is a no-op for a project that has no voice at all', () => {
    expect(migrateVoiceProfiles({ location: 'x' })).toBeNull()
    expect(migrateVoiceProfiles({ location: 'x', voiceFingerprint: '   ' })).toBeNull()
  })

  it('is idempotent — a migrated project is left alone', () => {
    expect(migrateVoiceProfiles({ location: 'x', voiceProfiles: [noir], activeVoiceId: noir.id })).toBeNull()
  })

  it('repairs a dangling active id instead of resolving to no voice', () => {
    const patch = migrateVoiceProfiles({ location: 'x', voiceProfiles: [noir], activeVoiceId: 'deleted-id' })
    expect(patch?.activeVoiceId).toBe(noir.id)
    expect(patch?.voiceFingerprint).toBe(noir.fingerprint)
  })
})

describe('resolveVoice', () => {
  it('uses the project default when a document names no voice', () => {
    const p = projectWith({ voiceProfiles: [noir, warm], activeVoiceId: noir.id }, { a: undefined })
    expect(resolveVoice(p, 'a')).toBe('Short declaratives.')
  })

  it("uses the document's own voice when it has one", () => {
    const p = projectWith({ voiceProfiles: [noir, warm], activeVoiceId: noir.id }, { a: warm.id })
    expect(resolveVoice(p, 'a')).toBe('Long looping sentences.')
  })

  it('falls back to the default when a document points at a deleted profile', () => {
    // Deleting a profile deliberately does not rewrite the tree, so stale ids
    // are expected — they must not resolve to an empty voice.
    const p = projectWith({ voiceProfiles: [noir], activeVoiceId: noir.id }, { a: 'gone' })
    expect(resolveVoice(p, 'a')).toBe('Short declaratives.')
  })

  it('reads the legacy field for a project that has not been migrated', () => {
    const p = projectWith({ voiceFingerprint: 'Legacy voice.' }, { a: undefined })
    expect(resolveVoice(p, 'a')).toBe('Legacy voice.')
  })

  it('returns empty rather than throwing with no project or no voice', () => {
    expect(resolveVoice(null)).toBe('')
    expect(resolveVoice(projectWith({}))).toBe('')
  })

  it('survives an active id that matches nothing', () => {
    const p = projectWith({ voiceProfiles: [noir, warm], activeVoiceId: 'nope' })
    expect(resolveVoice(p)).toBe(noir.fingerprint)
    expect(voiceProfileFor(p)?.id).toBe(noir.id)
  })
})

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
