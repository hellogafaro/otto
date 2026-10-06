import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A chat (domain `sessions`; docs/schema.md "Chats"). Private to `created_by` ('user:<id>'). `status_id` is a
 * `statuses` row id (null = no status set, read as the default), `agent_id` an `agents` row id (null = the
 * workspace's default agent), `origin` how the chat began: 'chat:<id>' (a branch or subtask of that chat),
 * 'routine:<id>' (a routine run), null (typed by the user). `pinned_at` pins it; unread = `read_at` is null or
 * `updated_at > read_at`; `updated_at` moves on a new user or final assistant message only. `run_started_at` is set
 * while a turn runs (boot recovery reads only these chats). `metadata` is JSON of everything nobody filters on
 * (model, thinking level, permission mode, connection, working directory, sources, branch and share state, token
 * usage, Pi's session id, ...: `ChatMetadata` in ./chats.ts). Labels are `labels_entities` rows `chat:<id>`.
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
    pinnedAt: integer('pinned_at', { mode: 'timestamp_ms' }),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    runStartedAt: integer('run_started_at', { mode: 'timestamp_ms' }),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('chats_workspace_creator_updated').on(table.workspaceId, table.createdBy, table.updatedAt)],
)

/**
 * The messages of a chat, one row each (docs/messages-design.md). `id` is unique per chat only (a branch copies its
 * parent's rows with the same ids); `position` is the order in the chat (gaps allowed); `type` is the message role
 * (`user`, `assistant`, `tool`, `error`, `info`, `warning`, `plan`, `auth-request`); `content` the JSON of every other
 * field of the stored message, with the chat folder's absolute path written as `{{SESSION_PATH}}`. `parent_id` is
 * Pi's tree link (P3b chunk 4; null for our own rows). The implicit rowid joins `messages_fts` (./messages.ts).
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
