import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One row per provider account or endpoint; see ./index.ts.
 * `scope` is 'install' or 'workspace:<id>'; `slug` is the stable handle chats and settings use, unique within a scope.
 * `type` is the provider type ('anthropic' | 'pi' | 'pi_compat'), `authType` how it signs in (the config's `LlmAuthType`).
 * `models` (the fetched list) and `config` (which holds the OAuth `account`) are JSON. `secretId` points into the secrets domain (no foreign key).
 * `slug` stays nullable and `authType` keeps its default: the domain always sets them.
 */
export const connections = sqliteTable(
  'connections',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull().default('install'),
    slug: text('slug'),
    type: text('type').notNull(),
    authType: text('auth_type').notNull().default('none'),
    title: text('title').notNull(),
    baseUrl: text('base_url'),
    defaultModel: text('default_model'),
    models: text('models'),
    config: text('config'),
    secretId: text('secret_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('connections_scope_slug').on(table.scope, table.slug)],
)
