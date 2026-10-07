import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { isActor, userIdOf } from '../actors.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { likeContains } from '../db/like.ts'
import { createId } from '../id.ts'
import { createNotification, deleteEntityNotifications } from '../notifications/index.ts'
import { ENTITY_TOKEN, isEntity } from '../entities.ts'
import { domainError } from '../utils/errors.ts'
import { isWorkspaceMember } from '../workspaces/members.ts'
import { comments } from './schema.ts'
import type { Comment } from './types.ts'

/**
 * Comments: what people (and agents) say on a task or a project.
 *
 *   comments(id, workspaceId, entity, createdBy, content, createdAt, updatedAt)   (schema.ts)
 *
 * `entity` is any typed reference '<type>:<id>' (../entities.ts: task and project now, comment for
 * replies later); this domain checks the shape and the type, the caller knows the entity exists, and a
 * new type needs no schema change. A mention is the token `user:<id>` in the content: creating a comment
 * writes one `mention` notification (../notifications) on the comment (`comment:<id>`) for each person it
 * names, once, never the author, and only workspace members. The author may edit a comment (`updatedAt`, no new notifications) and delete it
 * (hard delete; its notifications go too). Every function takes the workspace explicitly and only sees
 * its rows, and a `db` or `tx` last.
 */

export type * from './types.ts'

export const MAX_COMMENT = 20_000

/** The user ids a text mentions (its `user:<id>` tokens, `ENTITY_TOKEN`), once each. */
export const getMentions = (content: string): string[] =>
  [...new Set([...content.matchAll(ENTITY_TOKEN)].filter((match) => match[1] === 'user').map((match) => match[2]!))]

type Row = typeof comments.$inferSelect

const toComment = (row: Row): Comment => ({
  id: row.id,
  entity: row.entity,
  createdBy: row.createdBy,
  content: row.content,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
})

function assertContent(content: unknown): string {
  if (typeof content !== 'string' || !content.trim()) throw domainError('invalid', 'A comment cannot be empty')
  if (content.length > MAX_COMMENT) throw domainError('invalid', `Comments are limited to ${MAX_COMMENT} characters`)
  return content
}

/** Writes the comment and notifies the members it mentions, in the caller's transaction when `db` is one. */
export function createComment(input: { workspaceId: string; entity: string; createdBy: string; content: string }, db: Db | Tx = initDb()): Comment {
  if (!isEntity(input.entity)) throw domainError('invalid', `${String(input.entity)} is not an entity`)
  if (!isActor(input.createdBy)) throw domainError('invalid', `${String(input.createdBy)} is not an actor`)
  const content = assertContent(input.content)
  const author = userIdOf(input.createdBy)
  return (db as Db).transaction((tx) => {
    const now = new Date()
    const row = tx
      .insert(comments)
      .values({ id: createId(), workspaceId: input.workspaceId, entity: input.entity, createdBy: input.createdBy, content, createdAt: now, updatedAt: now })
      .returning()
      .get()
    for (const userId of getMentions(content)) {
      if (userId === author || !isWorkspaceMember(input.workspaceId, userId, tx)) continue
      createNotification({ userId, workspaceId: input.workspaceId, entity: `comment:${row.id}`, type: 'mention', createdBy: input.createdBy }, tx)
    }
    return toComment(row)
  })
}

/** The entity's comments, oldest first. */
export function getComments(workspaceId: string, entity: string, db: Db | Tx = initDb()): Comment[] {
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.workspaceId, workspaceId), eq(comments.entity, entity)))
    .orderBy(asc(comments.createdAt), sql`rowid`)
    .all()
    .map(toComment)
}

/** These comments, whatever their entity; the ones that do not exist are left out. */
export function getCommentsById(workspaceId: string, ids: string[], db: Db | Tx = initDb()): Comment[] {
  if (ids.length === 0) return []
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.workspaceId, workspaceId), inArray(comments.id, ids)))
    .all()
    .map(toComment)
}

/** The workspace's comments whose text contains `query` (plain LIKE), newest first; the caller drops those of entities it may not show. */
export function searchComments(workspaceId: string, query: string, limit = 20, db: Db | Tx = initDb()): Comment[] {
  const text = query.trim()
  if (!text) return []
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.workspaceId, workspaceId), likeContains(comments.content, text)))
    .orderBy(desc(comments.createdAt), sql`rowid desc`)
    .limit(limit)
    .all()
    .map(toComment)
}

function getOwnRow(workspaceId: string, id: string, actor: string, db: Db | Tx): Row {
  const row = db.select().from(comments).where(and(eq(comments.workspaceId, workspaceId), eq(comments.id, id))).get()
  if (!row) throw domainError('not_found', `Comment ${id} does not exist`)
  if (row.createdBy !== actor) throw domainError('forbidden', 'Only the author can change a comment')
  return row
}

/**
 * The author edits a comment. With `expectedUpdatedAt`, a different stored `updatedAt` means it changed
 * in between, and nothing changes (`conflict`). Mentions added by an edit notify nobody.
 */
export function updateComment(
  workspaceId: string,
  id: string,
  actor: string,
  content: string,
  expectedUpdatedAt?: number,
  db: Db | Tx = initDb(),
): Comment {
  const row = getOwnRow(workspaceId, id, actor, db)
  const text = assertContent(content)
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== row.updatedAt.getTime()) {
    throw domainError('conflict', `Comment ${id} changed since it was loaded`)
  }
  // Strictly after the stored value, so two saves in one millisecond still tell apart.
  const updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
  const updated = db.update(comments).set({ content: text, updatedAt }).where(and(eq(comments.id, id), eq(comments.updatedAt, row.updatedAt))).returning().get()
  if (!updated) throw domainError('conflict', `Comment ${id} changed since it was loaded`)
  return toComment(updated)
}

/** The author deletes a comment, and the notifications that point at it. */
export function deleteComment(workspaceId: string, id: string, actor: string, db: Db | Tx = initDb()): void {
  getOwnRow(workspaceId, id, actor, db)
  ;(db as Db).transaction((tx) => {
    deleteEntityNotifications(`comment:${id}`, tx)
    tx.delete(comments).where(eq(comments.id, id)).run()
  })
}
