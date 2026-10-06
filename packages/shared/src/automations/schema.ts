import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { RoutineConfig } from './routine-types.ts'

/**
 * A workspace's routines: what runs on a schedule or an event (docs/schema.md, docs/final-plan.md 2.8). `config` is
 * JSON (`RoutineConfig`: type, schedule or event, conditions, actions); `paused_at` null = active (no enabled
 * flag); `agent_id` null = the workspace's default agent; `created_by` an actor ('user:<id>'): its runs and their
 * chats belong to that person.
 */
export const routines = sqliteTable(
  'routines',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    agentId: text('agent_id'),
    title: text('title').notNull(),
    config: text('config', { mode: 'json' }).$type<RoutineConfig>().notNull(),
    pausedAt: integer('paused_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('routines_workspace').on(table.workspaceId)],
)

/**
 * One run of a routine. `scheduled_for` is the time the run was scheduled for (ms): the cron minute of a schedule,
 * else the trigger time. Its unique key with `routine_id` is what makes a schedule fire once across restarts and
 * nodes: the insert that wins runs it. `status` is `running` | `ok` | `error` | `skipped`; `chat_id` the chat a
 * prompt action started. The newest 20 per routine are kept.
 */
export const routinesHistory = sqliteTable(
  'routines_history',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    routineId: text('routine_id').notNull(),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
    status: text('status').notNull(),
    chatId: text('chat_id'),
    error: text('error'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('routines_history_routine_scheduled').on(table.routineId, table.scheduledFor),
    index('routines_history_workspace_routine_started').on(table.workspaceId, table.routineId, table.startedAt),
  ],
)
