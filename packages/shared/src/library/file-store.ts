import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createId } from '../id.ts'

/**
 * Where the bytes of library items live, keyed by item id. The default driver
 * writes to disk under the workspace; an S3-compatible driver (Garage, as in
 * Otto v1) plugs in here without touching the library domain.
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
}

export interface StagedFile {
  commit(): Promise<void>
  discard(): Promise<void>
}

const KEY = /^[a-z0-9]{12}$/

function assertKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`Invalid file key: ${key}`)
  return key
}

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
  }
}

/** Where a workspace keeps its library bytes. */
export const getLibraryDir = (workspaceRootPath: string) => join(workspaceRootPath, 'library')

export const getLibraryStore = (workspaceRootPath: string): FileStore => createDiskFileStore(getLibraryDir(workspaceRootPath))

/** The file an agent reads by path (`<workspaceRoot>/library/<id>`); show it the title in prompts, not this name. */
export const getLibraryItemPath = (workspaceRootPath: string, id: string) => join(getLibraryDir(workspaceRootPath), assertKey(id))
