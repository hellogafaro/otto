import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { userActor } from '@otto/shared/actors'
import { domainError } from '@otto/shared/utils'
import {
  createLibraryFolder,
  createLibraryItem,
  deleteLibraryItem,
  getLibraryItem,
  getLibraryItems,
  MAX_FILE_BYTES,
  readLibraryContent,
  updateLibraryItem,
  type LibraryContent,
  type LibraryFilter,
  type LibraryUpdate,
} from '@otto/shared/library'
import { isWorkspaceMember } from '@otto/shared/workspaces'
import type { RpcServer, RequestContext } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.library.CREATE,
  RPC_CHANNELS.library.CREATE_FOLDER,
  RPC_CHANNELS.library.LIST,
  RPC_CHANNELS.library.GET,
  RPC_CHANNELS.library.READ,
  RPC_CHANNELS.library.UPDATE,
  RPC_CHANNELS.library.DELETE,
] as const

/** The workspace a request is for: its own, or the one of the calling window. */
export function resolveWorkspace(ctx: RequestContext, deps: HandlerDeps) {
  const ref = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
  const workspace = ref ? getWorkspaceByNameOrId(ref) : null
  if (!workspace) throw new Error('Cannot determine workspace')
  return workspace
}

/** The caller as an actor ('user:<id>'). The server fills it from the connection; a client never says who it is. */
export function actorOf(ctx: RequestContext): string {
  if (!ctx.userId) throw domainError('unauthorized', 'Sign in first')
  return userActor(ctx.userId)
}

/** Assignees and project members that are people ('user:<id>') must belong to the workspace; agents are not checked. */
export function assertWorkspaceActors(workspaceId: string, actors: unknown): void {
  for (const actor of Array.isArray(actors) ? actors : []) {
    if (typeof actor === 'string' && actor.startsWith('user:') && !isWorkspaceMember(workspaceId, actor.slice('user:'.length))) {
      throw domainError('invalid', `${actor} is not a member of this workspace`)
    }
  }
}

function toBytes(content: LibraryContent): Uint8Array {
  if (content.encoding === 'utf8') return new TextEncoder().encode(content.data)
  // Refuse before decoding: base64 is 4 characters per 3 bytes.
  if (content.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw domainError('too_large', `Files are limited to ${MAX_FILE_BYTES} bytes`)
  return new Uint8Array(Buffer.from(content.data, 'base64'))
}

export function registerLibraryHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.library.CREATE,
    (ctx, input: { title: string; mime: string; content: LibraryContent; parentId?: string | null }) =>
      createLibraryItem({
        workspaceId: resolveWorkspace(ctx, deps).id,
        title: input.title,
        mime: input.mime,
        bytes: toBytes(input.content),
        parentId: input.parentId,
        createdBy: actorOf(ctx),
      }),
  )

  server.handle(RPC_CHANNELS.library.CREATE_FOLDER, (ctx, input: { title: string; parentId?: string | null }) =>
    createLibraryFolder({ workspaceId: resolveWorkspace(ctx, deps).id, title: input.title, parentId: input.parentId, createdBy: actorOf(ctx) }),
  )

  server.handle(RPC_CHANNELS.library.LIST, (ctx, filter?: LibraryFilter) => getLibraryItems(resolveWorkspace(ctx, deps).id, filter))

  server.handle(RPC_CHANNELS.library.GET, (ctx, id: string) => getLibraryItem(resolveWorkspace(ctx, deps).id, id) ?? null)

  // Documents come back as text, every other file as base64.
  server.handle(RPC_CHANNELS.library.READ, async (ctx, id: string) => {
    const workspaceId = resolveWorkspace(ctx, deps).id
    const bytes = await readLibraryContent(workspaceId, id)
    const item = getLibraryItem(workspaceId, id)!
    const content: LibraryContent =
      item.type === 'document'
        ? { encoding: 'utf8', data: new TextDecoder().decode(bytes) }
        : { encoding: 'base64', data: Buffer.from(bytes).toString('base64') }
    return { item, content }
  })

  server.handle(RPC_CHANNELS.library.UPDATE, (ctx, id: string, patch: LibraryUpdate) =>
    updateLibraryItem(resolveWorkspace(ctx, deps).id, id, {
      title: patch.title,
      parentId: patch.parentId,
      content: patch.content && toBytes(patch.content),
      expectedUpdatedAt: patch.expectedUpdatedAt,
    }),
  )

  server.handle(RPC_CHANNELS.library.DELETE, async (ctx, id: string) => {
    await deleteLibraryItem(resolveWorkspace(ctx, deps).id, id)
  })
}
