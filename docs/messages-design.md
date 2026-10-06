# Chat messages in SQLite (`messages`)

Status: proposal for the owner, nothing built. Owner decision: "no chats_messages, just `messages`", made as reliable, simple and performant as possible. This replaces **DECISION 4** of [data-architecture.md](data-architecture.md), which kept messages in JSONL; the chat header still goes to `chats` as planned there (P3b). Paths: `S` = `packages/shared/src`, `SC` = `packages/server-core/src`, `SM` = `SC/sessions/session-manager.ts`.

## 1. Tables

```
messages                                   S/sessions/schema.ts (next to chats)
  pk          integer PK     rowid alias, internal only: the join key of messages_fts (VACUUM keeps it). Never sent out.
  workspaceId text NN        the chat's workspace (rule below)
  chatId      text NN        chats.id
  id          text NN        the message id. Legacy 'msg-<ms>-<rand6>' / 'plan-<ms>-<rand6>' kept; new ones createId().
                             Unique per chat only: branches copy rows with the same ids (see 4).
  order       int  NN        position in the chat, ascending = display order. Gaps allowed. Quoted "order" in raw SQL.
  type        text NN        'user'|'assistant'|'tool'|'error'|'info'|'warning'|'plan'|'auth-request' ('status' is never stored)
  text        text NN        StoredMessage.content, the text a person reads (FTS, preview, snippets)
  content     text NN '{}'   JSON: every other StoredMessage field (toolInput, toolResult, attachments, badges,
                             annotations, turnId, isIntermediate, hidden, isQueued, error*, auth*, planPath ...)
  createdAt   int  NN        StoredMessage.timestamp (ms). Re-stamped with `order` when a queued message is replayed.
  updatedAt   int  NN
  unique (workspaceId, chatId, "order")   pages, max("order"), the integrity check
  unique (workspaceId, chatId, id)        the upsert key

messages_fts  FTS5, contentless: fts5(text, content='', contentless_delete=1,
              tokenize='unicode61 remove_diacritics 2', prefix='2 3');  rowid = messages.pk
```

Drizzle sketch (Drizzle quotes identifiers itself; only hand-written SQL must write `"order"`):

```ts
export const messages = sqliteTable('messages', {
  pk: integer('pk').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  chatId: text('chatId').notNull(),
  id: text('id').notNull(),
  order: integer('order').notNull(),
  type: text('type').notNull(),
  text: text('text').notNull(),
  content: text('content').notNull().default('{}'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  uniqueIndex('messages_order').on(t.workspaceId, t.chatId, t.order),
  uniqueIndex('messages_id').on(t.workspaceId, t.chatId, t.id),
])
```

**Why these columns.** SQL only filters or orders by workspace, chat, id, `order` and `type`. `turnId`, `toolUseId`, `isIntermediate` and `hidden` are read in JS, so they stay in the `content` JSON (rule 4 of data-architecture: columns only for what is listed, filtered or guarded). `text` is a column because FTS, the preview and snippets read it. `createdBy` arrives as a nullable column with shared chats, not before.

**Rule: `workspaceId` on every workspace-scoped table, child tables included.** It is `NN`, and indexes lead with it wherever queries are per workspace. Every query and guard can then be bounded by workspace without a join, and deleting or exporting a workspace is one `WHERE`.
- Applies to `messages`, `chats_labels` and `routines_history` (the run history) in data-architecture's sketches. That doc's index lists for them should lead with `workspaceId`; the other agent or the owner updates it there.
- The only existing table that breaks the rule is `projects_members` (`S/projects/schema.ts`: `projectId, actor, role`). Add `workspaceId NN` and make the PK `(workspaceId, projectId, actor)`. A `db:push` with a default cannot fill it, so its importer sets it from `projects.workspaceId` in one `UPDATE … FROM projects` before the column becomes `NN`. Add this to the plan's P2 or P3a.
- Install-scoped tables (`users*`, `secrets`, `connections` with `scope`) are not workspace-scoped and stay as they are.

`chats` (data-architecture (c)) keeps the list fields this design writes: `messageCount`, `lastMessageRole`, `lastFinalMessageId`, `preview`, `lastMessageAt`, `lastUsedAt`, and `metadata.tokenUsage`.

## 2. What the code does today (evidence)

- **Shape.** `StoredMessage` has about 50 optional fields (`packages/core/src/types/message.ts:345-420`). The runtime `Message` adds only `isStreaming`/`isPending`, which `messageToStored` drops (`message-mapper.ts:10-13`). `hidden` is persisted through the spread. Ids come from `generateMessageId()` = `msg-${Date.now()}-${rand6}` (`message.ts:610-612`); plan messages use `plan-…` (`SM:4582`). Ids are unique per chat but not globally: a branch copies its parent's messages with the same ids (`SM:3367-3383`). The real `~/.otto` shows this: `261006-polished-oasis` is a branch of `261005-vital-zenith` with the same 8 ids.
- **Order.** Timestamps come from `monotonic()`, which strictly increases per process (`SM:1902-1906`). The renderer sorts by timestamp (`packages/ui/src/components/chat/turn-utils.ts:368`). Array order is push order, so it differs from display order in one case: a mid-turn user message is pushed while queued (`SM:6352-6363`) and re-stamped when replayed (`SM:7336-7343`).
- **Streaming.** `text_delta` is never stored. It only builds `managed.streamingText` and batched IPC (`SM:7944-7949`). The assistant message is created whole at `text_complete` (`SM:7967-8025`).
- **Messages changed after creation.**
  - A tool row is created at `tool_start` (`SM:8117-8136`). The second SDK `tool_start` fills in its input, intent and icon (`SM:8091-8116`). `tool_result` sets `toolResult`/`toolStatus`/`isError` on that same row (`SM:8207-8215`). A parent Task auto-completes its children (`SM:8264-8284`). SubmitPlan is marked completed (`SM:4571-4578`).
  - Other in-place changes: `isQueued` flips (`SM:6384`, `:7143`, `:7337`), the re-stamp, annotations add/update/remove (`SM:6004-6165`), and `authStatus` (`SM:2648`).
  - Deletions: Stop removes queued user messages (`SM:6976-6979`). Auth retry removes the failed user message(s) (`SM:7083-7093`). `/clear` empties the chat (`S/sessions/storage.ts:443-459`).
  - There is no edit, regenerate or rewind of messages (grep: none). Compaction adds one `info` row with `statusType: 'compaction_complete'` (`SM:8311-8319`) and deletes nothing. `status` rows are never stored (`SM:2557-2559`).
- **Durability.** `persistSession` maps the whole array and enqueues it (`SM:2495-2575`). The queue debounces 500 ms (`persistence-queue.ts:65`), then rewrites the whole file through `.tmp` + rename (`:138-161`). On error it logs and **drops the write** (`:163-165`). The user message is flushed before the ack (`SM:6412-6417`, `:6451-6456`). `text_complete` and `tool_result` enqueue (`SM:8024`, `:8287`). `tool_start` does not.
- **Size caps.** A tool result is cut at 200,000 chars "for storage" (`SM:8188-8192`). `toolInput` is not capped. Attachments are library items (`SC/handlers/rpc/files.ts:345-348`), but the stored attachment carries a 200x200 PNG `thumbnailBase64` (`:350-358`) and, when the image was resized, the whole `resizedBase64` (`:333`, `:406`). After send, only the renderer uses `resizedBase64` (`apps/electron/src/renderer/app.tsx:1276`).
- **Portability.** Absolute session-folder paths become `{{SESSION_PATH}}` on write and are expanded on read (`S/sessions/jsonl.ts:23-50`). A truncated line is skipped, not fatal (`:287-299`).
- **List fields.** They are precomputed at every write: `messageCount`, `lastMessageRole`, `preview` = first user message cleaned to 150 chars, and `lastFinalMessageId` = last non-intermediate assistant message (`jsonl.ts:171-238`). `hasUnread` is set at turn end only when a new final message arrived and nobody is viewing (`SM:7221-7236`).
- **Reads.** The first access loads every message into `managed.messages` and keeps it there (`SM:2944-3031`). `sessions:getMessages` returns the full array with no paging (`SC/handlers/rpc/sessions.ts:183-188`). The renderer keeps all of it and renders the last 20 turns at first (`chat-display.tsx:501-502`, `:1358-1360`). Search is ripgrep over `**/session.jsonl` with regex snippets (`SC/services/search.ts:187-330`). Export/import (`S/sessions/bundle.ts:85-137`, `SM:9243-9420`) and share-to-viewer (`SM:5364-5416`) move the whole array.
- **Real data** (`~/.otto/workspaces/test`, 3 chats, names and sizes only):

  | chat | messages | message bytes | largest line |
  |---|---|---|---|
  | `261005-zesty-waterfall` | 2 | 516 | 399 |
  | `261005-vital-zenith` | 8 | 280,380 | 279,267 |
  | `261006-polished-oasis` (branch of vital-zenith) | 8 | 280,380 | 279,267 |

  Further checks: 0 corrupt lines, 0 out-of-order timestamps, every message has a timestamp. In the two large chats, 279,178 of 280,380 bytes (99.6%) are `attachments`: three `thumbnailBase64` of 83 to 109 KB each, plus a legacy `thumbnailPath` the type no longer declares. There is no large real chat, so the 100k-message numbers below are budgets to measure, not observations.

## 3. Harnesses: what each needs to resume

- **Neither harness takes its history from our messages.**
  - Claude resumes from the SDK's own transcript: `resume: sdkSessionId`, and for a branch `forkSession` + `resumeSessionAt` (`S/agent/claude-agent.ts:1546-1556`). The transcript lives under `~/.claude/projects/<cwd-hash>/`, with cwd = `sdkCwd` (`S/sessions/storage.ts:191-194`). No `CLAUDE_CONFIG_DIR` is set anywhere.
  - Pi resumes with `PiSessionManager.continueRecent(cwd, <chat>/.pi-sessions)` and forks with `forkFrom` + `branch(anchor)` (`packages/pi-agent-server/src/index.ts:687-717`). `updateRuntimeConfig` changes model and provider settings only, never history (`S/agent/pi-agent.ts:2290-2316`).
  - In the real data the Pi transcript of `vital-zenith` is 2.2 MB, against our 281 KB.
- **Our rows are only used when a harness transcript is missing.** On "No conversation found" or an empty resume, the backend clears the SDK id and prepends `buildRecoveryContext()`: the last 6 user/assistant messages, 1000 chars each (`S/agent/base-agent.ts:702-729`, `SM:3910-3919`). A failed Claude branch fork is summarized from the parent's messages by the mini model.
- **Conclusion.** `messages` is the display, search and export transcript. Model context stays in the harness files. That is correct: our rows are lossy for a model (tool results capped, paths made relative, no thinking blocks, signatures or compaction entries). Rebuilding Pi history from `messages` each turn would be a regression, so this design does **not** do it.
- **Restart mid-turn.**
  - The user message is durable (flushed before ack).
  - Streamed text is lost.
  - Tool rows of the dead turn stay `executing`, as today.
  - `isQueued` user messages are re-queued on load (`SM:3007-3028`).
  - Nothing recovers the in-flight turn. The harness transcript may hold part of it (unverified).
- **Harness transcripts on a server.** On disk now, unchanged; one server process per install is assumed. In P7 (S3, or any host that can lose its disk), each becomes an opaque object per chat:
  - Object keys: `workspaces/<ws>/chats/<chatId>/harness/claude/<sdkSessionId>.jsonl` and `.../harness/pi/<file>.jsonl`.
  - Upload: the whole file, at turn end (in `onProcessingStopped`, after `complete`).
  - Restore: before the agent is created, when the local file is missing (Claude into `~/.claude/projects/<cwd-hash>/`, Pi into `<chat>/.pi-sessions/`).
  - The disk FileStore runs the same code against `CONFIG_DIR/objects/` (data-architecture DECISION 10).
  - Unverified: the SDK's exact cwd-hash rule. The names seen (`-home-g4f4r0-agents`) suggest every non-alphanumeric character becomes `-`. Either read it from the SDK or record the transcript path when `sdkSessionId` is captured.

### Direction: agents in per-workspace containers or VMs

Pi and the CLIs would be pre-installed in a sandbox per workspace. For this design that means:
- **The sandbox never opens `otto.db`.** The server owns `messages` and is the only writer. Agent events stream from the sandbox to the server, which runs the flush in section 4. Recovery context and any history come from one server API, never a database connection, so the sandbox needs no DB credentials or file.
- **Harness transcripts travel as the per-chat objects above.** Before a resume, the server restores the Claude transcript into the container's home (`~/.claude/projects/<cwd-hash>/`) and the Pi file into `.pi-sessions/`, with the cwd fixed by the server, so the hash matches. At turn end it uploads them again.
- **The path token does the remapping.** `{{SESSION_PATH}}` maps message paths to whatever path the chat folder has inside the container.

## 4. Write path

**One path.** Every mutation site keeps calling `persistSession(managed)` (about 40 call sites, unchanged). The per-chat queue keeps its 500 ms debounce and its serialization (`persistence-queue.ts`). The flush stops rewriting a file and runs **one diff and one transaction**:

1. Stored rows = `managed.messages` minus `status`, through `messageToStored`, split into `{id, type, text, content, createdAt}`. Then `makeSessionPathPortable` on `text`/`content`, and the write-time trims below.
2. Diff against `written: Map<id, {hash, createdAt}>`. The map is filled when the chat's rows are loaded and updated only after COMMIT; `hash` = `Bun.hash(text + content)`. A row is upserted when it is new, its hash changed, or its `createdAt` moved. An id in `written` that is missing from the array is deleted. Ids this writer never loaded or wrote are never deleted, so a second writer cannot erase rows it does not know.
3. One `BEGIN IMMEDIATE` transaction (drizzle `db.transaction(fn, { behavior: 'immediate' })`):

```sql
SELECT coalesce(max("order"), 0) AS o FROM messages WHERE workspaceId = :ws AND chatId = :chatId;  -- index
-- per changed row, :next = ++o (a candidate; unused candidates leave gaps)
INSERT INTO messages (workspaceId, chatId, id, "order", type, text, content, createdAt, updatedAt)
VALUES (:ws, :chatId, :id, :next, :type, :text, :content, :createdAt, :now)
ON CONFLICT (workspaceId, chatId, id) DO UPDATE SET
  type = excluded.type, text = excluded.text, content = excluded.content, updatedAt = excluded.updatedAt,
  "order" = CASE WHEN excluded.createdAt <> messages.createdAt THEN excluded."order" ELSE messages."order" END,
  createdAt = excluded.createdAt
RETURNING pk;
DELETE FROM messages_fts WHERE rowid = :pk;
INSERT INTO messages_fts (rowid, text) VALUES (:pk, :text);   -- only user/assistant, not intermediate, not hidden
-- per removed id
DELETE FROM messages WHERE workspaceId = :ws AND chatId = :chatId AND id IN (:ids) RETURNING pk;  -- then FTS by pk
UPDATE chats SET messageCount = (SELECT count(*) FROM messages WHERE workspaceId = :ws AND chatId = :chatId),
  lastMessageRole = :role, lastFinalMessageId = :finalId, preview = coalesce(preview, :preview),
  lastMessageAt = :lastAt, lastUsedAt = :now, metadata = json_set(metadata, '$.tokenUsage', json(:usage)),
  updatedAt = :now
WHERE id = :chatId AND workspaceId = :ws;
COMMIT;
```

**Order rule.** A new row, or a row whose `createdAt` moved (only the replay re-stamp does this), takes `max("order")+1`. Within one flush, new rows are numbered in `(createdAt, array index)` order. So `order` equals the renderer's timestamp order, and pages never split a turn out of order. `BEGIN IMMEDIATE` takes the write lock before the `max` read, so two writers can never pick the same `order`, and `unique (workspaceId, chatId, "order")` would catch a bug.

**List fields.** `role`, `finalId`, `preview` and `lastAt` come from today's `createSessionHeader` helpers (`jsonl.ts:171-238`), moved into a `getChatListFields(messages)` function. `messageCount` is counted in SQL, so it heals itself: about 1 ms for 100k rows over the index, to be measured. `hasUnread`/`lastReadMessageId` stay separate single-row `chats` updates (`SM:7221-7236`), as data-architecture plans.

**Failure.** If the transaction throws (busy past 5 s, disk full), nothing is committed and `written` is unchanged. The queue keeps the chat dirty and retries after 1 s and on the next `persistSession`, instead of dropping it as today. A retry is idempotent: upsert by `(workspaceId, chatId, id)`, delete by id.

**Guarantee.** A message is durable when its flush commits. The user message is flushed before the ack, as today. The turn end (`onProcessingStopped`) flushes at once. Everything else is at most 500 ms behind. A crash loses at most: the last ≤500 ms of completed assistant/tool rows, the streaming text of the current message (never stored, as today), and nothing already committed. No half-written state is possible, because rows, FTS and `chats` fields commit together. Quitting still runs `flushAll`.

**Cost.** Each flush serializes and hashes every in-memory message, which is today's CPU cost (today also writes the whole file). For a 100k-message chat that is the hot spot. If the benchmark misses the budget, the next step is a per-message `version` bumped at the mutation sites, so the flush only looks at dirty rows (not built now).

**Large payloads.** No spill machinery. Write-time trims (display copy only; the model already has the bytes and the library item keeps the file):
- Drop `attachments[].resizedBase64`, which is only needed at send time.
- Cap each string inside `toolInput` at 200,000 chars with the same `[Truncated for storage …]` marker as `toolResult`.
- If a row is still over 1 MB, log it and truncate its largest string the same way. A row is then at most about 1 MB, typically under 1 KB.

Thumbnails are the real bulk (99.6% of the bytes measured): see DECISION 3. If spilling is wanted later, its format is `{"$ref": "<libraryItemId>"}` in place of the string, with the threshold at 64 KB per field.

**Other writes.**
- **Branch:** `INSERT INTO messages (workspaceId, chatId, id, "order", type, text, content, createdAt, updatedAt) SELECT workspaceId, :new, id, "order", type, text, content, createdAt, :now FROM messages WHERE workspaceId = :ws AND chatId = :src AND "order" <= :branchOrder`, plus FTS rows for the copies, in the transaction that creates the `chats` row. It copies rather than references, so deleting the parent never breaks a branch. Paths stay `{{SESSION_PATH}}` and so resolve to the branch folder by themselves, which replaces the remap at `SM:3369-3383`.
- **Delete chat / `/clear`:** `DELETE … WHERE workspaceId AND chatId` (+ FTS by the returned `pk`) in the same transaction as the `chats` change. Deleting a workspace is `WHERE workspaceId = ?`.
- **Import bundle:** insert in array order in one transaction.
- **Archive retention:** the existing `deleteOldArchivedSessions` deletes rows.
- **No per-chat message limit** (there is none today).

## 5. Read path

- **Chat list:** `chats` only, never `messages`.
- **Open a chat (server).**
  - Step 1 (P3b): the server still loads the whole chat into `managed.messages` on first access, now from `SELECT … WHERE workspaceId = ? AND chatId = ? ORDER BY "order"` (an index range scan, no JSON-file parse). It expands the tokens and fills `written`. The ~40 sites that read the array keep working.
  - Step 2 (only if the 100k benchmark misses budget): the server keeps a window, the last 500 rows. It needs the dirty `version` above, and these whole-array reads move to SQL: branch source, export, share, title refresh, messaging gateway, CLI.
- **RPC contract change.** `sessions:getMessages(sessionId, { beforeId?: string, limit = 200 })` returns the session with `messages` = the newest `limit` rows older than `beforeId`, and `hasOlder: boolean`.
  - The cursor is a message id, not `order`. The page is sliced from `managed.messages`, which includes rows not flushed yet, so the cursor must work there too. Once the server windows, the id maps to its `order` in SQL: `… AND "order" < (SELECT "order" FROM messages WHERE workspaceId = ? AND chatId = ? AND id = ?) ORDER BY "order" DESC LIMIT ?`.
  - Renderer: `loadSessionAtom` takes the first page. Scrolling past the loaded turns (`chat-display.tsx:703-742`) asks for `beforeId` = the oldest loaded server id and prepends the page. In-chat search loads older pages until it finds a match or reaches the end.
  - Live events are merged as today (`event-processor/processor.ts`).
  - CLI `session messages` and the messaging gateway pass a large `limit`.
- **Search.** FTS is written in the same transaction as the row: the index is always exact and there is no rebuild job. The cost is two small statements per changed user/assistant row. The query is bounded by `m.workspaceId` before the private-rule join:

```sql
SELECT m.chatId, count(*) AS hits, max(m."order") AS lastOrder
FROM messages_fts f JOIN messages m ON m.pk = f.rowid JOIN chats c ON c.id = m.chatId
WHERE messages_fts MATCH :q AND m.workspaceId = :ws AND c.hidden = 0
  AND (c.createdBy = :actor OR (c.createdBy IS NULL AND :isOwner))
GROUP BY m.chatId ORDER BY hits DESC LIMIT 50;
```

  `:q` is each user token quoted as a prefix (`"tok"*`). Snippets for the first 3 hits per chat come from `messages.text` with today's snippet code (`search.ts:105-170`); a contentless table has no `snippet()`. The ripgrep service is deleted. A global `search_fts` for tasks and comments (data-architecture (c)) stays separate; the one search RPC unions both. Messages need their own index because deleting by an UNINDEXED column is a full scan.
- **Export / share:** the bundle stays format v1, built from rows (`StoredMessage[]` in `order`). Messages travel with tokens still in place, so an importer on any version expands them to its own folder; today's absolute paths do not survive a move.

## 6. SQLite settings, size, privacy

- **Settings.**
  - `openDb` already sets `busy_timeout = 5000` and `journal_mode = WAL` (`S/db/index.ts:16-22`).
  - Add `PRAGMA synchronous = FULL` explicitly: one WAL fsync per commit, durable through power loss. It is affordable because writes are per flush, not per delta. Bun's compiled default was not verified.
  - Add `journal_size_limit = 67108864` so a long transaction cannot leave a huge WAL file.
  - Page size (4096) and cache stay at their defaults until a benchmark says otherwise.
- **`db:push` drops FTS. Verified** with a `:memory:` probe on this repo's `pushSchema`: after `CREATE VIRTUAL TABLE messages_fts …`, the next push plans `DROP TABLE messages_fts`, `messages_fts_data`, `_idx`, `_content`, `_docsize` and `_config`, and refuses for data loss (with `--force` it would drop the index).
  - Fix: `S/db/push.ts` ignores tables whose name ends in `_fts` or starts with `<name>_fts_`. It filters those statements out of `statementsToExecute` and their warnings out of `hasDataLoss`, then runs the rest, about 6 lines. `apply()` is replaced by running the filtered statements (to check against drizzle-kit).
  - `initMessages()` runs `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts …` at boot and in tests after `pushSchema`.
- **Growth.**
  - Text chats: about 1 to 5 KB per message without images (estimated, not measured).
  - Images: 80 to 110 KB per image today because of thumbnails (measured). That drops to about 10 KB with DECISION 3.
  - FTS: about 30 to 50% of the indexed text (estimated).
  - A heavy user making 20 chats a day at 300 KB is about 2 GB a year in `otto.db`.
- **One file for all workspaces.** One writer at a time. A flush transaction should take ≤2 ms, so about 500 flushes/s is the ceiling. 100 chats streaming at once (about 2 flushes/s each) use about 40% of it. Splitting per workspace is not done (NOT doing). The `workspaceId` lead column keeps that split a mechanical change.
- **Privacy.** A message is reachable only through a `chatId` that the one session guard has already checked against the `chats` row (private rule in SQL). Every message query is also bounded by `workspaceId`. Search joins `chats` with the same rule. No agent tool reads messages. Moving every chat into `otto.db` puts all users' chats in one file, so the private-path rule must keep covering `otto.db` (commit 3701182). An agent's shell can still read anything the server user can (data-architecture (g); the container direction in 3 closes it).

## 7. Migration (inside P3b, after `chats`)

**Importer** `initMessagesImport()`, run from bootstrap after `db:push` and before `SessionManager.initialize()` loads chats. For each workspace and each `sessions/<id>/session.jsonl`:

1. If a `chats` row for `<id>` exists, skip the chat: it was already imported. This is the idempotency key. It makes a second run a no-op even after rows were deleted in the DB, which per-row `DO NOTHING` alone would undo.
2. Read the file. Line 1 becomes the `chats` row (data-architecture P3b). Every later line is parsed separately:
   - A line that does not parse is skipped and counted. This covers a truncated last line from a crash.
   - Large lines are fine (`readFileSync`). A file over 256 MB is streamed line by line (not expected: largest seen 280 KB).
   - Absolute paths to this chat's folder go through `makeSessionPathPortable` first (idempotent on lines that already hold tokens).
   - `status` lines are dropped.
   - A missing `timestamp` inherits the previous line's.
   - A duplicate id within one file keeps the last line.
   - The write-time trims apply.
   - `order` comes from a stable sort on `(timestamp, line index)`.
   - `workspaceId` is the workspace being walked.
3. Insert the `chats` row, all rows and the FTS rows in **one transaction per chat**, with `ON CONFLICT (workspaceId, chatId, id) DO NOTHING` as a safety net.
4. Log `imported N chats, M messages, K lines skipped, F failed`. Record `settings install imports.messages`. A file that fails is logged and its chat skipped; it never stops boot. **Old files are never touched.**

**Switch-over (one commit, never two sources of truth).** The same change that turns the importer on also does the following:
- Makes the queue write SQL and deletes the JSONL write path (`writeSessionJsonl`, the `.tmp` logic, the header merge `persistence-queue.ts:116-130`).
- Makes `loadSession`, `listSessions`, bundle export and share read SQL.
- Deletes the watcher's `session.jsonl` branch (`S/config/watcher.ts:495-503`, `:999-1005`).
- Replaces `session-tools-core/src/source-helpers.ts:156-170` (it reads `workingDirectory` from the file) with a lookup from the chats row.
- Replaces ripgrep search with `messages_fts`, so P3c's chat half folds into P3b. Otherwise search would read stale files.

After this commit nothing reads or writes `session.jsonl`. The other folder contents (`plans/`, `data/`, `long_responses/`, `.pi-sessions/`, `meta/` anchors) stay agent working files.

**Rollback.** Revert the commit. The old code reads the untouched JSONL files, and messages written after the switch are lost to it. No export back to files (data-architecture rule). So the owner runs the build for a few days. Back up first with `sqlite3 otto.db ".backup …"` and a `tar` of the sessions folders. P7 cleanup moves `session.jsonl` files to `CONFIG_DIR/legacy-<date>/`.

## 8. Test plan

- **Unit** (`openDb(':memory:')` + `pushSchema` + `initMessages`):
  - Round trip `StoredMessage` → row → `StoredMessage`, including tokens and `hidden`/`isQueued`.
  - `order`: new rows in timestamp order; a re-stamp moves the row to the end; gaps are fine.
  - Tool row upsert (start, then input, then result).
  - Annotation change; Stop removes queued rows; auth-retry removal.
  - `chats` fields after each flush.
  - Branch copy with identical ids in two chats; `/clear`; delete chat and delete workspace (FTS rows gone).
  - `push.ts` keeps `messages_fts` across a second push.
- **Crash.** A child Bun process opens a file DB in a temp dir, runs a flush with a test seam that sends `SIGKILL` to itself after statement k (k = 1, mid-rows, before `UPDATE chats`, before COMMIT). The parent reopens and asserts all-or-nothing: rows, FTS count and `chats.messageCount` agree; then a retry produces the expected state.
- **Concurrency.**
  - Same process: a burst of `persistSession` with a flush in flight. No duplicate `order`, final state = last array.
  - Two `Database` handles in two processes upserting different messages to one chat: both commit, `order` values distinct, neither deletes the other's rows.
  - `busy_timeout` path: hold the write lock for 6 s; the flush fails, retries, and nothing is lost.
- **100k chat.** Generate a file DB with 1k chats and one chat of 100k rows (70% short text of 300 B, 25% tool rows of 2 to 20 KB, 5% 100 KB rows). Measure: first page, older page, full server load, one-row flush with the full in-memory diff, list, and search over 1M rows.
- **FTS.** Diacritics (`cafe` finds `café`), prefixes, phrases with quotes. Deleted and re-stamped rows. Intermediate and hidden rows not indexed. Another user's private chat, other workspaces and hidden chats never returned.
- **Importer** on fixtures shaped like the real files (header + messages, a truncated last line, a 5 MB line, `{{SESSION_PATH}}` and raw absolute paths, a missing timestamp, a `status` line, a duplicate id, a branch sharing ids with its parent). Run twice: same rows, and the second run imports 0. Delete a row after import and run again: it stays deleted. A `projects_members` importer test fills `workspaceId` from the project.
- **Budgets.** Server side, file DB, `synchronous = FULL`, measured with `performance.now()` over 1000 runs in `scripts/bench-messages.ts`, reporting p50/p95:

  | operation | p95 budget |
  |---|---|
  | open a chat, newest 200 rows of the 100k chat | < 30 ms |
  | older page | < 30 ms |
  | append flush (1-3 rows + FTS + chats) on a 1k-message chat | < 5 ms |
  | append flush on the 100k chat (diff included) | < 50 ms, else step 2 |
  | list 1k chats | < 20 ms |
  | search over 1M messages | < 100 ms |

  Keep the existing `sendmessage-durability.test.ts` and `midstream-queue.test.ts` green.

## 9. Risks and NOT doing

Risks:
- The full-array diff costs CPU on huge chats. It is measured, and the fallback (a dirty `version` plus a server window) is defined.
- The renderer contract change touches the chat view's scroll-back and in-chat search.
- `push.ts` filtering relies on drizzle-kit's statement text. A drizzle-kit upgrade must keep the `_fts` test green.
- `order` is an SQL keyword. Every hand-written statement must quote it, and a missed quote fails loudly at parse time, not silently.
- Folding chat search into P3b makes it bigger. Split it into 3 M chunks: storage+importer, manager+queue, RPC+renderer+search.
- Harness transcripts stay host-local until P7: a chat cannot resume on another host.
- Tool rows of a turn killed by a restart stay `executing` (unchanged).

NOT doing:
- Storing streaming deltas.
- Rebuilding Pi or Claude history from `messages`.
- Per-turn segments or an event log.
- Typed columns for the ~50 message fields.
- A spill/`$ref` framework now.
- FTS triggers (drizzle does not model them, and push behaviour with them is unverified).
- Per-workspace database files.
- Multi-node writers.
- Export back to JSONL.
- Moving `meta/*-turn-anchors.json` into rows (they work; they could later become a `content.anchor` field).
- `createdBy` on messages before shared chats.
- A per-chat message limit.

## 10. Owner decisions

1. **Row shape (owner set the names).** `type`, `text` (search) and one JSON `content`, plus identity, `workspaceId` and `order` columns. Alt: typed columns for every field (50 columns, schema churn on every UI field).
2. **Order and identity.** Recommended: per-chat `order` taken in the write transaction (`max+1` under `BEGIN IMMEDIATE`), legacy ids kept, new ids `createId()`, unique `(workspaceId, chatId, id)`, plus an internal `pk` rowid for FTS. Alt: a ULID/time-sortable id as both order and PK (clock-dependent; the re-stamp would need a new id). Alt: no `pk` and FTS keyed by `chatId`+`id` (deletes become full scans).
3. **Thumbnails.** Recommended: generate the 200 px thumbnail as JPEG q70 (about 10 KB instead of 80 to 110 KB): `files.ts:353` format plus the `data:` prefix in `user-message-bubble.tsx:433` and `attachment-preview.tsx:70`. Legacy rows keep theirs. Alt: keep PNG inline (rows stay up to ~330 KB). Alt: a thumbnail object in the FileStore with a `$ref` (a new read path).
4. **Spill threshold.** Recommended: no spill; trims and caps only (`resizedBase64` dropped, `toolInput` strings at 200k chars, 1 MB row guard). Alt: spill fields over 64 KB as `{"$ref": libraryItemId}`.
5. **FTS in the transaction.** Recommended: yes, a contentless `messages_fts` in `otto.db`, with `push.ts` ignoring `*_fts` tables. Alt: written after commit plus a rebuild-on-boot job. Alt: a separate `search.db` (ATTACH is not atomic across files in WAL mode, so it must be rebuildable anyway).
6. **Durability window.** Recommended: keep the 500 ms debounce, user message before ack, flush at turn end, `synchronous = FULL`. Alt: flush on every `text_complete`/`tool_result` (needs the dirty `version` first). Alt: `synchronous = NORMAL` (faster; power loss can drop the last commits).
7. **Server memory.** Recommended: full chat in memory on open in P3b, with the RPC paginated; the server window only if the benchmark requires it. Alt: window now (touches ~40 array readers in `SM`).
8. **Chat search scope.** Recommended: its own `messages_fts`, unioned with the global `search_fts` in one search RPC. Alt: messages inside `search_fts` (deletes scan an UNINDEXED column).
9. **`workspaceId` everywhere.** Owner rule, applied here and to `chats_labels`, `routines_history` and `projects_members` (filled from the project). Recommended order for `projects_members`: in P3a, beside the other table work.
