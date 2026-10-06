import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.DELETE,
] as const

/** Labels of a workspace: members read, owners write (`authorize.ts`); a write pushes `domain:changed` (`domain-changes.ts`). */
export function registerLabelsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // List all labels for a workspace
  server.handle(RPC_CHANNELS.labels.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getLabels } = await import('@otto/shared/labels/storage')
    return getLabels(workspace.id)
  })

  // Create a new label in a workspace
  server.handle(RPC_CHANNELS.labels.CREATE, async (_ctx, workspaceId: string, input: import('@otto/shared/labels').CreateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@otto/shared/labels/crud')
    const label = createLabel(workspace.id, input)
    deps.sessionManager.emitLabelConfigChange(workspace.id)
    return label
  })

  // Delete a label (and descendants) from a workspace
  server.handle(RPC_CHANNELS.labels.DELETE, async (_ctx, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteLabel } = await import('@otto/shared/labels/crud')
    const result = deleteLabel(workspace.id, labelId)
    deps.sessionManager.emitLabelConfigChange(workspace.id)
    return result
  })
}
