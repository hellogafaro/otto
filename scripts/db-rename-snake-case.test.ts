import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'bun:test'
import { openDb } from '../packages/shared/src/db/index.ts'
import { pushSchema } from '../packages/shared/src/db/push.ts'
import { migrateSnakeCase } from './db-rename-snake-case.ts'

/** The database before N0: the DDL drizzle-kit made from the camelCase schemas (read from a real one), plus the A1 `agents` table that still had `description`. */
const OLD_DDL = [
  "CREATE TABLE `secrets` ( `id` text PRIMARY KEY NOT NULL, `title` text NOT NULL, `value` text NOT NULL )",
  "CREATE TABLE `projects` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `title` text NOT NULL, `description` text DEFAULT '' NOT NULL, `status` text DEFAULT 'active' NOT NULL, `resources` text DEFAULT '[]' NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `projects_members` ( `projectId` text NOT NULL, `actor` text NOT NULL, `role` text NOT NULL, PRIMARY KEY(`projectId`, `actor`) )",
  "CREATE TABLE `library` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `folderId` text, `type` text NOT NULL, `title` text NOT NULL, `mime` text, `size` integer, `createdBy` text NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `workspaces` ( `id` text PRIMARY KEY NOT NULL, `title` text NOT NULL, `slug` text NOT NULL, `logo` text, `metadata` text, `createdAt` integer NOT NULL )",
  "CREATE TABLE `workspaces_invitations` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `email` text NOT NULL, `role` text, `status` text DEFAULT 'pending' NOT NULL, `inviterId` text NOT NULL, `expiresAt` integer NOT NULL, `createdAt` integer NOT NULL )",
  "CREATE TABLE `workspaces_members` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `userId` text NOT NULL, `role` text DEFAULT 'member' NOT NULL, `createdAt` integer NOT NULL )",
  "CREATE TABLE `users` ( `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `email` text NOT NULL, `emailVerified` integer DEFAULT false NOT NULL, `image` text, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `users_accounts` ( `id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `accountId` text NOT NULL, `providerId` text NOT NULL, `password` text, `accessToken` text, `refreshToken` text, `idToken` text, `accessTokenExpiresAt` integer, `refreshTokenExpiresAt` integer, `scope` text, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `users_sessions` ( `id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `token` text NOT NULL, `expiresAt` integer NOT NULL, `ipAddress` text, `userAgent` text, `activeOrganizationId` text, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `users_verifications` ( `id` text PRIMARY KEY NOT NULL, `identifier` text NOT NULL, `value` text NOT NULL, `expiresAt` integer NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `tasks` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `projectId` text NOT NULL, `title` text NOT NULL, `description` text DEFAULT '' NOT NULL, `status` text DEFAULT 'todo' NOT NULL, `dueAt` integer, `assignees` text DEFAULT '[]' NOT NULL, `resources` text DEFAULT '[]' NOT NULL, `createdBy` text NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `timesheets` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `taskId` text NOT NULL, `createdBy` text NOT NULL, `createdAt` integer NOT NULL, `time` integer NOT NULL, `notes` text DEFAULT '' NOT NULL )",
  "CREATE TABLE `comments` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `entity` text NOT NULL, `createdBy` text NOT NULL, `content` text NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `notifications` ( `id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `workspaceId` text NOT NULL, `entity` text NOT NULL, `type` text NOT NULL, `createdBy` text NOT NULL, `status` text DEFAULT 'unread' NOT NULL, `createdAt` integer NOT NULL )",
  "CREATE TABLE `labels` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `parentId` text, `slug` text NOT NULL, `title` text NOT NULL, `color` text, `valueType` text, `autoRules` text, `order` integer NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `labels_entities` ( `workspaceId` text NOT NULL, `labelId` text NOT NULL, `entity` text NOT NULL, `value` text, PRIMARY KEY(`labelId`, `entity`) )",
  "CREATE TABLE `statuses` ( `id` text PRIMARY KEY NOT NULL, `workspaceId` text NOT NULL, `slug` text NOT NULL, `title` text NOT NULL, `color` text, `icon` text, `category` text NOT NULL, `isFixed` integer NOT NULL, `isDefault` integer NOT NULL, `order` integer NOT NULL, `createdAt` integer NOT NULL, `updatedAt` integer NOT NULL )",
  "CREATE TABLE `settings` ( `entity` text NOT NULL, `key` text NOT NULL, `value` text NOT NULL, `updatedAt` integer NOT NULL, PRIMARY KEY(`entity`, `key`) )",
  "CREATE TABLE \"connections\" ( `id` text PRIMARY KEY NOT NULL, `scope` text DEFAULT 'install' NOT NULL, `slug` text, `type` text NOT NULL, `authType` text DEFAULT 'none' NOT NULL, `title` text NOT NULL, `baseUrl` text, `defaultModel` text, `models` text, `config` text, `account` text, `secretId` text, `lastUsedAt` integer, `createdAt` integer NOT NULL, `updatedAt` integer )",
  "CREATE INDEX `projects_workspace_status` ON `projects` (`workspaceId`,`status`)",
  "CREATE INDEX `library_workspace_folder` ON `library` (`workspaceId`,`folderId`)",
  "CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`)",
  "CREATE INDEX `workspaces_invitations_email` ON `workspaces_invitations` (`email`)",
  "CREATE UNIQUE INDEX `workspaces_members_workspace_user` ON `workspaces_members` (`workspaceId`,`userId`)",
  "CREATE INDEX `workspaces_members_user` ON `workspaces_members` (`userId`)",
  "CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)",
  "CREATE INDEX `users_accounts_user` ON `users_accounts` (`userId`)",
  "CREATE UNIQUE INDEX `users_sessions_token_unique` ON `users_sessions` (`token`)",
  "CREATE INDEX `users_sessions_user` ON `users_sessions` (`userId`)",
  "CREATE INDEX `users_verifications_identifier` ON `users_verifications` (`identifier`)",
  "CREATE INDEX `tasks_workspace_project` ON `tasks` (`workspaceId`,`projectId`,`status`)",
  "CREATE INDEX `timesheets_workspace_task` ON `timesheets` (`workspaceId`,`taskId`)",
  "CREATE INDEX `comments_workspace_entity` ON `comments` (`workspaceId`,`entity`,`createdAt`)",
  "CREATE INDEX `notifications_user_workspace_status` ON `notifications` (`userId`,`workspaceId`,`status`,`createdAt`)",
  "CREATE UNIQUE INDEX `notifications_user_entity_type` ON `notifications` (`userId`,`entity`,`type`)",
  "CREATE UNIQUE INDEX `labels_workspace_slug` ON `labels` (`workspaceId`,`slug`)",
  "CREATE INDEX `labels_workspace_parent` ON `labels` (`workspaceId`,`parentId`)",
  "CREATE INDEX `labels_entities_workspace_entity` ON `labels_entities` (`workspaceId`,`entity`)",
  "CREATE UNIQUE INDEX `statuses_workspace_slug` ON `statuses` (`workspaceId`,`slug`)",
  "CREATE INDEX `statuses_workspace_order` ON `statuses` (`workspaceId`,`order`)",
  "CREATE UNIQUE INDEX `connections_scope_slug` ON `connections` (`scope`,`slug`)",
  'CREATE TABLE `agents` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `title` text NOT NULL, `description` text NOT NULL, `instructions` text NOT NULL, `provider` text NOT NULL, `model` text, `thinking_level` text NOT NULL, `skills` text NOT NULL, `sources` text NOT NULL, `avatar` text DEFAULT \'\' NOT NULL, `created_by` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL)',
  'CREATE INDEX `agents_workspace_created` ON `agents` (`workspace_id`,`created_at`)',
]

const dir = mkdtempSync(join(tmpdir(), 'otto-snake-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function oldDatabase(path: string) {
  const db = new Database(path, { create: true })
  for (const statement of OLD_DDL) db.exec(statement)
  db.exec("INSERT INTO users VALUES ('u1', 'Ann', 'a@x.test', 1, NULL, 1, 2)")
  db.exec("INSERT INTO workspaces VALUES ('w1', 'One', 'one', NULL, NULL, 5), ('w2', 'Two', 'two', NULL, NULL, 6)")
  db.exec("INSERT INTO statuses VALUES ('s1', 'w1', 'todo', 'Todo', NULL, NULL, 'open', 1, 1, 0, 1, 1), ('s2', 'w1', 'done', 'Done', NULL, NULL, 'closed', 1, 0, 1, 1, 1)")
  db.exec("INSERT INTO labels VALUES ('l1', 'w1', NULL, 'bug', 'Bug', NULL, NULL, NULL, 0, 1, 1), ('l2', 'w1', 'l1', 'ui', 'UI', NULL, NULL, NULL, 3, 1, 1)")
  db.exec("INSERT INTO library VALUES ('f1', 'w1', NULL, 'folder', 'F', NULL, NULL, 'user:u1', 1, 1), ('d1', 'w1', 'f1', 'document', 'D', NULL, 3, 'user:u1', 1, 1)")
  db.exec("INSERT INTO projects VALUES ('p1', 'w1', 'P', '', 'active', '[]', 1, 1), ('p2', 'w1', 'Q', '', 'active', '[]', 1, 1)")
  db.exec("INSERT INTO projects_members VALUES ('p1', 'user:u1', 'contributor'), ('p1', 'agent:default', 'viewer')")
  db.exec("INSERT INTO notifications VALUES ('n1', 'u1', 'w1', 'task:t1', 'assigned', 'user:u2', 'read', 10), ('n2', 'u1', 'w1', 'task:t2', 'mention', 'user:u2', 'unread', 11)")
  db.exec("INSERT INTO settings VALUES ('install', 'imports', '{}', 9)")
  db.exec(`INSERT INTO connections (id, scope, slug, type, authType, title, baseUrl, config, account, lastUsedAt, createdAt, updatedAt) VALUES
    ('c1', 'install', 'claude', 'anthropic', 'oauth', 'Claude', NULL, '{"piAuthProvider":"x"}', '{"oauthAccountEmail":"me@x.test"}', 5, 6, 7),
    ('c2', 'install', 'plain', 'pi', 'none', 'Plain', NULL, NULL, '{}', NULL, 6, NULL)`)
  db.exec("INSERT INTO agents VALUES ('a1', 'w1', 'Agent', 'about', 'do it', 'anthropic', NULL, 'medium', '[]', '[]', '', 'user:u1', 1, 1)")
  return db
}

const names = (db: Database, table: string) => (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name)

test('converts an old database in place, keeps the data, refuses a second run, and leaves nothing for db:push but new tables', async () => {
  const path = join(dir, 'old.db')
  const db = oldDatabase(path)
  const summary = migrateSnakeCase(db)
  expect(summary).toMatchObject({ connectionsFolded: 1, projectsWithMembers: 1, notificationsRead: 1, archivedStatuses: 1, droppedTables: ['projects_members'] })

  expect(names(db, 'users')).toEqual(['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'])
  expect(names(db, 'statuses')).toEqual(['id', 'workspace_id', 'slug', 'title', 'color', 'icon', 'category', 'is_default', 'position'])
  expect(names(db, 'labels')).toEqual(['id', 'workspace_id', 'parent_id', 'slug', 'title', 'color', 'value_type', 'auto_rules', 'position'])
  expect(names(db, 'connections')).toEqual(['id', 'scope', 'slug', 'type', 'auth_type', 'title', 'base_url', 'default_model', 'models', 'config', 'secret_id', 'created_at'])
  expect(names(db, 'agents')).not.toContain('description')
  expect(names(db, 'settings')).toEqual(['entity', 'key', 'value'])

  expect(db.query('SELECT id, parent_id FROM library ORDER BY id').all()).toEqual([{ id: 'd1', parent_id: 'f1' }, { id: 'f1', parent_id: null }])
  expect(db.query('SELECT slug, position FROM labels ORDER BY position').all()).toEqual([{ slug: 'bug', position: 0 }, { slug: 'ui', position: 3 }])
  expect(JSON.parse((db.query("SELECT members FROM projects WHERE id = 'p1'").get() as { members: string }).members)).toEqual(['user:u1', 'agent:default'])
  expect((db.query("SELECT members FROM projects WHERE id = 'p2'").get() as { members: string }).members).toBe('[]')
  expect(db.query('SELECT id, read_at FROM notifications ORDER BY id').all()).toEqual([{ id: 'n1', read_at: 10 }, { id: 'n2', read_at: null }])
  expect(db.query("SELECT config FROM connections WHERE id = 'c1'").get()).toEqual({ config: '{"piAuthProvider":"x","account":{"oauthAccountEmail":"me@x.test"}}' })
  expect(db.query("SELECT config FROM connections WHERE id = 'c2'").get()).toEqual({ config: null })
  expect(db.query("SELECT slug, category, is_default, position FROM statuses WHERE workspace_id = 'w1' ORDER BY position").all()).toEqual([
    { slug: 'todo', category: 'open', is_default: 1, position: 0 },
    { slug: 'done', category: 'closed', is_default: 0, position: 1 },
    { slug: 'archived', category: 'archived', is_default: 0, position: 2 },
  ])
  expect(db.query('SELECT count(*) AS n FROM statuses').get()).toEqual({ n: 3 }) // w2 has none: it reads the defaults, which include archived

  expect(() => migrateSnakeCase(db)).toThrow('Already migrated')
  db.close()

  // db:push on the converted database only creates tables it never had (skills, sources, ...): it alters, rebuilds and drops nothing
  const converted = openDb(path)
  const statements = await pushSchema(converted)
  expect(statements.length).toBeGreaterThan(0)
  expect(statements.filter((statement) => !/^CREATE (TABLE|INDEX|UNIQUE INDEX) /.test(statement.trim()))).toEqual([])
  expect(await pushSchema(converted)).toEqual([])
})

test('refuses what is not an otto.db', () => {
  const db = new Database(':memory:')
  expect(() => migrateSnakeCase(db)).toThrow('not an otto.db')
})
