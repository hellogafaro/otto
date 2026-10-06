import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One row per workspace source, the index of its bundle; see ./store.ts. The bundle (`config.json`, `guide.md`, an
 * icon, `permissions.json`) is in S3 under `workspaces/<workspace>/sources/<slug>/`, never in the table.
 * `title`, `type` and `auth_status` are read from config.json (`name`, `type`, and its `connectionStatus` and
 * `isAuthenticated`) and refreshed on every write. `hash` is the sha256 of the bundle's sorted manifest: an equal hash
 * means nothing to write. `slug` is the folder name agents and mentions use and never changes.
 * `secret_id` is the source's credential in `secrets` (OAuth tokens, a bearer token, an API key): never part of the
 * bundle, and not touched by a bundle write. `created_by` is the actor that made it: 'user:<id>' or 'agent:<id>'.
 */
export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    type: text('type').notNull(), // mcp | api | local
    authStatus: text('auth_status').notNull(), // ok | needs_auth | error
    secretId: text('secret_id'),
    hash: text('hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('sources_workspace_slug').on(table.workspaceId, table.slug)],
)
