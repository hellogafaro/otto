import { userActor } from '@otto/shared/actors'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getUserByEmail, getUsers } from '@otto/shared/users'
import { domainError } from '@otto/shared/utils'
import {
  createWorkspaceInvitation,
  deleteWorkspaceMember,
  getWorkspaceInvitation,
  getWorkspaceInvitations,
  getWorkspaceMembers,
  isWorkspaceMember,
  updateInvitationCanceled,
  updateWorkspaceMemberRole,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from '@otto/shared/workspaces'
import type { RpcServer } from '@otto/server-core/transport'
import { assertOwner } from '../../bootstrap/authorize'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaces.GET_MEMBERS,
  RPC_CHANNELS.workspaces.GET_INVITATIONS,
  RPC_CHANNELS.workspaces.INVITE,
  RPC_CHANNELS.workspaces.REVOKE_INVITATION,
  RPC_CHANNELS.workspaces.REMOVE_MEMBER,
  RPC_CHANNELS.workspaces.UPDATE_MEMBER_ROLE,
  RPC_CHANNELS.workspaces.LEAVE,
] as const

/** The workspace id behind a reference (an id or, as everywhere, a name). The guard has already checked membership. */
function idOf(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw domainError('not_found', 'That workspace does not exist')
  return workspace.id
}

/** What the owner sends the invitee: the login page signs them up and accepts through the plugin's endpoint. */
const toInvitation = (row: { id: string; email: string; expiresAt: Date }): WorkspaceInvitation => ({
  id: row.id,
  email: row.email,
  expiresAt: row.expiresAt.getTime(),
  link: `${(process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')}/login?invite=${row.id}&email=${encodeURIComponent(row.email)}`,
})

/**
 * Members and invitations of a workspace. The guard (bootstrap/authorize.ts) has already checked that
 * the caller is a member, and an owner for the channels in `OWNER_CHANNELS`; the domain functions keep
 * the rules (roles, the last owner, 7-day invitations bound to an email).
 */
export function registerWorkspaceMembersHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.workspaces.GET_MEMBERS, (_ctx, workspaceId: string): WorkspaceMember[] => {
    const members = getWorkspaceMembers(idOf(workspaceId))
    const people = new Map(getUsers(members.map((member) => member.userId)).map((user) => [user.id, user]))
    return members.flatMap(({ userId, role }) => {
      const user = people.get(userId)
      return user ? [{ actor: userActor(userId), userId, name: user.name, email: user.email, role }] : []
    })
  })

  server.handle(RPC_CHANNELS.workspaces.GET_INVITATIONS, (_ctx, workspaceId: string) => getWorkspaceInvitations(idOf(workspaceId)).map(toInvitation))

  server.handle(RPC_CHANNELS.workspaces.INVITE, (ctx, workspaceId: string, email: string) => {
    const id = idOf(workspaceId)
    const person = typeof email === 'string' ? getUserByEmail(email) : undefined
    if (person && isWorkspaceMember(id, person.id)) throw domainError('conflict', 'That person is already a member')
    return toInvitation(createWorkspaceInvitation({ workspaceId: id, email, inviterId: ctx.userId! }))
  })

  // Takes an invitation id, not a workspace: the owner check is here.
  server.handle(RPC_CHANNELS.workspaces.REVOKE_INVITATION, (ctx, id: string) => {
    const invitation = getWorkspaceInvitation(id)
    if (!invitation) throw domainError('not_found', 'That invitation does not exist')
    assertOwner(ctx.userId, invitation.workspaceId)
    updateInvitationCanceled(id)
  })

  server.handle(RPC_CHANNELS.workspaces.REMOVE_MEMBER, (_ctx, workspaceId: string, userId: string) => {
    const id = idOf(workspaceId)
    deleteWorkspaceMember(id, userId)
    server.removeUserFromWorkspace?.(userId, id)
  })

  server.handle(RPC_CHANNELS.workspaces.UPDATE_MEMBER_ROLE, (_ctx, workspaceId: string, userId: string, role: string) => {
    updateWorkspaceMemberRole(idOf(workspaceId), userId, role)
  })

  server.handle(RPC_CHANNELS.workspaces.LEAVE, (ctx, workspaceId: string) => {
    const id = idOf(workspaceId)
    deleteWorkspaceMember(id, ctx.userId!)
    server.removeUserFromWorkspace?.(ctx.userId!, id)
  })
}
