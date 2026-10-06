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
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
})

export const usersSessions = sqliteTable(
  'users_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    /** Added by the organization plugin; workspaces are its organizations. */
    activeOrganizationId: text('activeOrganizationId'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('users_sessions_user').on(table.userId)],
)

/** `password` is the scrypt hash of an email-and-password account; null for the other providers. */
export const usersAccounts = sqliteTable(
  'users_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    password: text('password'),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
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
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('users_verifications_identifier').on(table.identifier)],
)
