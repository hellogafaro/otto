# Data architecture (plan to agree)

Status: proposal for the owner to review, nothing built. It says where every persisted thing lives (database, object storage, disk only, or deleted), the exact new tables, how files sync, how the user's `~/.otto` is imported, and the order of work. Every choice the owner may want different is marked **DECISION n** and listed in (i). Evidence comes from three code inventories (chats, workspace folder, install-wide) and `file:line` reads; what was not verified is said where it matters. Paths: `S` = `packages/shared/src`, `SC` = `packages/server-core/src`, `<ws>` = a workspace root, `CONFIG_DIR` = `~/.otto`.

## (a) Principles

1. **SQLite is the truth for records; object storage is the truth for files; disk is a cache agents read by path.** A record is anything listed, filtered, joined, guarded or edited field by field. A file is anything an agent reads or edits with its normal tools (skills, sources, library bytes, chat files later).
2. **Secrets only in `secrets`** (AES-256-GCM, `ENCRYPTION_KEY`). Other rows keep a `secretId`. No token in a JSON file, in S3, or in an agent's environment.
3. **Same code on the desktop and the server.** `OTTO_STORAGE=disk` (default, desktop, dev) and `OTTO_STORAGE=s3` (Garage, hosted) differ only in the storage driver. A single-user desktop with no S3 keeps working.
4. **Smallest model that works.** Settings are key/values, not one table per screen. Row columns only for what is listed, filtered or guarded; the rest is one JSON `metadata`/`config` column. No event sourcing, no history tables, no generic sync framework.
5. **Moves are imports, not rewrites.** Each domain imports its old files once at boot, idempotently, never deletes them, and the old reader is removed in the same change (no dual source of truth).

## (b) The map

Target legend: **DB** = table(s); **S3+DB** = object storage for bytes, DB row for metadata, disk cache; **disk** = stays a local file (machine state, generated assets, logs, caches); **mem** = stays in memory; **delete**. Phases are in (f).

| Thing | Today | Target | Scope | Phase |
|---|---|---|---|---|
| Workspace registry (`workspaces[]`: id, name, rootPath, iconUrl, mcpUrl, lastAccessedAt) | `config.json` + DB mirror `workspaces` | DB `workspaces` (+`rootPath`, real `slug`); `lastAccessedAt` on `workspaces_members` | install | P2 |
| Remote workspace entries (`remoteServer {url, token, remoteWorkspaceId}`) | `config.json`, token plaintext | DB `workspaces_remotes`, token in `secrets` | install (client) | P1c token, P2 table |
| `activeWorkspaceId`, `activeSessionId` | `config.json` | `settings` user scope | user | P1a |
| `llmConnections`, fetched model lists | `config.json` | DB `connections` (existing, extended) | install or workspace | P1c |
| `defaultLlmConnection`, `defaultThinkingLevel` | `config.json` | `settings` install | install | P1a |
| UI prefs: `colorTheme`, `notificationsEnabled`, `sendMessageKey`, `spellCheck`, `autoCapitalisation`, `richToolDescriptions` | `config.json` (shared by all members) | `settings` user | user | P1a |
| Machine settings: `setupDeferred`, `allowRemoteEvaluate`, `gitBashPath`, `keepAwakeWhileRunning`, `dismissedUpdateVersion`, `migrationsApplied` | `config.json` | `settings` install | install | P1a |
| `serverConfig {enabled, port, tlsCertPath, tlsKeyPath, token}` | `config.json`, token plaintext | `settings` install `server` with `tokenSecretId` | install | P1a, token P1c |
| `decisionLayer` + `decision_api_key::{provider}` | `config.json` + `credentials.enc` | `settings` install `decisionLayer` with `secretId` | install | P1a/P1c |
| `enable1MContext` (only in the real file, no code reads it) | `config.json` | delete | - | P1a |
| `preferences.json` name, email | file | `users.name`, `users.email` (already the local user's source) | user | P1a |
| `preferences.json` timezone, location, notes, diffViewer, includeCoAuthoredBy, uiLanguage | file (shared by all members) | `settings` user | user | P1a |
| `drafts.json` (per chat, not per user; pasted bytes inline) | file | DB `chats_drafts` | user | P1b |
| `credentials.enc` `llm_*`, legacy `anthropic_api_key`/`claude_oauth` | machine-id-keyed file | `secrets` via `connections.secretId` | install/workspace | P1c |
| `credentials.enc` `source_*::{ws}::{slug}` | same | `secrets` via `sources.secretId` | workspace | P4c |
| `credentials.enc` `messaging_bearer::{ws}::{platform}` | same | `secrets` via `settings` workspace `messaging` | workspace | P5c |
| `credentials.enc` `workspace_oauth::{ws}` (workspace MCP sign-in; use not fully traced) | same | `secrets` via `workspaces_remotes.secretId` or delete, once traced | install | P2 |
| `credentials.enc` `page_publish_token` | same | delete with pages | - | PX |
| `credentials.enc` file itself | file | delete after every family moved and verified | - | P7 |
| `config-defaults.json`, `docs/`, `permissions/default.json`, `tool-icons/`, `provider-domains.json` | rewritten or copied from the bundle | disk (generated assets, not user data) | install | - |
| `theme.json`, `themes/*.json` | file | disk for now (custom themes per install) | install | not now |
| `logs/` (`decisions`, `privileged-actions`, `page-actions`, interceptor, gateway, update) | jsonl/log files | disk; `page-actions` deleted with pages | install | - |
| `window-state.json`, `.server.lock`, `api-error.json`, `feedback/`, Electron browser partition, updater cache | files | disk (machine/Electron state) | install | - |
| `workspaces/{id}/plan.json` (`saveWorkspacePlan`, no caller outside `config/storage.ts` found) | file | delete (dead code) | - | P2 |
| OAuth flows in progress, pairing codes, background task outputs, scheduler tick, skills cache | memory | mem | - | - |
| `<ws>/config.json` (name, slug, `defaults`, `localMcpServers`) | file | `workspaces.title/slug` + `settings` workspace `defaults`, `localMcpServers` | workspace | P2 |
| `<ws>/permissions.json` | file (watched) | `settings` workspace `permissions` (**DECISION 11**) | workspace | P3a |
| Chat header (`SESSION_PERSISTENT_FIELDS` + precomputed list fields) | first line of `sessions/<id>/session.jsonl` | DB `chats` + `chats_labels` | user (private) | P3b |
| Chat messages | rest of `session.jsonl`, full rewrite per 500 ms burst | disk file (messages only) now; S3 object later (**DECISION 4**) | user | P3b, S3 P7 |
| Chat full-text search | ripgrep over JSONL | FTS5 `search_fts` | user | P3c |
| Chat `plans/`, `notes.md`, `downloads/` | session folder | disk now; S3 with chat files | user | P7 |
| Chat `long_responses/`, `data/`, `tmp/`, `meta/`, `.pi-sessions/`, `api-error.json` | session folder | disk (agent working files, travel in the export bundle as today) | user | - |
| Claude SDK transcripts | `~/.claude/projects/{cwd-hash}/` | disk (SDK-owned; resume works only on the same host) | user | - |
| Chat attachments | library items in "Chat attachments" | unchanged (library) | workspace | P4a for S3 |
| `<ws>/automations.json` (matchers; webhook `auth` holds plaintext passwords/tokens) | file (watched) | DB `routines`, webhook auth in `secrets` | workspace | P5a |
| `<ws>/automations-history.jsonl` | file | DB `routines_runs` | workspace | P5a |
| `<ws>/automations-retry-queue.jsonl` | file | `routines_runs` rows with `status='retry'` | workspace | P5a |
| `<ws>/events.jsonl` (no retention, no reader found in the UI) | file | delete (**DECISION 18**) | - | P5a |
| `<ws>/labels/config.json` | file (watched) | DB `labels` | workspace | P3a |
| `<ws>/statuses/config.json` + `statuses/icons/*` | files (watched) | DB `statuses` (icon in a column, **DECISION 22**) | workspace | P3a |
| `<ws>/views.json` | file | DB `views` | workspace | P3a |
| Workspace skills `<ws>/skills/<slug>/` | files (watched) | S3+DB `skills` | workspace | P4b |
| Global skills `~/.agents/skills/`, project skills `<repo>/.agents/skills/` | files | disk only, read-only listing (**DECISION 8**) | machine / repo | P4b |
| Sources `<ws>/sources/<slug>/` (config, guide, icon, permissions) | files (watched) | S3+DB `sources` | workspace | P4c |
| Source runtime fields `isAuthenticated`, `connectionStatus` | inside source `config.json` | `sources.authStatus` column (not in the bundle) | workspace | P4c |
| Source `.credential-cache.json` | file (holds tokens) | disk, never uploaded | workspace | P4c |
| Pages `<ws>/pages/` (no UI; agent tools + thumbnailer alive) | files | delete the feature (**DECISION 13**) | - | PX |
| Messaging `bindings.json`, `pending.json`, `topic-registry.json` | `CONFIG_DIR/workspaces/<id>/messaging/` | DB `messaging_bindings`, `messaging_pending`, `messaging_topics` | workspace | P5c |
| Messaging `config.json` | same | `settings` workspace `messaging` | workspace | P5c |
| WhatsApp `whatsapp-auth/` | folder (session keys) | disk now; `secrets` snapshot later (**DECISION 15**) | workspace | P7 |
| Library bytes | `<ws>/library/<id>` (disk FileStore) | S3+DB (`library` already) | workspace | P4a |
| `<ws>/.claude-plugin/plugin.json` | generated | disk | workspace | - |
| `<ws>/projects/` (old file projects, ignored) | empty folders | delete after import verification | - | P7 |
| library, projects, tasks, timesheets, comments, notifications, users, members, invitations, secrets, connections | `otto.db` | unchanged | - | - |

What leaves `config.json` by the end: everything. After P2 it holds nothing the server needs; the file is kept only if Electron still needs a pre-DB bootstrap value (none found). **Unverified:** whether any external tool or script reads `config.json` directly (the CLI goes through the server).

## (c) Schemas

Conventions (AGENTS.md): ids `createId()` unless noted; timestamps `integer` ms; booleans `integer` (`mode: 'boolean'`); JSON as `text`; references are plain id columns (no SQL foreign keys, as today); actors `user:<id>`/`agent:<id>`; entities `<type>:<id>`. `NN` = not null. `routine` and `chat` join `ENTITY_TYPES`.

### settings (new domain `S/settings`)

```
settings                          one key/value table for three scopes (DECISION 2)
  scope       text NN   'install' | 'workspace:<id>' | 'user:<id>'
  key         text NN   from one typed catalogue in code (default + validator per key)
  value       text NN   JSON
  updatedBy   text      actor
  updatedAt   int  NN
  PK (scope, key)
```
Keys: install `defaultConnectionId`, `defaultThinkingLevel`, `setupDeferred`, `server` (`{enabled, port, tlsCertPath, tlsKeyPath, tokenSecretId}`), `decisionLayer` (`{..., secretId}`), `allowRemoteEvaluate`, `gitBashPath`, `keepAwakeWhileRunning`, `dismissedUpdateVersion`, `imports` (per-domain import timestamps). Workspace `defaults`, `localMcpServers`, `permissions`, `messaging`. User `activeWorkspaceId`, `activeChatId`, `colorTheme`, `notificationsEnabled`, `sendMessageKey`, `spellCheck`, `autoCapitalisation`, `richToolDescriptions`, `profile` (`{timezone, location, notes}`), `diffViewer`, `includeCoAuthoredBy`, `uiLanguage`. Authorization by scope, in the one guard: install = workspace owner on the desktop / instance owner on a server, workspace = its owners, user = only that user (read and write). Electron localStorage UI state (sidebar, panels, recents) stays per device.

### providers (existing `S/connections`, made the only source)

```
connections                       (existing: id, slug, type, title, baseUrl, secretId, createdAt)
  + scope        text NN  'install' | 'workspace:<id>'   (DECISION 3); unique (scope, slug) replaces unique slug
  + authType     text NN  'api_key' | 'oauth' | 'iam' | 'service_account' | 'none'
  + defaultModel text
  + models       text     JSON: fetched model list (cache, replaced on refresh)
  + config       text     JSON: modelSelectionMode, piAuthProvider, customEndpoint, midStreamBehavior
  + account      text     JSON: oauthAccountUuid/Email, oauthOrganizationUuid/Name, verifiedAt
  + lastUsedAt   int
  + updatedAt    int NN
```
`type` = today's `providerType`. `secretId` holds one JSON value per connection (`{apiKey}` or `{accessToken, refreshToken, idToken, expiresAt}` or IAM/service-account fields); token refresh rewrites that secret in place. Chats keep `connectionId` (the slug is imported and kept for agent prompts). `SC/domain/connection-mirror.ts` is deleted.

### workspaces (existing tables, plugin `additionalFields`)

```
workspaces            + rootPath text NN  '~'-form path on this host (server: CONFIG_DIR/workspaces/<id>)
                      ~ slug     text NN unique: the route slug (today = id); imported from the folder name,
                                 collisions suffixed '-2' (DECISION 16)
workspaces_members    + lastAccessedAt int     per-user recent ordering for the switcher
workspaces_remotes                              a desktop's bookmarks of workspaces on other servers (DECISION 17)
  id, title NN, url NN, remoteWorkspaceId NN, secretId NN (session token), logo, lastAccessedAt,
  createdAt NN, updatedAt NN;  unique (url, remoteWorkspaceId)
```
`iconUrl` goes to the existing `logo`, `mcpUrl` to `metadata` (JSON) until its use is traced.

### chats (table set in `S/sessions/schema.ts`; the folder rename to `chats` is not part of this plan)

```
chats
  id                 text PK  legacy 'YYMMDD-adjective-noun' kept; new chats createId() (DECISION 6)
  workspaceId        text NN
  title              text     (was name)
  createdBy          text     actor; null = legacy chat, owned by the workspace owners (unchanged rule)
  statusId           text     statuses.id
  projectId          text
  parentChatId       text     subtask parent
  triggeredBy        text     entity 'routine:<id>' (was {automationName, automationId})
  flaggedAt          int      (was isFlagged)        DECISION 5: on the row, chats are private
  archivedAt         int      (was isArchived)
  hidden             bool NN default false
  hasUnread          bool NN default false
  lastReadMessageId  text
  connectionId       text     connections.id
  model              text
  thinkingLevel      text
  permissionMode     text
  messageCount       int  NN default 0     list fields the writer precomputes today
  lastMessageRole    text
  lastFinalMessageId text
  preview            text     150 chars
  lastMessageAt      int
  lastUsedAt         int
  metadata           text NN default '{}'  JSON: sdkSessionId, sdkCwd, workingDirectory, enabledSourceSlugs,
                              previousPermissionMode, connectionLocked, sharedUrl, sharedId, pendingPlanExecution,
                              branchFrom* (5), transferredSessionSummary(+Applied), tokenUsage
  createdAt          int  NN
  updatedAt          int  NN
  index (workspaceId, createdBy, lastMessageAt); index (workspaceId, projectId); index (parentChatId)

chats_labels        chatId NN, labelId NN, value text;  PK (chatId, labelId); index (labelId)
chats_drafts        chatId NN, userId NN, text NN, attachments text (JSON [{path, name, content?}], pasted bytes
                    inline, 10 MB cap), updatedAt NN;  PK (chatId, userId)
```
Private chats move from a list filter into SQL: every list query has `createdBy = :actor OR (createdBy IS NULL AND :isOwner)`. `workspaceRootPath` is dropped (the row knows its workspace). Header external-edit merging (`persistence-queue.ts:116-130`) and the watcher's `session.jsonl` branch go: nobody writes headers by path after P3b.

**Messages and streaming (DECISION 4).** The file `sessions/<id>/session.jsonl` keeps only messages (no header line), written by the same 500 ms debounced full rewrite; list fields go to the `chats` row in the same flush (one `UPDATE`). Why not a messages table: messages are large nested JSON that is always loaded whole per chat, agents and export read the folder, and tool results are capped at 200k. In P7 the file is uploaded as one object `workspaces/<ws>/chats/<id>/messages.jsonl`, at turn end only (not per burst), rewritten whole; per-turn segments are added only if chats grow past a few MB.

**Unread (DECISION 5).** One reader per chat today, so `hasUnread` + `lastReadMessageId` stay on the row. `chats_reads(chatId, userId, lastReadMessageId)` arrives only with shared chats.

### labels, statuses, views (P3a; each in its existing domain folder)

```
labels      id, workspaceId NN, parentId, slug NN (old id, used by 'slug::value', routines and agents; DECISION 21),
            title NN, color, valueType ('string'|'number'|'date'), autoRules (JSON), order int NN,
            createdAt NN, updatedAt NN;  unique (workspaceId, slug)
statuses    id, workspaceId NN, slug NN, title NN, color, icon text (emoji, icon name or data URL <= 16 KB,
            DECISION 22), category NN, isFixed bool NN, isDefault bool NN, order int NN, createdAt NN,
            updatedAt NN;  unique (workspaceId, slug); one isDefault per workspace, enforced in code
views       id, workspaceId NN, title NN, config (JSON, today's ViewConfig) NN, order int NN,
            createdAt NN, updatedAt NN;  index (workspaceId)
```
Rename/delete of a label or status updates `chats_labels` / `chats.statusId` in one transaction instead of rewriting chat files.

### search (new domain `S/search`)

```
search_fts  FTS5 virtual table, tokenize 'unicode61 remove_diacritics 2', prefix '2 3'   (DECISION 7)
  title, text                         indexed
  workspaceId, entity, part, userId   UNINDEXED; entity '<type>:<id>', part = messageId for chats,
                                      userId set only for private rows (chats), else null
```
Domains call `updateSearchEntry(workspaceId, entity, part, title, text, userId?)` / `deleteSearchEntries(entity)`. Chats index user and assistant text at turn end; tasks, projects, comments, library documents in P6. Queries filter `workspaceId` and `(userId IS NULL OR userId = :me)`. Created with raw SQL at boot (`CREATE VIRTUAL TABLE IF NOT EXISTS`) because drizzle-kit does not model FTS5; **unverified** whether `pushSQLiteSchema` then tries to drop the FTS shadow tables: P3c tests it first, and if it does the index moves to its own rebuildable file `search.db`.

### skills and sources (P4)

```
skills      id, workspaceId NN, slug NN, title NN, description, icon, rev text NN, hash text NN,
            createdBy NN, createdAt NN, updatedAt NN;  unique (workspaceId, slug)
sources     id, workspaceId NN, slug NN, title NN, type NN ('api'|'mcp'|'local'), secretId,
            authStatus ('ok'|'needs_auth'|'error'), rev text NN, hash text NN,
            createdBy NN, createdAt NN, updatedAt NN;  unique (workspaceId, slug)
```
The bundle (`SKILL.md` frontmatter, `config.json`, `guide.md`) stays the truth for content; `title`, `description`, `icon`, `type` are an index refreshed on every sync. `rev` = the object prefix of the current version (createId per write), `hash` = sha256 of the sorted manifest (path, size, sha256), used to skip no-op writes. Only workspace skills are rows (DECISION 8). Source credentials stay per workspace, shared by its members, as today (DECISION 20).

### routines (P5; domain `S/automations` renamed `S/routines`)

```
routines
  id, workspaceId NN, title NN
  type          text NN  'schedule' | 'event' | 'webhook'   (UI 'agentic' = event in AGENT_EVENTS)
  cron, timezone         schedule only
  event         text     an AutomationEvent name, event only
  webhookSecretId text   incoming token, webhook only (new trigger)
  conditions    text     JSON (today's conditions)
  actions       text NN  JSON [{type:'prompt'|'webhook'|'script', ...}]; webhook auth as {secretId};
                         script path relative to the workspace root
  labels        text     JSON label slugs given to the chats it creates
  projectId     text     chats it creates bind to this project
  enabled       bool NN default true
  createdBy     text NN  actor; prompt runs create chats owned by this user (DECISION 12)
  createdAt, updatedAt NN;  index (workspaceId, type, enabled)

routines_runs
  id, workspaceId NN, routineId NN
  status     text NN  'running' | 'ok' | 'error' | 'skipped' | 'retry'
  trigger    text NN  'schedule' | event name | 'webhook' | 'test' | 'replay'
  slot       int      the cron minute (ms) for schedule runs; unique (routineId, slot) = fires once
                      even after a restart or with two processes
  chatId, error, response (captured, 4 KB)
  attempt    int NN default 1;  nextAttemptAt int  (the retry queue: status 'retry' rows)
  createdBy  text NN  who ran it (the caller for test/replay, else the routine's createdBy)
  createdAt NN, finishedAt
  index (routineId, createdAt); index (status, nextAttemptAt)
```
Retention as today: keep the newest 20 runs per routine, trimmed on insert. "Last run" = newest row.

### messaging (P5c; tables in `S/messaging/schema.ts`, the gateway package calls its functions)

```
messaging_bindings  id, workspaceId NN, chatId NN, platform NN, channelId NN, threadId int, channelTitle,
                    enabled bool NN, config (JSON BindingConfig) NN, createdAt NN, updatedAt NN;
                    index (platform, channelId); one binding per (platform, channelId, threadId) in code
messaging_pending   id, workspaceId NN, platform NN, senderId NN, title, channelId, createdAt NN, updatedAt NN
messaging_topics    id, workspaceId NN, platform NN, channelId NN, threadId int NN, routineId NN, createdAt NN
```
`messaging_pending` and `messaging_topics` columns are from the file names and types skimmed, **to confirm** against `pending-senders.ts` and `topic-registry.ts` before P5c.

### activity log (shape only, not built; DECISION 19)

```
activities  id, workspaceId NN, entity NN, type NN (verb), createdBy NN, data (JSON), createdAt NN;
            index (workspaceId, createdAt); index (entity, createdAt)
```
`docs/activity-notifications.md` decided "no activity log"; this is only reserved so P6 search and routines do not invent their own.

## (d) Object storage and bundle sync

**Layout.** One bucket per install, everything under a workspace prefix, so deleting or exporting a workspace is one prefix:

```
workspaces/<wsId>/library/<itemId>
workspaces/<wsId>/skills/<skillId>/<rev>/<path>        (DECISION 9: by id + rev, not slug)
workspaces/<wsId>/sources/<sourceId>/<rev>/<path>      never: dotfiles, .credential-cache.json
workspaces/<wsId>/chats/<chatId>/messages.jsonl        (P7) and plans/, notes.md, downloads/
```
**Driver.** `FileStore` (`S/library/file-store.ts`) gains `list(prefix)` and path keys (validated: no `..`, no leading `/`), and an `s3` driver on Bun's `S3Client` (`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` from Infisical). `disk` driver root: `<ws>/library` for library keys (today's layout; store and cache are the same file), `CONFIG_DIR/objects/` for bundle keys. Disk mode runs the identical bundle sync against `CONFIG_DIR/objects/` (KBs duplicated; DECISION 10).

**Library on S3.** Save = today's two-phase save with `stage` = upload to `<itemId>.tmp-<rand>`, commit = copy over the key and delete the temp; the disk copy at `<ws>/library/<id>` is a read-through cache filled before an agent turn that names it and on `library:read`.

**Bundle write** (UI/RPC, or the watcher after an agent edit), one function `updateBundle(kind, row, files, expectedUpdatedAt)`:
1. Compute the manifest and `hash`; equal to the row's `hash` = nothing to do (this also absorbs the watcher events our own materialization causes).
2. Upload every file under a new `rev` prefix (bundles are small; whole-bundle upload, no diffing).
3. Guarded update `SET rev, hash, title..., updatedAt WHERE id AND updatedAt = expected`. Exactly one racing writer wins.
4. Winner: delete the old `rev` prefix, write the folder's marker `.otto-bundle.json {id, rev, updatedAt}`, push `domain:changed` (`skills`/`sources`), `invalidateSkillsCache`. Loser: delete its own `rev` prefix and go to conflict.

**Conflict rule:** the row in the database is the newer `updatedAt`, so it wins. The losing local folder is moved to `<ws>/.conflicts/<kind>/<slug>-<timestamp>/` (never lost), the folder is re-materialized, and the UI toasts.

**Materialize** (boot, workspace open, `domain:changed` from elsewhere): when the folder marker's `rev` differs from the row, download the `rev` prefix into `<ws>/<kind>/.tmp-<rand>/` and rename it over `<ws>/<kind>/<slug>/`. A folder with no row and no marker (an agent created a skill) becomes a new row through `updateBundle` with no expected `updatedAt`. A row deleted elsewhere removes the folder. Boot materializes lazily per workspace on first open, not every workspace up front.

**Watcher.** `S/config/watcher.ts` keeps only `skills/` and `sources/` (debounced 1 s per bundle, into `updateBundle`); the labels, statuses, automations, permissions, pages and session-header branches are deleted as each domain moves. One server process per install is assumed: no cross-node bus (NOT doing).

## (e) Migration

- **One importer per domain**, `init<Domain>Import()` in that domain, called from server bootstrap after `db:push`, in phase order. Each upserts by a natural key (connection slug, chat id, label slug, routine legacy id, skill slug) so a second run changes nothing, records `settings` install `imports.<domain> = <ms>`, and logs a count line (`imported 4 chats, 0 skipped, 0 failed`). A file that fails to parse is skipped and logged, never fatal.
- **Never destructive.** Old files stay where they are and are simply no longer read. Before the first import `config.json` is copied to `config.json.pre-db-<date>`. Cleanup is a separate later step (P7) the owner runs after verifying: old files move to `CONFIG_DIR/legacy-<date>/`, not deleted.
- **How `config.json` shrinks.** `StoredConfig` loses each key in the phase that imports it; the next `saveConfig` writes the file without it (with its three dated backups). After P2 nothing reads the file; it is deleted in P7.
- **Rollback.** Revert the phase's commit: the old code reads the untouched old files. Anything written after the switch exists only in the database and is lost to the old version; no export-back is built (NOT doing). So each phase runs a few days on the owner's install before the next one starts.

**The owner's real `~/.otto` (not touched now).** Seen (names only): one workspace `test` with 4 chats, `events.jsonl`, empty `pages/`, `skills/`, `sources/`, `projects/`; no `automations.json`, no `messaging/`; `config.json` keys `activeSessionId, activeWorkspaceId, decisionLayer, defaultLlmConnection, enable1MContext, llmConnections, migrationsApplied, workspaces`; `drafts.json`, `preferences.json`, `credentials.enc`, `otto.db` (+WAL, and `-polluted`/`-pre-comments` backups). Steps per phase:
1. Owner stops the dev server (9100/5175).
2. Back up: `tar czf ~/otto-backup-<date>.tgz -C ~ .otto` and `sqlite3 ~/.otto/otto.db ".backup ~/otto-db-<date>.db"` (WAL-safe).
3. Keep the same `ENCRYPTION_KEY` as today (existing `secrets` rows are encrypted with it).
4. `bun run dev` (pushes the schema, runs the importers), read the count lines.
5. Check in the app: connections list and a chat reply (P1c), chat list, labels, statuses, unread, search (P3), settings per user (P1a).
6. After a few days of use, the P7 cleanup.

## (f) Phases

Sizes: S = one agent, under half a day; M = one agent, a day; L = split into the listed M chunks. Tests everywhere: `openDb(':memory:')` + `pushSchema`, importers against a temp `OTTO_CONFIG_DIR` fixture shaped like `~/.otto` (run twice: same rows), the existing channel tables in `authorize.isolated.ts` and `session-guard.test.ts` extended for every new channel, typecheck.

| Phase | What | Files | Size | Needs |
|---|---|---|---|---|
| P0a | Desktop `ENCRYPTION_KEY`: generated once, stored with Electron `safeStorage` in `CONFIG_DIR/encryption-key` (0600), passed to the embedded server (DECISION 1) | `apps/electron/src/main/index.ts`, `S/secrets/index.ts` | S | - |
| P0b (done) | Agent subprocess env from an allow-list (`agentEnv`), not `...process.env`; the server's secrets are refused even when passed | `session-tools-core/src/runtime/agent-env.ts`, `S/agent/options.ts`, `S/agent/pi-agent.ts`, `S/mcp/{client,validation}.ts`, `S/automations/utils.ts`, `session-tools-core/src/runtime/sandbox-env.ts` | S | - |
| P1a | `settings` domain + importer (config UI/machine keys, `preferences.json`); scope-based guard | `S/settings/*`, `S/config/{storage,preferences}.ts`, `SC/handlers/rpc/settings.ts`, `SC/bootstrap/authorize.ts`, `update-preferences` session tool | M | P0a |
| P1b | `chats_drafts` + importer | `S/sessions/schema.ts`, `S/config/storage.ts:1019-1149`, `rpc/settings.ts:201-220` | S | - (parallel with P1a) |
| P1c1 | `connections` truth: columns, importer from `llmConnections` + `llm_*` credentials, every reader (sessions, Pi, model fetchers) on the domain | `S/connections/*`, `S/config/llm-connections.ts`, `S/config/storage.ts:2576-2860`, `SC/model-fetchers`, agent backends | M | P0a |
| P1c2 | Writes and OAuth (Claude, Codex, Copilot refresh) through `secrets`; delete `connection-mirror.ts`; `llm-connections`/OAuth channels need owner/instance role | `SC/handlers/rpc/{llm-connections,onboarding}.ts`, `S/auth/state.ts` | M | P1c1 |
| P1c3 | `serverConfig.token`, `remoteServer.token`, `decision_api_key` into `secrets` | `S/config/{storage,server-config}.ts`, `SC/handlers/rpc/workspace.ts:80`, `S/decisions/settings.ts` | S | P1a |
| P2 | Workspace registry in DB, `workspaces_remotes`, `<ws>/config.json` into rows + settings, delete `updateWorkspaceMirror` and `plan.json` code | `S/workspaces/*`, `S/config/storage.ts:613+`, `SC/handlers/rpc/{workspace,settings}.ts`, `packages/core/src/types/workspace.ts` | M | P1a, P1c3 |
| P3a | `labels`, `statuses`, `views` tables, workspace `permissions` setting; agent docs `labels.md`, `statuses.md`, `permissions.md` and `config_validate` targets updated | `S/{labels,statuses,views}/*`, `S/agent/permissions-config.ts`, `S/config/watcher.ts`, `session-tools-core/src/handlers/config-validate.ts` | M | P1a |
| P3b | `chats` + `chats_labels`; header out of JSONL; list from SQL with the private rule; export/import bundle; set-label/status tools | `S/sessions/{schema,storage,jsonl,persistence-queue,bundle}.ts`, `SC/sessions/session-manager.ts`, `SC/handlers/rpc/sessions.ts` | L (2 M: storage+importer, then manager+RPC) | P3a |
| P3c | `search` domain, FTS5 for chats, ripgrep search deleted | `S/search/*`, `SC/services/search.ts`, `rpc/sessions.ts:414-445` | M | P3b |
| PX | Delete pages (22 channels, agent page tools, `PageThumbnailer`, `pages.md`, `page_publish_token`, page sharing endpoints) | `S/pages`, `SC/handlers/rpc/pages.ts`, `apps/electron/src/transport/channel-map.ts`, `apps/electron/src/main/index.ts:650-660`, `docs/sharing.md` | M | - (any time) |
| P4a | `FileStore` s3 driver + `list`, library on S3 with read-through cache; test with Bun's S3 against Garage in a container, CI on disk | `S/library/file-store.ts`, `S/library/index.ts`, `SC/handlers/rpc/{library,files}.ts` | M | - (parallel with P1-P3) |
| P4b | `skills` table, `updateBundle`, materialize, watcher, importer; grids read the table | `S/skills/*`, `S/config/watcher.ts`, `SC/handlers/rpc/skills.ts`, `S/agent/base-agent.ts:842-937` | L (2 M) | P4a |
| P4c | `sources` table on the same sync, `authStatus` column, source credentials into `secrets` | `S/sources/*`, `S/sources/credential-manager.ts`, `S/credentials/*` | L (2 M) | P4b core |
| P5a | `routines` + `routines_runs` (+retry rows, slot dedupe), importer, scheduler and history on the DB; webhook auth into `secrets`; stop `events.jsonl` | `S/automations` → `S/routines`, `S/scheduler`, `SC/handlers/rpc/automations.ts` | L (2 M) | P3a (label slugs), P1c (connections) |
| P5b | Incoming webhook trigger `POST /api/routines/<id>/webhook` with bearer = its secret | `SC/webui/http-server.ts` | S | P5a |
| P5c | Messaging tables and setting, bot tokens into `secrets` | `S/messaging/*`, `packages/messaging-gateway/src/*-store.ts` | M | P3b (chat ids) |
| P6 | `search_fts` for tasks, projects, comments, library documents; one search RPC | each domain's write functions, `S/search` | M | P3c |
| P7 | Chat messages and plans/notes/downloads on S3; WhatsApp auth snapshot; `credentials.enc`, `config.json`, legacy folders cleanup | `S/sessions/*`, worker, `S/credentials` | L | P3b, P4a, P4c, P5c |

Parallel lanes: {P0a, P0b, P1b, PX, P4a} start together; P1a and P1c1 after P0a; P3a after P1a; P4b/P4c run beside P3; P5 after P3a; P6 and P7 last. Owner's order holds: small wins (P1) first, then chats + FTS (P3), then S3 + skills/sources (P4), then routines (P5), then search + activity (P6).

## (g) Security

| Hole | Closed by |
|---|---|
| Private file paths (`config.json`, `credentials.enc`, `otto.db`, other workspaces, other members' chats) | done, commit 3701182 |
| Plaintext `serverConfig.token`, `remoteServer.token`; plaintext webhook auth in `automations.json` | P1c3; P5a |
| `credentials.enc` decryptable by anyone who runs code as the server user (key derives from the machine id) | P1c/P4c/P5c move every family to `secrets`; P7 deletes the file |
| Server secrets in every agent's environment (`...process.env`), so an agent shell could decrypt `otto.db` | P0b, done: `agentEnv()` (`session-tools-core/src/runtime/agent-env.ts`) builds the env of the Claude and Pi subprocesses, script tools, automation scripts and MCP stdio sources from an allow-list of host variables plus what the caller passes on purpose; `ENCRYPTION_KEY`, `BETTER_AUTH_*`, `OTTO_SERVER_TOKEN`, `OTTO_WEBUI_*`, `OTTO_OWNER_EMAIL`, `OTTO_RPC_*` and `INFISICAL_*` are refused even when passed |
| `llm-connections` and OAuth channels open to any member | P1c2 (owner / instance role; workspace connections by workspace owners) |
| Members writing install-wide settings; personal prefs shared by all members | P1a (scope guard, per-user scope) |
| Agent shell execution reads anything the server user can (other workspaces' folders, the db file) | not closed by this plan: needs a per-workspace OS user or container sandbox on the hosted server; P0b + `secrets` limit what it can decrypt, not what it can read |
| Per-workspace sandboxing of disk caches | same as above; S3 prefixes per workspace make it possible (one scoped key per workspace), not built |

## (h) Risks and NOT doing

Risks:
- **Agents edit config by path today.** `~/.otto/docs/{labels,statuses,automations,permissions,sources,skills}.md` and `config_validate` teach agents to edit JSON files. Every domain that moves to the DB must, in the same change, update its doc and give agents a way in: one allow-listed session tool `otto_rpc(channel, args)` that runs as the chat's user through the same guard (DECISION 14). Skills and sources keep path editing (the watcher syncs).
- FTS5 vs `db:push` (see search). Fallback `search.db`.
- Desktop key loss: if `safeStorage` changes (OS user reinstall), secrets are unreadable and connections must be re-entered. Accepted for the desktop.
- Legacy chat ids are not the `createId()` shape; `isEntity` and `ENTITY_TOKEN` must accept them for `chat:` (or chats are never tokens).
- A workspace folder copied to another machine no longer carries its settings (they are rows). Accepted.
- One server process per install: caches, scheduler and watcher are in memory. Two nodes would need a bus; the `slot` unique only protects schedule runs.
- Claude SDK transcripts stay in `~/.claude/projects`, so a chat cannot resume on another host even after P7.
- Better Auth plugin tables gain columns through `additionalFields`; an upgrade must keep them (pinned version, `validateSchema`).

NOT doing: skills/sources content in SQLite; Postgres now (only the driver and `sqlite-core` imports would change later); migrations files before the MVP is stable; event sourcing, history or version tables (bucket versioning instead, if wanted); a messages table; per-user unread rows before shared chats; multi-node sync; export from DB back to files; moving themes, logs, Electron state or generated assets into the DB; syncing global or project skills; a generic settings framework beyond one table and one typed key list.

## (i) Owner decisions

Each: recommendation first, then the alternative.

1. **Desktop `ENCRYPTION_KEY`.** Generate once, keep it with Electron `safeStorage`. Alt: derive from the machine id like `credentials.enc` (weaker), or ask the user.
2. **Settings shape.** One `settings(scope, key, value)` table for install, workspace and user. Alt: `settings` + `users_preferences` + typed workspace columns.
3. **Connection scope.** `scope` install or workspace; existing ones imported as install; lookup workspace first, then install. Alt: install only (today), or workspace only (SaaS-pure, each workspace brings keys).
4. **Chat messages.** Header to `chats`, messages stay one JSONL per chat (disk now, one S3 object rewritten at turn end later). Alt: a `chats_messages` table, or per-turn S3 segments.
5. **Unread, flag, archive.** Columns on `chats` (chats are private). Alt: `chats_reads` per user now.
6. **Chat ids.** Keep legacy ids, new chats `createId()`. Alt: rewrite every id (breaks URLs, drafts, bindings, SDK folders).
7. **Search.** One FTS5 table for all entities, `unicode61` with prefixes. Alt: one FTS table per domain; `trigram` tokenizer for substring matches like ripgrep (bigger index).
8. **Skill scopes.** Only workspace skills go to DB and S3; global and repo skills stay disk, listed read-only. Alt: all three scopes synced.
9. **Object keys.** By id with a `rev` prefix per write. Alt: by slug as `docs/object-storage.md` says (renames move objects, writes need another commit step).
10. **Disk mode.** Same bundle sync against a disk object root. Alt: skip sync on the desktop (less duplication, two code paths).
11. **Permissions.** Workspace rules as a workspace setting, source rules inside the source bundle, app default a bundled asset. Alt: a `permissions` table.
12. **Routine actor.** Runs and their chats belong to the routine's creator. Alt: the workspace's first owner (today).
13. **Pages.** Delete the feature (no UI left). Alt: keep agent page tools and the thumbnailer.
14. **Agents and DB-backed config.** One allow-listed `otto_rpc` session tool under the user's guard. Alt: one tool per domain, or keep those domains as files.
15. **WhatsApp auth.** Disk only until P7, then a debounced `secrets` snapshot. Alt: S3 object now (it holds keys, so not S3).
16. **Workspace slug.** The DB `slug` becomes the unique route slug. Alt: keep `slug` = id and add a separate route slug column.
17. **Remote workspaces.** Separate `workspaces_remotes` table. Alt: rows in `workspaces` with a remote flag (pollutes membership and guards).
18. **`events.jsonl`.** Stop writing, do not import. Alt: keep as a disk log.
19. **Activity log.** Shape reserved, not built. Alt: build it in P6 (reverses the "no activity log" decision).
20. **Source credentials.** Per workspace, shared by members (today). Alt: per user.
21. **Label and status ids.** New `createId()` ids plus a `slug` holding the old id. Alt: rewrite every reference to new ids and drop slugs.
22. **Status icons.** `icon` text column (emoji, icon name or small data URL). Alt: S3 objects.
