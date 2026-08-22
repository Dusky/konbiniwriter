// An in-memory File System Access API, good enough to run the two browser
// project backends against real code paths in a unit test.
//
// Why this exists: `BrowserProjectService` (Chrome/Edge, real disk) and
// `OPFSProjectService` (Firefox/Safari) had no unit tests at all — they were
// covered only by `scripts/smoke.mjs`, which drives OPFS in a real browser, so
// a change that broke the FSA backend and not the others had nothing to fail.
// Both talk to the same handle interface, so one fake serves both: the FSA
// backend receives it from a stubbed `showDirectoryPicker`, the OPFS backend
// from a stubbed `navigator.storage.getDirectory`.
//
// It implements only what the services actually call — getDirectoryHandle,
// getFileHandle, createWritable, getFile, removeEntry, entries — and throws the
// same `NotFoundError` the browser does, because `readText` distinguishing
// "absent" from "broken" by catching that is part of the contract.

/** Monotonic, so `probe()`'s mtime comparisons are deterministic under a fast clock. */
let clock = 1_700_000_000_000
const tick = () => ++clock

function notFound(name: string): DOMException {
  return new DOMException(`A requested file or directory could not be found: ${name}`, 'NotFoundError')
}
function mismatch(name: string): DOMException {
  return new DOMException(`The path supplied exists, but was not an entry of the requested type: ${name}`, 'TypeMismatchError')
}

class MemFileHandle {
  readonly kind = 'file' as const
  data = ''
  lastModified = tick()
  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    const { data, name, lastModified } = this
    // Enough of File for the callers: text() and lastModified. Not a real File —
    // node has one, but constructing it per read would lose the mtime we control.
    return {
      name,
      lastModified,
      size: data.length,
      text: async () => data,
      arrayBuffer: async () => new TextEncoder().encode(data).buffer,
    } as unknown as File
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let buf = ''
    const self = this
    return {
      async write(chunk: unknown) {
        buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as ArrayBuffer)
      },
      async close() { self.data = buf; self.lastModified = tick() },
      async abort() { /* discard */ },
    } as unknown as FileSystemWildcardStream
  }
}

// The writable stream type in lib.dom is wider than we need; alias it so the
// cast above stays honest about being partial.
type FileSystemWildcardStream = FileSystemWritableFileStream

export class MemDirectoryHandle {
  readonly kind = 'directory' as const
  private children = new Map<string, MemDirectoryHandle | MemFileHandle>()
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDirectoryHandle> {
    const found = this.children.get(name)
    if (found) {
      if (found.kind !== 'directory') throw mismatch(name)
      return found
    }
    if (!opts?.create) throw notFound(name)
    const dir = new MemDirectoryHandle(name)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFileHandle> {
    const found = this.children.get(name)
    if (found) {
      if (found.kind !== 'file') throw mismatch(name)
      return found
    }
    if (!opts?.create) throw notFound(name)
    const file = new MemFileHandle(name)
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const found = this.children.get(name)
    if (!found) throw notFound(name)
    if (found.kind === 'directory' && found.children.size > 0 && !opts?.recursive) {
      throw new DOMException(`The object can not be modified in this way: ${name}`, 'InvalidModificationError')
    }
    this.children.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, MemDirectoryHandle | MemFileHandle]> {
    for (const entry of [...this.children.entries()]) yield entry
  }
  async *keys(): AsyncIterableIterator<string> {
    for (const key of [...this.children.keys()]) yield key
  }
  async *values(): AsyncIterableIterator<MemDirectoryHandle | MemFileHandle> {
    for (const value of [...this.children.values()]) yield value
  }
  [Symbol.asyncIterator]() { return this.entries() }

  // FSA permission methods — a picked handle in a real browser answers 'granted'
  // for the session. Tests that care about denial override these.
  async queryPermission(): Promise<PermissionState> { return 'granted' }
  async requestPermission(): Promise<PermissionState> { return 'granted' }

  // ── test-side helpers (not part of the FSA interface) ─────────────────────

  /** Read a file by slash-separated path, or null if any segment is missing. */
  async readPath(path: string): Promise<string | null> {
    const parts = path.split('/').filter(Boolean)
    let dir: MemDirectoryHandle = this
    try {
      for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
      const fh = await dir.getFileHandle(parts[parts.length - 1])
      return fh.data
    } catch { return null }
  }

  /** True if anything — file or directory — exists at this path. */
  async has(path: string): Promise<boolean> {
    const parts = path.split('/').filter(Boolean)
    let dir: MemDirectoryHandle = this
    try {
      for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
      const last = parts[parts.length - 1]
      return dir.children.has(last)
    } catch { return false }
  }

  /** Every file path under this directory, sorted — for asserting on layout. */
  async paths(prefix = ''): Promise<string[]> {
    const out: string[] = []
    for (const [name, entry] of this.children) {
      const p = prefix ? `${prefix}/${name}` : name
      if (entry.kind === 'file') out.push(p)
      else out.push(...await entry.paths(p))
    }
    return out.sort()
  }
}

/** A fresh, empty root directory handle. */
export function memRoot(name = 'Documents'): MemDirectoryHandle {
  return new MemDirectoryHandle(name)
}
