import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.REORDER,
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

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  server.handle(RPC_CHANNELS.statuses.REORDER, async (_ctx, workspaceId: string, orderedIds: string[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderStatuses } = await import('@otto/shared/statuses')
    reorderStatuses(workspace.id, orderedIds)
  })
}
