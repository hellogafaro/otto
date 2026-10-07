import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.CREATE,
  RPC_CHANNELS.statuses.UPDATE,
  RPC_CHANNELS.statuses.DELETE,
  RPC_CHANNELS.statuses.REORDER,
  RPC_CHANNELS.statuses.SET_DEFAULT,
] as const

/** Statuses of a workspace: members read, owners write (`authorize.ts`); a write pushes `domain:changed` (`domain-changes.ts`). */
export function registerStatusesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all statuses for a workspace
  server.handle(RPC_CHANNELS.statuses.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getStatuses } = await import('@otto/shared/statuses')
    return getStatuses(workspace.id)
  })

  // Create a status, last in the order
  server.handle(RPC_CHANNELS.statuses.CREATE, async (_ctx, workspaceId: string, input: import('@otto/shared/statuses').CreateStatusInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createStatus } = await import('@otto/shared/statuses')
    return createStatus(workspace.id, input)
  })

  // Change a status's label, color, icon or category
  server.handle(RPC_CHANNELS.statuses.UPDATE, async (_ctx, workspaceId: string, statusId: string, updates: import('@otto/shared/statuses').UpdateStatusInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateStatus } = await import('@otto/shared/statuses')
    return updateStatus(workspace.id, statusId, updates)
  })

  // Delete a status: its chats move to todo
  server.handle(RPC_CHANNELS.statuses.DELETE, async (_ctx, workspaceId: string, statusId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteStatus } = await import('@otto/shared/statuses')
    return deleteStatus(workspace.id, statusId)
  })

  // The status new chats get
  server.handle(RPC_CHANNELS.statuses.SET_DEFAULT, async (_ctx, workspaceId: string, statusId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { setDefaultStatus } = await import('@otto/shared/statuses')
    setDefaultStatus(workspace.id, statusId)
  })

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  server.handle(RPC_CHANNELS.statuses.REORDER, async (_ctx, workspaceId: string, orderedIds: string[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderStatuses } = await import('@otto/shared/statuses')
    reorderStatuses(workspace.id, orderedIds)
  })
}
