import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { RPC_CHANNELS as C } from '@otto/shared/protocol'
import { domainError } from '@otto/shared/utils'
import { getMemberRole, type WorkspaceRole } from '@otto/shared/workspaces'

/**
 * The membership guard: one function the transport calls before any handler runs (and at connect).
 * The caller (`ctx.userId`) must belong to the connection's workspace and, for the channels below,
 * to the workspace their argument names. Handlers never know about users.
 *
 * A workspace argument is an id or a name (`getWorkspaceByNameOrId`, as the handlers resolve it), or
 * for `automations:test` an object with a `workspaceId`. Which channels take one is declared here;
 * `authorize.test.ts` registers every handler and fails when a handler with a workspace parameter
 * is missing from this map.
 */

/** Channel -> index of the argument that names a workspace. */
export const WORKSPACE_ARG_CHANNELS = new Map<string, number>([
  ...[
    C.llmConnections.SET_WORKSPACE_DEFAULT,
    C.automations.GET, C.automations.TEST, C.automations.SET_ENABLED, C.automations.DUPLICATE, C.automations.DELETE,
    C.automations.GET_HISTORY, C.automations.GET_LAST_EXECUTED, C.automations.REPLAY,
    C.labels.LIST, C.labels.CREATE, C.labels.DELETE,
    C.pages.GET, C.pages.GET_ONE, C.pages.CREATE, C.pages.UPDATE, C.pages.DELETE, C.pages.GET_CONTENT, C.pages.SET_CONTENT,
    C.pages.GET_DATA, C.pages.GET_THUMBNAIL, C.pages.REGENERATE_THUMBNAIL, C.pages.CREATE_LEASE, C.pages.RELEASE_LEASE,
    C.pages.EXECUTE_ACTION, C.pages.CANCEL_ACTION, C.pages.ISSUE_GRANT, C.pages.LIST_GRANTS, C.pages.REVOKE_GRANT,
    C.pages.PUBLISH, C.pages.UNPUBLISH, C.pages.SET_PUBLICATION_PASSWORD, C.pages.GET_SHARE_DATA_SCAN,
    C.resources.EXPORT, C.resources.IMPORT,
    C.sessions.CREATE, C.sessions.IMPORT, C.sessions.IMPORT_REMOTE_TRANSFER, C.sessions.MARK_ALL_READ, C.sessions.SEARCH_CONTENT,
    C.skills.GET, C.skills.GET_FILES, C.skills.DELETE, C.skills.OPEN_EDITOR, C.skills.OPEN_FINDER,
    C.sources.GET, C.sources.CREATE, C.sources.DELETE, C.sources.GET_MCP_TOOLS, C.sources.GET_PERMISSIONS, C.sources.SAVE_CREDENTIALS,
    C.statuses.LIST, C.statuses.REORDER,
    C.views.LIST, C.views.SAVE,
    C.window.SWITCH_WORKSPACE,
    C.workspace.GET_PERMISSIONS, C.workspace.READ_IMAGE, C.workspace.WRITE_IMAGE, C.workspace.SETTINGS_GET, C.workspace.SETTINGS_UPDATE,
    C.workspaces.UPDATE_REMOTE, C.workspaces.GET_MEMBERS, C.workspaces.GET_INVITATIONS, C.workspaces.INVITE,
    C.workspaces.REMOVE_MEMBER, C.workspaces.UPDATE_MEMBER_ROLE, C.workspaces.LEAVE,
  ].map((channel): [string, number] => [channel, 0]),
  [C.sessions.GET_MODEL, 1],
  [C.sessions.SET_MODEL, 1],
  [C.notification.SHOW, 2],
])

/** Channels only an owner of the named workspace may call: members and invitations, workspace settings. (`workspaces:revokeInvitation` takes an invitation id and checks in its handler.) */
export const OWNER_CHANNELS = new Set<string>([
  C.workspaces.GET_INVITATIONS,
  C.workspaces.INVITE,
  C.workspaces.REMOVE_MEMBER,
  C.workspaces.UPDATE_MEMBER_ROLE,
  C.workspace.SETTINGS_UPDATE,
  C.workspaces.UPDATE_REMOTE,
])

const forbidden = (message: string) => domainError('forbidden', message)

/** The caller's role in the workspace a reference (id or name) names; null when not a member or no such workspace. */
export function getRoleIn(userId: string, ref: string): WorkspaceRole | null {
  const id = getWorkspaceByNameOrId(ref)?.id
  return id ? getMemberRole(id, userId) : null
}

/** Throws `forbidden` unless the caller is an owner of the workspace. For handlers that find the workspace themselves. */
export function assertOwner(userId: string | null, ref: string): void {
  if (!userId || getRoleIn(userId, ref) !== 'owner') throw forbidden('Only an owner of this workspace can do that')
}

/**
 * Throws `forbidden` unless the caller may make this request. Without a channel it checks a connection
 * (the handshake, a workspace switch): a signed-in user and, when the connection names a workspace, a member of it.
 */
export function authorize(ctx: { userId: string | null; workspaceId: string | null }, channel?: string, args: unknown[] = []): void {
  const { userId } = ctx
  if (!userId) throw forbidden('Sign in first')
  if (ctx.workspaceId != null && !getRoleIn(userId, ctx.workspaceId)) throw forbidden('You are not a member of this workspace')

  const index = channel === undefined ? undefined : WORKSPACE_ARG_CHANNELS.get(channel)
  if (channel === undefined || index === undefined) return
  const arg = args[index]
  if (arg == null) return // the handler falls back to the connection's workspace, checked above
  const ref = typeof arg === 'string' ? arg : (arg as { workspaceId?: unknown }).workspaceId
  const role = typeof ref === 'string' ? getRoleIn(userId, ref) : null
  if (!role) throw forbidden('You are not a member of this workspace')
  if (OWNER_CHANNELS.has(channel) && role !== 'owner') throw forbidden('Only an owner of this workspace can do that')
}
