// The registry is invariant 3's machinery: every prompt and agent must be
// editable, and an edit must survive a reload. What's worth pinning is the
// override stack — a user edit shadows the builtin without replacing it, and
// resetting brings the builtin back rather than leaving a hole.

import { describe, it, expect, beforeEach } from 'vitest'
import { PromptRegistry, AgentRegistry, promptRegistry } from './PromptRegistry'
import type { PromptTemplate } from '@shared/types'

const clearStore = () => {
  window.api.prefs.remove('konbini:promptRegistry')
  window.api.prefs.remove('konbini:agentRegistry')
}

const BUILTIN = 'builtin:inline:rewrite'

describe('PromptRegistry', () => {
  beforeEach(clearStore)

  it('ships the builtins with no stored overrides', () => {
    const r = new PromptRegistry()
    expect(r.get(BUILTIN)?.isBuiltin).toBe(true)
    expect(r.all().length).toBeGreaterThan(20)
  })

  it('returns null for an id it has never heard of', () => {
    expect(new PromptRegistry().get('builtin:nope')).toBeNull()
  })

  it('shadows a builtin with the user\'s edit', () => {
    const r = new PromptRegistry()
    const edited = { ...(r.get(BUILTIN) as PromptTemplate), template: 'MY VERSION {{selection}}' }
    r.save(edited)
    expect(r.get(BUILTIN)?.template).toBe('MY VERSION {{selection}}')
    expect(r.all().find((p) => p.id === BUILTIN)?.template).toBe('MY VERSION {{selection}}')
  })

  it('persists the edit, so a reload keeps it', () => {
    const r = new PromptRegistry()
    r.save({ ...(r.get(BUILTIN) as PromptTemplate), template: 'PERSISTED' })
    expect(new PromptRegistry().get(BUILTIN)?.template).toBe('PERSISTED')
  })

  it('stamps modifiedAt on save', () => {
    const r = new PromptRegistry()
    const before = r.get(BUILTIN) as PromptTemplate
    r.save({ ...before, modifiedAt: '1999-01-01T00:00:00.000Z' })
    expect(r.get(BUILTIN)?.modifiedAt).not.toBe('1999-01-01T00:00:00.000Z')
  })

  it('reset restores the builtin rather than deleting the prompt', () => {
    const r = new PromptRegistry()
    const original = r.get(BUILTIN)?.template
    r.save({ ...(r.get(BUILTIN) as PromptTemplate), template: 'CHANGED' })
    r.reset(BUILTIN)
    expect(r.get(BUILTIN)?.template).toBe(original)
    expect(new PromptRegistry().get(BUILTIN)?.template).toBe(original)
  })

  it('refuses to delete a builtin — nothing may leave the app without one', () => {
    const r = new PromptRegistry()
    r.delete(BUILTIN)
    expect(r.get(BUILTIN)).not.toBeNull()
  })

  it('filters by feature', () => {
    const r = new PromptRegistry()
    const inline = r.all('inline')
    expect(inline.length).toBeGreaterThan(0)
    expect(inline.every((p) => p.feature === 'inline')).toBe(true)
  })

  describe('duplicate', () => {
    it('makes an editable copy that points back at its source', () => {
      const r = new PromptRegistry()
      const copy = r.duplicate(BUILTIN)!
      expect(copy.id).not.toBe(BUILTIN)
      expect(copy.isBuiltin).toBe(false)
      expect(copy.parentId).toBe(BUILTIN)
      expect(copy.name).toContain('(copy)')
      expect(r.get(copy.id)?.template).toBe(r.get(BUILTIN)?.template)
    })

    it('lists the copy — a prompt you can create but never see is not editable', () => {
      const r = new PromptRegistry()
      const copy = r.duplicate(BUILTIN)!
      expect(r.all().map((p) => p.id)).toContain(copy.id)
      expect(r.all(copy.feature).map((p) => p.id)).toContain(copy.id)
    })

    it('can be deleted, unlike a builtin', () => {
      const r = new PromptRegistry()
      const copy = r.duplicate(BUILTIN)!
      r.delete(copy.id)
      expect(r.get(copy.id)).toBeNull()
    })

    it('returns null for an unknown source', () => {
      expect(new PromptRegistry().duplicate('nope')).toBeNull()
    })
  })

  describe('render', () => {
    it('fills every occurrence of a variable', () => {
      const r = new PromptRegistry()
      r.save({ ...(r.get(BUILTIN) as PromptTemplate), template: '{{a}} then {{a}} and {{b}}' })
      expect(r.render(BUILTIN, { a: 'X', b: 'Y' })).toBe('X then X and Y')
    })

    it('renders a missing variable as empty rather than leaving the placeholder', () => {
      const r = new PromptRegistry()
      r.save({ ...(r.get(BUILTIN) as PromptTemplate), template: 'a={{a}} b={{b}}' })
      expect(r.render(BUILTIN, { a: 'X' })).toBe('a=X b=')
    })

    it('leaves a non-variable brace pair alone', () => {
      const r = new PromptRegistry()
      r.save({ ...(r.get(BUILTIN) as PromptTemplate), template: 'JSON: {{ "k": 1 }}' })
      expect(r.render(BUILTIN, {})).toBe('JSON: {{ "k": 1 }}')
    })

    it('throws for a prompt that does not exist, rather than sending an empty one', () => {
      expect(() => new PromptRegistry().render('nope', {})).toThrow(/not found/i)
    })
  })

  it('every builtin declares the variables its template uses', () => {
    // A prompt whose {{var}} isn't declared renders empty at runtime and the
    // failure looks like a bad model rather than a bad template.
    const missing: string[] = []
    for (const p of promptRegistry.all()) {
      const used = new Set([...p.template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string))
      const declared = new Set(p.variables.map((v) => v.name))
      for (const u of used) if (!declared.has(u)) missing.push(`${p.id}:${u}`)
    }
    expect(missing).toEqual([])
  })

  it('every builtin prompt id is unique', () => {
    const ids = promptRegistry.all().map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('AgentRegistry', () => {
  beforeEach(clearStore)

  it('lists the builtin agents', () => {
    expect(new AgentRegistry().all().length).toBeGreaterThan(0)
  })

  it('shadows a builtin agent and keeps it listed once', () => {
    const r = new AgentRegistry()
    const first = r.all()[0]!
    const before = r.all().length
    r.save({ ...first, temperature: 0.123 })
    expect(r.get(first.id)?.temperature).toBe(0.123)
    expect(r.all().length).toBe(before)
  })

  it('lists a user-created agent alongside the builtins', () => {
    const r = new AgentRegistry()
    const copy = r.duplicate(r.all()[0]!.id)!
    expect(r.all().map((a) => a.id)).toContain(copy.id)
  })

  it('groups by category', () => {
    const readers = new AgentRegistry().byCategory('reader')
    expect(readers.length).toBeGreaterThan(0)
    expect(readers.every((a) => a.category === 'reader')).toBe(true)
  })

  it('survives a reload', () => {
    const r = new AgentRegistry()
    const first = r.all()[0]!
    r.save({ ...first, name: 'Renamed' })
    expect(new AgentRegistry().get(first.id)?.name).toBe('Renamed')
  })

  it('every reader agent points at a prompt that exists', () => {
    for (const a of new AgentRegistry().byCategory('reader')) {
      expect(promptRegistry.get(a.systemPromptId)).not.toBeNull()
    }
  })
})
