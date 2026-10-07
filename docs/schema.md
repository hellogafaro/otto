# Database schema (single source of truth)

Status: final, 6 Oct 2026 (owner: "GO on everything"). This file is authoritative for table and column names; `final-plan.md`, `data-architecture.md`, `messages-design.md`, `projects-tasks.md`, `library.md`, `activity-notifications.md`, `users-and-workspaces.md` and `harness-plan.md` defer to it where they disagree (for example their `triggered_by`, `parent_chat_id`, `slot`, `source`, `rev`, `search_fts`, `projects_members`, `transcripts`). **Built** tables match their `schema.ts` (renamed in N0); **planned** tables are written the same way from the start. Paths: `S` = `packages/shared/src`.

## 1. Rules

1. Every SQL column is snake_case (`workspace_id`, `created_at`); TypeScript properties stay camelCase (`workspaceId`). Tables are plural snake_case; `library` is the one singular.
2. Ids are `createId()` text. Actors `user:<id>` / `agent:<id>`; entity references `<type>:<id>`. Display label `title`, discriminator `type`, tree parent `parent_id`, ordering `position` (never `order`). Every workspace-scoped table has `workspace_id`.
3. Timestamps are integer epoch milliseconds (`timestamp_ms`), always `created_at` / `updated_at`. `created_at` is on every entity row; `updated_at` only where something reads it (an edit guard, a sort key or a sync): Better Auth tables, `library`, `projects`, `tasks`, `comments`, `chats`, `skills`, `sources`, `agents`.
4. A boolean next to a timestamp is one nullable `*_at` (`read_at`, `paused_at`, `pinned_at`; null = no). No `enabled`, `hidden`, `archived` or `is_*` columns where a `*_at` or a status works. Exceptions: Better Auth's `users.email_verified` (the plugin owns it) and `statuses.is_default` (a marker, no moment to record).
5. JSON is text (`json` below) where SQL never filters on it. No SQL foreign keys. The domain writes every column: no new SQL defaults (the few that exist stay; Better Auth's stay).
6. Search: only `messages_fts`. Tasks and projects search with `LIKE` on `title` and `description`, comments on `content`, the library on `title` (not its bytes), until that is too slow; each domain owns its `searchX` and `searchWorkspace` (`S/search/workspace.ts`, RPC `search:run`) only merges them by kind (25 each).

**How.** Write the snake_case name as the string in every column builder: `workspaceId: text('workspace_id').notNull()`. Do not use Drizzle's `casing` option: it renames only builders declared without a name, and our `db:push` (`pushSQLiteSchema` in `S/db/push.ts`) takes no `casing`, so push and queries would disagree (verified in drizzle-orm 0.45 / drizzle-kit 0.31). Explicit strings work for queries, push, Better Auth, raw `sql` and the later Postgres swap.

**Better Auth.** `fields` maps a Better Auth field to another *property* of the adapter schema; the SQL name is whatever the builder says, and the Drizzle adapter finds columns by property. So the properties keep Better Auth's names (`emailVerified`, `activeOrganizationId`, `inviterId`) and only the strings change; the two `fields` renames (`name` to `title` on workspaces, `organizationId` to `workspaceId`) stay. Tested with a sign-up and sign-in on `:memory:` (`S/users/users.test.ts`).

## 2. The schema

Legend: `PK` primary key, `NN` not null, `UQ` unique, `idx` index, `ms` epoch milliseconds, `json` JSON text.

### Identity (Better Auth) - built

```
users(id PK, name NN, email NN UQ, email_verified NN, image, created_at ms NN, updated_at ms NN)
users_sessions(id PK, user_id NN, token NN UQ, expires_at ms NN, ip_address, user_agent, active_organization_id, created_at ms NN, updated_at ms NN)   idx (user_id)
users_accounts(id PK, user_id NN, account_id NN, provider_id NN, password, access_token, refresh_token, id_token, access_token_expires_at ms, refresh_token_expires_at ms, scope, created_at ms NN, updated_at ms NN)   idx (user_id)
users_verifications(id PK, identifier NN, value NN, expires_at ms NN, created_at ms NN, updated_at ms NN)   idx (identifier)
workspaces(id PK, title NN, slug NN UQ, logo, metadata, created_at ms NN)
workspaces_members(id PK, workspace_id NN, user_id NN, role NN, created_at ms NN)   UQ (workspace_id, user_id); idx (user_id)
workspaces_invitations(id PK, workspace_id NN, email NN, role, status NN, inviter_id NN, expires_at ms NN, created_at ms NN)   idx (email)
```
`users.name` stays `name` (a person's name). `users_sessions` is a sign-in, not a chat; `active_organization_id` is the organization plugin's. `workspaces` is the plugin's organization; `root_path` arrives with the registry move (P2). `role` is `owner` | `member`; an invitation's `id` is its token, `inviter_id` the plugin's field.

### Platform - built

```
settings(entity NN, key NN, value json NN)   PK (entity, key)
secrets(id PK, title NN, value NN)
connections(id PK, scope NN, slug, type NN, auth_type NN, title NN, base_url, default_model, models json, config json, secret_id, created_at ms NN)   UQ (scope, slug)
```
`settings`: `entity` is `install` | `workspace:<id>` | `user:<id>`, keys from `S/settings/catalogue.ts`, including `imports.<domain>` (importer markers). `secrets`: AES-256-GCM, referenced by `connections.secret_id`, `sources.secret_id` and `routines.config`. `connections`: `scope` is `install` | `workspace:<id>` | `user:<id>` (not workspace-scoped, so no `workspace_id`); `type` is the Pi provider id (`anthropic`, `claude-code`, `openai-codex`, `openrouter`, `github-copilot`, `amazon-bedrock`, ..., or `custom` for an endpoint of the user's own); `auth_type` is `api_key` | `api_key_with_endpoint` | `oauth` | `iam_credentials` | `bearer_token` | `service_account_file` | `environment` | `none` | `cli_login` (a Claude subscription: the user's own `claude` login, no secret); `config` = `{ modelSelectionMode, customEndpoint, midStreamBehavior }`. Rows of the shape before Pi only (`anthropic` | `pi` | `pi_compat`, `config.piAuthProvider`, `config.account`) are converted at every boot by `initConnectionsPiProviderImport` (`S/connections/import.ts`, see [pi-only-plan](pi-only-plan.md)).

### Organize - built

```
labels(id PK, workspace_id NN, parent_id, slug NN, title NN, color json, value_type, auto_rules json, position NN)   UQ (workspace_id, slug)
labels_entities(workspace_id NN, label_id NN, entity NN, value)   PK (label_id, entity); idx (workspace_id, entity)
statuses(id PK, workspace_id NN, slug NN, title NN, color json, icon, category NN, is_default NN, position NN)   UQ (workspace_id, slug)
```
`labels.slug` is what chats and routines write (`bug`, `priority::3`); a workspace's labels are read whole. `statuses.category` is `open` | `closed` | `archived`. **Archived is a status**: every workspace has the fixed `archived` status (category `archived`), and archiving a chat moves it there; there is no `archived_at` or `hidden`. Fixed (undeletable) = `slug` in `FIXED_STATUS_IDS` (`todo`, `done`, `cancelled`, `archived`). `is_default` marks the one status new chats get (kept by code).

### Work - built

```
library(id PK, workspace_id NN, parent_id, type NN, title NN, mime, size, created_by NN, created_at ms NN, updated_at ms NN)   idx (workspace_id, parent_id)
projects(id PK, workspace_id NN, title NN, description NN, status NN, members json NN, resources json NN, created_at ms NN, updated_at ms NN)   idx (workspace_id, status)
tasks(id PK, workspace_id NN, project_id NN, title NN, description NN, status NN, due_at ms, assignees json NN, resources json NN, created_by NN, created_at ms NN, updated_at ms NN)   idx (workspace_id, project_id, status)
timesheets(id PK, workspace_id NN, task_id NN, time NN, notes NN, created_by NN, created_at ms NN)   idx (workspace_id, task_id)
comments(id PK, workspace_id NN, entity NN, type NN default 'comment', content NN, created_by NN, created_at ms NN, updated_at ms NN)   idx (workspace_id, entity, created_at)
notifications(id PK, workspace_id NN, user_id NN, entity NN, type NN, created_by NN, read_at ms, created_at ms NN)   UQ (user_id, entity, type); idx (user_id, workspace_id, created_at)
```
`library.type` is `file` | `document` | `folder`; `parent_id` a folder (null = root); bytes live in the FileStore under the id. `projects.status` is `active` | `archived` | `deleted`; `members` is a JSON array of actors (at most 50, the creator first) and replaces `projects_members`: there are no contributor/viewer roles. `tasks.status` is `todo` | `doing` | `done` | `archived` | `deleted`; `assignees` a JSON array of actors. `timesheets.time` is milliseconds. `notifications`: "`created_by` `type` you on `entity`"; unread = `read_at` null; a repeat of the same sentence sets `read_at` null and `created_at` now; Clear deletes.

**Comments and activity events** (`S/comments`): `comments.type` is `comment` (someone wrote it; `content` is markdown, mentions notify) or `event` (a domain recorded what happened; `content` is the event JSON, `{kind, ...}`: `status`, `title`, `project` `{from, to}` strings, `due` `{from, to}` ms or null, `assignees` `{from, to}` actor lists, `links` `{added, removed}` resources, `time` `{time}` ms). Events are written only by the tasks domain's own functions (`updateTask`, `setTaskStatus`, `createTimesheet`) through `createEvent`, in the same transaction and by the actor who did it; they never notify, are never searched and cannot be edited or deleted. A change to the same value writes nothing, and a from/to event by the same actor of the same kind within 5 minutes of the entity's newest row (that row) is merged into it (deleted when it lands back on its `from`), so autosave does not flood the feed. `created` is never stored: `comments:get` synthesizes it from the task on the oldest page, which covers every older task. The `type` default is the owner's exception to rule 5, so the push adds the column to existing rows (all comments).

### Chats (domain `sessions`) - built (P3b chunks 1-3, multiplayer)

```
chats(id PK, workspace_id NN, title, created_by NN, agent_id, status_id, project_id, origin, dm_key, pinned_at ms, run_started_at ms, metadata json, created_at ms NN, updated_at ms NN)
  idx (workspace_id, created_by, updated_at); UQ (workspace_id, dm_key)

chats_members(workspace_id NN, chat_id NN, actor NN, read_at ms, created_at ms NN)
  PK (chat_id, actor); idx (workspace_id, actor)

messages(workspace_id NN, chat_id NN, id NN, position NN, parent_id, type NN, content json NN, created_at ms NN)
  PK (chat_id, id); UQ (chat_id, position)

messages_fts  FTS5 virtual, stores its text (SQLite >= 3.35); rowid = the messages row's implicit rowid
```
**Multiplayer** (final-plan 2.3): a chat is a shared append-only log seen by its member people. `chats_members.actor` is `user:<id>` (sees the chat, may write; every list, get, send, search and the `otto` CLI check membership, and a workspace owner who is not a member sees nothing) or `agent:<id>` (the primary agent and every agent mentioned in it; `read_at` always null). `created_by` is the creator: always a member, the one who adds and removes members (anyone else may leave; the creator cannot), deletes the chat, and whose connection pays for every agent reply (NOT NULL: legacy chats with no creator go to the workspace's first owner, an importer rule). **Unread is per member**: `updated_at > read_at` of the viewer's row (null = never read); a person's own message sets their `read_at`. `agent_id` is the **primary agent** (it replies when the chat has one person and nobody else is mentioned); **null = a people chat** (a DM or a group: no agent replies unless mentioned). `dm_key` is `user:<a>|user:<b>` (sorted) on a direct message, unique per workspace, so "message Ana" opens the pair's DM; a DM that gains a third person loses it (it is a group). `chats.read_at` and `metadata.participants` are gone (replaced by member rows). `id`: legacy `YYMMDD-adjective-noun` kept, new ones `createId()`. `agent_id` (null = the workspace's default agent), `status_id`, `project_id` point at their tables. `origin` is how the chat began: `chat:<id>` (a branch or subtask of that chat), `routine:<id>` (a routine run), null (typed by the user). `pinned_at` pins it. **Unread = `updated_at > read_at`**: `updated_at` moves on a new final message (not on rename, status or label changes), opening a chat sets `read_at`, "mark unread" clears it, new chats start with `read_at = created_at`. `run_started_at` is set by a turn's first flush and cleared by its last; boot recovery reads only chats where it is set. `metadata` holds everything nobody filters on: `{ model, thinkingLevel, permissionMode, connectionId, workingDirectory, enabledSourceSlugs, sharedUrl, tokenUsage, routineDepth, sdkSessionId, piSession, agents, ... }` (`agents`: `{ [agentId]: { seen, sdkSessionId?, piSession? } }`, each agent's cursor: `seen` is the last message `position` already given to it; another agent's own Pi session id and object ref live here, the primary's stay in `sdkSessionId`/`piSession`) (no `harness`: every chat runs on Pi; Pi's own session id needs no column once the rows are the history). Labels are `labels_entities` rows `chat:<id>`; archived is the `archived` status; there are no `hidden`, `archived_at`, `preview` or `last_*` columns.

**What the renderer gets** (no extra queries: names and avatars resolve from the workspace's members and agents lists): every user message row carries `sender` (`user:<id>`; older rows without it read as `created_by`), every assistant, tool, error and plan row `author` (`agent:<id>`; older rows read as `agent_id`), and the live `text_complete` event `author` too. The chat DTO (`Session`) carries `members` (actors, oldest first, the creator first), `agentId` (primary agent, absent for a people chat), `dmKey` (DMs only), `createdBy` and `hasUnread` (the viewer's own). Membership changes push `session_created` to every member (re-hydrate) and `session_deleted` to a removed one. Members are written by `S/sessions/members.ts` (`addChatMembers`, `removeChatMember`, `updateChatMemberRead`, `initChatMembers` the idempotent boot backfill: creator, agent (null meant the default agent, which becomes `agent_id`), senders, old `read_at`).

As built (`S/sessions/{schema,chats,members,messages,persistence-queue,import}.ts`): `status_id` holds the `statuses` row id (null = none set, read as the default status); `origin` `chat:<id>` is a subtask unless `metadata.branchFromMessageId` says it is a branch; `metadata.triggeredBy` keeps a routine run's name, event and depth (its id is `origin`); unarchiving moves the chat to the workspace's default status. The list derives message count, last role, preview (first user message) and last final answer with subqueries on `(chat_id, position)`. Until chunk 4, `messages` rows are Otto's own `StoredMessage` rows (`parent_id` null).

`messages` is the one store: rows are Pi entries kept verbatim plus Otto rows, told apart by `type` (Otto rows use Otto types such as `otto.info`); `content` is the JSON (Otto's `StoredMessage`, or the Pi entry), `parent_id` Pi's tree link, `position` the order in the chat (gaps allowed). No `pk`, `source`, `display` or `updated_at` column. `messages_fts` is the only full-text table: created with raw SQL by `initMessages()`, written in the row's transaction, skipped by `db:push` (`S/db/push.ts`). Its rowid is the table's implicit rowid (the PK is not an integer, so the table has one), which a `VACUUM` or a `db:push` table rebuild may renumber: `scripts/db-push.ts` calls `rebuildMessagesSearch()` after a push that touches `messages` (the server's own push at boot relies on the check that follows), and `initMessages()` checks the index once per database handle (row count against `getSearchText`, plus a sampled rowid-to-text match) and rebuilds it when wrong, missing, or still the old contentless table (`contentless_delete` needs SQLite 3.43; macOS 13 ships 3.39). **Rebuild `messages_fts` after any manual `VACUUM`**.

### Bundles - built by S1 (`skills`, `sources`)

```
skills(id PK, workspace_id NN, slug NN, title NN, description NN, hash NN, created_by NN, created_at ms NN, updated_at ms NN)   UQ (workspace_id, slug)
sources(id PK, workspace_id NN, slug NN, title NN, type NN, auth_status NN, secret_id, hash NN, created_by NN, created_at ms NN, updated_at ms NN)   UQ (workspace_id, slug)
```
The folder (`SKILL.md`, files) is the truth, the row its index; `hash` (sha256 of the sorted manifest) replaces `rev` and names the S3 prefix; `updated_at` is the sync guard. `sources.type` is `mcp` | `api` | `local`; `auth_status` `ok` | `needs_auth` | `error`; credentials in `secrets`.

### Routines - built (R1 part 1; the domain folder is still `S/automations`)

```
routines(id PK, workspace_id NN, agent_id, title NN, config json NN, paused_at ms, created_by NN, created_at ms NN)
routines_history(id PK, workspace_id NN, routine_id NN, scheduled_for ms NN, status NN, chat_id, error, started_at ms NN)   UQ (routine_id, scheduled_for)
```
`config` holds everything the scheduler and runner read: `{ type: 'schedule' | 'event' | 'webhook', schedule: { cron, timezone } | event | webhook: { secretId }, conditions, actions: [{ type: 'prompt', prompt, labels, projectId } | { type: 'webhook', ..., secretId } | { type: 'script', script }] }` (the script is relative to the workspace root; a webhook's credentials are the secret named by `secretId`). `paused_at` null = active. `agent_id` null = the default agent; a run creates a chat owned by `created_by` with `origin = 'routine:<id>'`. `scheduled_for` is the time the run was scheduled for; its unique key with `routine_id` makes a schedule fire once across restarts and nodes (it replaces `slot`). `status` is `running` | `ok` | `error` | `skipped`; there is no retry queue. Event runs (through the session manager) write their `running` row when the prompt starts and end it `ok` / `error`, and every start and end pushes `domain:changed` `routines`, as schedule and Run now runs do. A webhook routine's `config.webhook.secretId` names a `secrets` row the server makes (create, or an update that makes the routine a webhook) and replaces on Reset (`routines:resetWebhook`); the caller never sets it, and deleting the routine (or changing its type) deletes the secret. `POST /api/webhooks/<routine_id>/<secret>` starts a run with `scheduled_for` = the request time (see final-plan 2.8).

### Agents - built (A1)

```
agents(id PK, workspace_id NN, title NN, instructions NN, provider NN, model, thinking_level NN, skills json NN, sources json NN, avatar NN, created_by NN, created_at ms NN, updated_at ms NN)   idx (workspace_id, created_at)
```
`title` is the UI's "Name" (at most 80); `instructions` at most 20,000 characters; `provider` picks which of the chat creator's connections pays (provider and `model` stay separate columns; `model` null = that connection's default); `skills` / `sources` are JSON id lists (`[]` = all); `avatar` is empty (generated from the id) or `library:<id>`. The default agent is the workspace's oldest. No `description`. `updated_at` guards the detail page's autosave.

### Not tables

Drafts, saved views, pages, `activities`, `transcripts`, `computers` (Docker owns that), `workspaces_remotes`, `chats_reads`, pins and recents (localStorage), import markers (`settings` `imports.*`), the decision log (`logs/decisions.jsonl`), `search_fts` and every per-domain FTS plan, `projects_members`, and `pi-durable`'s `pi_*` tables (its own `durable.db`, never `otto.db`).

## 3. Relations

```
users ─┬─< users_sessions, users_accounts          (user_id)
       ├─< workspaces_members >── workspaces        (user_id, workspace_id)
       └─< notifications                            (user_id)

workspaces ─┬─< workspaces_invitations              (inviter_id -> users)
            ├─< labels ─< labels (parent_id);  labels_entities >── entity '<chat|library|task|project>:<id>'
            ├─< statuses, library ─< library (parent_id), agents, skills, sources (secret_id -> secrets)
            ├─< projects ─< tasks ─< timesheets      (project_id, task_id);  projects.members -> actors
            ├─< comments (type 'comment' | 'event') >── entity 'task:<id>' | 'project:<id>';  notifications >── entity
            ├─< routines ─< routines_history          (routine_id; chat_id -> chats); routines.agent_id -> agents
            └─< chats ─┬─< messages (chat_id) ── messages_fts (rowid)
                       ├─< chats_members (chat_id; actor 'user:<id>' | 'agent:<id>')
                       └─ status_id -> statuses, project_id -> projects, agent_id -> agents, origin 'chat:<id>' | 'routine:<id>'

connections (scope) ── secret_id -> secrets;  settings (entity)
actors everywhere (created_by, assignees, members): 'user:<id>' | 'agent:<id>'
```

## 4. Migration of an existing database

No migrations framework: drizzle-kit's push asks interactively when a table has a new and a missing column (a rename looks like that), so a database made before N0 is converted once by `scripts/db-rename-snake-case.ts <db-path>` and then `bun run db:push` plans nothing. The script runs in one transaction, refuses a database that is already migrated, prints counts and never data. Back up first (`sqlite3 otto.db ".backup <file>"`), stop the server, keep the same `ENCRYPTION_KEY`.

| Table | Change |
|---|---|
| all built tables | `workspaceId` to `workspace_id`, `createdBy` to `created_by`, `createdAt` to `created_at`, `updatedAt` to `updated_at`, `userId` to `user_id`, `expiresAt` to `expires_at`, wherever they exist |
| `users` | `emailVerified` to `email_verified` |
| `users_sessions` | `ipAddress`, `userAgent`, `activeOrganizationId` to snake_case |
| `users_accounts` | `accountId`, `providerId`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt` to snake_case |
| `workspaces_invitations` | `inviterId` to `inviter_id` |
| `settings` | `updatedAt` dropped |

**Multiplayer chats** (`chats.read_at` dropped, `chats_members` added, `chats.dm_key` added): the server's push refuses the drop (data loss), so an existing database is converted once by `scripts/db-chat-members.ts <db-path>` (server stopped, backup first): in one transaction it creates `chats_members`, runs `initChatMembers` (copies `read_at` to each chat's people, gives chats with a null `agent_id` the default agent) and drops `chats.read_at`; it is idempotent. The next boot's push adds `dm_key` and its index.
| `connections` | `authType`, `baseUrl`, `defaultModel`, `secretId` to snake_case; `account` dropped; `lastUsedAt`, `updatedAt` dropped. At boot, `type` becomes the Pi provider id (`initConnectionsPiProviderImport`; a Claude subscription's stored token secret is deleted) |
| `labels` | `parentId`, `valueType`, `autoRules` to snake_case; `order` to `position`; `createdAt`, `updatedAt` and the `(workspace_id, parent_id)` index dropped |
| `labels_entities` | `labelId` to `label_id` |
| `statuses` | `isDefault` to `is_default`; `order` to `position`; `isFixed`, `createdAt`, `updatedAt` and the order index dropped; each workspace gains the `archived` status; chats keep their slugs |
| `library` | `folderId` to `parent_id` |
| `projects` | gains `members` (from `projects_members.actor`, in insertion order: the creator was inserted first); `projects_members` dropped |
| `tasks`, `timesheets` | `projectId`, `dueAt`, `taskId` to snake_case |
| `notifications` | `status` replaced by `read_at` (`created_at` where it was `read`); index without the status |
| `agents` | `description` dropped |

Planned tables (`chats`, `messages`, `routines`, ...) are created by push, already snake_case.
