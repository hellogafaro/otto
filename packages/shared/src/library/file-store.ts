import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

/**
 * Where the bytes of library items live, keyed by item id. The default driver
 * writes to disk under the workspace; `OTTO_STORAGE=s3` selects the S3-compatible
 * driver instead (s3-file-store.ts, wired in storage.ts), which keeps the same
 * directory as a read-through cache. The library domain does not know which one it has.
 */
export interface FileStore {
  put(key: string, bytes: Uint8Array): Promise<void>
  /**
   * Writes the bytes beside the key without touching it. `commit()` then makes them the
   * key's bytes in one step; `discard()` drops them. Exactly one of the two is called.
   */
  stage(key: string, bytes: Uint8Array): Promise<StagedFile>
  /** The bytes, or undefined when the key is not stored. */
  get(key: string): Promise<Uint8Array | undefined>
  /** The bytes as a stream with their size, or undefined when the key is not stored. */
  open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | undefined>
  /** Removes the key; nothing happens when it is not stored. */
  delete(key: string): Promise<void>
  /** The stored keys that start with `prefix` (all of them without one), in no particular order. */
  list(prefix?: string): Promise<string[]>
}

export interface StagedFile {
  commit(): Promise<void>
  discard(): Promise<void>
}

const KEY = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]{12})$/

export function assertKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`Invalid file key: ${key}`)
  return key
}

/** A list prefix is a plain run of key characters; it can never reach outside the store. */
export function assertPrefix(prefix: string): string {
  if (!/^[a-z0-9-]{0,36}$/.test(prefix)) throw new Error(`Invalid file key prefix: ${prefix}`)
  return prefix
}

export const isFileKey = (name: string) => KEY.test(name)

/**
 * A path key names a file inside a bundle (`my-skill/scripts/run.py`): `/`-separated segments with no `..`, no
 * empty or hidden (leading `.`) segment, no backslash or control character, and at most 512 characters, so it can
 * never leave the store. Bundles use these; the library's keys are ids (`assertKey`).
 */
export function assertPathKey(key: string): string {
  const ok =
    key.length > 0 &&
    key.length <= 512 &&
    !/[\\\u0000-\u001f]/.test(key) &&
    key.split('/').every((segment) => segment !== '' && !segment.startsWith('.'))
  if (!ok) throw new Error(`Invalid file key: ${key}`)
  return key
}

/** A list prefix for path keys: empty, or a run of whole segments ending in `/`, or a partial last segment. */
export function assertPathPrefix(prefix: string): string {
  if (prefix !== '') assertPathKey(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
  return prefix
}

/** The temp files a write leaves beside its target while it is in flight; never keys. */
const isTempFile = (name: string) => /\.tmp-(?:[a-z0-9]{12}|[0-9a-f-]{36})$/.test(name)

/** Keys are `crypto.randomUUID()` strings, or with `paths` bundle paths (`assertPathKey`); either way a key can never leave `rootDir`. */
export function createDiskFileStore(rootDir: string, options: { paths?: boolean } = {}): FileStore {
  const paths = options.paths === true
  const pathOf = (key: string) => join(rootDir, paths ? assertPathKey(key) : assertKey(key))

  async function stage(key: string, bytes: Uint8Array): Promise<StagedFile> {
    const path = pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    // Written beside the target, so the later rename is atomic: readers see the old or the new bytes, never half.
    const temp = `${path}.tmp-${crypto.randomUUID()}`
    try {
      await Bun.write(temp, bytes)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    return {
      async commit() {
        try {
          await rename(temp, path)
        } catch (error) {
          await rm(temp, { force: true })
          throw error
        }
      },
      discard: () => rm(temp, { force: true }),
    }
  }

  return {
    stage,

    async put(key, bytes) {
      await (await stage(key, bytes)).commit()
    },

    async get(key) {
      const file = Bun.file(pathOf(key))
      return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : undefined
    },

    async open(key) {
      const file = Bun.file(pathOf(key))
      return (await file.exists()) ? { stream: file.stream(), size: file.size } : undefined
    },

    async delete(key) {
      await rm(pathOf(key), { force: true })
    },

    async list(prefix = '') {
      if (paths) {
        assertPathPrefix(prefix)
        const entries = await readdir(rootDir, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) =>
          error.code === 'ENOENT' ? [] : Promise.reject(error),
        )
        const keys = entries
          .filter((entry) => entry.isFile() && !isTempFile(entry.name))
          .map((entry) => relative(rootDir, join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
        // Hidden files and folders (the bundle marker, `.tmp-*` swaps) are not keys.
        return keys.filter((key) => key.startsWith(prefix) && !key.split('/').some((segment) => segment.startsWith('.')))
      }
      assertPrefix(prefix)
      // Temp files and the S3 cache's bookkeeping are not keys.
      const names = await readdir(rootDir).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))
      return names.filter((name) => isFileKey(name) && name.startsWith(prefix))
    },
  }
}

/** Where a workspace keeps its library bytes (the store itself on disk, the read-through cache on S3). */
export const getLibraryDir = (workspaceRootPath: string) => join(workspaceRootPath, 'library')

/** The file an agent reads by path (`<workspaceRoot>/library/<id>`); show it the title in prompts, not this name. */
export const getLibraryItemPath = (workspaceRootPath: string, id: string) => join(getLibraryDir(workspaceRootPath), assertKey(id))
