import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ProjectStatus, Resource } from './types.ts'

/**
 * A project groups tasks and resources; see ./index.ts. `status` is the archive and the
 * soft delete: rows are never removed. `members` is a JSON array of actors ('user:<id>' or 'agent:<id>'), the
 * creator first; `resources` is a JSON array of { type, title, ref }.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<ProjectStatus>().notNull().default('active'),
    members: text('members', { mode: 'json' }).$type<string[]>().notNull().default([]),
    resources: text('resources', { mode: 'json' }).$type<Resource[]>().notNull().default([]),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('projects_workspace_status').on(table.workspaceId, table.status)],
)
