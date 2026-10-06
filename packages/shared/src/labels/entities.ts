import { and, eq } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { domainError } from '../utils/errors.ts'
import { labels, labelsEntities } from './schema.ts'
import { getLabelRow } from './storage.ts'

/**
 * Labels on things: one assignment table (`labels_entities`) for every kind that carries labels, owned
 * here; chats, library items, tasks and projects call these functions and never read it. An `entity` is
 * '<type>:<id>' (`chat:`, `library:`, `task:`, `project:`). Labels are named by slug, the id chats and
 * agents write (`bug`); `value` is the part after `::` of a valued label (`priority::3` is slug `priority`,
 * value `3`). Chats keep their labels in their headers until they move to the database, so nothing calls
 * these for chats yet.
 */

const ENTITY = /^[a-z]+:[A-Za-z0-9_-]{1,64}$/

function assertEntity(entity: string): void {
  if (typeof entity !== 'string' || !ENTITY.test(entity)) throw domainError('invalid', `${String(entity)} is not an entity`)
}

/** Gives the entity the label (with its value, replacing an earlier one); `not_found` when the workspace has no such label. */
export function setEntityLabel(workspaceId: string, entity: string, slug: string, value?: string | null, db: Db | Tx = initDb()): void {
  assertEntity(entity)
  const label = getLabelRow(workspaceId, slug, db)
  if (!label) throw domainError('not_found', `Label '${slug}' not found`)
  db.insert(labelsEntities)
    .values({ workspaceId, labelId: label.id, entity, value: value ?? null })
    .onConflictDoUpdate({ target: [labelsEntities.labelId, labelsEntities.entity], set: { value: value ?? null } })
    .run()
}

/** Takes the label off the entity; nothing happens when it did not carry it. */
export function removeEntityLabel(workspaceId: string, entity: string, slug: string, db: Db | Tx = initDb()): void {
  assertEntity(entity)
  const label = getLabelRow(workspaceId, slug, db)
  if (!label) return
  db.delete(labelsEntities).where(and(eq(labelsEntities.workspaceId, workspaceId), eq(labelsEntities.labelId, label.id), eq(labelsEntities.entity, entity))).run()
}

/** The labels an entity carries, as `{ label: slug, value }`. */
export function getEntityLabels(workspaceId: string, entity: string, db: Db | Tx = initDb()): { label: string; value: string | null }[] {
  assertEntity(entity)
  return db
    .select({ label: labels.slug, value: labelsEntities.value })
    .from(labelsEntities)
    .innerJoin(labels, eq(labels.id, labelsEntities.labelId))
    .where(and(eq(labelsEntities.workspaceId, workspaceId), eq(labelsEntities.entity, entity)))
    .all()
}

/** Everything that carries a label, as `{ entity, value }`; empty for an unknown label. */
export function getLabeledEntities(workspaceId: string, slug: string, db: Db | Tx = initDb()): { entity: string; value: string | null }[] {
  const label = getLabelRow(workspaceId, slug, db)
  if (!label) return []
  return db
    .select({ entity: labelsEntities.entity, value: labelsEntities.value })
    .from(labelsEntities)
    .where(and(eq(labelsEntities.workspaceId, workspaceId), eq(labelsEntities.labelId, label.id)))
    .all()
}
