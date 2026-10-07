import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.UPDATE,
  RPC_CHANNELS.labels.MOVE,
  RPC_CHANNELS.labels.REORDER,
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

  // Rename a label or change its color, value type or auto-apply rules (its id never changes)
  server.handle(RPC_CHANNELS.labels.UPDATE, async (_ctx, workspaceId: string, labelId: string, updates: import('@otto/shared/labels').UpdateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateLabel } = await import('@otto/shared/labels/crud')
    const label = updateLabel(workspace.id, labelId, updates)
    deps.sessionManager.emitLabelConfigChange(workspace.id)
    return label
  })

  // Move a label under another one (no parent = the top level)
  server.handle(RPC_CHANNELS.labels.MOVE, async (_ctx, workspaceId: string, labelId: string, parentId?: string | null) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { moveLabel } = await import('@otto/shared/labels/crud')
    moveLabel(workspace.id, labelId, parentId ?? null)
    deps.sessionManager.emitLabelConfigChange(workspace.id)
  })

  // Order the children of one parent (no parent = the top level)
  server.handle(RPC_CHANNELS.labels.REORDER, async (_ctx, workspaceId: string, orderedIds: string[], parentId?: string | null) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderLabels } = await import('@otto/shared/labels/crud')
    reorderLabels(workspace.id, parentId ?? null, orderedIds)
    deps.sessionManager.emitLabelConfigChange(workspace.id)
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
