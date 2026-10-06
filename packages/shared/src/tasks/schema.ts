import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Resource } from '../projects/types.ts'
import type { TaskStatus } from './types.ts'

/**
 * A task belongs to one project; see ./index.ts. `status` is the archive and the soft
 * delete: rows are never removed. `assignees` is a JSON array of actors, `resources` of
 * { type, title, ref }. `createdBy` is 'user:<id>' or 'agent:<id>'.
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    projectId: text('projectId').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<TaskStatus>().notNull().default('todo'),
    dueAt: integer('dueAt', { mode: 'timestamp_ms' }),
    assignees: text('assignees', { mode: 'json' }).$type<string[]>().notNull().default([]),
    resources: text('resources', { mode: 'json' }).$type<Resource[]>().notNull().default([]),
    createdBy: text('createdBy').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('tasks_workspace_project').on(table.workspaceId, table.projectId, table.status)],
)

/** Time logged on a task, in milliseconds (so a timer can fill it later). Rows are removed for real. */
export const timesheets = sqliteTable(
  'timesheets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    taskId: text('taskId').notNull(),
    createdBy: text('createdBy').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    time: integer('time').notNull(),
    notes: text('notes').notNull().default(''),
  },
  (table) => [index('timesheets_workspace_task').on(table.workspaceId, table.taskId)],
)
