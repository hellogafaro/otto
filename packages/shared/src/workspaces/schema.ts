import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * What Better Auth's organization plugin stores for a workspace (see ../users/index.ts and
 * ./members.ts). `workspaces` mirrors the registry in the config: `id` is the workspace id and
 * `slug` is the id too (the route slug is the folder name and is not unique). `logo` and
 * `metadata` are the plugin's; nothing here writes them. Roles are `owner` and `member`.
 * `workspaceId` is the plugin's `organizationId`, `title` its `name`.
 */
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
})

export const workspacesMembers = sqliteTable(
  'workspaces_members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    userId: text('userId').notNull(),
    role: text('role').notNull().default('member'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('workspaces_members_workspace_user').on(table.workspaceId, table.userId), index('workspaces_members_user').on(table.userId)],
)

/** An invitation is a link: its `id` is the token. `status` is 'pending', 'accepted', 'rejected' or 'canceled'. */
export const workspacesInvitations = sqliteTable(
  'workspaces_invitations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    inviterId: text('inviterId').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('workspaces_invitations_email').on(table.email)],
)
