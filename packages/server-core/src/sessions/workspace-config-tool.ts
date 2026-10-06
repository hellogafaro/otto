import { updateWorkspacePermissions, getWorkspacePermissions } from '@otto/shared/agent'
import { createLabel, deleteLabel, moveLabel, reorderLabels, updateLabel } from '@otto/shared/labels/crud'
import { getLabels } from '@otto/shared/labels/storage'
import { createStatus, deleteStatus, reorderStatuses, setDefaultStatus, updateStatus } from '@otto/shared/statuses/crud'
import { getStatuses } from '@otto/shared/statuses/storage'
import { domainError } from '@otto/shared/utils'
import { getMemberRole } from '@otto/shared/workspaces'

/**
 * What the agent tools `labels_edit`, `statuses_edit` and `permissions_edit` do: the domain functions, as the chat's
 * user, bounded to the chat's workspace (the guard of `bootstrap/authorize.ts`: members read, owners write).
 * They replace the agents editing `labels/config.json`, `statuses/config.json` and `permissions.json` by path, which
 * nothing reads any more; the Python `otto` CLI will take over from them (docs/data-architecture.md, PT).
 */

export type WorkspaceConfigDomain = 'labels' | 'statuses' | 'permissions'

const READS: Record<WorkspaceConfigDomain, string> = { labels: 'list', statuses: 'list', permissions: 'get' }

const str = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value) throw domainError('invalid', `${name} is required`)
  return value
}
const strList = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw domainError('invalid', `${name} must be a list of ids`)
  return value as string[]
}

/** A status icon that is an image data URL is not worth an agent's context: it says it is an image. */
const withoutImageData = <T extends { icon?: string }>(status: T): T => (status.icon?.startsWith('data:') ? { ...status, icon: '[image]' } : status)

/**
 * Runs one action for `userId` in the workspace. Returns what to tell the agent and whether anything changed
 * (so the caller can push `domain:changed`). Throws `forbidden` for a non-member, or a non-owner who writes.
 */
export function runWorkspaceConfigAction(workspaceId: string, userId: string | null, domain: WorkspaceConfigDomain, args: Record<string, unknown>): { result: unknown; wrote: boolean } {
  const action = str(args.action, 'action')
  const role = userId ? getMemberRole(workspaceId, userId) : null
  if (!role) throw domainError('forbidden', 'You are not a member of this workspace')
  const wrote = action !== READS[domain]
  if (wrote && role !== 'owner') throw domainError('forbidden', `Only an owner of this workspace can change its ${domain}`)

  if (domain === 'labels') {
    const id = () => str(args.id, 'id')
    switch (action) {
      case 'list':
        return { result: getLabels(workspaceId), wrote }
      case 'create':
        return { result: createLabel(workspaceId, { name: str(args.name, 'name'), color: args.color as never, parentId: args.parentId as string | undefined, valueType: args.valueType as never, autoRules: args.autoRules as never }), wrote }
      case 'update':
        return { result: updateLabel(workspaceId, id(), { name: args.name as string | undefined, color: args.color as never, valueType: args.valueType as never, autoRules: args.autoRules as never }), wrote }
      case 'delete':
        return { result: deleteLabel(workspaceId, id()), wrote }
      case 'move':
        moveLabel(workspaceId, id(), (args.parentId as string | null | undefined) ?? null)
        return { result: getLabels(workspaceId), wrote }
      case 'reorder':
        reorderLabels(workspaceId, (args.parentId as string | null | undefined) ?? null, strList(args.orderedIds, 'orderedIds'))
        return { result: getLabels(workspaceId), wrote }
    }
  } else if (domain === 'statuses') {
    const id = () => str(args.id, 'id')
    switch (action) {
      case 'list':
        return { result: getStatuses(workspaceId).map(withoutImageData), wrote }
      case 'create':
        return { result: withoutImageData(createStatus(workspaceId, { label: str(args.label, 'label'), color: args.color as never, icon: args.icon as string | undefined, category: args.category as never })), wrote }
      case 'update':
        return { result: withoutImageData(updateStatus(workspaceId, id(), { label: args.label as string | undefined, color: args.color as never, icon: args.icon as string | undefined, category: args.category as never })), wrote }
      case 'delete':
        return { result: deleteStatus(workspaceId, id()), wrote }
      case 'reorder':
        reorderStatuses(workspaceId, strList(args.orderedIds, 'orderedIds'))
        return { result: getStatuses(workspaceId).map(withoutImageData), wrote }
      case 'set_default':
        setDefaultStatus(workspaceId, id())
        return { result: getStatuses(workspaceId).map(withoutImageData), wrote }
    }
  } else {
    switch (action) {
      case 'get':
        return { result: getWorkspacePermissions(workspaceId), wrote }
      case 'update':
        return { result: updateWorkspacePermissions(workspaceId, args.rules), wrote }
    }
  }
  throw domainError('invalid', `Unknown ${domain} action: ${action}`)
}
