import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One row per workspace skill, the index of its bundle; see ./store.ts. The bundle (`SKILL.md`, an icon,
 * scripts and references) is in S3 under `workspaces/<workspace>/skills/<slug>/`, never in the table.
 * `title` and `description` come from SKILL.md's frontmatter (`name`, `description`) and are refreshed on every
 * write. `hash` is the sha256 of the bundle's sorted manifest (path, size, sha256 of each file): an equal hash
 * means nothing to write. `slug` is the folder name agents and mentions use and never changes.
 * `createdBy` is the actor that made it: 'user:<id>' or 'agent:<id>'.
 */
export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    hash: text('hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('skills_workspace_slug').on(table.workspaceId, table.slug)],
)
