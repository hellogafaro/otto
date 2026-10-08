import { expect, it } from 'bun:test'
import { openDb } from '../db/index'
import { pushSchema } from '../db/push'
import { createLibraryStore } from './index'
import type { FileStore } from './file-store'

it('bounded Library reads cancel stalled streams and reject actual bytes beyond metadata', async () => {
  const db = openDb(':memory:')
  await pushSchema(db)
  let cancelled = 0, stalled = true
  const store: FileStore = {
    put: async () => {}, stage: async () => ({ commit: async () => {}, discard: async () => {} }), get: async () => { throw new Error('Unbounded reads must not run') }, delete: async () => {}, list: async () => [],
    open: async () => ({ size: 3, stream: new ReadableStream({ start(controller) { if (!stalled) { controller.enqueue(new Uint8Array(8)); controller.close() } }, cancel() { cancelled++ } }) }),
  }
  const lib = createLibraryStore(db, () => store)
  try {
    const item = await lib.createLibraryItem({ workspaceId: 'fixture', title: 'text.txt', mime: 'text/plain', bytes: new Uint8Array([65, 66, 67]), createdBy: 'user:aaaaaaaaaaaa' })
    const abort = new AbortController()
    const pending = lib.readLibraryContent('fixture', item.id, { maxBytes: 4, signal: abort.signal })
    await Bun.sleep(5)
    abort.abort()
    await expect(pending).rejects.toThrow()
    expect(cancelled).toBe(1)
    stalled = false
    await expect(lib.readLibraryContent('fixture', item.id, { maxBytes: 4, signal: new AbortController().signal })).rejects.toThrow('input limit')
    await expect(lib.readLibraryContent('foreign', item.id, { maxBytes: 4, signal: new AbortController().signal })).rejects.toThrow('does not exist')
  } finally { db.$client.close() }
})
