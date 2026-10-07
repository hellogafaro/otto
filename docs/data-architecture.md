# Data architecture (plan to agree)

Status: the owner reviewed this plan and decided two sets on 6 Oct 2026: first remote workspaces cut, settings naming, drafts cut, messages in SQLite, saved views dropped, routines names, messaging cut, workspace skills only; then A-G (one `labels_entities` table, the final `messages` schema, images as library objects, DB-first memory and short write transactions, search split, Python agent tools, harness and sandbox direction). Both are applied below and listed as resolved in (k). Also on 6 Oct 2026 the Pi research (`docs/pi-research.md`) was applied: the Durability section, the `transcripts` table (recommended, pending the owner as **DECISION 16**), phases P0c, P0d and P8, agent tools as a CLI the agent runs through bash, and containers that run tools only. Nothing built beyond the phases marked done. It says where every persisted thing lives (database, object storage, disk only, or deleted), the exact new tables, how files sync, how the user's `~/.otto` is imported, and the order of work. Every choice the owner may want different is marked **DECISION n** and listed in (k). Evidence comes from three code inventories (chats, workspace folder, install-wide) and `file:line` reads; what was not verified is said where it matters. Paths: `S` = `packages/shared/src`, `SC` = `packages/server-core/src`, `<ws>` = a workspace root, `CONFIG_DIR` = `~/.otto`.

## (a) Principles

1. **SQLite is the truth for records; object storage is the truth for files; disk is a cache agents read by path.** A record is anything listed, filtered, joined, guarded or edited field by field. A file is anything an agent reads or edits with its normal tools (skills, sources, library bytes, chat files later).
2. **Secrets only in `secrets`** (AES-256-GCM, `ENCRYPTION_KEY`). Other rows keep a `secretId`. No token in a JSON file, in S3, or in an agent's environment.
3. **Same code on the desktop and the server.** `OTTO_STORAGE=disk` (default, desktop, dev) and `OTTO_STORAGE=s3` (Garage, hosted) differ only in the storage driver. A single-user desktop with no S3 keeps working.
4. **Smallest model that works.** Settings are key/values, not one table per screen. Row columns only for what is listed, filtered or guarded; the rest is one JSON `metadata`/`config` column. No event sourcing, no history tables, no generic sync framework.
5. **Moves are imports, not rewrites.** Each domain imports its old files once at boot, idempotently, never deletes them, and the old reader is removed in the same change (no dual source of truth).
6. **Every workspace-scoped table carries `workspaceId`, child tables included** (owner, 6 Oct 2026), so every query and guard can bound by workspace. Today `projects_members` lacks it; the new child tables (`messages`, `transcripts`, `labels_entities`, `routines_history`) include it from day one, and an importer fills it for `projects_members` from its project.
7. **Durable by default.** What was committed is never lost, a failed write is retried rather than dropped, and a crash never leaves a false state on screen (a tool spinning forever, one message sent twice). The targets and their tests are in "Durability" below.

## Durability (first-class requirement)

Owner, 6 Oct 2026: "durable is something key for us to make sure we have the highest quality possible". Every phase that touches chats is checked against the table below, and P3b ships the crash suite that proves it. This section has no letter so the references to (b)-(k) elsewhere stay valid. Evidence and Pi's own guarantees: `docs/pi-research.md` 2 and 3.

**Today** (`docs/pi-research.md` 3, `docs/messages-design.md` 2): the user message is committed before the ack; streamed text is never stored, so a server restart loses all of it; the tool rows of a dead turn stay `executing`; nothing resumes a turn; Pi's transcript is a file in `<chat>/.pi-sessions` on one host, and a tool call cut off by a crash reaches the model as Pi's synthetic "No result provided"; a failed write is logged and dropped (`persistence-queue.ts:163-165`); duplicate sends are caught in memory only.

| Failure | Guarantee we target | Mechanism | Phase | Test (P3b crash suite) |
|---|---|---|---|---|
| Server crash while an answer streams | At most 500 ms of streamed text lost; after the restart the partial answer is shown, marked interrupted | The assistant row exists from the first text delta with `content.partial`; its text so far is saved on the 500 ms debounce (snapshots, not deltas); boot recovery marks it interrupted | P3b | `SIGKILL` mid-stream; reopen: the row holds the text of the last flush, marked interrupted |
| Server crash during a tool call | No row stays `executing`; the model is told the call was interrupted and may have run; no silent retry | Boot recovery marks `executing` rows `interrupted` and, for Pi chats, appends a matching interrupted tool result to `transcripts` (DECISION 16; with files, Pi's "No result provided" stays); tools are tagged read-only or side-effecting (Pi's `annotations.readOnlyHint`); nothing is replayed automatically | P3b | `SIGKILL` inside a tool's `execute()`; boot: the row is `interrupted` and the next Pi request carries the interrupted result |
| Server crash during compaction | Nothing lost: the transcript stays the pre-compaction one and compacts again when needed | Pi writes the compaction entry only when it is done and never deletes entries; `transcripts` is append-only; our compaction `info` row is written on `compaction_complete` only | P3b (verify) | `SIGKILL` during compaction; resume: the entries equal the pre-crash set and the next turn works |
| Server crash or error during a DB write | All or nothing per batch; a failed write is retried, never dropped | One short `BEGIN IMMEDIATE` per batch holding the rows, FTS, `chats` fields and new `transcripts` entries; `synchronous = FULL`; upsert by id; retry after 1 s | P3b | `SIGKILL` after statement k (`docs/messages-design.md` 8), extended to `transcripts`; write lock held 6 s: retried, nothing lost |
| Two tabs on one chat; a tab reconnects | A tab opened mid-turn sees the committed rows plus the current partial; after a server restart every tab reloads to the committed state with its interrupted markers, without duplicates | The newest page merges the in-memory tail (with the partial) over the SQL rows; a restart takes today's `stale: true` reload | P3b | A second client opens mid-stream and sees the partial; after a restart the clients reload and match SQL |
| Duplicate send after a restart (the client never got the ack) | One user message and one turn per client message id | The client's message id (`createId()` shape; today's `optimisticMessageId`) is the stored `messages.id`; a send whose id exists returns the stored message and starts no turn | P3b | Kill after the user message commits, before the ack; resend the same id: one row, one turn |
| Server restart or move to another host (Pi chats) | Pi resumes with its exact context from the database, on any host | `transcripts` holds Pi's entries verbatim, seeded into `SessionManager.inMemory` on resume (DECISION 16, pending) | P3b | Restart with an empty `.pi-sessions`: Pi gets the same entries a file-backed run would |
| Agent container dies (later, (h)) | The turn and its transcript survive; only the running tool call fails | Only tools run in the container; harness, transcript and credentials stay on the server | direction (h) | When built: kill the container mid-`bash`; the turn continues with an error result |
| Server crash mid-turn: continue the run itself | Not targeted now: the turn stops at its interrupted markers and the user prompts again | Checkpointed runs and idempotent submissions are what `pi-durable` provides | P8 | P8 runs this same suite against `pi-durable` |

**Boot recovery** runs once at boot, before chats load, and reads only chats whose `turnStartedAt` is set (set in a turn's first flush, cleared in its last), so it never scans `messages`. **Claude harness:** gone; Claude runs through Pi ([pi-only-plan](pi-only-plan.md)).

## (b) The map

Target legend: **DB** = table(s); **S3+DB** = object storage for bytes, DB row for metadata, disk cache; **disk** = stays a local file (machine state, generated assets, logs, caches); **mem** = stays in memory; **delete**. Phases are in (f).

| Thing | Today | Target | Scope | Phase |
|---|---|---|---|---|
| Workspace registry (`workspaces[]`: id, name, rootPath, iconUrl, mcpUrl, lastAccessedAt) | `config.json` + DB mirror `workspaces` | DB `workspaces` (+`rootPath`, real `slug`); `lastAccessedAt` on `workspaces_members` | install | P2 |
| `remoteServer {url, token, remoteWorkspaceId}` (remote workspaces are cut from the MVP, see (j) "Deployment modes") | `config.json`, token plaintext | token in `secrets`; no new table | install (client) | P1c3 |
| `activeWorkspaceId`, `activeSessionId` | `config.json` | `settings` `user:<id>` | user | P1a |
| `llmConnections`, fetched model lists | `config.json` | DB `connections` (existing, extended) | install or workspace | P1c |
| `defaultLlmConnection`, `defaultThinkingLevel` | `config.json` | `settings` `install` | install | P1a |
| UI prefs: `colorTheme`, `notificationsEnabled`, `sendMessageKey`, `spellCheck`, `autoCapitalisation`, `richToolDescriptions` | `config.json` (shared by all members) | `settings` `user:<id>` | user | P1a |
| Machine settings: `setupDeferred`, `allowRemoteEvaluate`, `gitBashPath`, `keepAwakeWhileRunning`, `dismissedUpdateVersion`, `migrationsApplied` | `config.json` | `settings` `install` | install | P1a |
| `serverConfig {enabled, port, tlsCertPath, tlsKeyPath, token}` | `config.json`, token plaintext | `settings` `install` key `server` with `tokenSecretId` | install | P1a, token P1c3 |
| `decisionLayer` + `decision_api_key::{provider}` | `config.json` + `credentials.enc` | `settings` `install` key `decisionLayer` with `secretId` | install | P1a/P1c |
| `enable1MContext` (only in the real file, no code reads it) | `config.json` | delete | - | P1a |
| `preferences.json` name, email | file | `users.name`, `users.email` (already the local user's source) | user | P1a |
| `preferences.json` timezone, location, notes, diffViewer, includeCoAuthoredBy, uiLanguage | file (shared by all members) | `settings` `user:<id>` | user | P1a |
| `drafts.json` (per chat, not per user; pasted bytes inline) | file | dropped, not imported: drafts live in the browser only (per user and chat, localStorage or IndexedDB), no server storage | user | - |
| `credentials.enc` `llm_*`, legacy `anthropic_api_key`/`claude_oauth` | machine-id-keyed file | `secrets` via `connections.secretId` | install/workspace | P1c |
| `credentials.enc` `source_*::{ws}::{slug}` | same | `secrets` via `sources.secretId` | workspace | P4c |
| `credentials.enc` `messaging_bearer::{ws}::{platform}` | same | untouched: messaging is hidden from the MVP, files untouched, revisit later | workspace | - |
| `credentials.enc` `workspace_oauth::{ws}` (workspace MCP sign-in; use not fully traced) | same | delete once traced (it served remote-workspace sign-in, now cut), else `secrets` | install | P2 |
| `credentials.enc` `page_publish_token` | same | credential type deleted with pages (done); a leftover entry is ignored and goes with the file | - | PX (done) |
| `credentials.enc` file itself | file | delete after every family moved and verified (the hidden messaging entries are dropped or moved when that feature is revisited) | - | P7 |
| `config-defaults.json`, `docs/`, `permissions/default.json`, `tool-icons/`, `provider-domains.json` | rewritten or copied from the bundle | disk (generated assets, not user data) | install | - |
| `theme.json`, `themes/*.json` | file | disk for now (custom themes per install) | install | not now |
| `logs/` (`decisions`, `privileged-actions`, `page-actions`, interceptor, gateway, update) | jsonl/log files | disk; the `page-actions` writer is deleted with pages (done) | install | - |
| `window-state.json`, `.server.lock`, `api-error.json`, `feedback/`, Electron browser partition, updater cache | files | disk (machine/Electron state) | install | - |
| `workspaces/{id}/plan.json` (`saveWorkspacePlan`, no caller outside `config/storage.ts` found) | file | delete (dead code) | - | P2 |
| OAuth flows in progress, pairing codes, background task outputs, scheduler tick, skills cache | memory | mem | - | - |
| `<ws>/config.json` (name, slug, `defaults`, `localMcpServers`) | file | `workspaces.title/slug` + `settings` `workspace:<id>` keys `defaults`, `localMcpServers` | workspace | P2 |
| `<ws>/permissions.json` | file (watched) | `settings` `workspace:<id>` key `permissions` (**DECISION 8**) | workspace | P3a |
| Chat header (`SESSION_PERSISTENT_FIELDS` + precomputed list fields) | first line of `sessions/<id>/session.jsonl` | DB `chats`; its labels in `labels_entities` (`chat:<id>`) | user (private) | P3b |
| Chat messages | rest of `session.jsonl`, full rewrite per 500 ms burst | DB `messages` (design: `docs/messages-design.md`); no longer a file or an S3 object | user | P3b |
| Chat full-text search | ripgrep over JSONL | FTS5 `messages_fts`, written in the message's transaction | user | P3b |
| Inline images in messages (`thumbnailBase64`, `resizedBase64`, legacy `thumbnailPath`) | base64 inside `session.jsonl` (99.6% of the measured bytes) | library objects; UI thumbnails from `/api/library/<id>/thumb`; the importer moves or drops them | workspace | P3b |
| Chat `plans/`, `notes.md`, `downloads/` | session folder | disk now; S3 with chat files | user | P7 |
| Chat `long_responses/`, `data/`, `tmp/`, `meta/`, `api-error.json` | session folder | disk (agent working files, travel in the export bundle as today) | user | - |
| Pi session entries | `<chat>/.pi-sessions/*.jsonl` (one host's disk) | DB `transcripts`, Pi's entries verbatim, seeded into `SessionManager.inMemory` on resume; the importer reads the newest file (the one `continueRecent` picks); no S3 object (**DECISION 16**, recommended, pending the owner; alt: files + one S3 blob in P7) | user | P3b |
| Claude SDK transcripts | `~/.claude/projects/{cwd-hash}/` | superseded: no Claude harness and no blob; old Claude chats continue in Pi and keep their stored messages ([pi-only-plan](pi-only-plan.md)) | user | - |
| Chat attachments | library items in "Chat attachments" | unchanged (library); thumbnails cached as `<itemId>.thumb` | workspace | P4a for S3 |
| `<ws>/automations.json` (matchers; webhook `auth` holds plaintext passwords/tokens) | file (watched) | DB `routines`, webhook auth in `secrets` | workspace | P5a |
| `<ws>/automations-history.jsonl` | file | DB `routines_history` | workspace | P5a |
| `<ws>/automations-retry-queue.jsonl` | file | `routines_history` rows with `status='retry'` | workspace | P5a |
| `<ws>/events.jsonl` (no retention, no reader found in the UI) | file | delete (**DECISION 11**) | - | P5a |
| `<ws>/labels/config.json` | file (watched) | DB `labels`; assignments in `labels_entities` (chats, library items, tasks, projects) | workspace | P3a |
| `<ws>/statuses/config.json` + `statuses/icons/*` | files (watched) | DB `statuses` (icon in a column, **DECISION 15**) | workspace | P3a |
| Workspace skills `<ws>/skills/<slug>/` (the only skill scope; the code that reads global `~/.agents/skills` and project-repo skills is deleted in P4b) | files (watched) | S3+DB `skills` | workspace | P4b |
| Sources `<ws>/sources/<slug>/` (config, guide, icon, permissions) | files (watched) | S3+DB `sources` | workspace | P4c |
| Source runtime fields `isAuthenticated`, `connectionStatus` | inside source `config.json` | `sources.authStatus` column (not in the bundle) | workspace | P4c |
| Source `.credential-cache.json` | file (holds tokens) | disk, never uploaded | workspace | P4c |
| Pages `<ws>/pages/` | files | the feature is deleted (resolved and done, (k)); existing folders stay on disk, nothing reads them | - | PX (done) |
| Messaging `bindings.json`, `pending.json`, `topic-registry.json`, `config.json` | `CONFIG_DIR/workspaces/<id>/messaging/` | feature hidden, files untouched, revisit later (no tables, no importer) | workspace | - |
| WhatsApp `whatsapp-auth/` | folder (session keys) | same: feature hidden, files untouched, revisit later | workspace | - |
| Library bytes | `<ws>/library/<id>` (disk FileStore) | S3+DB (`library` already) | workspace | P4a |
| `<ws>/.claude-plugin/plugin.json` | generated | disk | workspace | - |
| `<ws>/projects/` (old file projects, ignored) | empty folders | delete after import verification | - | P7 |
| library, projects, tasks, timesheets, comments, notifications, users, members, invitations, secrets, connections | `otto.db` | unchanged | - | - |

What leaves `config.json` by the end: everything. After P2 it holds nothing the server needs; the file is kept only if Electron still needs a pre-DB bootstrap value (none found). **Unverified:** whether any external tool or script reads `config.json` directly (the CLI goes through the server).

## (c) Schemas

Conventions (AGENTS.md): ids `createId()` unless noted; timestamps `integer` ms; booleans `integer` (`mode: 'boolean'`); JSON as `text`; references are plain id columns (no SQL foreign keys, as today); actors `user:<id>`/`agent:<id>`; entities `<type>:<id>`. `NN` = not null. `routine` and `chat` join `ENTITY_TYPES`.

### settings (new domain `S/settings`)

```
settings                          one key/value table for three kinds of owner (DECISION 1)
  entity      text NN   'install' (one fixed value) | 'workspace:<id>' | 'user:<id>'
  key         text NN   from one typed catalogue in code (default + validator per key)
  value       text NN   JSON
  updatedAt   int  NN
  PK (entity, key)
```
Keys: entity `install`: `defaultConnectionSlug`, `defaultThinkingLevel`, `setupDeferred`, `server` (`{enabled, port, tlsCertPath, tlsKeyPath, token}`; `token` is plaintext until P1c3 replaces it with `tokenSecretId`), `decisionLayer` (`{..., secretId}`), `allowRemoteEvaluate`, `gitBashPath`, `keepAwakeWhileRunning`, `dismissedUpdateVersion`, `imports` (per-domain import timestamps). Entity `workspace:<id>`: `defaults`, `localMcpServers`, `permissions` (P3a). Entity `user:<id>`: `activeWorkspaceId`, `activeChatId`, `colorTheme`, `notificationsEnabled`, `sendMessageKey`, `spellCheck`, `autoCapitalisation`, `richToolDescriptions`, `timezone`, `location`, `notes`, `diffViewer`, `includeCoAuthoredBy`, `uiLanguage`. Authorization by entity, in the one guard: `install` = workspace owner on the desktop / instance owner on a server, `workspace:<id>` = its owners, `user:<id>` = only that user (read and write). Electron localStorage UI state (sidebar, panels, recents) stays per device.

### providers (existing `S/connections`, made the only source)

```
connections                       (existing: id, slug, type, title, baseUrl, secretId, createdAt)
  + scope        text NN  'install' | 'workspace:<id>' | 'user:<id>'   (DECISION 2 + owner, 6 Oct 2026: each person connects their own); unique (scope, slug) replaces unique slug
  + authType     text NN  today's LlmAuthType, lossless: api_key | api_key_with_endpoint | bearer_token | oauth | iam_credentials | service_account_file | environment | none
  + defaultModel text
  + models       text     JSON: fetched model list (cache, replaced on refresh)
  + config       text     JSON: modelSelectionMode, piAuthProvider, customEndpoint, midStreamBehavior
  + account      text     JSON: oauthAccountUuid/Email, oauthOrganizationUuid/Name, verifiedAt
  + lastUsedAt   int
  + updatedAt    int NN
```
`type` = today's `providerType`. A lookup by slug looks in the person's own scope first, then the workspace's, then the install's; a person's own connection is seen by nobody else. `secretId` holds one JSON value per connection (`{apiKey}` or `{accessToken, refreshToken, idToken, expiresAt}` or IAM/service-account fields); token refresh rewrites that secret in place. Chats keep `connectionId` (the slug is imported and kept for agent prompts). `SC/domain/connection-mirror.ts` is deleted.

### workspaces (existing tables, plugin `additionalFields`)

```
workspaces            + rootPath text NN  '~'-form path on this host (server: CONFIG_DIR/workspaces/<id>)
                      ~ slug     text NN unique: the route slug (today = id); imported from the folder name,
                                 collisions suffixed '-2' (DECISION 10)
workspaces_members    + lastAccessedAt int     per-user recent ordering for the switcher
```
`iconUrl` goes to the existing `logo`, `mcpUrl` to `metadata` (JSON) until its use is traced.

### chats (table set in `S/sessions/schema.ts`; the folder rename to `chats` is not part of this plan)

```
chats
  id                 text PK  legacy 'YYMMDD-adjective-noun' kept; new chats createId() (DECISION 4)
  workspaceId        text NN
  title              text     (was name)
  createdBy          text     actor; null = legacy chat, owned by the workspace owners (unchanged rule)
  statusId           text     statuses.id
  projectId          text
  parentChatId       text     subtask parent
  triggeredBy        text     entity 'routine:<id>' (was {automationName, automationId})
  flaggedAt          int      (was isFlagged)        DECISION 3: on the row, chats are private
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
  turnStartedAt      int      set in a turn's first flush, cleared in its last; boot recovery reads only these chats
  metadata           text NN default '{}'  JSON: sdkSessionId, sdkCwd, piSessionId, workingDirectory, enabledSourceSlugs,
                              previousPermissionMode, connectionLocked, sharedUrl, sharedId, pendingPlanExecution,
                              branchFrom* (5), transferredSessionSummary(+Applied), tokenUsage
  createdAt          int  NN
  updatedAt          int  NN
  index (workspaceId, createdBy, lastMessageAt); index (workspaceId, projectId); index (parentChatId)
```
A chat's labels are rows of `labels_entities` (labels section below) with `entity = 'chat:<id>'`; the list's label filter joins it.
Private chats move from a list filter into SQL: every list query has `createdBy = :actor OR (createdBy IS NULL AND :isOwner)`. `workspaceRootPath` is dropped (the row knows its workspace). Header external-edit merging (`persistence-queue.ts:116-130`) and the watcher's `session.jsonl` branch go: nobody writes headers by path after P3b.

**Messages and streaming.** Full design in `docs/messages-design.md`. Final table: `messages(pk INTEGER PRIMARY KEY, workspaceId NN, chatId NN, id NN, "order" int NN, type NN, content NN JSON, createdAt NN, updatedAt NN)`, unique `(workspaceId, chatId, "order")` and `(workspaceId, chatId, id)`; `pk` is SQLite's rowid made explicit, used only to link the contentless `messages_fts`. No inline base64: images are library objects with a cached thumbnail endpoint. The server reads DB-first (memory holds running turns plus a 16-chat LRU) and writes each finalized message or batch in a short `BEGIN IMMEDIATE` transaction (500 ms debounce only for streaming changes). `session.jsonl` goes away. Drafts are not stored on the server: they stay in the browser (per user and chat); `drafts.json` is dropped, not imported. Durability additions (see "Durability"): the assistant row exists from the first text delta and its partial text is saved on the 500 ms debounce; boot recovery marks `executing` and partial rows interrupted; the client's message id is the stored id, so a resent message is an upsert, not a second turn.

**Pi transcripts (DECISION 16, recommended, pending the owner).** `messages` is the display, search and export table and is lossy for a model (capped tool results, tokenised paths, no thinking blocks, signatures or compaction entries), so it is not Pi's store. Pi's own entries go verbatim into a second table in the same schema file:

```
transcripts
  workspaceId  text NN
  chatId       text NN   chats.id
  id           text NN   Pi's entry id, kept as Pi made it (parentId points at it, so it is not a createId())
  parentId     text      Pi's parent entry id; null for the first entry (Pi's entries form a tree, the leaf picks the branch)
  type         text NN   Pi's entry type: 'message' | 'model_change' | 'thinking_level_change' | 'compaction' | ...
  content      text NN   JSON: the whole entry exactly as Pi produced it (never capped, rewritten or path-tokenised)
  order        int  NN   append order, which is the order Pi needs them back in; quoted "order" in raw SQL
  createdAt    int  NN
  PK (workspaceId, chatId, id); unique (workspaceId, chatId, "order")
```
- **Resume:** the server reads the chat's rows in `order` and builds the session with `SessionManager.inMemory(cwd, { id: metadata.piSessionId }, entries)` (supported since Pi 0.85.0, present in our 0.87.1). No `.pi-sessions` file, no S3 object, no restore step, and a chat resumes on any host.
- **Append:** `pi-agent-server` sends the entries it has not sent yet (compared by id against `getEntries()`) at `message_end`, `turn_end`, `compaction_end` and `agent_settled`; the server inserts them in the same batch transaction as the `messages` rows. That this catches every entry type is **unverified**: a test compares the mirror with a file-backed run.
- **Fork and clear:** a branch copies the parent's rows up to the anchor (`INSERT … SELECT`, as for `messages`); `/clear` and chat delete remove them in the same transaction.
- **Size:** larger than `messages` (the real `vital-zenith` Pi file is 2.2 MB against 281 KB of messages): tool results are whole and images stay inline as base64 in the model's messages. The `messages` 1 MB row guard does not apply, since verbatim is the point. Compaction never deletes entries (Pi adds a `compaction` entry with `firstKeptEntryId`), so the rows of a chat only grow until the chat is deleted, and resume loads all of them because Pi rebuilds context from the whole tree. `scripts/bench-messages.ts` measures resume of a large transcript.
- **Alternative:** keep `.pi-sessions` files on disk and upload each as one blob with the chat files in P7 (resume only on the host that holds the file until then).

**Unread (DECISION 3).** One reader per chat today, so `hasUnread` + `lastReadMessageId` stay on the row. `chats_reads(chatId, userId, lastReadMessageId)` arrives only with shared chats.

### labels and statuses (P3a; each in its existing domain folder; saved views are dropped, `views.json` is not imported)

```
labels      id, workspaceId NN, parentId, slug NN (old id, used by 'slug::value', routines and agents; DECISION 14),
            title NN, color, valueType ('string'|'number'|'date'), autoRules (JSON), order int NN,
            createdAt NN, updatedAt NN;  unique (workspaceId, slug)
labels_entities  workspaceId NN, labelId NN, entity NN ('chat:<id>' | 'library:<id>' | 'task:<id>' | 'project:<id>'),
                 value text;  PK (labelId, entity); index (workspaceId, entity)
statuses    id, workspaceId NN, slug NN, title NN, color, icon text (emoji, icon name or data URL <= 16 KB,
            DECISION 15), category NN, isFixed bool NN, isDefault bool NN, order int NN, createdAt NN,
            updatedAt NN;  unique (workspaceId, slug); one isDefault per workspace, enforced in code
```
One assignment table for every labelled kind (owner, 6 Oct 2026): chats, library items, tasks and projects carry labels through `labels_entities`, owned by the labels domain (other domains call its functions). The PK serves "everything with label X"; the index serves "labels of this entity". Rename/delete of a label updates `labels_entities` (and of a status `chats.statusId`) in one transaction instead of rewriting chat files. Chats' labels are imported in P3b; library items get labels in the data only for now (the Library UI showing and filtering them is a later change); tasks and projects have no labels today.

### search (new domain `S/search`)

```
search_fts  FTS5 virtual table, tokenize 'unicode61 remove_diacritics 2', prefix '2 3'   (DECISION 5)
  title, text            indexed
  workspaceId, entity    UNINDEXED; entity '<type>:<id>' (task, project, comment, library)
```
Chat messages are not in `search_fts`: they have their own `messages_fts`, written in the message's transaction (`docs/messages-design.md`, decided 6 Oct 2026). `search_fts` holds tasks, projects, comments and library documents (P6); domains call `updateSearchEntry(workspaceId, entity, title, text)` / `deleteSearchEntries(entity)`, and queries filter `workspaceId`. One search RPC merges both indexes' results. Both tables are created with raw SQL at boot (`CREATE VIRTUAL TABLE IF NOT EXISTS`) because drizzle-kit does not model FTS5. **Verified** (messages-design 6) that `db:push` would drop FTS tables; the fix is a `*_fts` filter in `S/db/push.ts`, the first step of P3b.

### skills and sources (P4)

```
skills      id, workspaceId NN, slug NN, title NN, description, icon, rev text NN, hash text NN,
            createdBy NN, createdAt NN, updatedAt NN;  unique (workspaceId, slug)
sources     id, workspaceId NN, slug NN, title NN, type NN ('api'|'mcp'|'local'), secretId,
            authStatus ('ok'|'needs_auth'|'error'), rev text NN, hash text NN,
            createdBy NN, createdAt NN, updatedAt NN;  unique (workspaceId, slug)
```
The bundle (`SKILL.md` frontmatter, `config.json`, `guide.md`) stays the truth for content; `title`, `description`, `icon`, `type` are an index refreshed on every sync. `rev` = the object prefix of the current version (createId per write), `hash` = sha256 of the sorted manifest (path, size, sha256), used to skip no-op writes. Only workspace skills exist (resolved): the code that reads the global (`~/.agents/skills`) and project-repo skill scopes is deleted in P4b, and the Skills page stops showing a "global" skill. Source credentials stay per workspace, shared by its members, as today (DECISION 13).

### routines (P5; domain `S/automations` renamed `S/routines`)

Tables: `routines` + `routines_history` (owner chose the product-facing name, 6 Oct 2026; it also holds the retry queue and the slot).

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
  createdBy     text NN  actor; prompt runs create chats owned by this user (DECISION 9)
  createdAt, updatedAt NN;  index (workspaceId, type, enabled)

routines_history
  id, workspaceId NN, routineId NN
  status     text NN  'running' | 'ok' | 'error' | 'skipped' | 'retry'
  trigger    text NN  'schedule' | event name | 'webhook' | 'test' | 'replay'
  slot       int      the cron minute (ms) for schedule runs; unique (routineId, slot) = fires once
                      even after a restart or with two processes
  chatId, error, response (captured, 4 KB)
  attempt    int NN default 1;  nextAttemptAt int  (the retry queue: status 'retry' rows)
  createdBy  text NN  who ran it (the caller for test/replay, else the routine's createdBy)
  createdAt NN, finishedAt
  index (workspaceId, routineId, createdAt); index (status, nextAttemptAt)  (install-wide retry scan)
```
Retention as today: keep the newest 20 runs per routine, trimmed on insert. "Last run" = newest row.

### messaging (cut from the MVP)

Later: the feature is hidden and its files stay untouched; a database design (tables, bot tokens into `secrets`) is made when it is revisited.

### activity log (shape only, not built; DECISION 12)

```
activities  id, workspaceId NN, entity NN, type NN (verb), createdBy NN, data (JSON), createdAt NN;
            index (workspaceId, createdAt); index (entity, createdAt)
```
`docs/activity-notifications.md` decided "no activity log"; this is only reserved so P6 search and routines do not invent their own.

## (d) Object storage and bundle sync

**Layout.** One bucket per install, everything under a workspace prefix, so deleting or exporting a workspace is one prefix:

```
workspaces/<wsId>/library/<itemId>
workspaces/<wsId>/skills/<skillId>/<rev>/<path>        (DECISION 6: by id + rev, not slug)
workspaces/<wsId>/sources/<sourceId>/<rev>/<path>      never: dotfiles, .credential-cache.json
workspaces/<wsId>/chats/<chatId>/                      (P7) plans/, notes.md, downloads/
                                                       (no Claude blob: Pi only, pi-only-plan.md; Pi entries are in `transcripts`)
                                                       (messages are in the database, not here)
```
**Driver.** `FileStore` (`S/library/file-store.ts`) gains `list(prefix)` and path keys (validated: no `..`, no leading `/`), and an `s3` driver on Bun's `S3Client` (`OTTO_S3_ENDPOINT`, `OTTO_S3_BUCKET`, `OTTO_S3_REGION`, `OTTO_S3_ACCESS_KEY_ID`, `OTTO_S3_SECRET_ACCESS_KEY`, optional `OTTO_S3_PREFIX`, picked by `OTTO_STORAGE=disk|s3`; built in P4a). `disk` driver root: `<ws>/library` for library keys (today's layout; store and cache are the same file), `CONFIG_DIR/objects/` for bundle keys. Disk mode runs the identical bundle sync against `CONFIG_DIR/objects/` (KBs duplicated; DECISION 7).

**Library on S3** (built in P4a). Save = today's two-phase save; as built, `stage` holds the bytes and `commit` is one atomic PUT over the key (Bun's S3 has no copy, and the guarded row update is the commit point), so there is no temp object; the disk copy at `<ws>/library/<id>` is a read-through cache filled before an agent turn that names it and on `library:read`.

**Bundle write** (UI/RPC, or the watcher after an agent edit), one function `updateBundle(kind, row, files, expectedUpdatedAt)`:
1. Compute the manifest and `hash`; equal to the row's `hash` = nothing to do (this also absorbs the watcher events our own materialization causes).
2. Upload every file under a new `rev` prefix (bundles are small; whole-bundle upload, no diffing).
3. Guarded update `SET rev, hash, title..., updatedAt WHERE id AND updatedAt = expected`. Exactly one racing writer wins.
4. Winner: delete the old `rev` prefix, write the folder's marker `.otto-bundle.json {id, rev, updatedAt}`, push `domain:changed` (`skills`/`sources`), `invalidateSkillsCache`. Loser: delete its own `rev` prefix and go to conflict.

**Conflict rule:** the row in the database is the newer `updatedAt`, so it wins. The losing local folder is moved to `<ws>/.conflicts/<kind>/<slug>-<timestamp>/` (never lost), the folder is re-materialized, and the UI toasts.

**Materialize** (boot, workspace open, `domain:changed` from elsewhere): when the folder marker's `rev` differs from the row, download the `rev` prefix into `<ws>/<kind>/.tmp-<rand>/` and rename it over `<ws>/<kind>/<slug>/`. A folder with no row and no marker (an agent created a skill) becomes a new row through `updateBundle` with no expected `updatedAt`. A row deleted elsewhere removes the folder. Boot materializes lazily per workspace on first open, not every workspace up front.

**Watcher.** `S/config/watcher.ts` keeps only `skills/` and `sources/` (debounced 1 s per bundle, into `updateBundle`); the labels, statuses, automations, permissions and session-header branches (views are gone with the feature) are deleted as each domain moves. One server process per install is assumed: no cross-node bus (NOT doing).

## (e) Migration

- **One importer per domain**, `init<Domain>Import()` in that domain, called from server bootstrap after `db:push`, in phase order. Each upserts by a natural key (connection slug, chat id, label slug, routine legacy id, skill slug) so a second run changes nothing, records `settings` (`install`, key `imports.<domain>`) `= <ms>`, and logs a count line (`imported 4 chats, 0 skipped, 0 failed`). A file that fails to parse is skipped and logged, never fatal.
- **Never destructive.** Old files stay where they are and are simply no longer read. Before the first import `config.json` is copied to `config.json.pre-db-<date>`. Cleanup is a separate later step (P7) the owner runs after verifying: old files move to `CONFIG_DIR/legacy-<date>/`, not deleted.
- **How `config.json` shrinks.** `StoredConfig` loses each key in the phase that imports it; the next `saveConfig` writes the file without it (with its three dated backups). After P2 nothing reads the file; it is deleted in P7.
- **Rollback.** Revert the phase's commit: the old code reads the untouched old files. Anything written after the switch exists only in the database and is lost to the old version; no export-back is built (NOT doing). So each phase runs a few days on the owner's install before the next one starts.

**The owner's real `~/.otto` (not touched now).** Seen (names only): one workspace `test` with 4 chats, `events.jsonl`, empty `pages/`, `skills/`, `sources/`, `projects/`; no `automations.json`, no `messaging/`; `config.json` keys `activeSessionId, activeWorkspaceId, decisionLayer, defaultLlmConnection, enable1MContext, llmConnections, migrationsApplied, workspaces`; `drafts.json` (dropped, not imported), `preferences.json`, `credentials.enc`, `otto.db` (+WAL, and `-polluted`/`-pre-comments` backups). Steps per phase:
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
| P0a (done) | Desktop `ENCRYPTION_KEY`: generated once, stored with Electron `safeStorage` in `CONFIG_DIR/encryption-key` (0600), passed to the embedded server (resolved, (k)) | `apps/electron/src/main/index.ts`, `S/secrets/index.ts` | S | - |
| P0b (done) | Agent subprocess env from an allow-list (`agentEnv`), not `...process.env`; the server's secrets are refused even when passed | `session-tools-core/src/runtime/agent-env.ts`, `S/agent/options.ts`, `S/agent/pi-agent.ts`, `S/mcp/{client,validation}.ts`, `S/automations/utils.ts`, `session-tools-core/src/runtime/sandbox-env.ts` | S | - |
| P0c (done) | Fix `pi-agent-server` line framing: `readline` on both sides also split on U+2028/U+2029, so a JSON line holding either character arrived in two pieces (verified under Bun and Node, `docs/pi-research.md` 6); both sides now frame lines through one shared helper (15 tests plus a regression test) | `S/utils/jsonl-lines.ts` (+ `__tests__/jsonl-lines.test.ts`), `packages/pi-agent-server/src/index.ts`, `S/agent/pi-agent.ts` | S | - |
| P0d | Pi 0.87.1 -> 1.0.4 (`pi-coding-agent`, `pi-agent-core`, `pi-ai`): the one breaking change that touches us is the Azure provider id `azure-openai-responses` -> `azure` (10 files); the exports we import still exist in 1.0.4 | `packages/pi-agent-server/package.json`, `packages/shared/package.json`, root `package.json`, `pi-agent-server/src/model-resolution.ts`, `S/config/models-pi.ts` and 8 more files naming the Azure id | S | P0c |
| P1a (done) | `settings` domain + importer (config UI/machine keys, `preferences.json`); entity-based guard | `S/settings/*`, `S/config/{storage,preferences}.ts`, `SC/handlers/rpc/settings.ts`, `SC/bootstrap/authorize.ts`, `update-preferences` session tool | M | P0a |
| P1c1 (done) | `connections` truth: columns, importer from `llmConnections` + `llm_*` credentials, every reader (sessions, Pi, model fetchers) on the domain | `S/connections/*`, `S/config/llm-connections.ts`, `S/config/storage.ts:2576-2860`, `SC/model-fetchers`, agent backends | M | P0a |
| P1c2 (done) | Writes and OAuth (Claude, Codex, Copilot refresh) through `secrets`; delete `connection-mirror.ts`; `llm-connections`/OAuth channels need owner/instance role | `SC/handlers/rpc/{llm-connections,onboarding}.ts`, `S/auth/state.ts` | M | P1c1 |
| P1c3 (done) | `serverConfig.token`, `remoteServer.token`, `decision_api_key` into `secrets` | `S/config/{storage,server-config}.ts`, `SC/handlers/rpc/workspace.ts:80`, `S/decisions/settings.ts` | S | P1a |
| P2 | Workspace registry in DB, `<ws>/config.json` into rows + settings, delete `updateWorkspaceMirror` and `plan.json` code | `S/workspaces/*`, `S/config/storage.ts:613+`, `SC/handlers/rpc/{workspace,settings}.ts`, `packages/core/src/types/workspace.ts` | M | P1a, P1c3 |
| P3a (done) | `labels` + `labels_entities`, `statuses` tables, workspace `permissions` setting; the path-editing agent docs `labels.md`, `statuses.md`, `permissions.md` and their `config_validate` targets removed (their Python tool docs come in PT); saved views removed | `S/{labels,statuses}/*`, `S/agent/permissions-config.ts`, `S/config/watcher.ts`, `session-tools-core/src/handlers/config-validate.ts` | M | P1a |
| P3b | First step: the `*_fts` filter in `S/db/push.ts` (+ test). Then `chats` + `messages` + `messages_fts` (`docs/messages-design.md`); chat labels into `labels_entities`; DB-first reads (running turns + a 16-chat LRU in memory), dirty-row writes in short `BEGIN IMMEDIATE` transactions; images out of rows, `/api/library/<id>/thumb`; chat search on `messages_fts`, ripgrep deleted; `session.jsonl` retired; list from SQL with the private rule; export/import bundle; set-label/status tools. Durability ("Durability" section): the assistant row exists from the first text delta and its partial text is saved to `messages` every 500 ms; boot-time recovery (chats with `turnStartedAt`) marks `executing` and partial rows interrupted; the client message id is the stored id, so a resent message is idempotent; `transcripts` with its importer from `.pi-sessions` and the seed/append path in `pi-agent-server` (if DECISION 16 holds); the crash test suite, one test per row of the failure-mode table | `S/db/push.ts`, `S/sessions/{schema,storage,jsonl,persistence-queue,bundle}.ts`, `SC/sessions/session-manager.ts`, `SC/handlers/rpc/{sessions,files}.ts`, `SC/services/search.ts`, `SC/webui/http-server.ts`, `S/agent/pi-agent.ts`, `packages/pi-agent-server/src/index.ts`, the chat view | L (4 M: storage+importer; manager+queue; RPC+renderer+search+thumbnails; durability: partial text, boot recovery, idempotent sends, `transcripts`, crash suite) | P3a |
| PX (done) | Delete pages (22 channels, agent page tools, `PageThumbnailer`, `pages.md`, `page_publish_token`, page sharing endpoints; `sessions:getShareCapabilities` replaces `pages:getShareCapabilities` for session sharing) | `S/pages`, `SC/handlers/rpc/pages.ts`, `apps/electron/src/transport/channel-map.ts`, `apps/electron/src/main/index.ts:650-660`, `docs/sharing.md` | M | - (any time) |
| P4a (done) | `FileStore` s3 driver + `list`, library on S3 with read-through cache (built: see `docs/object-storage.md` "Built: P4a"; tested against an in-process S3 double, a real Garage not run); the cache is not yet filled before an agent turn | `S/library/file-store.ts`, `S/library/index.ts`, `SC/handlers/rpc/{library,files}.ts` | M | - (parallel with P1-P3) |
| P4b | `skills` table, `updateBundle`, materialize, watcher, importer; grids read the table; delete the code that reads global and project-repo skills (the Skills page stops showing a "global" skill) | `S/skills/*`, `S/config/watcher.ts`, `SC/handlers/rpc/skills.ts`, `S/agent/base-agent.ts:842-937` | L (2 M) | P4a |
| P4c | `sources` table on the same sync, `authStatus` column, source credentials into `secrets` | `S/sources/*`, `S/sources/credential-manager.ts`, `S/credentials/*` | L (2 M) | P4b core |
| P5a | `routines` + `routines_history` (+retry rows, slot dedupe), importer, scheduler and history on the DB; webhook auth into `secrets`; stop `events.jsonl` | `S/automations` → `S/routines`, `S/scheduler`, `SC/handlers/rpc/automations.ts` | L (2 M) | P3a (label slugs), P1c (connections) |
| P5b | Incoming webhook trigger `POST /api/routines/<id>/webhook` with bearer = its secret | `SC/webui/http-server.ts` | S | P5a |
| P6 | `search` domain: `search_fts` for tasks, projects, comments, library documents; one search RPC merging it with `messages_fts` | each domain's write functions, `S/search/*` | M | P3b |
| PT (done) | Agent tools ((g)): `/api/agent/rpc`, per-run scoped token, agent channel table, the `otto` CLI the agent runs through bash (a Bun script, not a Python package), the generated skill, the first tool set; `permissions_edit` the one typed tool kept; built as [final-plan](final-plan.md) "PT as built" | `S/protocol/agent-channels.ts`, `S/agent/run-tokens.ts`, `SC/webui/agent-rpc.ts`, `SC/transport/server.ts` (`invoke`), `SC/bootstrap/headless-start.ts`, `S/agent/pi-agent.ts`, `packages/pi-agent-server/src/index.ts`, `apps/electron/resources/{bin/otto,scripts/otto.mjs,docs/otto.md}` | L (2 M, sizes in (g)) | P3a, P3b; `otto.routines` also P5a |
| P7 | Chat files (plans, notes, downloads) on S3; no Claude blob (Pi only, [pi-only-plan](pi-only-plan.md)); no Pi blob (Pi entries are in `transcripts`, DECISION 16; with its alternative, the Pi file is uploaded here too); `credentials.enc`, `config.json`, legacy folders cleanup | `S/sessions/*`, worker, `S/credentials` | L | P3b, P4a, P4c |
| P8 | `pi-durable` trial behind an adapter: a `SqliteDatabase` facade over `bun:sqlite` on its own SQLite file (`CONFIG_DIR/durable.db`, never `otto.db`: its tables and integer ids break our rules and `db:push` would plan to drop them), run its `registerStorageConformance()` suite, put one chat path behind a flag and run the Durability crash suite against it (crash-safe resume, idempotent submissions); the outcome is adopt, wait or drop. Its API is experimental ("changes without notice between releases") | new `S/agent/durable/*`, `packages/pi-agent-server/src/index.ts` | M | P0d, P3b |

**P1c as built.** (1) `connections` is the one source for AI connections: columns and `scope` (`install` | `workspace:<id>` | `user:<id>`) per (c), unique (scope, slug), one JSON secret per connection written with its row in one transaction (`S/connections/index.ts`); the new columns are nullable or constant-defaulted and `slug` stays nullable in the table, so `db:push` adds them with `ALTER TABLE` (a stricter column makes drizzle-kit rebuild the table and copy the new columns from columns the old one lacks, which corrupted rows once). `authType` keeps today's eight values; `catalog.ts` and `connection-mirror.ts` are deleted. (2) `initConnectionsImport()` (`connections/import.ts`, boot after the settings import) reads `config.json` `llmConnections` and the `llm_*` / legacy `claude_oauth` / `anthropic_api_key` entries of `credentials.enc` into `install` rows, reusing a row by slug, skipping what cannot be read, `imports.connections` last; the old files are read only. (3) Readers keep their names as thin wrappers (`getLlmConnection(s)`, `add/update/deleteLlmConnection`, `getDefaultLlmConnection`, the credential manager's `getLlm*`/`setLlm*`, which read and write the connection's secret); a lookup takes a `ConnectionContext` (user, workspace; a chat uses its creator's own connection first), a connection a chat resolved carries its `scope`, and every credential read or OAuth refresh addresses that exact scope. A credential for a slug with no connection yet (sign-in finished before the setup, a connection test) is held in memory per scope and consumed by the setup that creates the connection. Each person has their own default (`userDefaultConnectionSlug`), else their first own connection, else the install's. (4) `S/secrets/import.ts` (`initSecretsImport()`) moves the plain tokens: the `server` setting kept `tokenSecretId` (gone with the desktop's server mode, 7 Oct 2026, docs/desktop.md), each remote workspace of the `config.json` registry `remoteServer.tokenSecretId` (a save of the registry strips the token), the `decisionLayer` setting `keySecretIds` for the decision model's keys. (5) Guard: `CONNECTION_WRITE_CHANNELS` in `bootstrap/authorize.ts`; `OTTO_SERVER_TOKEN` is unchanged. Not verified: the real Claude, ChatGPT and Copilot sign-in flows and token refresh against the providers; a workspace-scoped sign-in for a connection that does not exist yet stages its credential under the caller's own scope.

**P1a as built.** `S/settings/{schema,catalogue,index,types}.ts`: the catalogue is the keys above (`migrationsApplied` stays in `config.json`; the workspace keys `defaults`/`localMcpServers` are in the catalogue, their readers move in P2), `getSetting`/`getSettings`/`updateSetting`/`deleteSetting` (+ `getUserSetting`/`updateUserSetting`, which fall back to the first user where no caller is known), `initSettingsImport()` at boot after the first user exists (headless: after `initFirstOwner`; Electron: after `initLocalUser`): each key only if it has no row, `imports.settings` recorded, old files never changed (`config.json` copied once to `config.json.pre-db-<date>`; a server with no user yet imports the install keys and the rest at a later boot).
Every reader and writer of the migrated keys in `config/storage.ts` and `config/preferences.ts` is a wrapper over the domain (same names, an optional `userId` last), the RPC handlers pass `ctx.userId`, agents pass the chat's user; the `preferences:read`/`write` channels now carry the caller's name, email and settings as JSON, `update_user_preferences` writes the same, the ConfigWatcher no longer watches `preferences.json` and `config_validate` lost its `preferences` target. Guard (`bootstrap/authorize.ts`): `settings:getSetting`/`updateSetting` by entity, and `INSTANCE_OWNER_CHANNELS`; the instance owner is the first user (earliest account). Test databases get every table from `scripts/test-preload.ts`.

**P3a as built.** `S/labels/{schema,storage,crud,entities,import}.ts` and `S/statuses/{schema,storage,crud}.ts` hold the tables of (c) and take a workspace id; a label or status `id` the app and agents use is the row's `slug` (the old id), so `'slug::value'` strings keep resolving, and the row id is a `createId()`. `labels_entities` has `setEntityLabel`, `removeEntityLabel`, `getEntityLabels`, `getLabeledEntities` (by slug); nothing calls them for chats until P3b, so deleting a label or status still rewrites the chat headers by path (`getWorkspaceRootPath`), now in one update per chat, and a deleted status moves its chats to `todo` before it goes (the old code listed them after, found them already read as `todo`, and moved none). `isDefault` of a status now means the one new chats get (the old `defaultStatusId`, `todo` unless `set_default` picks another), not "cannot be deleted"; reading a workspace with no status rows gives the defaults and every status write seeds them first.
`initLabelsStatusesImport()` (`S/labels/import.ts`, called at boot after the connections import and after a workspace is created) imports each workspace once (`imports['labelsStatuses:<workspaceId>']`, so a label deleted later is not brought back): `labels/config.json` with `children` becoming `parentId`, `statuses/config.json` with `statuses/icons/*` inlined as data URLs (an icon over 16 KB or a web address with no file is dropped and reported in the returned `warnings`), `permissions.json` into the `permissions` setting of `workspace:<id>`; a workspace with no file gets the defaults; the old files are only read (a test hashes the tree before and after). Workspace rules are `getWorkspacePermissions`/`updateWorkspacePermissions` (`S/agent/permissions-config.ts`: regexes checked on write, the merged-rules cache cleared); a source's `permissions.json` stays a file. Saved views are deleted (code, `views:*` channels, hook, route filter, strings).
Guard: members read, workspace owners write (`labels:create`, `labels:delete`, `statuses:reorder` are `OWNER_CHANNELS`); the ConfigWatcher no longer watches the three files; writes push `domain:changed` (`labels`, `statuses`, `permissions`), by `WRITE_CHANNELS` for client calls and by the session manager for agent tools and automations, which also fires the `LabelConfigChange` automation event as the watcher did. Interim agent tools (since PT: `labels_edit` and `statuses_edit` are deleted for the `otto` CLI, `permissions_edit` stays): `labels_edit`, `statuses_edit`, `permissions_edit` (`session-tools-core/src/handlers/workspace-config.ts`, run by `server-core/src/sessions/workspace-config-tool.ts` as the chat's user through the same membership and owner check); `config_validate` lost its `statuses` target and its `permissions` target only checks source files. The flag-off `otto label` / `otto permission` CLI policies (`config/cli-domains.ts`, `otto-cli.md`) are deleted in PT. Tests: `labels/__tests__/{labels,import}.test.ts`, `labels/__tests__/chat-headers.isolated.ts`, `statuses/statuses.test.ts`, `config/__tests__/watcher-removed-files.test.ts`, `handlers/rpc/labels-statuses.isolated.ts`, and the owner matrix in `authorize.isolated.ts`.

Parallel lanes: {P0a, P0b, P0c, PX, P4a} start together (P0c done), P0d after P0c; P1a and P1c1 after P0a; P3a after P1a; P4b/P4c run beside P3; P5 after P3a; PT after P3b (its routines module after P5a); P6 and P7 last; P8 after P3b and P0d. Owner's order holds: small wins (P1) first, then chats + FTS (P3), then S3 + skills/sources (P4), then routines (P5), then search + activity (P6).

## (g) Agent tools in Python (owner, 6 Oct 2026)

*As built (PT): one Bun CLI instead of a Python package (Python is not on every desktop host, Bun is), the skill's command list generated from the table by a test instead of a generator script, the token named `OTTO_RUN_TOKEN`, and `permissions_edit` the only typed tool; see [final-plan](final-plan.md) "PT as built". The design below is what was planned.*

Every capability agents use on tasks, projects, library, comments, chats and routines is a Python tool. This replaces the single allow-listed `otto_rpc` session tool planned earlier. Shape (from `docs/pi-research.md` 6, which matches Pi's own advice to let agents wire CLIs together through bash): a generated CLI the agent runs through `bash`, taught by a skill, plus a few server-side proxy tools for the calls that need a check or an approval.

- **One package, one API, used as a CLI.** The agent image (and the desktop host) ships a Python package `otto` with a command line: `otto tasks create --title …`, `otto library read <id>`, `otto chats list` print JSON, and the same functions are importable (`otto.tasks.create(...)`) for skill scripts. Each is a thin call to one authenticated endpoint, `POST /api/agent/rpc {channel, args}`, which runs the same domain handlers the app's RPC runs. There is no second implementation. The agent runs it through its normal `bash` tool, so it composes with pipes and other CLIs and adds nothing to the tool list.
- **Taught by a skill.** A bundled `otto` skill (its `SKILL.md` and one page per module, generated with the package) tells the agent the commands; only its name and description sit in the prompt and the pages are read on demand, as for every skill.
- **Server-side proxy tools for gated calls.** The few calls that must be checked or approved before they run stay typed tools that execute in the server, passed to Pi as `customTools` beside today's source proxy tools, through the existing permission handshake, and calling the same handlers. PT picks the set (candidates: deleting, permission changes, anything that leaves the workspace); everything else is the CLI.
- **As the chat's user.** A call runs with the chat's user as `ctx.userId`, through the same membership guard (`SC/bootstrap/authorize.ts`) and session guard, bounded to the chat's workspace (a workspace argument must equal it), with the private-chat rule. An agent can do nothing its user cannot do in the app.
- **Scoped token per run.** Each chat run gets a short-lived token minted at turn start, bound to (user, workspace, chat), valid until the turn ends or 1 h passes, kept hashed in memory and never stored. It reaches the agent as `OTTO_AGENT_TOKEN` and `OTTO_API_URL`, passed on purpose through `agentEnv()` (P0b refuses `OTTO_RPC_*`, hence the different name). It is not the user's session and reaches only the agent channel table.
- **Generated client, so it cannot drift.** The agent channel table, `S/protocol/agent-channels.ts`, lists each exposed channel with its Python name and a zod schema for its arguments (today `RPC_CHANNELS` holds names only, no argument schemas: verified). The server validates agent calls with those schemas. `scripts/gen-otto-py.ts` generates `packages/otto-py/otto/*.py` (typed functions, docstrings from the schema descriptions) and one markdown doc page per module. Tests: `scripts/gen-otto-py.test.ts` regenerates in memory and fails when the committed files differ; a second test fails when an agent channel is missing from `RPC_CHANNELS` or the guard's tables; a smoke test runs `python3 -c "import otto; …"` against a `:memory:` server (that CI has `python3` is unverified).
- **Custom tools** are Python scripts in workspace skills (`skills/<slug>/tools/*.py`, synced as S3 bundles, P4b) that import `otto`; the skill's `SKILL.md` says how to run them and the agent runs them through `bash`. Pi has no Python tool runtime (its tools are TypeScript `ToolDefinition`s, `packages/pi-agent-server/src/index.ts:613-672`), so no per-file Pi loader is built.
- **Config docs.** `labels.md`, `statuses.md`, `permissions.md` and the `config_validate` targets for those files (removed in P3a) come back as pages of the `otto` skill for `otto labels`, `otto statuses` and `otto permissions`.

First tool set (phase PT):

| Module | Functions | Size |
|---|---|---|
| foundation | `/api/agent/rpc`, scoped token, agent channel table, generator, package and `otto` CLI in the image and on the desktop, the generated `otto` skill, tests | M |
| `otto.tasks` | list, get, create, update, set status | S |
| `otto.projects` | list, get, create, update | S |
| `otto.library` | list, get, read, create, update (bytes through the API) | S |
| `otto.comments` | list, create | S |
| `otto.notifications` | list, unread count (read only) | S |
| `otto.chats` | list, get (header and a page of messages, private rule) | S |
| `otto.routines` | list, get, create, update, enable/disable, test run | S (after P5a) |
| `otto.labels`, `otto.statuses`, `otto.permissions` | the config tools that replace the path docs | S |
| proxy tools | the gated calls as server-side Pi `customTools` with the approval handshake | S |

Total L: 2 M (foundation + tasks, projects, library; then the rest + skill pages + proxy tools).

## (h) Direction: harnesses and sandbox (not phases; nothing built now)

- **Per-workspace containers or VMs run tools only.** Later, tool execution runs in a container or VM per workspace from one `otto-agent` image (bash, node, uv, git, the `otto` CLI). The harness (Pi), the transcript and every credential stay on the server: Pi's built-in tools (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`) are redirected into the container through their `operations` (the Gondolin pattern in Pi's `docs/containerization.md`; `pi-durable`'s per-conversation `ExecutionEnv` is the same idea, `docs/pi-research.md` 5). The container mounts only that workspace's folder (the S3-materialized cache), has no database access, and carries **no model key and no transcript**: its env holds only the run's scoped token and API URL for the `otto` CLI. This supersedes the earlier wording that the container carries its connection's API key and reads chat history through the server API. A dead container fails only the running tool call ("Durability"). Desktop local mode keeps running tools on the host, as today. For hosted, a microVM later. This is what closes the "agent shell reads anything" hole in (i).
- **The Claude harness meanwhile.** *Superseded: the Claude harness is deleted ([pi-only-plan](pi-only-plan.md) B3).* The Claude Agent SDK runs its built-in tools inside the Claude CLI process, so the tools-only split is not a given for it: whether its tools can be redirected into the container (and so whether it can run hosted without its key beside the tools) is **unverified**. Claude through Pi (next bullet) removes the question.
- **Claude through Pi (longer term).** *Built (B2, B3) as the `claude-code` Pi provider in `pi-agent-server`, not a gateway in the `providers` domain; the terms check is still open ([pi-only-plan](pi-only-plan.md) 2).* The owner wants one harness: Claude runs through Pi via a provider bridge in the `providers` domain (AGENTS.md: the gateway that turns the Claude and Codex CLIs into APIs), giving one transcript type and one tool system. This depends on a compliance check of the providers' terms, which is **not verified**. It reduces resume state to the `transcripts` rows (DECISION 16) with no blob at all: no Claude SDK transcript under `~/.claude/projects`, no cwd-hash restore, no `forkSession`/`resumeSessionAt` branch path (`docs/messages-design.md` 3).
- **MCP sources (post-MVP).** Keep our server-side MCP connection pool (`S/mcp/mcp-pool.ts`): one connection per workspace source shared by its chats, tokens in `secrets` and never in a container, and Pi gets proxy tools. Pi's own per-session MCP (tokens in `~/.pi/agent/mcp-auth.json`) is not used. After the MVP the pool may run on `@earendil-works/pi-mcp` (OAuth, with an injected `McpOAuthStateStore` backed by `secrets`) and register its proxy tools with `exposure: "codemode"` or `"deferred"` so a source with 40 tools does not flood the prompt; that needs a server-side OAuth redirect for hosted servers and a `tool_call` gate for source permissions (`docs/pi-research.md` 4).

## (i) Security

| Hole | Closed by |
|---|---|
| Private file paths (`config.json`, `credentials.enc`, `otto.db`, other workspaces, other members' chats) | done, commit 3701182 |
| Plaintext `serverConfig.token`, `remoteServer.token`; plaintext webhook auth in `automations.json` | P1c3, done (server and remote tokens, decision keys); P5a for the webhook auth |
| `credentials.enc` decryptable by anyone who runs code as the server user (key derives from the machine id) | P1c/P4c move every family to `secrets` (the hidden messaging entries wait for that feature); P7 deletes the file |
| Server secrets in every agent's environment (`...process.env`), so an agent shell could decrypt `otto.db` | P0b, done: `agentEnv()` (`session-tools-core/src/runtime/agent-env.ts`) builds the env of the Claude and Pi subprocesses, script tools, automation scripts and MCP stdio sources from an allow-list of host variables plus what the caller passes on purpose; `ENCRYPTION_KEY`, `BETTER_AUTH_*`, `OTTO_SERVER_TOKEN`, `OTTO_WEBUI_*`, `OTTO_OWNER_EMAIL`, `OTTO_RPC_*` and `INFISICAL_*` are refused even when passed |
| `llm-connections` and OAuth channels open to any member | P1c2, done: a person manages their own connections, workspace owners the workspace's, the instance owner the install's (`CONNECTION_WRITE_CHANNELS`) |
| Members writing install-wide settings; personal prefs shared by all members | P1a (entity guard, per-user entity) |
| Agent shell execution reads anything the server user can (other workspaces' folders, the db file) | not closed by this plan: the per-workspace container direction in (h) closes it on the hosted server, and since only tools run there, no model key or transcript is in reach of a tool; P0b + `secrets` limit what it can decrypt, not what it can read |
| Agents acting with more than their user's rights | PT, done: the `otto` CLI runs as the chat's user through the same guard (`WsRpcServer.invoke`), with a per-run scoped token, never the user's session ((g)) |
| Per-workspace sandboxing of disk caches | same as above; S3 prefixes per workspace make it possible (one scoped key per workspace), not built |

## (j) Risks and NOT doing

Risks:
- **Agents edit config by path today.** `~/.otto/docs/{labels,statuses,automations,permissions,sources,skills}.md` and `config_validate` teach agents to edit JSON files. Each domain that moves to the DB removes its path doc in the same change (no agent writes a dead file); agents get the domain back through the `otto` CLI in PT ((g)), whose generated skill pages replace the path docs. Since PT agents edit labels and statuses with the `otto` CLI and the permission rules with `permissions_edit`; the interim `labels_edit` and `statuses_edit` are deleted. Skills and sources keep path editing (the watcher syncs).
- FTS5 vs `db:push`: verified that a push drops FTS tables; the `*_fts` filter in `push.ts` is P3b's first step, and a drizzle-kit upgrade must keep its test green.
- Many tiny write transactions from 50 streaming chats on one SQLite file: estimated at about 40% of one writer; measured by `scripts/bench-messages.ts`, with a group commit as the defined next step (`docs/messages-design.md` 6, 8).
- Desktop key loss: if `safeStorage` changes (OS user reinstall), secrets are unreadable and connections must be re-entered. Accepted for the desktop.
- Legacy chat ids are not the `createId()` shape; `isEntity` and `ENTITY_TOKEN` must accept them for `chat:` (or chats are never tokens).
- A workspace folder copied to another machine no longer carries its settings (they are rows). Accepted.
- One server process per install: caches, scheduler and watcher are in memory. Two nodes would need a bus; the `slot` unique only protects schedule runs.
- Superseded: no Claude SDK transcripts to keep ([pi-only-plan](pi-only-plan.md)).
- Pi transcripts (DECISION 16): mirroring `getEntries()` at four events may miss an entry type (no per-entry hook in Pi, **unverified**); P3b's test compares the mirror with a file-backed run. The table grows with every tool result and inline image and is never compacted; resume reads a chat's whole transcript, measured in the benchmark.
- `pi-durable` is experimental ("The API changes without notice between releases"); P8 is a trial behind an adapter on its own file, so dropping it costs only the adapter.
- Better Auth plugin tables gain columns through `additionalFields`; an upgrade must keep them (pinned version, `validateSchema`).

Deployment modes (owner, 6 Oct 2026; replaces the earlier data-less relay idea). One server program, three ways to run it: (1) local: the macOS app embeds the server and everything stays on the machine, with no collaboration and no remote features; (2) hosted: workspaces live on a server we run, and you create a workspace and invite people into it; (3) self-hosted: the same server on your own machine (the owner calls it the relay). The desktop app can also sign in to a hosted or self-hosted server as a client. Workspace data always lives on the server that hosts the workspace: no tunnel and no data-less relay, so no new tables. The list of servers a desktop is signed in to is a per-user client setting kept on the desktop only (`settings`, `user:<id>`, key `servers`, with the session token in `secrets`), not a server table.

NOT doing: skills/sources content in SQLite; Postgres now (only the driver and `sqlite-core` imports would change later); migrations files before the MVP is stable; event sourcing, history or version tables (bucket versioning instead, if wanted); per-user unread rows before shared chats; multi-node sync; export from DB back to files; moving themes, logs, Electron state or generated assets into the DB; global or project-repo skills (not read or shown at all); remote workspaces, messaging, saved views and server-side drafts (cut from the MVP); a generic settings framework beyond one table and one typed key list; storing each streaming delta (the partial text is saved as a snapshot every 500 ms instead); `messages` as Pi's session store; adopting `chord` directly (it is not durability; `pi-durable` brings it if P8 adopts that); a Pi loader for Python tool files; the model key or the transcript inside an agent container.

## (k) Owner decisions

Resolved on 6 Oct 2026 (applied above, kept here for history), first set:
- Remote workspaces: cut from the MVP, no `workspaces_remotes`; the relay idea became the deployment modes in (j).
- Chat messages: a `messages` table in SQLite, design in `docs/messages-design.md`.
- Skill scopes: only workspace skills exist; the global and project-repo skill code is deleted in P4b.
- Messaging: cut from the MVP, files untouched, revisit later; this also settles the WhatsApp auth question.
- Settings naming: `settings(entity, key, value, updatedAt)`, PK (entity, key); no `updatedBy`, no `scope` column (DECISION 1 below keeps the shape).
- Drafts: browser only, no server storage, no drafts table; P1b removed.
- Saved views: dropped, `views` table removed.
- Routines tables: `routines` + `routines_history`.
- Desktop `ENCRYPTION_KEY`: generated once, kept with Electron `safeStorage` (built, P0a).
- Pages: the feature is deleted (built, PX).

Second set (A-G; `docs/messages-design.md` 10 uses the same letters):
- A. Labels: one `labels_entities(workspaceId, labelId, entity, value)` table for chats, library items, tasks and projects, PK (labelId, entity); no chat-only or library-only label table.
- B. Messages schema: `messages(pk, workspaceId, chatId, id, "order", type, content, createdAt, updatedAt)`, no `text` column; contentless `messages_fts`, which `db:push` ignores through a `*_fts` filter (P3b's first step).
- C. Images and big payloads: no inline base64; images are library objects with a cached `/api/library/<id>/thumb`; the importer moves or drops inline images; 200k tool-result cap, no spill, 1 MB row guard.
- D. Memory and concurrency: DB-first reads, memory = running turns + a 16-chat LRU; short `BEGIN IMMEDIATE` transactions per finalized message or batch; benchmarks cover 50 chats streaming at once.
- E. Search: chat search on `messages_fts`, `search_fts` for the other entities, one search RPC merges them.
- F. Agent tools: a generated Python package `otto` over one authenticated agent API, as the chat's user with a per-run scoped token; replaces the `otto_rpc` session tool (old 12). Refined by the Pi research (6 Oct 2026): the package is a CLI the agent runs through `bash`, taught by a generated skill, with server-side proxy tools only for calls that need a check or approval; no Pi loader ((g)).
- G. Harnesses and sandbox: per-workspace `otto-agent` containers later, desktop on the host; Claude through Pi as a direction pending a provider-terms check ((h)). Refined by the Pi research (6 Oct 2026): the container runs tools only; harness, transcript and credentials stay on the server, so no model key is in it ((h)).

Third set (owner direction, 6 Oct 2026): durability is a first-class requirement ("durable is something key for us to make sure we have the highest quality possible"); applied as the Durability section, the P3b durability chunk and P8. The table that carries it for Pi is still open (16).

Open, each: recommendation first, then the alternative.

1. **Settings shape.** One `settings(entity, key, value, updatedAt)` table for install, workspace and user. Alt: `settings` + `users_preferences` + typed workspace columns.
2. **Connection scope.** `scope` install or workspace; existing ones imported as install; lookup workspace first, then install. Alt: install only (today), or workspace only (SaaS-pure, each workspace brings keys).
3. **Unread, flag, archive.** Columns on `chats` (chats are private). Alt: `chats_reads` per user now.
4. **Chat ids.** Keep legacy ids, new chats `createId()`. Alt: rewrite every id (breaks URLs, SDK folders).
5. **Search tokenizer.** `unicode61` with prefixes for `messages_fts` and `search_fts`. Alt: `trigram` for substring matches like ripgrep (bigger index).
6. **Object keys.** By id with a `rev` prefix per write. Alt: by slug as `docs/object-storage.md` says (renames move objects, writes need another commit step).
7. **Disk mode.** Same bundle sync against a disk object root. Alt: skip sync on the desktop (less duplication, two code paths).
8. **Permissions.** Workspace rules as a workspace setting, source rules inside the source bundle, app default a bundled asset. Alt: a `permissions` table.
9. **Routine actor.** Runs and their chats belong to the routine's creator. Alt: the workspace's first owner (today).
10. **Workspace slug.** The DB `slug` becomes the unique route slug. Alt: keep `slug` = id and add a separate route slug column.
11. **`events.jsonl`.** Stop writing, do not import. Alt: keep as a disk log.
12. **Activity log.** Shape reserved, not built. Alt: build it in P6 (reverses the "no activity log" decision).
13. **Source credentials.** Per workspace, shared by members (today). Alt: per user.
14. **Label and status ids.** New `createId()` ids plus a `slug` holding the old id. Alt: rewrite every reference to new ids and drop slugs.
15. **Status icons.** `icon` text column (emoji, icon name or small data URL). Alt: S3 objects.
16. **Pi transcripts (pending the owner).** Recommended: a `transcripts` table holding Pi's entries verbatim ((c) "chats"), seeded into `SessionManager.inMemory` on resume and appended per event, in the same transaction as `messages`; resume works on any host and P7 uploads no Pi blob. Alt: `messages` as Pi's store (rejected by the research: it is lossy for a model, holds rows Pi does not have and lacks Pi's tree, and Pi has no storage interface to plug it into), or keep `.pi-sessions` files with one S3 blob per chat in P7.

Numbers changed on 6 Oct 2026 (second pass): 1, 11, 12 and 19 resolved; 2->1, 3->2, 4->3, 5->4, 6->5, 7->6, 8->7, 9->8, 10->9, 13->10, 14->11, 15->12, 16->13, 17->14, 18->15.
