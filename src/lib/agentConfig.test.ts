import { describe, it, expect } from 'vitest'
import { resolveConfigSlot, configDocId, isConfigDocId, CONFIG_TARGETS } from './agentConfig'
import type { Project, ProjectSettings } from '@shared/types'

function proj(settings: Partial<ProjectSettings>): Project {
  return {
    schemaVersion: 2, id: 'p', title: 'P', created: '', modified: '',
    rootIds: [], trashId: null, nodes: {}, docs: {},
    settings: { location: 'x', ...settings },
  }
}

const voice = (id: string, name: string, fingerprint: string) =>
  ({ id, name, fingerprint, createdAt: '', modifiedAt: '' })

describe('resolveConfigSlot — the boundary', () => {
  const deps = { project: proj({}), globalInstructions: 'be terse' }

  it('refuses anything not on the whitelist', () => {
    for (const forbidden of ['apiKey', 'anthropicKey', 'model', 'provider', 'chatMaxTokens', 'openaiBaseUrl', '']) {
      const out = resolveConfigSlot(forbidden, undefined, deps)
      expect(out, forbidden).toHaveProperty('error')
    }
  })

  it('names the editable targets in its refusal, so the model can correct itself', () => {
    const out = resolveConfigSlot('apiKey', undefined, deps)
    expect('error' in out && out.error).toContain('project-instructions')
    expect('error' in out && out.error).toMatch(/API keys/i)
  })

  it('does not treat a target as editable just because it looks close', () => {
    expect(resolveConfigSlot('instructions', undefined, deps)).toHaveProperty('error')
    expect(resolveConfigSlot('PROJECT-INSTRUCTIONS', undefined, deps)).toHaveProperty('error')
  })

  it('reads global instructions from the caller, not from a store', () => {
    const out = resolveConfigSlot('global-instructions', undefined, deps)
    expect(out).toMatchObject({ target: 'global-instructions', current: 'be terse' })
  })

  it('reads project instructions', () => {
    const out = resolveConfigSlot('project-instructions', undefined, {
      ...deps, project: proj({ aiInstructions: 'Mara is 31.' }),
    })
    expect(out).toMatchObject({ current: 'Mara is 31.' })
  })

  it('needs an open project for project-scoped targets', () => {
    expect(resolveConfigSlot('project-instructions', undefined, { ...deps, project: null })).toHaveProperty('error')
    expect(resolveConfigSlot('voice', undefined, { ...deps, project: null })).toHaveProperty('error')
  })
})

describe('resolveConfigSlot — voice profiles', () => {
  const a = voice('v1', 'Noir', 'Short declaratives.')
  const b = voice('v2', 'Warm', 'Long sentences.')
  const deps = { project: proj({ voiceProfiles: [a, b], activeVoiceId: 'v2' }), globalInstructions: '' }

  it('defaults to the active profile when no key is given', () => {
    expect(resolveConfigSlot('voice', undefined, deps)).toMatchObject({ key: 'v2', current: 'Long sentences.' })
  })

  it('finds a profile by name, case-insensitively', () => {
    expect(resolveConfigSlot('voice', 'noir', deps)).toMatchObject({ key: 'v1' })
    expect(resolveConfigSlot('voice', 'NOIR', deps)).toMatchObject({ key: 'v1' })
  })

  it('finds a profile by id', () => {
    expect(resolveConfigSlot('voice', 'v1', deps)).toMatchObject({ key: 'v1' })
  })

  it('resolves to an id even when asked by name, so applying survives a rename', () => {
    const out = resolveConfigSlot('voice', 'Noir', deps)
    expect('key' in out && out.key).toBe('v1')
  })

  it('lists what exists when the name is wrong', () => {
    const out = resolveConfigSlot('voice', 'Gothic', deps)
    expect('error' in out && out.error).toContain('Noir')
    expect('error' in out && out.error).toContain('Warm')
  })

  it('says so when the project has no profiles at all', () => {
    const out = resolveConfigSlot('voice', undefined, { ...deps, project: proj({}) })
    expect('error' in out && out.error).toMatch(/no voice profiles/i)
  })
})

describe('resolveConfigSlot — prompts', () => {
  const deps = { project: proj({}), globalInstructions: '' }

  it('requires an id and says what one looks like', () => {
    const out = resolveConfigSlot('prompt', undefined, deps)
    expect('error' in out && out.error).toContain('builtin:')
  })

  it('rejects an unknown prompt id', () => {
    expect(resolveConfigSlot('prompt', 'builtin:nope', deps)).toHaveProperty('error')
  })

  it('reads a real prompt template', () => {
    const out = resolveConfigSlot('prompt', 'builtin:inline:rewrite', deps)
    expect(out).not.toHaveProperty('error')
    expect('current' in out && out.current.length).toBeGreaterThan(20)
  })
})

describe('configDocId', () => {
  it('namespaces so a setting can never be mistaken for a node', () => {
    expect(configDocId({ target: 'voice', key: 'v1' })).toBe('config:voice:v1')
    expect(configDocId({ target: 'global-instructions' })).toBe('config:global-instructions')
    expect(isConfigDocId('config:voice:v1')).toBe(true)
    expect(isConfigDocId('scene-abc-1')).toBe(false)
  })

  it('produces a distinct id per target, so two pending changes do not collide', () => {
    const ids = CONFIG_TARGETS.map((t) => configDocId({ target: t, key: 'k' }))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
