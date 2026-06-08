// HandleStore — persists FileSystemDirectoryHandle objects in IndexedDB so that
// "Recent Projects" can reopen a bundle directly on Chrome/Edge (File System
// Access) instead of forcing the user back through the folder picker.
//
// FSA handles are structured-cloneable, so IndexedDB can store them across
// sessions. Permission is NOT persisted — on reopen we must re-request it from
// within a user gesture (the recent-row click). OPFS and Electron don't need
// this: they reopen by location string directly.

const DB_NAME = 'konbini'
const STORE = 'projectHandles'

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      })
  )
}

export const handleStore = {
  async put(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
    if (!hasIDB()) return
    try { await tx('readwrite', (s) => s.put(handle, id)) } catch { /* best-effort */ }
  },

  async get(id: string): Promise<FileSystemDirectoryHandle | undefined> {
    if (!hasIDB()) return undefined
    try { return (await tx<FileSystemDirectoryHandle>('readonly', (s) => s.get(id))) ?? undefined }
    catch { return undefined }
  },

  async del(id: string): Promise<void> {
    if (!hasIDB()) return
    try { await tx('readwrite', (s) => s.delete(id)) } catch { /* best-effort */ }
  },
}
