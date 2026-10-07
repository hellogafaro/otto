import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../db/index.ts'
import { pushSchema } from '../../db/push.ts'
import { createDiskFileStore, type FileStore } from '../file-store.ts'
import { createLibraryStore } from '../index.ts'
import { createS3Client, createS3FileStore } from '../s3-file-store.ts'
import { getLibraryStore, initFileStorage } from '../storage.ts'
import { startS3Double, type S3Double } from './s3-double.ts'

/**
 * One suite, run against every FileStore driver. To run it against a real Garage or minio instead of the
 * in-process double, set OTTO_TEST_S3_ENDPOINT, OTTO_TEST_S3_BUCKET (it must exist), OTTO_TEST_S3_REGION,
 * OTTO_TEST_S3_ACCESS_KEY_ID and OTTO_TEST_S3_SECRET_ACCESS_KEY: the S3 driver then runs on a unique prefix in that
 * bucket and deletes what it wrote. (Skipped assertions: those that read the double's internals.)
 */
const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)
const readAll = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer())

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'otto-contract-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

type Subject = {
  store: FileStore
  /** Where a file is readable by path (the store itself on disk, the cache on S3). */
  dir: string
  /** Makes the next writes fail, and puts things right again; a real server cannot be told to. */
  breakWrites?(): Promise<void>
  fixWrites?(): Promise<void>
}

const real = ['ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'].map((name) => process.env[`OTTO_TEST_S3_${name}`])

const drivers: { name: string; make(): Promise<Subject> }[] = [
  {
    name: 'disk',
    async make() {
      const dir = join(await tempDir(), 'library')
      cleanups.push(() => chmod(dir, 0o755).catch(() => {}))
      return {
        store: createDiskFileStore(dir),
        dir,
        breakWrites: async () => void (await chmod(dir, 0o555)),
        fixWrites: async () => void (await chmod(dir, 0o755)),
      }
    },
  },
  {
    name: 's3 (test double)',
    async make() {
      const double = startS3Double({ pageSize: 2 })
      cleanups.push(() => double.stop())
      const dir = await tempDir()
      return {
        store: createS3FileStore({ client: clientOf(double), keyPrefix: 'workspaces/ws1/library/', cacheDir: dir }),
        dir,
        breakWrites: async () => void (double.fail = (method) => method === 'PUT'),
        fixWrites: async () => void (double.fail = undefined),
      }
    },
  },
  ...(real.every(Boolean)
    ? [
        {
          name: 's3 (real server)',
          async make(): Promise<Subject> {
            const [endpoint, bucket, region, accessKeyId, secretAccessKey] = real as string[]
            const client = createS3Client({ endpoint: endpoint!, bucket: bucket!, region: region!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! })
            const keyPrefix = `otto-contract-${crypto.randomUUID()}/`
            const dir = await tempDir()
            const store = createS3FileStore({ client, keyPrefix, cacheDir: dir })
            cleanups.push(async () => void (await Promise.all((await store.list()).map((key) => store.delete(key)))))
            return { store, dir }
          },
        },
      ]
    : []),
]

const clientOf = (double: S3Double, accessKeyId = double.accessKeyId) =>
  createS3Client({ endpoint: double.url, bucket: double.bucket, region: 'test-region', accessKeyId, secretAccessKey: 'test-secret-value' })

// Disk write protection does not hold for root.
const canProtect = (name: string) => name !== 'disk' || process.getuid?.() !== 0

describe.each(drivers)('FileStore contract: $name', ({ name, make }) => {
  test('put, get, open and delete round-trip the bytes; a missing key is undefined', async () => {
    const { store } = await make()
    const key = crypto.randomUUID()
    expect(await store.get(key)).toBeUndefined()
    expect(await store.open(key)).toBeUndefined()
    await store.delete(key)

    await store.put(key, bytes(1, 2, 3))
    expect(await store.get(key)).toEqual(bytes(1, 2, 3))
    const opened = await store.open(key)
    expect(opened?.size).toBe(3)
    expect(await readAll(opened!.stream)).toEqual(bytes(1, 2, 3))

    await store.delete(key)
    expect(await store.get(key)).toBeUndefined()
    expect(await store.open(key)).toBeUndefined()
    await store.delete(key)
  })

  test('put overwrites; a staged file replaces the key only when committed', async () => {
    const { store } = await make()
    const key = crypto.randomUUID()
    await store.put(key, bytes(1))
    await store.put(key, bytes(2, 2))
    expect(await store.get(key)).toEqual(bytes(2, 2))

    const dropped = await store.stage(key, bytes(3))
    expect(await store.get(key)).toEqual(bytes(2, 2))
    await dropped.discard()
    expect(await store.get(key)).toEqual(bytes(2, 2))

    const kept = await store.stage(key, bytes(4, 4, 4))
    expect(await store.get(key)).toEqual(bytes(2, 2))
    await kept.commit()
    expect(await store.get(key)).toEqual(bytes(4, 4, 4))
    expect((await store.open(key))?.size).toBe(3)
    expect(await store.list()).toEqual([key])
  })

  test('list returns every key (across pages), filters by prefix and ignores what is not a key', async () => {
    const { store, dir } = await make()
    expect(await store.list()).toEqual([])
    const keys = ['aaaaaaaaaaa1', 'aaaaaaaaaaa2', 'aaaaaaaaaaa3', 'bbbbbbbbbbb1', 'bbbbbbbbbbb2']
    for (const key of keys) await store.put(key, bytes(1))
    expect((await store.list()).sort()).toEqual(keys)
    expect((await store.list('aaa')).sort()).toEqual(keys.slice(0, 3))
    expect(await store.list('ccc')).toEqual([])
    await store.delete('aaaaaaaaaaa2')
    expect((await store.list()).sort()).toEqual(keys.filter((key) => key !== 'aaaaaaaaaaa2'))
    await Bun.write(join(dir, 'stray.tmp-abc'), 'x')
    expect((await store.list('stray')).length).toBe(0)
    await expect(store.list('../x')).rejects.toThrow('Invalid file key prefix')
  })

  test('keys that are not ids are rejected', async () => {
    const { store } = await make()
    for (const key of ['../escape', 'a/b', '', 'ABCDEFGHIJKL', 'short', `${crypto.randomUUID()}.tmp`, '/etc/passwd']) {
      await expect(store.put(key, bytes(1))).rejects.toThrow('Invalid file key')
      await expect(store.stage(key, bytes(1))).rejects.toThrow('Invalid file key')
      await expect(store.get(key)).rejects.toThrow('Invalid file key')
      await expect(store.open(key)).rejects.toThrow('Invalid file key')
      await expect(store.delete(key)).rejects.toThrow('Invalid file key')
    }
    expect(await store.list()).toEqual([])
  })

  test('a 20 MB file streams back in pieces and matches byte for byte', async () => {
    const { store } = await make()
    const key = crypto.randomUUID()
    const big = new Uint8Array(20 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 4099) big[i] = (i / 4099) % 251
    await store.put(key, big)

    const opened = await store.open(key)
    expect(opened?.size).toBe(big.length)
    const hasher = new Bun.CryptoHasher('sha256')
    let total = 0
    let chunks = 0
    for await (const chunk of opened!.stream) {
      hasher.update(chunk)
      total += chunk.length
      chunks++
    }
    expect(total).toBe(big.length)
    expect(chunks).toBeGreaterThan(1)
    expect(hasher.digest('hex')).toBe(new Bun.CryptoHasher('sha256').update(big).digest('hex'))
  })

  test('concurrent writers: different keys all land, and racing writers on one key leave exactly one whole value', async () => {
    const { store } = await make()
    const keys = Array.from({ length: 12 }, () => crypto.randomUUID())
    await Promise.all(keys.map((key, i) => store.put(key, bytes(i, i, i))))
    for (const [i, key] of keys.entries()) expect(await store.get(key)).toEqual(bytes(i, i, i))
    expect((await store.list()).sort()).toEqual([...keys].sort())

    const key = crypto.randomUUID()
    const values = Array.from({ length: 8 }, (_, i) => new Uint8Array(200_000).fill(i + 1))
    await Promise.all(values.map((value) => store.put(key, value)))
    const winner = await store.get(key)
    expect(winner).toHaveLength(200_000)
    expect(new Set(winner).size).toBe(1)
    expect(new Set(values.map((value) => value[0])).has(winner![0]!)).toBe(true)
    expect(await store.list(key)).toEqual([key])
  })

  test.skipIf(!canProtect(name) || name === 's3 (real server)')('a write that fails leaves the stored bytes intact, for readers and for later reads', async () => {
    const { store, breakWrites, fixWrites } = await make()
    const key = crypto.randomUUID()
    await store.put(key, text('old'))

    await breakWrites!()
    await expect(store.put(key, text('new, and longer'))).rejects.toThrow()
    await expect(store.stage(key, text('staged')).then((staged) => staged.commit())).rejects.toThrow()
    await fixWrites!()
    expect(new TextDecoder().decode((await store.get(key))!)).toBe('old')
    expect(await store.list()).toEqual([key])

    await store.put(key, text('fixed'))
    expect(new TextDecoder().decode((await store.get(key))!)).toBe('fixed')
  })
})
