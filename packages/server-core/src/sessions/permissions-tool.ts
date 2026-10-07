import { updateWorkspacePermissions, getWorkspacePermissions } from '@otto/shared/agent'
import { domainError } from '@otto/shared/utils'
import { getMemberRole } from '@otto/shared/workspaces'

/**
 * What the agent tool `permissions_edit` does: read or replace the workspace's Explore-mode permission rules, as the
 * chat's user (members read, owners write: the guard of `bootstrap/authorize.ts`). It stays a typed server-side tool
 * on purpose, not an `otto` CLI command (docs/final-plan.md PT): these rules gate the agent itself, so a change goes
 * through the tool permission handshake and is blocked in Explore mode like every other write tool.
 * Returns what to tell the agent and whether anything changed (so the caller can push `domain:changed`).
 */
export function runPermissionsAction(workspaceId: string, userId: string | null, args: Record<string, unknown>): { result: unknown; wrote: boolean } {
  const role = userId ? getMemberRole(workspaceId, userId) : null
  if (!role) throw domainError('forbidden', 'You are not a member of this workspace')
  switch (args.action) {
    case 'get':
      return { result: getWorkspacePermissions(workspaceId), wrote: false }
    case 'update':
      if (role !== 'owner') throw domainError('forbidden', 'Only an owner of this workspace can change its permissions')
      return { result: updateWorkspacePermissions(workspaceId, args.rules), wrote: true }
  }
  throw domainError('invalid', `Unknown permissions action: ${String(args.action)}`)
}
