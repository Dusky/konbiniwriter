import { describe, it, expect } from 'vitest'
import { slimManifest, adoptSidecars, serializeCodex } from './bundle'
import { buildProjectFromTemplate } from './templates'
import type { Project, CodexEntry, DebtItem } from './types'

const proj = (): Project => buildProjectFromTemplate('T', 'novel', '/tmp')
const entry = (id: string): CodexEntry => ({ id, name: id, category: 'character', aliases: [], facts: [], notes: '' } as unknown as CodexEntry)
const item = (id: string): DebtItem => ({ id, layer: 'canon', title: id, detail: '', source: '', affected: [], createdAt: '' })

describe('slimManifest', () => {
  it('keeps codex/debt out of the manifest so they can only live in sidecars', () => {
    const p = proj()
    p.settings.codex = [entry('a')]
    p.settings.debt = [item('d')]
    const out = slimManifest(p) as { settings: Record<string, unknown> }
    expect('codex' in out.settings).toBe(false)
    expect('debt' in out.settings).toBe(false)
    // ...but the live project object is untouched.
    expect(p.settings.codex).toHaveLength(1)
  })

  it('strips snapshot content (prose lives in files, not the manifest)', () => {
    const p = proj()
    const id = Object.values(p.nodes).find((n) => n.type !== 'folder')!.id
    p.docs[id].snapshots = [{ id: 's1', title: '', takenAt: '', content: 'long prose', words: 2 }]
    const out = slimManifest(p) as { docs: Record<string, { snapshots: Array<{ content: string }> }> }
    expect(out.docs[id].snapshots[0].content).toBe('')
  })
})

describe('adoptSidecars', () => {
  it('a sidecar on disk wins over stale inline manifest data', () => {
    const p = proj()
    p.settings.codex = [entry('stale')]
    const owed = adoptSidecars(p, serializeCodex([entry('fresh')]), null)
    expect((p.settings.codex as CodexEntry[])[0].id).toBe('fresh')
    expect(owed).toBe(false)   // sidecar already exists — nothing owed
  })

  it('reports a migration owed when data exists only inline', () => {
    const p = proj()
    p.settings.codex = [entry('legacy')]
    expect(adoptSidecars(p, null, null)).toBe(true)
    expect((p.settings.codex as CodexEntry[])[0].id).toBe('legacy')  // preserved, not dropped
  })

  it('owes nothing for an empty project and normalises to arrays', () => {
    const p = proj()
    delete p.settings.codex
    delete p.settings.debt
    expect(adoptSidecars(p, null, null)).toBe(false)
    expect(p.settings.codex).toEqual([])
    expect(p.settings.debt).toEqual([])
  })

  it('survives corrupt sidecar JSON by falling back instead of throwing', () => {
    const p = proj()
    p.settings.debt = [item('kept')]
    expect(() => adoptSidecars(p, '{not json', 'also broken')).not.toThrow()
    expect((p.settings.debt as DebtItem[])[0].id).toBe('kept')
  })
})
