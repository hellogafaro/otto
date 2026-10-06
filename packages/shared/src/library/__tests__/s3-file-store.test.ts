import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../db/index.ts'
import { pushSchema } from '../../db/push.ts'
import { createId } from '../../id.ts'
import { isDomainError } from '../../utils/errors.ts'
import { createLibraryStore } from '../index.ts'
import { createS3Client, createS3FileStore } from '../s3-file-store.ts'
import { getLibraryStore, initFileStorage } from '../storage.ts'
import { startS3Double, type S3Double } from './s3-double.ts'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)
const SECRET = 'very-secret-access-key'
const KEY_PREFIX = 'workspaces/ws1/library/'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  initFileStorage({})
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function startDouble() {
  const double = startS3Double()
  cleanups.push(() => double.stop())
  return double
}

async function node(double: S3Double, keyPrefix = KEY_PREFIX) {
  const dir = await mkdtemp(join(tmpdir(), 'otto-s3-cache-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const client = createS3Client({ endpoint: double.url, bucket: double.bucket, region: 'r', accessKeyId: double.accessKeyId, secretAccessKey: SECRET })
  return { dir, store: createS3FileStore({ client, keyPrefix, cacheDir: dir }) }
}

const gets = (double: S3Double) => double.requests.filter((request) => request.startsWith('GET ') && !request.endsWith(' ')).length

describe('S3 driver: read-through cache', () => {
  test('put writes through: the file is readable by path at once, without a download', async () => {
    const double = startDouble()
    const { store, dir } = await node(double)
    const key = createId()
    await store.put(key, text('hello'))
    expect(await Bun.file(join(dir, key)).text()).toBe('hello')
    expect(double.objects.get(KEY_PREFIX + key)?.bytes).toEqual(text('hello'))
    expect(await store.get(key)).toEqual(text('hello'))
    expect(gets(double)).toBe(0)
  })

  test('a read on a node with no cache downloads the object to <dir>/<key> and later reads reuse it', async () => {
    const double = startDouble()
    const writer = await node(double)
    const reader = await node(double)
    const key = createId()
    await writer.store.put(key, text('shared'))

    expect(existsSync(join(reader.dir, key))).toBe(false)
    expect(await reader.store.get(key)).toEqual(text('shared'))
    expect(await Bun.file(join(reader.dir, key)).text()).toBe('shared')
    expect(gets(double)).toBe(1)

    const opened = await reader.store.open(key)
    expect(opened?.size).toBe(6)
    expect(await new Response(opened!.stream).text()).toBe('shared')
    expect(gets(double)).toBe(1) // validated by HEAD only
    expect((await readdir(reader.dir)).filter((name) => name !== '.etags')).toEqual([key])
  })

  test('a changed object (even to the same size) is downloaded again; a deleted one drops the cached file', async () => {
    const double = startDouble()
    const a = await node(double)
    const b = await node(double)
    const key = createId()
    await a.store.put(key, text('one'))
    expect(await a.store.get(key)).toEqual(text('one'))

    await b.store.put(key, text('two')) // another node saves
    expect(await a.store.get(key)).toEqual(text('two'))
    expect(await Bun.file(join(a.dir, key)).text()).toBe('two')
    expect(gets(double)).toBe(1)

    await b.store.delete(key)
    expect(await a.store.get(key)).toBeUndefined()
    expect(existsSync(join(a.dir, key))).toBe(false)
  })

  test('a cache file that was damaged or removed is repaired from the object', async () => {
    const double = startDouble()
    const { store, dir } = await node(double)
    const key = createId()
    await store.put(key, text('intact'))
    await Bun.write(join(dir, key), 'torn')
    expect(await store.get(key)).toEqual(text('intact'))
    await rm(join(dir, key))
    expect(await store.get(key)).toEqual(text('intact'))
    expect(await Bun.file(join(dir, key)).text()).toBe('intact')
  })

  test('delete removes the object and the cached file', async () => {
    const double = startDouble()
    const { store, dir } = await node(double)
    const key = createId()
    await store.put(key, bytes(1))
    await store.delete(key)
    expect(double.objects.size).toBe(0)
    expect(existsSync(join(dir, key))).toBe(false)
  })

  test('a failed download leaves the old cache untouched and no temp file behind', async () => {
    const double = startDouble()
    const a = await node(double)
    const b = await node(double)
    const key = createId()
    await a.store.put(key, text('old'))
    await b.store.put(key, text('new'))
    double.fail = (method) => method === 'GET'
    await expect(a.store.get(key)).rejects.toThrow()
    double.fail = undefined
    expect(await Bun.file(join(a.dir, key)).text()).toBe('old') // stale, but whole; the next read refreshes it
    expect((await readdir(a.dir)).filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(await a.store.get(key)).toEqual(text('new'))
  })
})

describe('S3 driver: keys, credentials and configuration', () => {
  const env = (double: S3Double, extra: Record<string, string> = {}) => ({
    OTTO_STORAGE: 's3',
    OTTO_S3_ENDPOINT: double.url,
    OTTO_S3_BUCKET: double.bucket,
    OTTO_S3_REGION: 'test-region',
    OTTO_S3_ACCESS_KEY_ID: double.accessKeyId,
    OTTO_S3_SECRET_ACCESS_KEY: SECRET,
    ...extra,
  })

  test('library keys are workspaces/<workspaceId>/library/<id>, under OTTO_S3_PREFIX when set', async () => {
    const double = startDouble()
    const root = await mkdtemp(join(tmpdir(), 'otto-ws-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const id = createId()

    expect(initFileStorage(env(double))).toBe('s3')
    await getLibraryStore(root, 'ws1').put(id, bytes(1))
    expect([...double.objects.keys()]).toEqual([`workspaces/ws1/library/${id}`])
    expect(existsSync(join(root, 'library', id))).toBe(true)

    initFileStorage(env(double, { OTTO_S3_PREFIX: '/team-a/' }))
    await getLibraryStore(root, 'ws2').put(id, bytes(2))
    expect([...double.objects.keys()].sort()).toEqual([`team-a/workspaces/ws2/library/${id}`, `workspaces/ws1/library/${id}`])
    expect(() => getLibraryStore(root, '../x')).toThrow('Invalid workspace id')
  })

  test('another workspace never sees the keys of this one', async () => {
    const double = startDouble()
    const root = await mkdtemp(join(tmpdir(), 'otto-ws-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    initFileStorage(env(double))
    await getLibraryStore(root, 'ws1').put('aaaaaaaaaaaa', bytes(1))
    expect(await getLibraryStore(join(root, 'other'), 'ws2').list()).toEqual([])
    expect(await getLibraryStore(join(root, 'other'), 'ws2').get('aaaaaaaaaaaa')).toBeUndefined()
  })

  test('disk is the default; a bad or incomplete configuration is refused naming variables, never values', () => {
    expect(initFileStorage({})).toBe('disk')
    expect(initFileStorage({ OTTO_STORAGE: 'disk' })).toBe('disk')
    expect(() => initFileStorage({ OTTO_STORAGE: 'gcs' })).toThrow('OTTO_STORAGE must be "disk" or "s3"')
    const message = (() => {
      try {
        initFileStorage({ OTTO_STORAGE: 's3', OTTO_S3_SECRET_ACCESS_KEY: SECRET, OTTO_S3_ENDPOINT: 'http://x' })
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).toBe('OTTO_STORAGE=s3 needs OTTO_S3_BUCKET, OTTO_S3_REGION, OTTO_S3_ACCESS_KEY_ID')
    expect(() => initFileStorage({ ...env({ url: 'not a url', bucket: 'b', accessKeyId: 'a' } as S3Double) })).toThrow('OTTO_S3_ENDPOINT must be a URL')
  })

  test('requests carry the configured access key; a rejected key fails without leaking the secret', async () => {
    const double = startDouble()
    const root = await mkdtemp(join(tmpdir(), 'otto-ws-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    initFileStorage(env(double, { OTTO_S3_ACCESS_KEY_ID: 'someone-else' }))
    const error = await getLibraryStore(root, 'ws1').put('aaaaaaaaaaaa', bytes(1)).then(() => undefined, (e: unknown) => e)
    expect(error).toBeDefined()
    expect(`${(error as Error).message} ${(error as Error).stack}`).not.toContain(SECRET)
    expect(double.objects.size).toBe(0)
  })
})

describe('the library domain on the S3 driver', () => {
  const ME = 'user:aaaaaaaaaaaa'

  async function setup(double: S3Double) {
    const db = openDb(':memory:')
    await pushSchema(db)
    const a = await node(double)
    const b = await node(double)
    return { a, b, lib: createLibraryStore(db, () => a.store), otherNodeLib: createLibraryStore(db, () => b.store) }
  }

  test('create, guarded save, read from another node and delete keep row and object together', async () => {
    const double = startDouble()
    const { lib, otherNodeLib, a, b } = await setup(double)
    const item = await lib.createLibraryItem({ workspaceId: 'ws1', title: 'n.md', mime: 'text/markdown', bytes: text('one'), createdBy: ME })
    expect([...double.objects.keys()]).toEqual([KEY_PREFIX + item.id])
    expect(existsSync(join(a.dir, item.id))).toBe(true)

    const saved = await lib.updateLibraryItem('ws1', item.id, { content: text('two'), expectedUpdatedAt: item.updatedAt })
    expect(await otherNodeLib.readLibraryText('ws1', item.id)).toBe('two')
    expect(await Bun.file(join(b.dir, item.id)).text()).toBe('two')

    // A stale save changes nothing: not the row, not the object, not the cache.
    const error = await lib.updateLibraryItem('ws1', item.id, { content: text('lost'), expectedUpdatedAt: item.updatedAt }).then(() => undefined, (e: unknown) => e)
    expect(isDomainError(error) && error.code).toBe('conflict')
    expect(await lib.readLibraryText('ws1', item.id)).toBe('two')
    expect(lib.getLibraryItem('ws1', item.id)).toEqual(saved)

    // The object cannot be written: the row goes back to what it was.
    double.fail = (method) => method === 'PUT'
    await expect(lib.updateLibraryItem('ws1', item.id, { content: text('nope'), expectedUpdatedAt: saved.updatedAt })).rejects.toThrow()
    double.fail = undefined
    expect(lib.getLibraryItem('ws1', item.id)).toEqual(saved)
    expect(await lib.readLibraryText('ws1', item.id)).toBe('two')

    await lib.deleteLibraryItem('ws1', item.id)
    expect(double.objects.size).toBe(0)
    expect(existsSync(join(a.dir, item.id))).toBe(false)
  })

  test('an upload that cannot be stored creates no row', async () => {
    const double = startDouble()
    const { lib } = await setup(double)
    double.fail = (method) => method === 'PUT'
    await expect(lib.createLibraryItem({ workspaceId: 'ws1', title: 'a', mime: 'x/y', bytes: bytes(1), createdBy: ME })).rejects.toThrow()
    double.fail = undefined
    expect(lib.getLibraryItems('ws1')).toEqual([])
  })
})
