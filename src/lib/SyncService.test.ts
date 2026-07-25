import { describe, it, expect, beforeEach } from 'vitest'
import { syncService } from './SyncService'
import { buildProjectFromTemplate } from '@shared/templates'

const proj = () => buildProjectFromTemplate('T', 'novel', '/tmp')

beforeEach(() => { localStorage.clear() })

describe('syncService', () => {
  it('mints a device id once and reuses it', () => {
    const a = syncService.deviceId()
    const b = syncService.deviceId()
    expect(a).toBe(b)
    expect(a).toMatch(/^dev-/)
  })

  it('returns a fresh empty log for an unknown project', () => {
    const log = syncService.getLog('nope')
    expect(log.lastSyncAt).toBeNull()
    expect(log.baseRev).toBe(0)
    expect(log.baseDocHashes).toEqual({})
  })

  it('markSynced records an ancestor that round-trips', () => {
    const p = proj()
    const saved = syncService.markSynced(p)
    expect(saved.lastSyncAt).not.toBeNull()
    expect(Object.keys(saved.baseDocHashes).length).toBe(Object.keys(p.docs).length)
    const loaded = syncService.getLog(p.id)
    expect(loaded).toEqual(saved)
  })

  it('falls back to an empty log rather than throwing on corrupt prefs', () => {
    const p = proj()
    localStorage.setItem(`sync:log:${p.id}`, '{{{ not json')
    expect(() => syncService.getLog(p.id)).not.toThrow()
    expect(syncService.getLog(p.id).baseRev).toBe(0)
  })

  it('clearLog forgets the ancestor', () => {
    const p = proj()
    syncService.markSynced(p)
    syncService.clearLog(p.id)
    expect(syncService.getLog(p.id).lastSyncAt).toBeNull()
  })

  it('logs are per-project', () => {
    const a = proj(), b = proj()
    syncService.markSynced(a)
    expect(syncService.getLog(a.id).lastSyncAt).not.toBeNull()
    expect(syncService.getLog(b.id).lastSyncAt).toBeNull()
  })
})
