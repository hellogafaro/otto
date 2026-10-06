import { userIdOf } from '@otto/shared/actors'
import { domainError } from '@otto/shared/utils'

/**
 * Chats are private: a chat belongs to the user who created it (`createdBy`, 'user:<id>') and
 * nobody else in the workspace sees or touches it. A chat with no `createdBy` was made before
 * chats were private; it belongs to the workspace owners.
 */

/** The user ids of a workspace's owners. The host sets it from the database; until then no owner exists. */
export type WorkspaceOwners = (workspaceId: string) => string[]

/** User ids who may see a chat: its creator; with no creator, the owners of its workspace. */
export function getChatAudience(chat: { createdBy?: string }, ownersOf: () => string[]): string[] {
  if (!chat.createdBy) return ownersOf()
  const userId = userIdOf(chat.createdBy)
  return userId ? [userId] : []
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
