// HistoryService decides when a version gets captured behind the author's back.
// Both halves of the throttle matter: too eager and History fills with noise,
// too lazy and the safety net has holes. Neither is visible until you look.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { historyService } from './HistoryService'
import { useProjectStore } from '../store/projectStore'
import { useShellStore } from '../store/shellStore'
import type { KNode, Project, Snapshot } from '@shared/types'

const WORD_DELTA = 30
const MIN_INTERVAL_MS = 3 * 60 * 1000

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

const node = (id: string, title: string): KNode => ({
  id, type: 'scene', title, parentId: null, childIds: [], expanded: true,
  meta: { label: 'scene', status: 'draft', synopsis: '', target: 0, includeInCompile: true, keywords: [] },
  ext: {}, rev: 1, modified: '',
})

const project = (): Project => ({
  schemaVersion: 2, id: 'p', title: 'Book', created: '', modified: '',
  rootIds: ['a'], trashId: 'trash',
  nodes: { a: node('a', 'A'), trash: { ...node('trash', 'Trash'), type: 'folder' } },
  docs: { a: { content: '', snapshots: [] } },
  settings: { location: '' },
} as Project)

let taken: Array<{ nodeId: string; kind: string }>
let deleted: string[]
let now: number

beforeEach(() => {
  taken = []
  deleted = []
  now = Date.parse('2026-07-29T12:00:00Z')
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  useProjectStore.getState().loadProject(project())
  useShellStore.setState({ autoVersion: true, historyRetentionDays: 0 })
  window.api.snapshot.take = (async (_pid: string, nodeId: string, title = '', kind = 'manual') => {
    taken.push({ nodeId, kind })
    const snap: Snapshot = {
      id: `s${taken.length}`, title, takenAt: new Date(now).toISOString(),
      content: '', words: 0, kind: kind as 'manual' | 'auto',
    }
    return snap
  }) as typeof window.api.snapshot.take
  window.api.snapshot.delete = (async (_p: string, _n: string, id: string) => { deleted.push(id) }) as typeof window.api.snapshot.delete
  // Each test starts from a service that has never seen these documents.
  ;(historyService as unknown as { tracks: Map<string, unknown> }).tracks.clear()
})

/**
 * The first save of a document only establishes the baseline — opening a
 * 90,000-word manuscript must not immediately snapshot every scene you touch.
 * Tests that care about a *change* prime the tracker first, the way the app
 * does on the document's first autosave.
 */
const prime = (nodeId = 'a') => historyService.maybeCapture('p', nodeId, '')

describe('maybeCapture', () => {
  it('does nothing on the first save — that only sets the baseline', async () => {
    // Otherwise opening a long manuscript would snapshot every scene at once.
    await historyService.maybeCapture('p', 'a', words(5000))
    expect(taken).toEqual([])
  })

  it('does nothing while the document has barely moved', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(WORD_DELTA - 1))
    expect(taken).toEqual([])
  })

  it('captures once the word delta is crossed', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(WORD_DELTA + 5))
    expect(taken).toEqual([{ nodeId: 'a', kind: 'auto' }])
  })

  it('files the version as auto, so it is prunable and manual saves are not', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(60))
    expect(taken[0]?.kind).toBe('auto')
  })

  it('adds the snapshot to the store, so History shows it without a reload', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(60))
    expect(useProjectStore.getState().project!.docs.a!.snapshots).toHaveLength(1)
  })

  it('will not capture twice inside the interval, however much is written', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(60))
    now += 1000
    await historyService.maybeCapture('p', 'a', words(500))
    expect(taken).toHaveLength(1)
  })

  it('captures again once the interval has passed', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(60))
    now += MIN_INTERVAL_MS + 1
    await historyService.maybeCapture('p', 'a', words(200))
    expect(taken).toHaveLength(2)
  })

  it('measures drift from the last capture, not from zero', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(60))
    now += MIN_INTERVAL_MS + 1
    // Only 5 words on from the baseline — under the threshold.
    await historyService.maybeCapture('p', 'a', words(65))
    expect(taken).toHaveLength(1)
  })

  it('captures a large deletion too — losing 200 words is worth a rollback point', async () => {
    await prime()
    await historyService.maybeCapture('p', 'a', words(200))
    now += MIN_INTERVAL_MS + 1
    await historyService.maybeCapture('p', 'a', words(10))
    expect(taken).toHaveLength(2)
  })

  it('tracks documents independently', async () => {
    await prime('a'); await prime('b')
    await historyService.maybeCapture('p', 'a', words(60))
    await historyService.maybeCapture('p', 'b', words(60))
    expect(taken.map((t) => t.nodeId)).toEqual(['a', 'b'])
  })

  it('does nothing at all when auto-versioning is switched off', async () => {
    useShellStore.setState({ autoVersion: false })
    await prime()
    await historyService.maybeCapture('p', 'a', words(500))
    expect(taken).toEqual([])
  })

  it('swallows a failed capture rather than breaking the save that triggered it', async () => {
    await prime()
    window.api.snapshot.take = (async () => { throw new Error('disk full') }) as typeof window.api.snapshot.take
    await expect(historyService.maybeCapture('p', 'a', words(60))).resolves.toBeUndefined()
  })
})

describe('retention', () => {
  const stale = (id: string, kind: 'auto' | 'manual' | undefined, ageDays: number): Snapshot => ({
    id, title: '', takenAt: new Date(now - ageDays * 86_400_000).toISOString(),
    content: '', words: 0, ...(kind ? { kind } : {}),
  })

  it('keeps everything when retention is off', async () => {
    useShellStore.setState({ historyRetentionDays: 0 })
    await prime()
    useProjectStore.getState().addSnapshot('a', stale('old', 'auto', 90))
    await historyService.maybeCapture('p', 'a', words(60))
    expect(deleted).toEqual([])
  })

  it('drops auto versions past the window', async () => {
    useShellStore.setState({ historyRetentionDays: 30 })
    await prime()
    useProjectStore.getState().addSnapshot('a', stale('old', 'auto', 90))
    await historyService.maybeCapture('p', 'a', words(60))
    expect(deleted).toEqual(['old'])
    expect(useProjectStore.getState().project!.docs.a!.snapshots.map((s) => s.id)).not.toContain('old')
  })

  it('never drops a manual snapshot — those are the author\'s save points', async () => {
    useShellStore.setState({ historyRetentionDays: 30 })
    await prime()
    useProjectStore.getState().addSnapshot('a', stale('named', 'manual', 90))
    await historyService.maybeCapture('p', 'a', words(60))
    expect(deleted).toEqual([])
  })

  it('never drops a kind-less snapshot from an older bundle', async () => {
    useShellStore.setState({ historyRetentionDays: 30 })
    await prime()
    useProjectStore.getState().addSnapshot('a', stale('legacy', undefined, 90))
    await historyService.maybeCapture('p', 'a', words(60))
    expect(deleted).toEqual([])
  })

  it('keeps auto versions still inside the window', async () => {
    useShellStore.setState({ historyRetentionDays: 30 })
    await prime()
    useProjectStore.getState().addSnapshot('a', stale('recent', 'auto', 5))
    await historyService.maybeCapture('p', 'a', words(60))
    expect(deleted).toEqual([])
  })
})
