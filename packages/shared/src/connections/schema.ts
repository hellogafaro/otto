import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One row per provider account or endpoint; see ./index.ts.
 * `scope` is 'install' or 'workspace:<id>'; `slug` is the stable handle chats and settings use, unique within a scope.
 * `type` is the provider type ('anthropic' | 'pi' | 'pi_compat'), `authType` how it signs in (the config's `LlmAuthType`).
 * `models` (the fetched list), `config` and `account` are JSON. `secretId` points into the secrets domain (no foreign key).
 * The columns added after the first version are nullable or carry a constant default, and `slug` stays nullable (the
 * domain always sets it): `db:push` then adds them to a table that has rows with `ALTER TABLE`, where a stricter
 * column would make it rebuild the table and copy the new columns from columns the old table does not have.
 */
export const connections = sqliteTable(
  'connections',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull().default('install'),
    slug: text('slug'),
    type: text('type').notNull(),
    authType: text('authType').notNull().default('none'),
    title: text('title').notNull(),
    baseUrl: text('baseUrl'),
    defaultModel: text('defaultModel'),
    models: text('models'),
    config: text('config'),
    account: text('account'),
    secretId: text('secretId'),
    lastUsedAt: integer('lastUsedAt', { mode: 'timestamp_ms' }),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('connections_scope_slug').on(table.scope, table.slug)],
)
