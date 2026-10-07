import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A chat (domain `sessions`; docs/schema.md "Chats"): a shared append-only log seen by its member people
 * (`chats_members`); `created_by` ('user:<id>') is its creator, whose connection pays for every agent reply.
 * `status_id` is a `statuses` row id (null = no status set, read as the default), `agent_id` the primary agent (an
 * `agents` row id; null = a people chat: a DM or a group where no agent replies unless mentioned), `dm_key`
 * 'user:<a>|user:<b>' (sorted) on a direct message (unique per workspace, null otherwise), `origin` how the chat began:
 * 'chat:<id>' (a branch or subtask of that chat), 'routine:<id>' (a routine run), null (typed by a person). `pinned_at`
 * pins it; `updated_at` moves on a new user or final assistant message only (unread per member: their `read_at` is
 * older). `run_started_at` is set while a turn runs (boot recovery reads only these chats). `metadata` is JSON of
 * everything nobody filters on (`ChatMetadata` in ./chats.ts). Labels are `labels_entities` rows `chat:<id>`.
 */
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title'),
    createdBy: text('created_by').notNull(),
    agentId: text('agent_id'),
    statusId: text('status_id'),
    projectId: text('project_id'),
    origin: text('origin'),
    dmKey: text('dm_key'),
    pinnedAt: integer('pinned_at', { mode: 'timestamp_ms' }),
    runStartedAt: integer('run_started_at', { mode: 'timestamp_ms' }),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('chats_workspace_creator_updated').on(table.workspaceId, table.createdBy, table.updatedAt),
    uniqueIndex('chats_workspace_dm_key').on(table.workspaceId, table.dmKey),
  ],
)

/**
 * Who is in a chat (./members.ts): `actor` is 'user:<id>' (a person: sees the chat, may write) or 'agent:<id>' (an
 * agent that was the primary or was mentioned). `read_at` is when the person last read it (null = never; always null
 * for agents): unread = the chat's `updated_at` is newer. The creator is always a member.
 */
export const chatsMembers = sqliteTable(
  'chats_members',
  {
    workspaceId: text('workspace_id').notNull(),
    chatId: text('chat_id').notNull(),
    actor: text('actor').notNull(),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.actor] }), index('chats_members_workspace_actor').on(table.workspaceId, table.actor)],
)

/**
 * The messages of a chat, one row each (docs/messages-design.md). `id` is unique per chat only (a branch copies its
 * parent's rows with the same ids); `position` is the order in the chat (gaps allowed); `type` is the message role
 * (`user`, `assistant`, `tool`, `error`, `info`, `warning`, `plan`, `auth-request`); `content` the JSON of every other
 * field of the stored message, with the chat folder's absolute path written as `{{SESSION_PATH}}`. `parent_id` is
 * Pi's tree link (P3b chunk 4; null for our own rows). The implicit rowid joins `messages_fts` (./messages.ts); a `db:push`
 * that rebuilds this table renumbers it, so `scripts/db-push.ts` then rebuilds the index (and boot checks it).
 */
export const messages = sqliteTable(
  'messages',
  {
    workspaceId: text('workspace_id').notNull(),
    chatId: text('chat_id').notNull(),
    id: text('id').notNull(),
    position: integer('position').notNull(),
    parentId: text('parent_id'),
    type: text('type').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.id] }), uniqueIndex('messages_chat_position').on(table.chatId, table.position)],
)
