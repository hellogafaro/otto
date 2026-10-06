import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getWorkspaceByNameOrId } from '../config/storage.ts'
import { isActor } from '../actors.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { createId } from '../id.ts'
import { domainError } from '../utils/errors.ts'
import type { FileStore } from './file-store.ts'
import { MAX_FILE_BYTES, MAX_FOLDER_DEPTH } from './limits.ts'
import { library } from './schema.ts'
import { getLibraryStore } from './storage.ts'
import type { LibraryFilter, LibraryItem, LibraryItemType } from './types.ts'

/**
 * Library: everything saved. Uploads, chat attachments, what agents make and
 * markdown documents are all one kind of item; folders are items too.
 *
 *   library(id, workspaceId, parentId, type, title, mime, size, createdBy, createdAt, updatedAt)   (schema.ts)
 *
 * `type` is 'document' for markdown (mime text/markdown or a .md name), 'folder'
 * for folders and 'file' otherwise; it is fixed when the item is created.
 * `createdBy` is 'user:<id>' or 'agent:<id>', set by the caller. Chat attachments are ordinary items in the
 * root folder titled CHAT_ATTACHMENTS_FOLDER_TITLE, created on first use.
 * The bytes live in a FileStore keyed by the item id (file-store.ts), never in
 * the table. Every function takes the workspace explicitly and only sees its rows.
 */

export * from './file-store.ts'
export * from './limits.ts'
export { getBundleStore, getLibraryStore, initFileStorage, isObjectStorage } from './storage.ts'
export type * from './types.ts'

/** Title of the root folder that holds chat attachments (not translated; it is a name, like a file's). */
export const CHAT_ATTACHMENTS_FOLDER_TITLE = 'Chat attachments'

type Row = typeof library.$inferSelect

function toItem(row: Row): LibraryItem {
  return {
    id: row.id,
    parentId: row.parentId,
    type: row.type as LibraryItemType,
    title: row.title,
    mime: row.mime,
    size: row.size,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** Gives what the bare actor 'user' made to `actor`: runs once, when the first user appears. */
export function updateLegacyUserActor(db: Db | Tx, actor: string): void {
  db.update(library).set({ createdBy: actor }).where(eq(library.createdBy, 'user')).run()
}

/** Gives what actor `from` made in the workspace to `to` (`agent:default` to the agent that replaces it): see `initAgentsImport`. */
export function updateAgentActor(db: Db | Tx, workspaceId: string, from: string, to: string): void {
  db.update(library).set({ createdBy: to }).where(and(eq(library.workspaceId, workspaceId), eq(library.createdBy, from))).run()
}

const isMarkdown = (title: string, mime: string) => mime === 'text/markdown' || /\.md$/i.test(title)

function assertTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw domainError('invalid', 'A title is required')
  return trimmed
}

function assertActor(actor: unknown): string {
  if (!isActor(actor)) throw domainError('invalid', `${String(actor)} is not an actor`)
  return actor
}

function assertSize(bytes: Uint8Array) {
  if (bytes.length === 0) throw domainError('invalid', 'The file is empty')
  if (bytes.length > MAX_FILE_BYTES) throw domainError('too_large', `Files are limited to ${MAX_FILE_BYTES} bytes`)
}

export function createLibraryStore(db: Db, storeFor: (workspaceId: string) => FileStore) {
  const find = (workspaceId: string, id: string) =>
    db.select().from(library).where(and(eq(library.workspaceId, workspaceId), eq(library.id, id))).get()

  function getRow(workspaceId: string, id: string): Row {
    const row = find(workspaceId, id)
    if (!row) throw domainError('not_found', `Library item ${id} does not exist`)
    return row
  }

  /** The folders from the root down to `id` (empty for the root); `id` must be a folder of the workspace. */
  function folderChain(workspaceId: string, id: string | null): Row[] {
    const chain: Row[] = []
    let next = id
    while (next !== null && chain.length <= MAX_FOLDER_DEPTH) {
      const row = find(workspaceId, next)
      if (!row) throw domainError('not_found', `Folder ${next} does not exist`)
      if (row.type !== 'folder') throw domainError('invalid', `${next} is not a folder`)
      chain.unshift(row)
      next = row.parentId
    }
    return chain
  }

  /** How many folder levels the tree under (and including) the folder `id` has. */
  function folderHeight(workspaceId: string, id: string): number {
    let height = 0
    for (let level = [id]; level.length > 0; height++) {
      level = db
        .select({ id: library.id })
        .from(library)
        .where(and(eq(library.workspaceId, workspaceId), eq(library.type, 'folder'), inArray(library.parentId, level)))
        .all()
        .map((row) => row.id)
    }
    return height
  }

  function insert(row: Omit<Row, 'createdAt' | 'updatedAt'>): LibraryItem {
    const now = new Date()
    return toItem(db.insert(library).values({ ...row, createdAt: now, updatedAt: now }).returning().get())
  }

  async function readContent(workspaceId: string, id: string): Promise<Uint8Array> {
    const row = getRow(workspaceId, id)
    if (row.type === 'folder') throw domainError('invalid', 'A folder has no content')
    const bytes = await storeFor(workspaceId).get(id)
    if (!bytes) throw domainError('not_found', `The content of ${id} is missing`)
    return bytes
  }

  function createFolder(input: { workspaceId: string; title: string; parentId?: string | null; createdBy: string }): LibraryItem {
    const title = assertTitle(input.title)
    const createdBy = assertActor(input.createdBy)
    const parentId = input.parentId ?? null
    if (folderChain(input.workspaceId, parentId).length + 1 > MAX_FOLDER_DEPTH) {
      throw domainError('invalid', `Folders nest at most ${MAX_FOLDER_DEPTH} levels`)
    }
    return insert({
      id: createId(),
      workspaceId: input.workspaceId,
      parentId,
      type: 'folder',
      title,
      mime: null,
      size: null,
      createdBy,
    })
  }

  return {
    createLibraryFolder: createFolder,

    /** The root folder for chat attachments; made the first time it is needed. */
    initChatAttachmentsFolder(workspaceId: string, createdBy: string): LibraryItem {
      const existing = db
        .select()
        .from(library)
        .where(and(eq(library.workspaceId, workspaceId), isNull(library.parentId), eq(library.type, 'folder'), eq(library.title, CHAT_ATTACHMENTS_FOLDER_TITLE)))
        .get()
      return existing ? toItem(existing) : createFolder({ workspaceId, title: CHAT_ATTACHMENTS_FOLDER_TITLE, createdBy })
    },

    /** Saves the bytes, then the row; the bytes are removed again when the row cannot be saved. */
    async createLibraryItem(input: {
      workspaceId: string
      title: string
      mime: string
      bytes: Uint8Array
      parentId?: string | null
      createdBy: string
    }): Promise<LibraryItem> {
      const title = assertTitle(input.title)
      const createdBy = assertActor(input.createdBy)
      assertSize(input.bytes)
      const parentId = input.parentId ?? null
      folderChain(input.workspaceId, parentId)
      const mime = input.mime.trim() || 'application/octet-stream'
      const id = createId()
      const store = storeFor(input.workspaceId)
      await store.put(id, input.bytes)
      try {
        return insert({
          id,
          workspaceId: input.workspaceId,
          parentId,
          type: isMarkdown(title, mime) ? 'document' : 'file',
          title,
          mime,
          size: input.bytes.length,
          createdBy,
        })
      } catch (error) {
        await store.delete(id)
        throw error
      }
    },

    getLibraryItem(workspaceId: string, id: string): LibraryItem | undefined {
      const row = find(workspaceId, id)
      return row && toItem(row)
    },

    /** Folders first, then the most recently updated. */
    getLibraryItems(workspaceId: string, filter: LibraryFilter = {}): LibraryItem[] {
      const where = [
        eq(library.workspaceId, workspaceId),
        filter.parentId === undefined ? undefined : filter.parentId === null ? isNull(library.parentId) : eq(library.parentId, filter.parentId),
        filter.createdBy === undefined ? undefined : eq(library.createdBy, filter.createdBy),
        filter.type === undefined ? undefined : eq(library.type, filter.type),
      ]
      return db
        .select()
        .from(library)
        .where(and(...where))
        .orderBy(sql`${library.type} = 'folder' desc`, desc(library.updatedAt))
        .all()
        .map(toItem)
    },

    /** The folders from the root down to the folder `id` (the folder itself last). */
    getLibraryFolderPath(workspaceId: string, id: string): LibraryItem[] {
      return folderChain(workspaceId, id).map(toItem)
    },

    readLibraryContent: readContent,

    async readLibraryText(workspaceId: string, id: string): Promise<string> {
      return new TextDecoder().decode(await readContent(workspaceId, id))
    },

    /**
     * Rename, move (`parentId`: null for the root) or replace the content. Replacing the
     * content needs `expectedUpdatedAt`, the `updatedAt` the caller last saw; a different
     * stored value means someone saved in between, and nothing changes (`conflict`).
     * A save is two-phase: stage the bytes, guarded row update, then commit the bytes.
     */
    async updateLibraryItem(
      workspaceId: string,
      id: string,
      patch: { title?: string; parentId?: string | null; content?: Uint8Array; expectedUpdatedAt?: number },
    ): Promise<LibraryItem> {
      const row = getRow(workspaceId, id)
      const changes: Partial<Row> = {}

      if (patch.title !== undefined) changes.title = assertTitle(patch.title)

      if (patch.parentId !== undefined) {
        const chain = folderChain(workspaceId, patch.parentId)
        if (row.type === 'folder') {
          if (chain.some((folder) => folder.id === id)) throw domainError('invalid', 'A folder cannot move into itself')
          if (chain.length + folderHeight(workspaceId, id) > MAX_FOLDER_DEPTH) {
            throw domainError('invalid', `Folders nest at most ${MAX_FOLDER_DEPTH} levels`)
          }
        }
        changes.parentId = patch.parentId
      }

      const content = patch.content
      if (content !== undefined) {
        if (row.type === 'folder') throw domainError('invalid', 'A folder has no content')
        if (patch.expectedUpdatedAt !== row.updatedAt.getTime()) {
          throw domainError('conflict', `${id} changed since it was loaded`)
        }
        assertSize(content)
        changes.size = content.length
      }

      // Strictly after the stored value, so two saves in one millisecond still tell apart.
      changes.updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))

      // Bytes first, but beside the real file: only the save that wins the guarded row update
      // below moves them into place, so the row and the bytes always come from the same save.
      const staged = content === undefined ? undefined : await storeFor(workspaceId).stage(id, content)
      let updated: Row | undefined
      try {
        updated = db
          .update(library)
          .set(changes)
          .where(and(eq(library.id, id), eq(library.workspaceId, workspaceId), eq(library.updatedAt, row.updatedAt)))
          .returning()
          .get()
        if (!updated) throw domainError('conflict', `${id} changed since it was loaded`)
        await staged?.commit()
      } catch (error) {
        await staged?.discard()
        // The bytes did not move, so the row must not claim they did.
        if (updated) db.update(library).set(row).where(and(eq(library.id, id), eq(library.updatedAt, updated.updatedAt))).run()
        throw error
      }
      return toItem(updated)
    },

    /** Removes the item and its bytes; a folder only when it is empty. */
    async deleteLibraryItem(workspaceId: string, id: string): Promise<void> {
      const row = getRow(workspaceId, id)
      if (row.type === 'folder') {
        const child = db
          .select({ id: library.id })
          .from(library)
          .where(and(eq(library.workspaceId, workspaceId), eq(library.parentId, id)))
          .get()
        if (child) throw domainError('not_empty', 'The folder is not empty')
      }
      db.delete(library).where(eq(library.id, id)).run()
      if (row.type !== 'folder') await storeFor(workspaceId).delete(id)
    },
  }
}

type Store = ReturnType<typeof createLibraryStore>

let store: Store | undefined

/** Bytes live under the workspace's own directory (`<root>/library`), or in S3 with that directory as a cache (storage.ts). */
function defaultStore() {
  return (store ??= createLibraryStore(initDb(), (workspaceId) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw domainError('not_found', `Workspace ${workspaceId} does not exist`)
    return getLibraryStore(workspace.rootPath, workspace.id)
  }))
}

export const createLibraryFolder: Store['createLibraryFolder'] = (input) => defaultStore().createLibraryFolder(input)
export const initChatAttachmentsFolder: Store['initChatAttachmentsFolder'] = (workspaceId, createdBy) => defaultStore().initChatAttachmentsFolder(workspaceId, createdBy)
export const createLibraryItem: Store['createLibraryItem'] = (input) => defaultStore().createLibraryItem(input)
export const getLibraryItem: Store['getLibraryItem'] = (workspaceId, id) => defaultStore().getLibraryItem(workspaceId, id)
export const getLibraryItems: Store['getLibraryItems'] = (workspaceId, filter) => defaultStore().getLibraryItems(workspaceId, filter)
export const getLibraryFolderPath: Store['getLibraryFolderPath'] = (workspaceId, id) => defaultStore().getLibraryFolderPath(workspaceId, id)
export const readLibraryContent: Store['readLibraryContent'] = (workspaceId, id) => defaultStore().readLibraryContent(workspaceId, id)
export const readLibraryText: Store['readLibraryText'] = (workspaceId, id) => defaultStore().readLibraryText(workspaceId, id)
export const updateLibraryItem: Store['updateLibraryItem'] = (workspaceId, id, patch) => defaultStore().updateLibraryItem(workspaceId, id, patch)
export const deleteLibraryItem: Store['deleteLibraryItem'] = (workspaceId, id) => defaultStore().deleteLibraryItem(workspaceId, id)
