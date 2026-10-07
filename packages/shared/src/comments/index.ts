import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { isActor, userIdOf } from '../actors.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { likeContains } from '../db/like.ts'
import { createId } from '../id.ts'
import { createNotification, deleteEntityNotifications } from '../notifications/index.ts'
import { ENTITY_TOKEN, isEntity } from '../entities.ts'
import { domainError } from '../utils/errors.ts'
import { isWorkspaceMember } from '../workspaces/members.ts'
import { comments } from './schema.ts'
import type { ActivityEvent, Comment, CommentPage } from './types.ts'

/**
 * Comments: what people (and agents) say on a task or a project, and the activity events of a task.
 *
 *   comments(id, workspaceId, entity, type, createdBy, content, createdAt, updatedAt)   (schema.ts)
 *
 * `entity` is any typed reference '<type>:<id>' (../entities.ts: task and project now, comment for
 * replies later); this domain checks the shape and the type, the caller knows the entity exists, and a
 * new type needs no schema change. A mention is the token `user:<id>` in the content: creating a comment
 * writes one `mention` notification (../notifications) on the comment (`comment:<id>`) for each person it
 * names, once, never the author, and only workspace members. The author may edit a comment (`updatedAt`,
 * no new notifications) and delete it (hard delete; its notifications go too).
 *
 * An activity event is a row of `type` 'event' whose `content` is the ActivityEvent JSON (`event` once
 * read). Other domains write them with `createEvent` in their own transaction (tasks: ../tasks); events
 * never notify, are never searched and can be neither edited nor deleted. A change to the same value
 * writes nothing, and a from/to event by the same actor of the same kind within `EVENT_MERGE_MS` of the
 * entity's newest row (that row) is merged into it, so autosaved fields do not flood the feed. 'created'
 * is never stored: the reader synthesizes it from the entity. `getComments` pages comments and events
 * together. Every function takes the workspace explicitly and only sees its rows, and a `db` or `tx` last.
 */

export type * from './types.ts'

export const MAX_COMMENT = 20_000
/** A from/to event this soon after the same actor's event of the same kind is merged into it. */
export const EVENT_MERGE_MS = 5 * 60_000

/** The user ids a text mentions (its `user:<id>` tokens, `ENTITY_TOKEN`), once each. */
export const getMentions = (content: string): string[] =>
  [...new Set([...content.matchAll(ENTITY_TOKEN)].filter((match) => match[1] === 'user').map((match) => match[2]!))]

type Row = typeof comments.$inferSelect

/** The stored event JSON; undefined when the row is not a readable event. */
function parseEvent(content: string): ActivityEvent | undefined {
  try {
    const event = JSON.parse(content) as ActivityEvent
    return event && typeof event === 'object' && typeof event.kind === 'string' ? event : undefined
  } catch {
    return undefined
  }
}

function toComment(row: Row): Comment {
  const event = row.type === 'event' ? parseEvent(row.content) : undefined
  return {
    id: row.id,
    entity: row.entity,
    type: row.type,
    createdBy: row.createdBy,
    content: row.content,
    ...(event && { event }),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** Same value: the event shapes are plain JSON (strings, numbers, null and arrays of them). */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

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
      .values({ id: createId(), workspaceId: input.workspaceId, entity: input.entity, type: 'comment', createdBy: input.createdBy, content, createdAt: now, updatedAt: now })
      .returning()
      .get()
    for (const userId of getMentions(content)) {
      if (userId === author || !isWorkspaceMember(input.workspaceId, userId, tx)) continue
      createNotification({ userId, workspaceId: input.workspaceId, entity: `comment:${row.id}`, type: 'mention', createdBy: input.createdBy }, tx)
    }
    return toComment(row)
  })
}

/**
 * Records what happened to an entity, in the caller's transaction when `db` is one; never notifies.
 * Writes nothing (null) for a from/to event to the same value or a links event without links. A from/to
 * event of the same kind by the same actor as the entity's newest row, an event less than
 * `EVENT_MERGE_MS` old, updates that row's `to` instead (deleting it, null, when that lands back on its `from`).
 */
export function createEvent(input: { workspaceId: string; entity: string; createdBy: string; event: ActivityEvent }, db: Db | Tx = initDb()): Comment | null {
  if (!isEntity(input.entity)) throw domainError('invalid', `${String(input.entity)} is not an entity`)
  if (!isActor(input.createdBy)) throw domainError('invalid', `${String(input.createdBy)} is not an actor`)
  const next = input.event
  if ('from' in next && same(next.from, next.to)) return null
  if (next.kind === 'links' && next.added.length === 0 && next.removed.length === 0) return null
  return (db as Db).transaction((tx) => {
    const now = new Date()
    const last = tx
      .select()
      .from(comments)
      .where(and(eq(comments.workspaceId, input.workspaceId), eq(comments.entity, input.entity)))
      .orderBy(desc(comments.createdAt), sql`rowid desc`)
      .limit(1)
      .get()
    const prev = last?.type === 'event' && last.createdBy === input.createdBy && now.getTime() - last.createdAt.getTime() < EVENT_MERGE_MS ? parseEvent(last.content) : undefined
    if (last && prev && prev.kind === next.kind && 'from' in prev && 'from' in next) {
      const merged = { ...prev, to: next.to } as ActivityEvent
      if ('from' in merged && same(merged.from, merged.to)) {
        tx.delete(comments).where(eq(comments.id, last.id)).run()
        return null
      }
      const updatedAt = new Date(Math.max(now.getTime(), last.updatedAt.getTime() + 1))
      return toComment(tx.update(comments).set({ content: JSON.stringify(merged), updatedAt }).where(eq(comments.id, last.id)).returning().get()!)
    }
    const row = tx
      .insert(comments)
      .values({ id: createId(), workspaceId: input.workspaceId, entity: input.entity, type: 'event', createdBy: input.createdBy, content: JSON.stringify(next), createdAt: now, updatedAt: now })
      .returning()
      .get()
    return toComment(row)
  })
}

/**
 * A page of the entity's comments and events: the newest `limit` (50 by default, 1 to 500) strictly
 * before the row `before` (by creation, then insertion), oldest first; `more` = older rows remain,
 * `earlier` = how many. An unknown `before` is an empty page.
 */
export function getComments(workspaceId: string, entity: string, page: { before?: string; limit?: number } = {}, db: Db | Tx = initDb()): CommentPage {
  const limit = Number.isFinite(page.limit) ? Math.min(500, Math.max(1, Math.floor(page.limit!))) : 50
  const scope = and(eq(comments.workspaceId, workspaceId), eq(comments.entity, entity))
  let older
  if (page.before !== undefined) {
    const anchor = db
      .select({ createdAt: comments.createdAt, rowid: sql<number>`rowid` })
      .from(comments)
      .where(and(scope, eq(comments.id, String(page.before))))
      .get()
    if (!anchor) return { items: [], more: false, earlier: 0 }
    const at = anchor.createdAt.getTime()
    older = sql`(${comments.createdAt} < ${at} or (${comments.createdAt} = ${at} and rowid < ${anchor.rowid}))`
  }
  const rows = db
    .select()
    .from(comments)
    .where(and(scope, older))
    .orderBy(desc(comments.createdAt), sql`rowid desc`)
    .limit(limit + 1)
    .all()
  const more = rows.length > limit
  const earlier = more ? db.select({ count: sql<number>`count(*)` }).from(comments).where(and(scope, older)).get()!.count - limit : 0
  return { items: rows.slice(0, limit).reverse().map(toComment), more, earlier }
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

/** The workspace's comments (not events) whose text contains `query` (plain LIKE), newest first; the caller drops those of entities it may not show. */
export function searchComments(workspaceId: string, query: string, limit = 20, db: Db | Tx = initDb()): Comment[] {
  const text = query.trim()
  if (!text) return []
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.workspaceId, workspaceId), eq(comments.type, 'comment'), likeContains(comments.content, text)))
    .orderBy(desc(comments.createdAt), sql`rowid desc`)
    .limit(limit)
    .all()
    .map(toComment)
}

function getOwnRow(workspaceId: string, id: string, actor: string, db: Db | Tx): Row {
  const row = db.select().from(comments).where(and(eq(comments.workspaceId, workspaceId), eq(comments.id, id))).get()
  if (!row) throw domainError('not_found', `Comment ${id} does not exist`)
  if (row.type === 'event') throw domainError('forbidden', 'Activity events cannot be changed')
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
