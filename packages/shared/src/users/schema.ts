import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Better Auth's tables, named for this codebase through `modelName` (see ./index.ts). The
 * property names are Better Auth's field names: its Drizzle adapter finds columns by them.
 * `name` stays `name` (a person's name, not an item label) next to `library`.
 * `users_sessions` is not `sessions`: that word is a chat here.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const usersSessions = sqliteTable(
  'users_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Added by the organization plugin; workspaces are its organizations. */
    activeOrganizationId: text('active_organization_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('users_sessions_user').on(table.userId)],
)

/** `password` is the scrypt hash of an email-and-password account; null for the other providers. */
export const usersAccounts = sqliteTable(
  'users_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('users_accounts_user').on(table.userId)],
)

/** Kept for the mail flows that come later (verification, reset); nothing writes it yet. */
export const usersVerifications = sqliteTable(
  'users_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('users_verifications_identifier').on(table.identifier)],
)
