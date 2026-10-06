import { S3Client } from 'bun'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createId } from '../id.ts'
import { assertKey, assertPrefix, type FileStore } from './file-store.ts'

export type S3Config = {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/** Path-style addressing (`<endpoint>/<bucket>/<key>`), which Garage and minio need and AWS still accepts. */
export const createS3Client = (config: S3Config) => new S3Client({ ...config, virtualHostedStyle: false })

const isNotFound = (error: unknown) => (error as { code?: string } | null)?.code === 'NoSuchKey'
const orUndefined = <T>(error: unknown): T | undefined => {
  if (isNotFound(error)) return undefined
  throw error
}

/**
 * The S3 driver: one object per key at `<keyPrefix><key>` (`keyPrefix` is
 * `[OTTO_S3_PREFIX/]workspaces/<workspaceId>/library/`). S3 is the truth; `cacheDir` is a
 * read-through cache so agents can still read a file by path (`<workspace>/library/<id>`).
 *
 * Cache rule: a cached file is valid while its recorded ETag (`<cacheDir>/.etags/<key>`) equals the
 * object's current ETag (one HEAD per read). `get` and `open` download a missing or outdated file
 * (streamed to a temp file, then renamed, so readers never see half a file) and serve it from disk;
 * `put` and a committed stage write the new bytes through; `delete` and a read that finds the
 * object gone drop the cached file. The ETag is recorded after the file is in place and comes from
 * a HEAD made before the download, so a stale pair can only cause one extra download, never a wrong hit.
 *
 * A save stages nothing remote: S3 overwrites an object atomically, so `stage` keeps the bytes and
 * `commit` is the one PUT (after the library's guarded row update). A failed stage or discard leaves the
 * stored object untouched; if the PUT fails, the library puts the row back.
 */
export function createS3FileStore(options: { client: S3Client; keyPrefix: string; cacheDir: string }): FileStore {
  const { client, keyPrefix, cacheDir } = options
  const etagDir = join(cacheDir, '.etags')
  const objectOf = (key: string) => keyPrefix + assertKey(key)
  const cachePathOf = (key: string) => join(cacheDir, key)
  const etagPathOf = (key: string) => join(etagDir, key)

  const dropCache = async (key: string) => void (await Promise.all([rm(cachePathOf(key), { force: true }), rm(etagPathOf(key), { force: true })]))

  async function fillCache(key: string, source: Uint8Array | Blob, etag: string) {
    await mkdir(etagDir, { recursive: true })
    const temp = `${cachePathOf(key)}.tmp-${createId()}`
    try {
      await Bun.write(temp, source)
      await rename(temp, cachePathOf(key))
      await Bun.write(etagPathOf(key), etag)
    } catch (error) {
      await Promise.all([rm(temp, { force: true }), rm(etagPathOf(key), { force: true })])
      throw error
    }
  }

  /** The cached file's path once it matches the stored object; undefined when the key is not stored. */
  async function materialize(key: string): Promise<string | undefined> {
    const path = cachePathOf(key)
    const stat = await client.stat(objectOf(key)).catch(orUndefined<Awaited<ReturnType<S3Client['stat']>>>)
    if (!stat) return void (await dropCache(key))
    const cached = Bun.file(path)
    const recorded = await Bun.file(etagPathOf(key)).text().catch(() => undefined)
    if (recorded === stat.etag && (await cached.exists()) && cached.size === stat.size) return path
    try {
      await fillCache(key, client.file(objectOf(key)), stat.etag)
    } catch (error) {
      if (!isNotFound(error)) throw error
      return void (await dropCache(key)) // deleted between the HEAD and the download
    }
    return path
  }

  async function put(key: string, bytes: Uint8Array) {
    const object = objectOf(key)
    await client.write(object, bytes)
    // Write through; a cache that cannot be written is only a cache miss later, the object is stored.
    try {
      await fillCache(key, bytes, (await client.stat(object)).etag)
    } catch {
      await dropCache(key).catch(() => {})
    }
  }

  return {
    put,

    async stage(key, bytes) {
      objectOf(key)
      return { commit: () => put(key, bytes), discard: async () => {} }
    },

    async get(key) {
      const path = await materialize(key)
      return path === undefined ? undefined : new Uint8Array(await Bun.file(path).arrayBuffer())
    },

    async open(key) {
      const path = await materialize(key)
      if (path === undefined) return undefined
      const file = Bun.file(path)
      return { stream: file.stream(), size: file.size }
    },

    async delete(key) {
      await client.delete(objectOf(key))
      await dropCache(key)
    },

    async list(prefix = '') {
      assertPrefix(prefix)
      const keys: string[] = []
      let continuationToken: string | undefined
      do {
        const page = await client.list({ prefix: keyPrefix + prefix, continuationToken })
        for (const { key } of page.contents ?? []) keys.push(key.slice(keyPrefix.length))
        continuationToken = page.isTruncated ? page.nextContinuationToken : undefined
      } while (continuationToken)
      return keys
    },
  }
}
