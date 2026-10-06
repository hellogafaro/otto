import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createId } from '../id.ts'

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

const KEY = /^[a-z0-9]{12}$/

export function assertKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`Invalid file key: ${key}`)
  return key
}

/** A list prefix is a plain run of key characters; it can never reach outside the store. */
export function assertPrefix(prefix: string): string {
  if (!/^[a-z0-9]{0,12}$/.test(prefix)) throw new Error(`Invalid file key prefix: ${prefix}`)
  return prefix
}

export const isFileKey = (name: string) => KEY.test(name)

/** Keys are `createId()` strings, so a key can never leave `rootDir`. */
export function createDiskFileStore(rootDir: string): FileStore {
  const pathOf = (key: string) => join(rootDir, assertKey(key))

  async function stage(key: string, bytes: Uint8Array): Promise<StagedFile> {
    const path = pathOf(key)
    await mkdir(rootDir, { recursive: true })
    // Written beside the target, so the later rename is atomic: readers see the old or the new bytes, never half.
    const temp = `${path}.tmp-${createId()}`
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
