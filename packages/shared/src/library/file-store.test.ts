import { afterEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiskFileStore, getLibraryItemPath } from './file-store.ts'
import { getLibraryStore } from './storage.ts'

const dirs: string[] = []
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'otto-file-store-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('put, get, open and delete round-trip the bytes', async () => {
  const root = join(await tempDir(), 'files')
  const store = createDiskFileStore(root)
  const key = crypto.randomUUID()
  expect(await store.get(key)).toBeUndefined()
  expect(await store.open(key)).toBeUndefined()

  await store.put(key, new Uint8Array([1, 2, 3]))
  expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]))
  const opened = await store.open(key)
  expect(opened?.size).toBe(3)
  expect(new Uint8Array(await new Response(opened!.stream).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

  await store.delete(key)
  expect(await store.get(key)).toBeUndefined()
  await store.delete(key)
})

test('put replaces atomically and leaves no temp file', async () => {
  const root = await tempDir()
  const store = createDiskFileStore(root)
  const key = crypto.randomUUID()
  await store.put(key, new Uint8Array([1]))
  await store.put(key, new Uint8Array([2, 2]))
  expect(await store.get(key)).toEqual(new Uint8Array([2, 2]))
  expect(await readdir(root)).toEqual([key])
})

test('a staged file replaces the key only when committed, and discard leaves it alone', async () => {
  const root = await tempDir()
  const store = createDiskFileStore(root)
  const key = crypto.randomUUID()
  await store.put(key, new Uint8Array([1]))

  const dropped = await store.stage(key, new Uint8Array([2]))
  expect(await store.get(key)).toEqual(new Uint8Array([1]))
  expect((await readdir(root)).sort()).toHaveLength(2)
  await dropped.discard()
  expect(await readdir(root)).toEqual([key])

  const kept = await store.stage(key, new Uint8Array([3, 3]))
  expect(await store.get(key)).toEqual(new Uint8Array([1]))
  await kept.commit()
  expect(await store.get(key)).toEqual(new Uint8Array([3, 3]))
  expect(await readdir(root)).toEqual([key])
})

test('keys that are not ids are rejected before touching the disk', async () => {
  const root = await tempDir()
  const store = createDiskFileStore(root)
  for (const key of ['../escape', 'a/b', '', 'ABCDEFGHIJKL', 'short', `${crypto.randomUUID()}.tmp`, '/etc/passwd']) {
    await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow('Invalid file key')
    await expect(store.get(key)).rejects.toThrow('Invalid file key')
    await expect(store.open(key)).rejects.toThrow('Invalid file key')
    await expect(store.delete(key)).rejects.toThrow('Invalid file key')
  }
  expect(await readdir(root)).toEqual([])
})

test('the library store lives under <workspace>/library and the item path matches it', async () => {
  const root = await tempDir()
  const id = crypto.randomUUID()
  await getLibraryStore(root, 'ws1').put(id, new Uint8Array([7]))
  expect(getLibraryItemPath(root, id)).toBe(join(root, 'library', id))
  expect(existsSync(getLibraryItemPath(root, id))).toBe(true)
  expect(() => getLibraryItemPath(root, '../x')).toThrow('Invalid file key')
})
