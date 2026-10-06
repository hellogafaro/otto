import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { MemberRole, ProjectStatus, Resource } from './types.ts'

/**
 * A project groups tasks and resources; see ./index.ts. `status` is the archive and the
 * soft delete: rows are never removed. `resources` is a JSON array of { type, title, ref }.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<ProjectStatus>().notNull().default('active'),
    resources: text('resources', { mode: 'json' }).$type<Resource[]>().notNull().default([]),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('projects_workspace_status').on(table.workspaceId, table.status)],
)

/** Who is on a project. `actor` is 'user:<id>' or 'agent:<id>'. */
export const projectsMembers = sqliteTable(
  'projects_members',
  {
    projectId: text('projectId').notNull(),
    actor: text('actor').notNull(),
    role: text('role').$type<MemberRole>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.actor] })],
)
