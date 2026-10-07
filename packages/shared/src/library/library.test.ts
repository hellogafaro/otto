import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createDiskFileStore } from './file-store.ts'
import { CHAT_ATTACHMENTS_FOLDER_TITLE, createLibraryStore, type LibraryErrorCode } from './index.ts'
import { isDomainError } from '../utils/errors.ts'
import { MAX_FILE_BYTES, MAX_FOLDER_DEPTH } from './limits.ts'
import { library } from './schema.ts'

const W = 'ws1'
const ME = 'user:aaaaaaaaaaaa'
const OTHER = 'ws2'
const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  const dir = await mkdtemp(join(tmpdir(), 'otto-library-'))
  dirs.push(dir)
  const lib = createLibraryStore(db, (workspaceId) => createDiskFileStore(join(dir, workspaceId)))
  return { db, dir, lib }
}

async function failsWith(code: LibraryErrorCode, run: () => unknown) {
  const error = await Promise.resolve()
    .then(run)
    .then(() => undefined, (e: unknown) => e)
  expect(isDomainError(error) && error.code).toBe(code)
}

const stored = async (dir: string, workspaceId: string) => readdir(join(dir, workspaceId)).catch(() => [])

test('create stores the bytes under the id and the row without them', async () => {
  const { lib, dir } = await setup()
  const item = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'pic.png', mime: 'image/png', bytes: bytes(1, 2, 3) })
  expect(item.id).toMatch(/^[0-9a-z]{12}$/)
  expect(item).toMatchObject({ type: 'file', title: 'pic.png', mime: 'image/png', size: 3, parentId: null, createdBy: ME })
  expect(item.createdAt).toBe(item.updatedAt)
  expect(await lib.readLibraryContent(W, item.id)).toEqual(bytes(1, 2, 3))
  expect(await stored(dir, W)).toEqual([item.id])
  expect(lib.getLibraryItem(W, item.id)).toEqual(item)
})

test('type is derived from the mime or the name', async () => {
  const { lib } = await setup()
  const make = (title: string, mime: string) => lib.createLibraryItem({ createdBy: ME, workspaceId: W, title, mime, bytes: bytes(1) })
  expect((await make('a.bin', 'application/octet-stream')).type).toBe('file')
  expect((await make('notes', 'text/markdown')).type).toBe('document')
  expect((await make('README.MD', 'text/plain')).type).toBe('document')
  expect((await make('a.txt', 'text/plain')).type).toBe('file')
  expect((await make('a.bin', '')).mime).toBe('application/octet-stream')
  expect(lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'Docs' })).toMatchObject({ type: 'folder', mime: null, size: null })
})

test('createdBy is kept and filters the list', async () => {
  const { lib } = await setup()
  const mine = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'text/plain', bytes: bytes(1) })
  const agent = await lib.createLibraryItem({ workspaceId: W, title: 'c', mime: 'text/plain', bytes: bytes(1), createdBy: 'agent:default' })
  expect(agent.createdBy).toBe('agent:default')
  expect(lib.getLibraryItems(W, { createdBy: 'agent:default' }).map((item) => item.id)).toEqual([agent.id])
  expect(lib.getLibraryItems(W, { createdBy: ME }).map((item) => item.id)).toEqual([mine.id])
})

test('the chat attachments folder is a plain root folder, made once per workspace', async () => {
  const { lib } = await setup()
  const folder = lib.initChatAttachmentsFolder(W, ME)
  expect(folder).toMatchObject({ type: 'folder', title: CHAT_ATTACHMENTS_FOLDER_TITLE, parentId: null, createdBy: ME })
  expect(lib.initChatAttachmentsFolder(W, ME)).toEqual(folder)
  expect(lib.getLibraryItems(W, { type: 'folder' })).toEqual([folder])
  const other = lib.initChatAttachmentsFolder(OTHER, ME)
  expect(other.id).not.toBe(folder.id)
  // A folder with that title deeper down is not it.
  const inner = lib.createLibraryFolder({ createdBy: ME, workspaceId: 'ws3', title: 'x' })
  lib.createLibraryFolder({ createdBy: ME, workspaceId: 'ws3', title: CHAT_ATTACHMENTS_FOLDER_TITLE, parentId: inner.id })
  expect(lib.initChatAttachmentsFolder('ws3', ME).parentId).toBeNull()
})

test('size 0 and over the limit are refused and store nothing', async () => {
  const { lib, dir } = await setup()
  await failsWith('invalid', () => lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: new Uint8Array(0) }))
  await failsWith('too_large', () => lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: new Uint8Array(MAX_FILE_BYTES + 1) }))
  await failsWith('invalid', () => lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: '  ', mime: 'x/y', bytes: bytes(1) }))
  expect(await stored(dir, W)).toEqual([])
  expect(lib.getLibraryItems(W)).toEqual([])
  const exact = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'big', mime: 'x/y', bytes: new Uint8Array(MAX_FILE_BYTES) })
  expect(exact.size).toBe(MAX_FILE_BYTES)
})

test('a failed insert removes the bytes again', async () => {
  const { db, lib, dir } = await setup()
  const item = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: bytes(1) })
  db.$client.exec('DROP TABLE library')
  await expect(lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'b', mime: 'x/y', bytes: bytes(2) })).rejects.toThrow()
  expect(await stored(dir, W)).toEqual([item.id])
})

test('parentId must be a folder of the same workspace', async () => {
  const { lib } = await setup()
  const folder = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'F' })
  const file = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: bytes(1) })
  const foreign = lib.createLibraryFolder({ createdBy: ME, workspaceId: OTHER, title: 'Elsewhere' })
  const make = (parentId: string) => lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'n', mime: 'x/y', bytes: bytes(1), parentId })
  expect((await make(folder.id)).parentId).toBe(folder.id)
  await failsWith('not_found', () => make('missing00000'))
  await failsWith('not_found', () => make(foreign.id))
  await failsWith('invalid', () => make(file.id))
  await failsWith('not_found', () => lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'x', parentId: foreign.id }))
  await failsWith('invalid', () => lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'x', parentId: file.id }))
})

test('folders nest at most MAX_FOLDER_DEPTH levels', async () => {
  const { lib } = await setup()
  let parent: string | null = null
  const ids: string[] = []
  for (let level = 1; level <= MAX_FOLDER_DEPTH; level++) {
    const folder = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: `L${level}`, parentId: parent })
    ids.push(folder.id)
    parent = folder.id
  }
  await failsWith('invalid', () => lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'too deep', parentId: parent }))
  // Files are not folder levels.
  await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: bytes(1), parentId: parent })
  expect(lib.getLibraryFolderPath(W, parent!).map((folder) => folder.id)).toEqual(ids)
})

test('moving folders refuses cycles and levels beyond the limit', async () => {
  const { lib } = await setup()
  const a = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'a' })
  const b = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'b', parentId: a.id })
  const c = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'c', parentId: b.id })
  await failsWith('invalid', () => lib.updateLibraryItem(W, a.id, { parentId: a.id }))
  await failsWith('invalid', () => lib.updateLibraryItem(W, a.id, { parentId: c.id }))
  await failsWith('invalid', () => lib.updateLibraryItem(W, b.id, { parentId: c.id }))

  // A chain of MAX_FOLDER_DEPTH - 1 folders: a 3-level tree cannot move under it.
  let parent: string | null = null
  for (let level = 1; level < MAX_FOLDER_DEPTH; level++) parent = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'd', parentId: parent }).id
  await failsWith('invalid', () => lib.updateLibraryItem(W, a.id, { parentId: parent }))
  const lone = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'lone' })
  expect((await lib.updateLibraryItem(W, lone.id, { parentId: parent })).parentId).toBe(parent)
  // Files can move anywhere that is a folder.
  const file = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'f', mime: 'x/y', bytes: bytes(1) })
  expect((await lib.updateLibraryItem(W, file.id, { parentId: c.id })).parentId).toBe(c.id)
  expect((await lib.updateLibraryItem(W, file.id, { parentId: null })).parentId).toBeNull()
  await failsWith('invalid', () => lib.updateLibraryItem(W, file.id, { parentId: file.id }))
})

test('list puts folders first, then the most recently updated, and filters', async () => {
  const { lib } = await setup()
  const tick = () => Bun.sleep(2)
  const first = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'first', mime: 'x/y', bytes: bytes(1) })
  const folder = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'F' })
  await tick()
  const second = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'second', mime: 'text/markdown', bytes: bytes(1) })
  await tick()
  const inside = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'inside', mime: 'x/y', bytes: bytes(1), parentId: folder.id })
  await tick()
  await lib.updateLibraryItem(W, first.id, { title: 'first!' })

  const titles = (items: { title: string }[]) => items.map((item) => item.title)
  expect(titles(lib.getLibraryItems(W))).toEqual(['F', 'first!', 'inside', 'second'])
  expect(titles(lib.getLibraryItems(W, { parentId: null }))).toEqual(['F', 'first!', 'second'])
  expect(titles(lib.getLibraryItems(W, { parentId: folder.id }))).toEqual(['inside'])
  expect(titles(lib.getLibraryItems(W, { type: 'document' }))).toEqual(['second'])
  expect(titles(lib.getLibraryItems(W, { type: 'folder' }))).toEqual(['F'])
  expect(lib.getLibraryItems(OTHER)).toEqual([])
  expect(inside.parentId).toBe(folder.id)
  expect(second.type).toBe('document')
})

test('rename and move bump updatedAt and keep the content', async () => {
  const { lib } = await setup()
  const folder = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'F' })
  const item = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a.txt', mime: 'text/plain', bytes: text('hi') })
  const renamed = await lib.updateLibraryItem(W, item.id, { title: 'b.txt', parentId: folder.id })
  expect(renamed).toMatchObject({ title: 'b.txt', parentId: folder.id, size: 2, createdAt: item.createdAt })
  expect(renamed.updatedAt).toBeGreaterThan(item.updatedAt)
  expect(await lib.readLibraryText(W, item.id)).toBe('hi')
  await failsWith('invalid', () => lib.updateLibraryItem(W, item.id, { title: '' }))
})

test('replacing content needs the current updatedAt and changes nothing on conflict', async () => {
  const { lib } = await setup()
  const doc = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'n.md', mime: 'text/markdown', bytes: text('one') })

  await failsWith('conflict', () => lib.updateLibraryItem(W, doc.id, { content: text('stale'), expectedUpdatedAt: doc.updatedAt - 1 }))
  await failsWith('conflict', () => lib.updateLibraryItem(W, doc.id, { content: text('blind') }))
  expect(await lib.readLibraryText(W, doc.id)).toBe('one')
  expect(lib.getLibraryItem(W, doc.id)).toEqual(doc)

  const saved = await lib.updateLibraryItem(W, doc.id, { content: text('three'), expectedUpdatedAt: doc.updatedAt })
  expect(saved.size).toBe(5)
  expect(saved.updatedAt).toBeGreaterThan(doc.updatedAt)
  expect(await lib.readLibraryText(W, doc.id)).toBe('three')

  // The first saver's updatedAt is now stale, even within the same millisecond.
  await failsWith('conflict', () => lib.updateLibraryItem(W, doc.id, { content: text('late'), expectedUpdatedAt: doc.updatedAt }))
  await failsWith('invalid', () => lib.updateLibraryItem(W, doc.id, { content: new Uint8Array(0), expectedUpdatedAt: saved.updatedAt }))
  await failsWith('too_large', () => lib.updateLibraryItem(W, doc.id, { content: new Uint8Array(MAX_FILE_BYTES + 1), expectedUpdatedAt: saved.updatedAt }))
  expect(await lib.readLibraryText(W, doc.id)).toBe('three')
})

test('two saves racing on the same updatedAt: one wins, bytes and row come from the winner', async () => {
  const { lib, dir } = await setup()
  const doc = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'n.md', mime: 'text/markdown', bytes: text('one') })
  const contents = ['first save', 'second, longer save']

  const results = await Promise.allSettled(
    contents.map((content) => lib.updateLibraryItem(W, doc.id, { content: text(content), expectedUpdatedAt: doc.updatedAt })),
  )
  const winners = results.flatMap((result, i) => (result.status === 'fulfilled' ? [{ item: result.value, content: contents[i]! }] : []))
  const losers = results.filter((result) => result.status === 'rejected')
  expect(winners).toHaveLength(1)
  expect(losers).toHaveLength(1)
  expect(((losers[0] as PromiseRejectedResult).reason as { code: string }).code).toBe('conflict')

  const { item, content } = winners[0]!
  expect(await lib.readLibraryText(W, doc.id)).toBe(content)
  expect(lib.getLibraryItem(W, doc.id)).toEqual(item)
  expect(item.size).toBe(content.length)
  expect(item.updatedAt).toBeGreaterThan(doc.updatedAt)
  expect(await stored(dir, W)).toEqual([doc.id])
})

test('a conflict or a failure while saving leaves the bytes, the row and the directory as they were', async () => {
  const { db, lib, dir } = await setup()
  const doc = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'n.md', mime: 'text/markdown', bytes: text('one') })

  await failsWith('conflict', () => lib.updateLibraryItem(W, doc.id, { content: text('stale'), expectedUpdatedAt: doc.updatedAt - 1 }))
  expect(await stored(dir, W)).toEqual([doc.id])

  // The row update itself fails: the staged bytes are dropped.
  db.$client.exec("CREATE TRIGGER no_updates BEFORE UPDATE ON library BEGIN SELECT RAISE(ABORT, 'boom'); END")
  await expect(lib.updateLibraryItem(W, doc.id, { content: text('lost'), expectedUpdatedAt: doc.updatedAt })).rejects.toThrow('boom')
  db.$client.exec('DROP TRIGGER no_updates')
  expect(await lib.readLibraryText(W, doc.id)).toBe('one')
  expect(lib.getLibraryItem(W, doc.id)).toEqual(doc)
  expect(await stored(dir, W)).toEqual([doc.id])
})

test('when the bytes cannot be moved into place the row goes back to what it was', async () => {
  const { db, dir } = await setup()
  const lib = createLibraryStore(db, (workspaceId) => {
    const store = createDiskFileStore(join(dir, workspaceId))
    return {
      ...store,
      async stage(key, content) {
        const staged = await store.stage(key, content)
        return {
          discard: staged.discard,
          commit: async () => {
            await staged.discard()
            throw new Error('disk full')
          },
        }
      },
    }
  })
  const doc = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'n.md', mime: 'text/markdown', bytes: text('one') })
  await expect(lib.updateLibraryItem(W, doc.id, { content: text('longer'), expectedUpdatedAt: doc.updatedAt })).rejects.toThrow('disk full')
  expect(lib.getLibraryItem(W, doc.id)).toEqual(doc)
  expect(await lib.readLibraryText(W, doc.id)).toBe('one')
  expect(await stored(dir, W)).toEqual([doc.id])
})

test('a folder has no content', async () => {
  const { lib } = await setup()
  const folder = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'F' })
  await failsWith('invalid', () => lib.readLibraryContent(W, folder.id))
  await failsWith('invalid', () => lib.updateLibraryItem(W, folder.id, { content: bytes(1), expectedUpdatedAt: folder.updatedAt }))
})

test('delete removes a file with its bytes; a folder only when empty', async () => {
  const { lib, dir } = await setup()
  const folder = lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'F' })
  const item = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: bytes(1), parentId: folder.id })
  await failsWith('not_empty', () => lib.deleteLibraryItem(W, folder.id))
  expect(lib.getLibraryItem(W, folder.id)).toBeDefined()

  await lib.deleteLibraryItem(W, item.id)
  expect(lib.getLibraryItem(W, item.id)).toBeUndefined()
  expect(await stored(dir, W)).toEqual([])
  await lib.deleteLibraryItem(W, folder.id)
  expect(lib.getLibraryItems(W)).toEqual([])
  await failsWith('not_found', () => lib.deleteLibraryItem(W, item.id))
})

test('another workspace never sees or changes an item', async () => {
  const { lib, db } = await setup()
  const item = await lib.createLibraryItem({ createdBy: ME, workspaceId: W, title: 'a', mime: 'x/y', bytes: bytes(1) })
  expect(lib.getLibraryItem(OTHER, item.id)).toBeUndefined()
  await failsWith('not_found', () => lib.readLibraryContent(OTHER, item.id))
  await failsWith('not_found', () => lib.updateLibraryItem(OTHER, item.id, { title: 'x' }))
  await failsWith('not_found', () => lib.deleteLibraryItem(OTHER, item.id))
  await failsWith('not_found', () => lib.getLibraryFolderPath(OTHER, item.id))
  expect(db.select().from(library).all()).toHaveLength(1)
  expect(lib.getLibraryItem(W, item.id)).toEqual(item)
})

test('search finds titles (folders too) in the workspace, a title that starts with it first, then recency', async () => {
  const { lib } = await setup()
  const make = (title: string, workspaceId = W) => lib.createLibraryItem({ createdBy: ME, workspaceId, title, mime: 'text/markdown', bytes: bytes(1) })
  await make('Old brand notes.md')
  await make('Brand guide.md')
  await lib.createLibraryFolder({ createdBy: ME, workspaceId: W, title: 'Brand assets' })
  await make('Taxes.md')
  await make('Brand elsewhere.md', OTHER)
  expect(lib.searchLibraryItems(W, ' brand ').map((item) => item.title)).toEqual(['Brand assets', 'Brand guide.md', 'Old brand notes.md'])
  expect(lib.searchLibraryItems(W, 'brand', 1)).toHaveLength(1)
  expect(lib.searchLibraryItems(W, '.md').map((item) => item.title)).toHaveLength(3)
  expect(lib.searchLibraryItems(W, '%')).toEqual([])
  expect(lib.searchLibraryItems(W, '')).toEqual([])
})
