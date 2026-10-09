import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  createLibraryFolder,
  createLibraryItem,
  deleteLibraryItem,
  getLibraryFolderPath,
  getLibraryItem,
  getLibraryItems,
  isFileKey,
  readLibraryContent,
  searchLibraryItems,
  updateLibraryItem,
} from '@otto/shared/library'
import { isActor } from '@otto/shared/actors'
import { domainError, isDomainError } from '@otto/shared/utils'

export function createMastraLibraryTools(scope: {
  workspaceId: string
  agentId: string
  assertAccess: () => void
  getUserId: () => string
  assertChatAccess: (id: string) => void
}) {
  const workspaceId = scope.workspaceId
  const id = z.string().refine(isFileKey, 'Invalid stored Library ID')
  const title = z.string().trim().min(1).max(255)
  const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  const content = z.string().min(1).max(65536).refine((value) => new TextEncoder().encode(value).byteLength <= 65536, 'Document text exceeds 64 KiB')
  const assertAccess = () => {
    scope.assertAccess()
    if (!scope.getUserId()) throw new Error('Library tools require a signed-in creator.')
  }
  const item = (itemId: string) => {
    const found = getLibraryItem(workspaceId, itemId)
    if (!found) throw domainError('not_found', 'Library item not found in this workspace.')
    return found
  }
  const folder = (folderId: string | null | undefined) => {
    if (folderId !== null && folderId !== undefined && item(folderId).type !== 'folder') throw domainError('invalid', 'The parent must be a Library folder.')
  }
  const execute = async <T>(action: () => T | Promise<T>) => {
    assertAccess()
    try {
      const result = await action()
      assertAccess()
      if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw domainError('too_large', 'Library result exceeds the output limit.')
      return result
    } catch (error) {
      assertAccess()
      throw new Error(isDomainError(error) ? `Library action failed (${error.code}).` : 'Library action could not complete. The item may have changed; read its metadata before retrying.')
    }
  }
  return {
    library_list: createTool({
      strict: false,
      id: 'library_list', description: 'List bounded Library metadata in this workspace. Filter by folder (null for root), creator actor, or file/document/folder type. Offset pages are not a stable snapshot; no content, binary data or host paths are returned.',
      inputSchema: z.object({ parentId: id.nullable().optional(), createdBy: z.string().refine(isActor, 'Invalid creator actor').optional(), type: z.enum(['document', 'file', 'folder']).optional(), offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict(),
      execute: (input) => execute(() => {
        folder(input.parentId)
        const items = getLibraryItems(workspaceId, { parentId: input.parentId, createdBy: input.createdBy, type: input.type })
        return { total: items.length, items: items.slice(input.offset, input.offset + input.limit), nextOffset: input.offset + input.limit < items.length ? input.offset + input.limit : null }
      }),
    }),
    library_search: createTool({
      id: 'library_search', description: 'Search Library titles in this workspace, including files and folders. Literal title matching only, not document contents. Returns at most 100 metadata records.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(255), limit: z.number().int().min(1).max(100).default(20) }).strict(),
      execute: (input) => execute(() => ({ items: searchLibraryItems(workspaceId, input.query, input.limit) })),
    }),
    library_get_item: createTool({
      id: 'library_get_item', description: 'Get an existing Library file, document or folder by ID in this workspace. Includes its updatedAt version, not bytes, credentials, download URLs or server paths. Files remain downloadable through the authenticated Library view.',
      inputSchema: z.object({ id }).strict(),
      execute: (input) => execute(() => item(input.id)),
    }),
    library_folder_path: createTool({
      id: 'library_folder_path', description: 'Get the Library folder metadata chain from the root to an existing folder in this workspace. These are Library IDs and titles, never filesystem paths.',
      inputSchema: z.object({ id }).strict(),
      execute: (input) => execute(() => ({ folders: getLibraryFolderPath(workspaceId, input.id) })),
    }),
    library_read_document: createTool({
      id: 'library_read_document', description: 'Read UTF-8 document text and its updatedAt version from this workspace Library. Refuses documents larger than 64 KiB before reading and refuses binary files/folders. Does not convert or duplicate an artifact.',
      inputSchema: z.object({ id }).strict(),
      execute: (input, context) => execute(async () => {
        const current = item(input.id)
        if (current.type !== 'document') throw domainError('invalid', 'Only Library documents can be read as text.')
        const signal = context?.abortSignal ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
        const bytes = await readLibraryContent(workspaceId, current.id, { maxBytes: 65536, signal })
        if (item(current.id).updatedAt !== current.updatedAt) throw domainError('conflict', 'The document changed during the read.')
        return { item: current, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      }),
    }),
    library_create_document: createTool({
      id: 'library_create_document', description: 'Create one nonempty Markdown document in this workspace Library, optionally under an existing folder. Maximum 64 KiB UTF-8; attributed to the current named agent. Requires write authorization.',
      inputSchema: z.object({ title, content, parentId: id.nullable().optional() }).strict(),
      execute: (input) => execute(() => createLibraryItem({ workspaceId, title: input.title, mime: 'text/markdown', bytes: new TextEncoder().encode(input.content), parentId: input.parentId, createdBy: `agent:${scope.agentId}` })),
    }),
    library_create_folder: createTool({
      id: 'library_create_folder', description: 'Create a Library folder in this workspace, attributed to the current named agent. Optional parent must be a folder here; existing depth limits apply. Requires write authorization.',
      inputSchema: z.object({ title, parentId: id.nullable().optional() }).strict(),
      execute: (input) => execute(() => createLibraryFolder({ workspaceId, ...input, createdBy: `agent:${scope.agentId}` })),
    }),
    library_update_item: createTool({
      strict: false,
      id: 'library_update_item', description: 'Rename or move an existing Library file/document/folder without duplicating it. parentId null moves it to root. Replace content only for Markdown documents, at most 64 KiB UTF-8. Always supply the updatedAt version just read; stale versions, invalid parents, cycles and excess depth are refused. Requires write authorization.',
      inputSchema: z.object({ id, expectedUpdatedAt: version, title: title.optional(), parentId: id.nullable().optional(), content: content.optional() }).strict().refine((input) => input.title !== undefined || input.parentId !== undefined || input.content !== undefined, 'At least one change is required'),
      execute: (input) => execute(() => {
        const current = item(input.id)
        if (current.updatedAt !== input.expectedUpdatedAt) throw domainError('conflict', 'The item changed since it was read.')
        if (input.content !== undefined && current.type !== 'document') throw domainError('invalid', 'Only document text can be replaced.')
        return updateLibraryItem(workspaceId, current.id, { title: input.title, parentId: input.parentId, expectedUpdatedAt: input.expectedUpdatedAt, content: input.content === undefined ? undefined : new TextEncoder().encode(input.content) })
      }),
    }),
    library_delete_item: createTool({
      id: 'library_delete_item', description: 'Permanently delete exactly one Library item and its stored bytes after explicit native approval, even in Allow-all. Always use its current updatedAt version. Folders must already be empty; never recursively deletes children or creates public links.',
      requireApproval: true,
      inputSchema: z.object({ id, expectedUpdatedAt: version }).strict(),
      execute: (input) => execute(async () => {
        const current = item(input.id)
        if (current.updatedAt !== input.expectedUpdatedAt) throw domainError('conflict', 'The item changed since it was read.')
        await deleteLibraryItem(workspaceId, current.id)
        return { deletedId: current.id }
      }),
    }),
  }
}

export const MASTRA_LIBRARY_WRITES = new Set(['library_create_document', 'library_create_folder', 'library_update_item', 'library_delete_item'])
export const MASTRA_LIBRARY_DESTRUCTIVE = new Set(['library_delete_item'])
