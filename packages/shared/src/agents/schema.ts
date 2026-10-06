import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * An agent of a workspace; see ./index.ts and docs/final-plan.md 2.7. Explicit snake_case column names (the repo
 * is moving to them, docs/schema.md); the TypeScript properties stay camelCase. `skills` and `sources` are JSON
 * arrays of ids (`[]` = all), `model` null = the connection's default, `avatar` empty (a generated avatar from the id)
 * or `library:<id>` (an uploaded image), `createdBy` an actor ('user:<id>'). The domain writes every value; `avatar`
 * alone has the SQL default '' so the table can gain it.
 */
export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    thinkingLevel: text('thinking_level').notNull(),
    skills: text('skills', { mode: 'json' }).$type<string[]>().notNull(),
    sources: text('sources', { mode: 'json' }).$type<string[]>().notNull(),
    avatar: text('avatar').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('agents_workspace_created').on(table.workspaceId, table.createdAt)],
)
