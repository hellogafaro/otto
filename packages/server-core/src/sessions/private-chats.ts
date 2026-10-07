import { userIdOf } from '@otto/shared/actors'
import { domainError } from '@otto/shared/utils'

/**
 * Who sees a chat: its member people (`chats_members` rows 'user:<id>'; docs/schema.md "Chats"). The creator is
 * always a member; a workspace owner who is not one does not see it either. Agents are members too but see nothing.
 */

/** The user ids of a workspace's owners. The host sets it from the database; until then no owner exists. */
export type WorkspaceOwners = (workspaceId: string) => string[]

/** User ids who may see a chat: its member people. */
export function getChatAudience(chat: { members?: readonly { actor: string }[] }): string[] {
  return (chat.members ?? []).map((member) => userIdOf(member.actor)).filter((id): id is string => !!id)
}

/** What a chat that is not yours looks like: a chat that does not exist. */
export const chatNotFound = (sessionId: string) => domainError('not_found', `Session not found: ${sessionId}`)

/** Throws not_found unless the caller may see the chat (a chat that does not exist is not visible either). */
export function assertOwnsSession(
  sessions: { canSeeSession(sessionId: string, userId: string | null): boolean },
  ctx: { userId: string | null },
  sessionId: unknown,
): void {
  if (typeof sessionId !== 'string' || !sessions.canSeeSession(sessionId, ctx.userId)) throw chatNotFound(String(sessionId))
}
