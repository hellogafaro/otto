import { canEditAgent, getAgent } from '@otto/shared/agents'
import { canEditRoutine, getRoutine } from '@otto/shared/automations/routines'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { INSTALL_SCOPE, getConnection, narrowContext, userScope, workspaceScope } from '@otto/shared/connections'
import { userActor } from '@otto/shared/actors'
import { RPC_CHANNELS as C } from '@otto/shared/protocol'
import { CATALOGUE, getEntityKind, userEntity } from '@otto/shared/settings'
import { getSkill } from '@otto/shared/skills'
import { getSource } from '@otto/shared/sources'
import { domainError } from '@otto/shared/utils'
import { getFirstUser } from '@otto/shared/users/queries'
import { getMemberRole, type WorkspaceRole } from '@otto/shared/workspaces'

/**
 * The membership guard: one function the transport calls before any handler runs (and at connect).
 * The caller (`ctx.userId`) must belong to the connection's workspace and, for the channels below,
 * to the workspace their argument names. Handlers never know about users.
 *
 * A workspace argument is an id or a name (`getWorkspaceByNameOrId`, as the handlers resolve it), or
 * an object with a `workspaceId`. Which channels take one is declared here;
 * `authorize.test.ts` registers every handler and fails when a handler with a workspace parameter
 * is missing from this map.
 */

/** Channel -> index of the argument that names a workspace. */
export const WORKSPACE_ARG_CHANNELS = new Map<string, number>([
  ...[
    C.llmConnections.SET_WORKSPACE_DEFAULT,
    C.labels.LIST, C.labels.CREATE, C.labels.DELETE,
    C.resources.EXPORT, C.resources.IMPORT,
    C.sessions.CREATE, C.sessions.IMPORT, C.sessions.IMPORT_REMOTE_TRANSFER, C.sessions.MARK_ALL_READ, C.sessions.SEARCH_CONTENT,
    C.skills.GET, C.skills.GET_FILES, C.skills.DELETE, C.skills.OPEN_EDITOR, C.skills.OPEN_FINDER,
    C.sources.GET, C.sources.CREATE, C.sources.DELETE, C.sources.GET_MCP_TOOLS, C.sources.GET_PERMISSIONS, C.sources.SAVE_CREDENTIALS,
    C.statuses.LIST, C.statuses.REORDER,
    C.window.SWITCH_WORKSPACE,
    C.workspace.GET_PERMISSIONS, C.workspace.READ_IMAGE, C.workspace.WRITE_IMAGE, C.workspace.SETTINGS_GET, C.workspace.SETTINGS_UPDATE,
    C.workspaces.UPDATE_REMOTE, C.workspaces.GET_MEMBERS, C.workspaces.GET_INVITATIONS, C.workspaces.INVITE,
    C.workspaces.REMOVE_MEMBER, C.workspaces.UPDATE_MEMBER_ROLE, C.workspaces.LEAVE,
  ].map((channel): [string, number] => [channel, 0]),
  [C.sessions.GET_MODEL, 1],
  [C.sessions.SET_MODEL, 1],
  [C.notification.SHOW, 2],
])

/** Channels only an owner of the named workspace may call: members and invitations, workspace settings, labels and statuses (members read them). (`workspaces:revokeInvitation` takes an invitation id and checks in its handler.) */
export const OWNER_CHANNELS = new Set<string>([
  C.workspaces.GET_INVITATIONS,
  C.workspaces.INVITE,
  C.workspaces.REMOVE_MEMBER,
  C.workspaces.UPDATE_MEMBER_ROLE,
  C.workspace.SETTINGS_UPDATE,
  C.workspaces.UPDATE_REMOTE,
  C.llmConnections.SET_WORKSPACE_DEFAULT,
  C.labels.CREATE,
  C.labels.DELETE,
  C.statuses.REORDER,
])

/**
 * Channels that change one agent, naming it by id in their first argument: its creator or an owner of the connection's
 * workspace may (`canEditAgent`); every other member is refused. Any member lists, gets and creates agents. An id that is
 * no agent of that workspace is let through: the handler answers `not_found`, to everyone alike.
 */
export const AGENT_WRITE_CHANNELS = new Set<string>([C.agents.UPDATE, C.agents.DELETE])

/**
 * Channels that change or run one routine, naming it by id in their first argument: its creator or an owner of the
 * connection's workspace may; every other member is refused (an owner's change makes the routine the owner's, and
 * Run now runs as the person who asked: `updateRoutine`). Any member lists, gets and creates routines. An id that
 * is no routine of that workspace is let through: the handler answers `not_found`, to everyone alike.
 */
export const ROUTINE_WRITE_CHANNELS = new Set<string>([C.routines.UPDATE, C.routines.DELETE, C.routines.PAUSE, C.routines.RESUME, C.routines.RUN])

/** Channels that change one skill: `(workspace, slug)`. Members read skills; the skill's creator or an owner of the workspace writes. */
export const SKILL_WRITE_CHANNELS = new Set<string>([C.skills.DELETE])

/**
 * Channels that change one source or its credential: its creator or an owner of the workspace may; any member reads and
 * creates sources. A value gives the workspace and the slug the call names: the first two arguments, or for the sign-in
 * channels (`oauth:start`, `oauth:revoke`) the slug in the first argument and the connection's workspace.
 */
export const SOURCE_WRITE_CHANNELS = new Map<string, (args: unknown[], workspaceRef: string | null) => [unknown, unknown]>([
  [C.sources.DELETE, (args) => [args[0], args[1]]],
  [C.sources.SAVE_CREDENTIALS, (args) => [args[0], args[1]]],
  [C.oauth.START, (args, workspaceRef) => [workspaceRef, (args[0] as { sourceSlug?: unknown } | undefined)?.sourceSlug]],
  [C.oauth.REVOKE, (args, workspaceRef) => [workspaceRef, (args[0] as { sourceSlug?: unknown } | undefined)?.sourceSlug]],
])

/**
 * Channels only the instance owner may call: they write `install` settings (or read one that holds a secret), or ask
 * about the server's own `claude` (a Claude subscription is the instance owner's alone, `getClaudeCodeScope`).
 * The instance owner is the first user (the earliest account): the owner of every workspace in a single-workspace
 * install, who `OTTO_SERVER_TOKEN` and the desktop app act as. Everyone else, workspace owners included, is refused.
 */
export const INSTANCE_OWNER_CHANNELS = new Set<string>([
  C.claudeCode.GET_STATUS,
  C.settings.SET_DEFAULT_THINKING_LEVEL,
  C.settings.GET_SERVER_CONFIG,
  C.settings.SET_SERVER_CONFIG,
  C.settings.GET_SERVER_STATUS,
  C.power.SET_KEEP_AWAKE,
  C.update.DISMISS,
  C.decisions.SET_SETTINGS,
  C.gitbash.SET_PATH,
  C.onboarding.DEFER_SETUP,
])

/**
 * Channels that write a connection or its credential (or reveal its masked key): sign-in flows, setup, save, delete,
 * test, model refresh. Value: the index of the argument that names the connection, a slug or an object with a
 * `slug` (`connectionSlug` for a setup test); the channels with no argument act on the install. Who may call them
 * follows the connection's scope: the instance owner for the install's, the owners of the workspace for a workspace's,
 * the person for their own.
 * A new connection is the caller's own unless its setup asks for `scope: 'workspace'` (in the connection's workspace) or `'install'`.
 */
export const CONNECTION_WRITE_CHANNELS = new Map<string, number>([
  [C.settings.SETUP_LLM_CONNECTION, 0],
  [C.settings.TEST_LLM_CONNECTION_SETUP, 0],
  [C.llmConnections.SAVE, 0],
  [C.llmConnections.DELETE, 0],
  [C.llmConnections.TEST, 0],
  [C.llmConnections.REFRESH_MODELS, 0],
  [C.chatgpt.START_OAUTH, 0],
  [C.chatgpt.CANCEL_OAUTH, 0],
  [C.chatgpt.LOGOUT, 0],
  [C.copilot.START_OAUTH, 0],
  [C.copilot.CANCEL_OAUTH, 0],
  [C.copilot.LOGOUT, 0],
])

/** Channels that address any settings entity by name: `(entity, key, ...)`. */
const SETTING_CHANNELS = new Map<string, 'read' | 'write'>([
  [C.settings.GET_SETTING, 'read'],
  [C.settings.UPDATE_SETTING, 'write'],
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

export const isInstanceOwner = (userId: string): boolean => getFirstUser()?.id === userId

/** Throws `forbidden` unless the caller made the agent (`id`) or owns its workspace (the connection's, as the handler resolves it). */
function assertAgentWrite(userId: string, workspaceRef: string | null, id: unknown): void {
  const workspaceId = workspaceRef != null ? getWorkspaceByNameOrId(workspaceRef)?.id : undefined
  const agent = workspaceId && typeof id === 'string' ? getAgent(workspaceId, id) : undefined
  if (workspaceId && agent && !canEditAgent(workspaceId, agent, userId)) throw forbidden('Only the creator of this agent or an owner of this workspace can do that')
}

/** Throws `forbidden` unless the caller made the routine (`id`) or owns its workspace (the connection's, as the handler resolves it). */
function assertRoutineWrite(userId: string, workspaceRef: string | null, id: unknown): void {
  const workspaceId = workspaceRef != null ? getWorkspaceByNameOrId(workspaceRef)?.id : undefined
  const routine = workspaceId && typeof id === 'string' ? getRoutine(workspaceId, id) : undefined
  if (workspaceId && routine && !canEditRoutine(workspaceId, routine, userId)) throw forbidden('Only the creator of this routine or an owner of this workspace can do that')
}

/** Throws `forbidden` unless the caller made the source (`slug`) or owns its workspace. A source that is not there is the handler's `not_found`. */
function assertSourceWrite(userId: string, workspaceRef: unknown, slug: unknown): void {
  const workspaceId = typeof workspaceRef === 'string' ? getWorkspaceByNameOrId(workspaceRef)?.id : undefined
  const source = workspaceId && typeof slug === 'string' ? getSource(workspaceId, slug) : undefined
  if (workspaceId && source && source.createdBy !== userActor(userId) && getMemberRole(workspaceId, userId) !== 'owner') {
    throw forbidden('Only the creator of this source or an owner of this workspace can do that')
  }
}

/**
 * Throws `forbidden` unless the caller may change the connection this argument names (see `CONNECTION_WRITE_CHANNELS`).
 * Whose it is follows its scope: a person's own (`user:<id>`) only that person (a lookup never finds another's, the
 * instance owner's included), a workspace's its owners, the install's the instance owner.
 */
function assertConnectionWrite(ctx: { userId: string; workspaceId: string | null }, arg: unknown): void {
  const named = typeof arg === 'object' && arg !== null ? (arg as { slug?: unknown; connectionSlug?: unknown; scope?: unknown }) : undefined
  const slug = typeof arg === 'string' ? arg : (named?.slug ?? named?.connectionSlug)
  const kind = named?.scope === 'user' || named?.scope === 'workspace' || named?.scope === 'install' ? named.scope : undefined
  const workspaceId = (ctx.workspaceId != null && getWorkspaceByNameOrId(ctx.workspaceId)?.id) || undefined
  const where = narrowContext({ userId: ctx.userId, workspaceId }, kind)
  const existing = typeof slug === 'string' ? getConnection(slug, where) : undefined
  const scope = existing?.scope ?? (kind === 'install' ? INSTALL_SCOPE : kind === 'workspace' && workspaceId ? workspaceScope(workspaceId) : userScope(ctx.userId))
  if (scope === INSTALL_SCOPE) {
    if (!isInstanceOwner(ctx.userId)) throw forbidden('Only the owner of this server can do that')
  } else if (scope.startsWith('workspace:') && getMemberRole(scope.slice('workspace:'.length), ctx.userId) !== 'owner') {
    throw forbidden('Only an owner of this workspace can do that')
  }
}

/**
 * Who may read or write a settings entity. `user:<id>`: only that user, both ways. `workspace:<id>`: its members read,
 * its owners write. `install`: any signed-in user reads the keys that hold no secret, only the instance owner writes
 * (and reads the others). An entity that is not one, or an unknown key, is `invalid` (from the settings domain).
 */
export function assertSettingAccess(userId: string, entity: unknown, key: unknown, mode: 'read' | 'write'): void {
  const kind = getEntityKind(entity as string)
  if (kind === 'user') {
    if (entity !== userEntity(userId)) throw forbidden('These are another user\'s settings')
  } else if (kind === 'workspace') {
    const role = getMemberRole((entity as string).slice('workspace:'.length), userId)
    if (!role) throw forbidden('You are not a member of this workspace')
    if (mode === 'write' && role !== 'owner') throw forbidden('Only an owner of this workspace can do that')
  } else if ((mode === 'write' || CATALOGUE[key as keyof typeof CATALOGUE]?.sensitive) && !isInstanceOwner(userId)) {
    throw forbidden('Only the owner of this server can do that')
  }
}

/**
 * Throws `forbidden` unless the caller may make this request. Without a channel it checks a connection
 * (the handshake, a workspace switch): a signed-in user and, when the connection names a workspace, a member of it.
 */
export function authorize(ctx: { userId: string | null; workspaceId: string | null }, channel?: string, args: unknown[] = []): void {
  const { userId } = ctx
  if (!userId) throw forbidden('Sign in first')
  if (ctx.workspaceId != null && !getRoleIn(userId, ctx.workspaceId)) throw forbidden('You are not a member of this workspace')

  if (channel !== undefined) {
    if (INSTANCE_OWNER_CHANNELS.has(channel) && !isInstanceOwner(userId)) throw forbidden('Only the owner of this server can do that')
    const mode = SETTING_CHANNELS.get(channel)
    if (mode) assertSettingAccess(userId, args[0], args[1], mode)
    if (AGENT_WRITE_CHANNELS.has(channel)) assertAgentWrite(userId, ctx.workspaceId, args[0])
    if (ROUTINE_WRITE_CHANNELS.has(channel)) assertRoutineWrite(userId, ctx.workspaceId, args[0])
    const sourceArgs = SOURCE_WRITE_CHANNELS.get(channel)?.(args, ctx.workspaceId)
    if (sourceArgs) assertSourceWrite(userId, ...sourceArgs)
    const connectionArg = CONNECTION_WRITE_CHANNELS.get(channel)
    if (connectionArg !== undefined) assertConnectionWrite({ userId, workspaceId: ctx.workspaceId }, args[connectionArg])
  }

  const index = channel === undefined ? undefined : WORKSPACE_ARG_CHANNELS.get(channel)
  if (channel === undefined || index === undefined) return
  const arg = args[index]
  if (arg == null) return // the handler falls back to the connection's workspace, checked above
  const ref = typeof arg === 'string' ? arg : (arg as { workspaceId?: unknown }).workspaceId
  const role = typeof ref === 'string' ? getRoleIn(userId, ref) : null
  if (!role) throw forbidden('You are not a member of this workspace')
  if (OWNER_CHANNELS.has(channel) && role !== 'owner') throw forbidden('Only an owner of this workspace can do that')
  if (SKILL_WRITE_CHANNELS.has(channel) && role !== 'owner') {
    // A skill that is not there is the handler's `not_found`, not a refusal.
    const skill = typeof ref === 'string' && typeof args[1] === 'string' ? getSkill(getWorkspaceByNameOrId(ref)?.id ?? ref, args[1]) : undefined
    if (skill && skill.createdBy !== userActor(userId)) throw forbidden('Only the creator of this skill or an owner of this workspace can do that')
  }
}
