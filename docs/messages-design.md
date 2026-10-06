# Chat messages in SQLite (`messages`)

Status: agreed with the owner (decisions of 6 Oct 2026 applied, listed in 10), nothing built. Also applied on 6 Oct 2026, from the Pi research (`docs/pi-research.md`) and the owner's durability direction: the write path saves partial assistant text, marks interrupted rows at boot and uses the client's id for sends (section 4); Pi's history lives in a separate `transcripts` table, recommended and pending the owner (section 3, open decision 2). Owner decision: "no chats_messages, just `messages`", made as reliable, simple and performant as possible. This replaces the JSONL plan of [data-architecture.md](data-architecture.md) (its resolved "Chat messages", old DECISION 4); the chat header still goes to `chats` as planned there (P3b). Paths: `S` = `packages/shared/src`, `SC` = `packages/server-core/src`, `SM` = `SC/sessions/session-manager.ts`.

## 1. Tables

```
messages                                   S/sessions/schema.ts (next to chats)
  pk          integer PK     SQLite's own rowid made explicit; internal only: the join key of messages_fts. Never sent out
                             and never used by app code.
  workspaceId text NN        the chat's workspace (rule below)
  chatId      text NN        chats.id
  id          text NN        the message id. Legacy 'msg-<ms>-<rand6>' / 'plan-<ms>-<rand6>' kept; new ones createId().
                             A user message keeps the id the client made (createId() shape), so a resent message
                             is an upsert (section 4). Unique per chat only: branches copy rows with the same ids (see 4).
  order       int  NN        position in the chat, ascending = display order. Gaps allowed. Quoted "order" in raw SQL.
  type        text NN        'user'|'assistant'|'tool'|'error'|'info'|'warning'|'plan'|'auth-request' ('status' is never stored)
  content     text NN        JSON: every StoredMessage field except id, type and timestamp. The text a person reads
                             (StoredMessage.content) is the key `text`; then toolInput, toolResult, attachments, badges,
                             annotations, turnId, isIntermediate, hidden, isQueued, error*, auth*, planPath,
                             partial (assistant text still streaming), interrupted (cut off by a restart) ...
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
  content: text('content').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  uniqueIndex('messages_order').on(t.workspaceId, t.chatId, t.order),
  uniqueIndex('messages_id').on(t.workspaceId, t.chatId, t.id),
])
```

**Why these columns.** SQL only filters or orders by workspace, chat, id, `order` and `type`. `turnId`, `toolUseId`, `isIntermediate` and `hidden` are read in JS, so they stay in the `content` JSON (rule 4 of data-architecture: columns only for what is listed, filtered or guarded). There is no separate `text` column: the readable text is stored once, in `content.text`, and `messages_fts` holds only its index (see "FTS" below). `createdBy` arrives as a nullable column with shared chats, not before.

**Why `pk`.** An `INTEGER PRIMARY KEY` is the rowid itself (no extra index or bytes), and declaring it keeps its values stable across `VACUUM`, which an implicit rowid does not promise, so FTS rows always point at the right message. Alternative: no `pk` and FTS keyed by `(chatId, id)` as UNINDEXED columns, which turns every FTS delete and update into a full scan.

**FTS: how it is filled.** No triggers. The same JS write function, in the same transaction as the row (section 4): for every upserted row, `DELETE FROM messages_fts WHERE rowid = :pk`, then, when the row is searchable (`user` or `assistant`, not intermediate, not hidden, not `partial`; a partial answer is indexed when it is finalized or marked interrupted), `INSERT INTO messages_fts (rowid, text) VALUES (:pk, :text)` with `:text` = `content.text`. One function, `getSearchText(row)`, holds that rule; every writer (flush, branch, import) uses it. Contentless means the index keeps no copy of the text; `contentless_delete=1` lets a row be deleted by rowid without supplying its old text. Verified with Bun's SQLite (3.53.2, which this needs to be at least 3.43): delete by rowid, re-insert and prefix queries work on such a table.

**Rule: `workspaceId` on every workspace-scoped table, child tables included.** It is `NN`, and indexes lead with it wherever queries are per workspace. Every query and guard can then be bounded by workspace without a join, and deleting or exporting a workspace is one `WHERE`.
- Applies to `messages`, `transcripts` (section 3), `labels_entities` and `routines_history` (the run history) in data-architecture's sketches, whose index lists now lead with `workspaceId` (the install-wide retry scan excepted).
- The only existing table that breaks the rule is `projects_members` (`S/projects/schema.ts`: `projectId, actor, role`). Add `workspaceId NN` and make the PK `(workspaceId, projectId, actor)`. A `db:push` with a default cannot fill it, so its importer sets it from `projects.workspaceId` in one `UPDATE … FROM projects` before the column becomes `NN`. When: open decision 1 in section 10.
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

- **Neither harness takes its history from our messages, today or in this plan.**
  - Claude: superseded, the Claude backend is deleted ([pi-only-plan](pi-only-plan.md)); old Claude chats continue in Pi with a recovery summary of their last messages (`recoverHistory`).
  - Pi resumes with `PiSessionManager.continueRecent(cwd, <chat>/.pi-sessions)` and forks with `forkFrom` + `branch(anchor)` (`packages/pi-agent-server/src/index.ts:687-717`). `updateRuntimeConfig` changes model and provider settings only, never history (`S/agent/pi-agent.ts:2290-2316`).
  - In the real data the Pi transcript of `vital-zenith` is 2.2 MB, against our 281 KB.
- **Our rows are only used when a harness transcript is missing.** On "No conversation found" or an empty resume, the backend clears the SDK id and prepends `buildRecoveryContext()`: the last 6 user/assistant messages, 1000 chars each (`S/agent/base-agent.ts:702-729`, `SM:3910-3919`).
- **Conclusion.** `messages` is the display, search and export transcript. Model context stays with Pi: in the `transcripts` table below (recommended, pending the owner; today `.pi-sessions` files). That is correct: our rows are lossy for a model (tool results capped, paths made relative, no thinking blocks, signatures or compaction entries). Rebuilding Pi history from `messages` each turn would be a regression, so this design does **not** do it; `buildRecoveryContext` stays the only reader of `messages` on the resume path, and only when a transcript is missing.
- **Restart mid-turn** (targets in data-architecture "Durability"; mechanisms in section 4).
  - The user message is durable (committed before the ack), and a resend with the same client id is not a second message or turn.
  - At most 500 ms of streamed text is lost: the partial answer is in its row, and boot recovery marks it interrupted.
  - Tool rows of the dead turn become `interrupted` at boot instead of staying `executing`.
  - `isQueued` user messages are re-queued on load (`SM:3007-3028`).
  - Nothing resumes the in-flight turn itself; the user prompts again. Continuing a run is what the `pi-durable` trial (data-architecture P8) would add.
- **Claude transcript on a server.** Superseded: no Claude harness and no P7 blob ([pi-only-plan](pi-only-plan.md)). Pi needs no object: its entries are rows (below). With the alternative of open decision 2, the Pi file would go under `workspaces/<ws>/chats/<chatId>/harness/pi/`.

### Relation to Pi sessions (`transcripts`)

Two tables, two jobs, one writer (the server), one transaction:
- **`messages`** = what people see: display, search, export and share. Lossy on purpose (caps, path tokens, images as library objects), and it also holds rows Pi does not have (`error`, `info`, `plan`, `auth-request`, old Claude turns).
- **`transcripts`** = what Pi needs to resume: Pi's own entries verbatim (`workspaceId, chatId, id, parentId, type, content, "order", createdAt`; schema and notes in data-architecture (c) "chats"). Resume seeds `SessionManager.inMemory(cwd, { id }, entries)`; `pi-agent-server` sends the new entries at `message_end`, `turn_end`, `compaction_end` and `agent_settled`, and the server inserts them in the same batch transaction as the `messages` rows. A branch copies rows up to its anchor; `/clear` and chat delete remove them with the chat's messages.
- Neither is derived from the other: no `messages` row is rebuilt from Pi entries, and no Pi entry from `messages`. Status: recommended, pending the owner (data-architecture DECISION 16, open decision 2 here). Evidence: `docs/pi-research.md` 2a and 6.

### Direction: tools in per-workspace containers or VMs (not built now)

The direction is in data-architecture (h): later, tools run in a container or VM per workspace (one `otto-agent` image), mounting only the workspace folder, with no database access, **no model key and no transcript**: the harness (Pi), `transcripts` and every credential stay on the server, and only the run's scoped token for the `otto` CLI is in the container's env. Desktop local mode stays on the host. For this design that means:
- **The container never opens `otto.db` and holds no history.** The server owns `messages` and `transcripts` and is the only writer. The harness runs in the server, so its events never cross the container boundary; only tool calls and their results do.
- **Nothing to restore before a resume.** Pi is seeded from `transcripts`; the Claude harness is gone ([pi-only-plan](pi-only-plan.md)).
- **The path token does the remapping.** `{{SESSION_PATH}}` maps message paths to whatever path the chat folder has inside the container.
- **Claude through Pi** (built, B2 and B3: the `claude-code` Pi provider, [pi-only-plan](pi-only-plan.md)). The only resume state left is Pi's entries, with no blob: the Claude transcript object, the cwd-hash restore and the `forkSession`/`resumeSessionAt` branch path are gone.

## 4. Write path

**Dirty rows, not the whole chat.** No whole-chat rewrite and no whole-chat diff: the cost of a write is the rows that changed, so a 100k-message chat appends as fast as a 10-message one.
- Each chat in memory keeps `dirty: Set<id>` and `removed: Set<id>`. The mutation sites that today call `persistSession(managed)` after changing a message (about 45 `persistSession(` calls in `SM`) call `touchMessage(managed, id, { final })` or `removeMessages(managed, ids)` instead. `persistSession` stays only for header-only changes (the `chats` row).
- **Finalized → immediate flush.** A finalized message flushes at once, without the debounce: the user message (before the ack, as today, under the client's id), the assistant message at `text_complete` (which clears `partial`), a tool row at `tool_result`, `error`/`info`/`plan` rows, removals (Stop, auth retry, `/clear`), and the turn end (`onProcessingStopped`, which also clears `chats.turnStartedAt`). The turn's first flush sets `chats.turnStartedAt`.
- **Streaming → 500 ms debounce.** In-place changes while a turn streams (a tool row created at `tool_start` and filled by the second `tool_start`, `isQueued` flips, annotations, `authStatus`) wait up to 500 ms, as the queue does today. **Partial assistant text** joins them: the assistant row is created at the first `text_delta` (its id fixed then, not at `text_complete`) with `content.partial = true`, and the text built so far (`managed.streamingText`) is written as a snapshot on the same 500 ms debounce. Single deltas are never stored, only the latest whole text.
- **Pi entries ride along.** When `pi-agent-server` reports new Pi entries (section 3, "Relation to Pi sessions"), they go into the chat's next batch and are inserted into `transcripts` by id (`ON CONFLICT DO NOTHING`), so `messages` and `transcripts` commit together.
- The per-chat queue (`persistence-queue.ts`) keeps one flush in flight per chat. A flush takes the whole dirty set at that moment, so a burst becomes one batch.

**One short transaction per batch.** `BEGIN IMMEDIATE` (drizzle `db.transaction(fn, { behavior: 'immediate' })`), only the batch's rows, each through `messageToStored`, `makeSessionPathPortable` on `content`, and the write-time limits below:

```sql
-- only when the batch holds a new or re-stamped row:
SELECT coalesce(max("order"), 0) AS o FROM messages WHERE workspaceId = :ws AND chatId = :chatId;  -- index seek
-- per dirty row; :next = ++o for a new or re-stamped row (unused candidates leave gaps)
INSERT INTO messages (workspaceId, chatId, id, "order", type, content, createdAt, updatedAt)
VALUES (:ws, :chatId, :id, :next, :type, :content, :createdAt, :now)
ON CONFLICT (workspaceId, chatId, id) DO NOTHING RETURNING pk;                  -- a row back = inserted
UPDATE messages SET type = :type, content = :content, updatedAt = :now,         -- only if nothing came back
  "order" = CASE WHEN createdAt <> :createdAt THEN :next ELSE "order" END, createdAt = :createdAt
WHERE workspaceId = :ws AND chatId = :chatId AND id = :id RETURNING pk;
DELETE FROM messages_fts WHERE rowid = :pk;
INSERT INTO messages_fts (rowid, text) VALUES (:pk, :text);   -- only when getSearchText(row) is not null
-- removed ids
DELETE FROM messages WHERE workspaceId = :ws AND chatId = :chatId AND id IN (:ids) RETURNING pk;  -- then FTS by pk
-- new Pi entries, in Pi's order (DECISION 16)
INSERT INTO transcripts (workspaceId, chatId, id, parentId, type, content, "order", createdAt)
VALUES (...) ON CONFLICT (workspaceId, chatId, id) DO NOTHING;
UPDATE chats SET messageCount = messageCount + :inserted - :deleted, turnStartedAt = :turnStartedAt,
  lastMessageRole = :role, lastFinalMessageId = :finalId, preview = coalesce(preview, :preview),
  lastMessageAt = :lastAt, lastUsedAt = :now, metadata = json_set(metadata, '$.tokenUsage', json(:usage)),
  updatedAt = :now
WHERE id = :chatId AND workspaceId = :ws;
COMMIT;
```

**Order rule.** A new row, or a row whose `createdAt` moved (only the replay re-stamp does this), takes `max("order")+1`. Within one batch, new rows are numbered in `(createdAt, array index)` order. So `order` equals the renderer's timestamp order, and pages never split a turn out of order. `BEGIN IMMEDIATE` takes the write lock before the `max` read, so two writers can never pick the same `order`, and `unique (workspaceId, chatId, "order")` would catch a bug.

**List fields.** `role`, `finalId`, `preview` and `lastAt` come from today's `createSessionHeader` helpers (`jsonl.ts:171-238`), moved into a `getChatListFields(rows)` function that looks only at the in-memory tail (the newest rows decide them). `messageCount` moves by the rows the batch inserted and deleted (insert-then-update tells them apart); `/clear`, branch and import set it with one `count(*)`. `hasUnread`/`lastReadMessageId` stay separate single-row `chats` updates (`SM:7221-7236`), as data-architecture plans.

**Failure.** If the transaction throws (busy past `busy_timeout`, disk full), nothing is committed; the batch's ids go back into `dirty`/`removed`, the rows are still in memory (a running turn), and the queue retries after 1 s and on the next touch, instead of dropping the write as today. A retry is idempotent: insert-or-update by `(workspaceId, chatId, id)`, delete by id.

**Idempotent sends.** The client makes the user message's id (`createId()`, today's `optimisticMessageId`) and the server stores it as `messages.id`. A send whose id already exists in the chat (a client retrying after a restart that ate the ack) returns the stored message and starts no turn. Today this dedupe is in memory only (`SC/sessions/session-manager.ts:826,929`).

**Boot recovery.** Once at boot, before chats load, for each chat whose `turnStartedAt` is set (so no scan of `messages`): rows with `content.partial` lose the flag and get `content.interrupted = true` (and enter `messages_fts`); tool rows still `executing` become `interrupted`; for a Pi chat, each tool call left without a result gets an interrupted tool-result entry appended to `transcripts` ("interrupted by a restart; the action may have run"), so the model does not see Pi's generic "No result provided" and does not silently repeat a side-effecting call (needs DECISION 16; the entry shape is checked against Pi's session format in P3b); then `turnStartedAt` is cleared. All of it in one transaction per chat. The UI shows interrupted rows as such, never a spinner.

**Guarantee.** A finalized message is durable when its immediate flush commits, a few ms after it is final. The user message is committed before the ack, as today, and is stored once per client id. In-place streaming changes, including the partial answer's text, are at most 500 ms behind. A crash loses at most ≤500 ms of streamed text and of in-place tool-row updates, and nothing already committed; after the restart nothing is left `partial` or `executing`. No half-written state is possible, because rows, FTS, `transcripts` entries and `chats` fields commit together. Quitting still runs `flushAll`. The full failure-mode table with its tests is data-architecture "Durability".

**Large payloads (decided).** No inline base64 in rows and no spill machinery:
- **Images are library objects.** A chat attachment already is a library item, and the stored attachment's `id` is that item's id (`SC/handlers/rpc/files.ts:346`, `:396`). `files.ts` stops putting `thumbnailBase64` into the attachment; `resizedBase64` is only needed at send time and is stripped before the row is written. The UI shows `<img src="/api/library/<id>/thumb">` (`user-message-bubble.tsx:433`, `attachment-preview.tsx:70`, `:111`).
- **Thumbnail endpoint.** `GET /api/library/<id>/thumb`, behind the same membership guard as `library:read`: resized once to 200 px (JPEG, or PNG when the image has transparency) with the existing `imageProcessor`, cached as the FileStore key `<itemId>.thumb` beside the item, and served with `ETag` = the item's `updatedAt` and `Cache-Control: private, max-age=86400`. A non-image returns 404 and the UI keeps its icon fallback.
- **Tool results** keep today's 200,000-char cap (`SM:8136-8140`); each string inside `toolInput` gets the same cap and the same `[Truncated for storage …]` marker. No spill-to-file for now: revisit when measurement shows big rows matter.
- **1 MB row guard** as the safety net: if a row is still over 1 MB, log it and truncate its largest string the same way. A row is then at most about 1 MB, typically under 1 KB.

**Other writes.**
- **Branch:** `INSERT INTO messages (workspaceId, chatId, id, "order", type, content, createdAt, updatedAt) SELECT workspaceId, :new, id, "order", type, content, createdAt, :now FROM messages WHERE workspaceId = :ws AND chatId = :src AND "order" <= :branchOrder RETURNING pk, type, content`, then FTS rows for the copies through `getSearchText`, in the transaction that creates the `chats` row. It copies rather than references, so deleting the parent never breaks a branch. Paths stay `{{SESSION_PATH}}` and so resolve to the branch folder by themselves, which replaces the remap at `SM:3369-3383`.
- **Delete chat / `/clear`:** `DELETE … WHERE workspaceId AND chatId` (+ FTS by the returned `pk`) in the same transaction as the `chats` change. Deleting a workspace is `WHERE workspaceId = ?`.
- **Import bundle:** insert in array order in one transaction.
- **Archive retention:** the existing `deleteOldArchivedSessions` deletes rows.
- **No per-chat message limit** (there is none today).

## 5. Read path

- **Chat list:** `chats` only, never `messages`. Label filters join `labels_entities` (data-architecture (c)).
- **DB-first (decided).** The server stops holding every chat's messages in memory. `managed.messages` becomes a tail, not the whole chat:
  - **Running turns:** a chat with a turn in flight holds its rows from the start of the current turn (plus queued user messages), which is what the event handlers look up (the tool row by `toolUseId`, the last assistant message, queued messages).
  - **LRU of recently opened chats:** N = 16 chats keep their newest page (200 rows). With the owner's 10 to 50 open chats, the rest read from SQL on open, inside the open-chat budget (section 8). Bound: about 16 × 200 rows × 1-5 KB = 3 to 16 MB, plus running turns.
  - An evicted chat keeps nothing but its `chats` row. When a turn starts, its tail loads from SQL (`… ORDER BY "order" DESC LIMIT 200`) and `isQueued` user messages there are re-queued (today `SM:3007-3028` scans the whole array).
  - Whole-chat readers move to messages-domain SQL functions: `getMessages(ws, chatId, { beforeId, limit })`, the branch copy (`INSERT … SELECT`, section 4), `getRecentMessages` for `buildRecoveryContext` (last 6 user/assistant), export, share, title refresh, the messaging gateway and the CLI. About 80 lines in `SM` touch `.messages` (grep count); sorting them into "tail" and "SQL" is the bulk of P3b's manager chunk.
- **RPC contract change.** `sessions:getMessages(sessionId, { beforeId?: string, limit = 200 })` returns the session with `messages` = the newest `limit` rows older than `beforeId`, and `hasOlder: boolean`.
  - The cursor is a message id, not `order`; in SQL it maps to its `order`: `… AND "order" < (SELECT "order" FROM messages WHERE workspaceId = ? AND chatId = ? AND id = ?) ORDER BY "order" DESC LIMIT ?`. The newest page merges the in-memory tail over the SQL rows by id, so rows not yet flushed (≤500 ms) are included, and a tab opened mid-turn sees the current partial answer.
  - Renderer: `loadSessionAtom` takes the first page. Scrolling past the loaded turns (`chat-display.tsx:703-742`) asks for `beforeId` = the oldest loaded server id and prepends the page. In-chat search loads older pages until it finds a match or reaches the end.
  - Live events are merged as today (`event-processor/processor.ts`).
  - CLI `session messages` and the messaging gateway pass a large `limit`.
- **Search (decided).** Chat search uses `messages_fts`, written in the same transaction as the row (section 1): the index is always exact and there is no rebuild job. The cost is two small statements per changed user/assistant row. The query is bounded by `m.workspaceId` before the private-rule join:

```sql
SELECT m.chatId, count(*) AS hits, max(m."order") AS lastOrder
FROM messages_fts f JOIN messages m ON m.pk = f.rowid JOIN chats c ON c.id = m.chatId
WHERE messages_fts MATCH :q AND m.workspaceId = :ws AND c.hidden = 0
  AND (c.createdBy = :actor OR (c.createdBy IS NULL AND :isOwner))
GROUP BY m.chatId ORDER BY hits DESC LIMIT 50;
```

  `:q` is each user token quoted as a prefix (`"tok"*`). Snippets for the first 3 hits per chat come from `json_extract(m.content, '$.text')` with today's snippet code (`search.ts:105-170`); a contentless table has no `snippet()`. The ripgrep service is deleted. The global `search_fts` stays for the other entities (tasks, projects, comments, library documents; data-architecture (c)); one search RPC merges both. Messages need their own index because deleting by an UNINDEXED column is a full scan.
- **Export / share:** the bundle stays format v1, built from rows (`StoredMessage[]` in `order`). Messages travel with tokens still in place, so an importer on any version expands them to its own folder; today's absolute paths do not survive a move. Pi's resume state travels as the chat's `transcripts` rows in place of any `.pi-sessions` file (whether today's bundle includes that folder is not checked); share-to-viewer never includes them.

## 6. SQLite settings, size, privacy

- **Settings.**
  - `openDb` already sets `busy_timeout = 5000` and `journal_mode = WAL` (`S/db/index.ts:16-22`).
  - Add `PRAGMA synchronous = FULL` explicitly: one WAL fsync per commit, durable through power loss. It is affordable because writes are per batch, not per delta. Bun's default on Linux is already FULL in WAL mode (verified); macOS Bun may use the system SQLite, so the pragma is set anyway.
  - Add `journal_size_limit = 67108864` so a long transaction cannot leave a huge WAL file.
  - Page size (4096) and cache stay at their defaults until a benchmark says otherwise.
- **`db:push` drops FTS. Verified** with a `:memory:` probe on this repo's `pushSchema`: after `CREATE VIRTUAL TABLE messages_fts …`, the next push plans `DROP TABLE messages_fts`, `messages_fts_data`, `_idx`, `_content`, `_docsize` and `_config`, and refuses for data loss (with `--force` it would drop the index).
  - Fix, the **first step of P3b**: `S/db/push.ts` ignores tables whose name ends in `_fts` or starts with `<name>_fts_`. It filters those statements out of `statementsToExecute` and their warnings out of `hasDataLoss`, then runs the rest, about 6 lines. Today's `apply()` (`push.ts:22`) is replaced by running the filtered statements (to check against drizzle-kit). This also covers data-architecture's `search_fts`.
  - `initMessages()` runs `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts …` at boot and in tests after `pushSchema`.
- **Growth.**
  - Text chats: about 1 to 5 KB per message without images (estimated, not measured).
  - Images: 80 to 110 KB per image in rows today because of inline thumbnails (measured). With images as library objects a row holds only the attachment metadata (well under 1 KB); the cached thumbnail is a separate object of about 10 KB.
  - FTS: about 30 to 50% of the indexed text (estimated).
  - A heavy user making 20 chats a day at 50 KB is about 365 MB a year in `otto.db` (estimated).
- **Many chats at once (the owner's pattern).** 10 to 50 chats open, several browser and desktop tabs, up to 50 chats streaming together, all on one SQLite file in WAL.
  - Readers never block the writer or each other (WAL). Several tabs on one chat share one server-side chat (one tail, one queue); a tab costs no server state beyond its subscription.
  - One writer at a time. `bun:sqlite` is synchronous, so inside the server process two transactions never interleave: in-process "lock waits" are event-loop time, and real `SQLITE_BUSY` waits come only from another process (a backup, a test, a second server by mistake). Each batch is 1 to 3 rows, target ≤1 ms of work plus one WAL fsync.
  - Load: 50 streaming chats at about 2 finalized rows/s plus 2 debounced flushes/s each is about 200 small transactions/s. At 2 ms each that is about 40% of one writer (estimated; the benchmark in 8 measures it).
  - `busy_timeout` stays 5000 ms (`S/db/index.ts`). A transaction that still fails goes back to `dirty` and retries (section 4).
  - **Batching policy.** Per chat: one flush in flight, and everything dirty meanwhile joins the next batch. If the benchmark shows fsync-bound p95 over budget, the next step is a group commit: one transaction for every chat whose batch is ready in the same tick (not built now).
  - **At the limit.** Pending batches coalesce instead of queueing: each chat has at most one pending batch, which grows, so the writer does fewer, bigger transactions. Nothing is dropped; rows wait in memory and the user-message ack waits for its commit, so overload shows as send latency, not errors. A batch pending for more than 2 s logs a warning.
  - Page reads are short (200 rows), so they do not pin old WAL snapshots for long; `journal_size_limit` bounds the WAL after checkpoints.
  - Splitting per workspace is not done (NOT doing). The `workspaceId` lead column keeps that split a mechanical change.
- **Privacy.** A message is reachable only through a `chatId` that the one session guard has already checked against the `chats` row (private rule in SQL). Every message query is also bounded by `workspaceId`. Search joins `chats` with the same rule. Agents read chats only through the `otto` CLI (`otto chats list/get`, data-architecture (g)), which call the same server API as the chat's user, so the guard, workspace bounds and private rule apply. Moving every chat into `otto.db` puts all users' chats in one file, so the private-path rule must keep covering `otto.db` (commit 3701182). An agent's shell can still read anything the server user can (data-architecture (i); the container direction in data-architecture (h) closes it).

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
   - **Inline images leave the rows.** For each attachment with `thumbnailBase64`, `resizedBase64` or a legacy `thumbnailPath`: when `attachment.id` names a library item that still exists, the inline fields are dropped (the thumbnail endpoint regenerates from the item); otherwise the best inline image (`resizedBase64`, else the thumbnail) becomes a library item in "Chat attachments" and `attachment.id` points to it. Both cases strip the fields from `content`. Those library items are created before the chat's transaction; a chat that then fails can leave unreferenced items, which are logged.
   - The write-time limits apply (200k caps, 1 MB guard).
   - `order` comes from a stable sort on `(timestamp, line index)`.
   - `workspaceId` is the workspace being walked.
   - **Pi entries** (DECISION 16): the newest `<chat>/.pi-sessions/*.jsonl` (the file `continueRecent` picks) becomes `transcripts` rows, verbatim, in file order; its header gives `chats.metadata.piSessionId`. No caps or path tokens apply to them.
3. Insert the `chats` row, its `labels_entities` rows (`entity = 'chat:<id>'`), all message rows, the FTS rows and the `transcripts` rows in **one transaction per chat**, with `ON CONFLICT (workspaceId, chatId, id) DO NOTHING` as a safety net.
4. Log `imported N chats, M messages, I images moved, K lines skipped, F failed`. Record `settings` (`install`, key `imports.messages`). A file that fails is logged and its chat skipped; it never stops boot. **Old files are never touched.**

**Before the switch.** The `*_fts` filter in `push.ts` lands first, with its test, so the first `db:push` after `messages_fts` exists cannot drop it.

**Switch-over (one commit, never two sources of truth).** The same change that turns the importer on also does the following:
- Makes the queue write dirty rows to SQL and deletes the JSONL write path (`writeSessionJsonl`, the `.tmp` logic, the header merge `persistence-queue.ts:116-130`).
- Makes `loadSession`, `listSessions`, bundle export and share read SQL; the server holds only tails and the LRU (section 5).
- Serves thumbnails from `/api/library/<id>/thumb` and stops writing inline base64.
- Deletes the watcher's `session.jsonl` branch (`S/config/watcher.ts:495-503`, `:999-1005`).
- Replaces `session-tools-core/src/source-helpers.ts:156-170` (it reads `workingDirectory` from the file) with a lookup from the chats row.
- Replaces ripgrep search with `messages_fts` (chat search is part of P3b; there is no separate P3c). Otherwise search would read stale files.

- Makes `pi-agent-server` seed sessions from `transcripts` (`SessionManager.inMemory`) and report new entries, instead of `continueRecent` on `.pi-sessions` (DECISION 16).

After this commit nothing reads or writes `session.jsonl` or `.pi-sessions/` (with DECISION 16). The other folder contents (`plans/`, `data/`, `long_responses/`, `meta/` anchors) stay agent working files.

**Rollback.** Revert the commit. The old code reads the untouched JSONL files, and messages written after the switch are lost to it. No export back to files (data-architecture rule). So the owner runs the build for a few days. Back up first with `sqlite3 otto.db ".backup …"` and a `tar` of the sessions folders. P7 cleanup moves `session.jsonl` files to `CONFIG_DIR/legacy-<date>/`.

## 8. Test plan

- **Unit** (`openDb(':memory:')` + `pushSchema` + `initMessages`):
  - Round trip `StoredMessage` → row → `StoredMessage`, including tokens and `hidden`/`isQueued`.
  - `order`: new rows in timestamp order; a re-stamp moves the row to the end; gaps are fine.
  - Tool row upsert (start, then input, then result); a finalized row commits without waiting for the debounce.
  - Annotation change; Stop removes queued rows; auth-retry removal.
  - `chats` fields after each flush; `messageCount` equals `count(*)` after inserts, updates and deletes.
  - A test-only check at every turn end: the in-memory tail equals its rows in SQL (catches a mutation site that forgot `touchMessage`).
  - Branch copy with identical ids in two chats; `/clear`; delete chat and delete workspace (FTS rows gone).
  - LRU: the 17th opened chat evicts the oldest; a turn on an evicted chat loads its tail and re-queues `isQueued` rows; the first page merges unflushed tail rows.
  - Thumbnail endpoint: guard (another workspace's item is 404), resized once (second request reads the cached key), `ETag`/304, non-image 404.
  - `push.ts` keeps `messages_fts` across a second push.
- **Crash.** A child Bun process opens a file DB in a temp dir, runs a flush with a test seam that sends `SIGKILL` to itself after statement k (k = 1, mid-rows, before `UPDATE chats`, before COMMIT). The parent reopens and asserts all-or-nothing: rows, FTS count, `transcripts` rows and `chats.messageCount` agree; then a retry produces the expected state.
- **Durability suite** (one test per row of data-architecture's failure-mode table, P3b's durability chunk; child process killed with `SIGKILL`, parent restarts the server code on the same file DB):
  - Kill mid-stream: the assistant row holds the text of the last 500 ms flush; after boot recovery it is `interrupted`, not `partial`, and indexed.
  - Kill inside a tool's `execute()`: the row ends `interrupted`; for Pi, the next request carries the interrupted tool result, not "No result provided".
  - Kill during compaction: `transcripts` equals the pre-crash entries and the next turn works.
  - Kill after the user message commits, before the ack; resend the same client id: one row, one turn.
  - A second client opening mid-stream gets the partial; after a restart both clients reload to the SQL state.
  - Pi mirror: a scripted Pi run through the seed/append path ends with the same entries as a file-backed `SessionManager` run (all entry types, including compaction and model changes); resume from rows gives Pi the same context.
  - Boot recovery reads only chats with `turnStartedAt` set and clears it.
- **Concurrency.**
  - Same process: a burst of `touchMessage` calls with a flush in flight. No duplicate `order`; the rows touched during the flight land in the next batch; final state = the in-memory tail.
  - Two `Database` handles in two processes upserting different messages to one chat: both commit, `order` values distinct, neither deletes the other's rows.
  - `busy_timeout` path: hold the write lock for 6 s; the flush fails, retries, and nothing is lost.
- **100k chat.** Generate a file DB with 1k chats and one chat of 100k rows (70% short text of 300 B, 25% tool rows of 2 to 20 KB, 5% 100 KB rows). Measure: open (first page, chat not in the LRU), older page, one-row append, list, and search over 1M rows.
- **Many chats at once** (the owner's pattern), in `scripts/bench-messages.ts`, file DB in WAL, 60 s per run:
  - 50 simulated streaming chats in the server process, each producing a finalized row every 200 to 500 ms and debounced in-place updates, while 5 reader loops (the tabs) open chats and page back through 10 to 50 chats.
  - A second process writing every 100 ms, so real `SQLITE_BUSY` waits happen.
  - Measured: append latency from `touchMessage` to COMMIT (p50/p95/p99), lock wait (time to acquire `BEGIN IMMEDIATE`), transactions/s and rows per transaction, event-loop delay p99, WAL size, rows lost (must be 0).
  - **The limit:** ramp from 50 to 200 streaming chats until append p95 passes 100 ms. Record the knee and check that batches coalesce (transactions/s levels off, rows per transaction grow) and nothing is lost. A knee below 100 chats turns on the group commit (section 6).
- **FTS.** Diacritics (`cafe` finds `café`), prefixes, phrases with quotes. Deleted and re-stamped rows. Intermediate and hidden rows not indexed. Another user's private chat, other workspaces and hidden chats never returned.
- **Importer** on fixtures shaped like the real files (header + messages, a truncated last line, a 5 MB line, `{{SESSION_PATH}}` and raw absolute paths, a missing timestamp, a `status` line, a duplicate id, a branch sharing ids with its parent, inline thumbnails with and without a surviving library item, chat labels). Run twice: same rows, and the second run imports 0. Delete a row after import and run again: it stays deleted. No row keeps `thumbnailBase64`/`resizedBase64`. A `projects_members` importer test fills `workspaceId` from the project.
- **Budgets.** Server side, file DB, `synchronous = FULL`, measured with `performance.now()` in `scripts/bench-messages.ts`, reporting p50/p95:

  | operation | p95 budget |
  |---|---|
  | open the 100k chat (not in the LRU), newest 200 rows | < 30 ms |
  | older page of the 100k chat | < 30 ms |
  | append (1-3 rows + FTS + chats), 1k-message chat or 100k chat | < 5 ms, alone |
  | append with 50 chats streaming (touch to COMMIT) | < 20 ms; lock wait < 10 ms |
  | event-loop delay with 50 chats streaming | p99 < 50 ms |
  | list 1k chats | < 20 ms |
  | search over 1M messages | < 100 ms |

  Keep the existing `sendmessage-durability.test.ts` and `midstream-queue.test.ts` green.

## 9. Risks and NOT doing

Risks:
- Dirty tracking replaces the diff: a mutation site that forgets `touchMessage` leaves its row stale in SQL until the row changes again. The turn-end test check (section 8) catches it.
- DB-first reads touch about 80 `.messages` lines in `SM`; a reader left on the tail sees only recent rows. Each is sorted into "tail" or "SQL" explicitly.
- The renderer contract change touches the chat view's scroll-back and in-chat search.
- `push.ts` filtering relies on drizzle-kit's statement text. A drizzle-kit upgrade must keep the `_fts` test green.
- `order` is an SQL keyword. Every hand-written statement must quote it, and a missed quote fails loudly at parse time, not silently.
- Many tiny transactions under 50 streaming chats: the estimate is about 40% of one writer; the benchmark decides whether the group commit is needed.
- The thumbnail endpoint is a plain HTTP `<img>` request: the web UI sends its session cookie, but how the Electron renderer authenticates it to the embedded server is **unverified**.
- Folding chat search, DB-first reads, the thumbnail endpoint and durability into P3b makes it bigger. Split it into 4 M chunks: storage+importer, manager+queue (tail, LRU, dirty rows), RPC+renderer+search+thumbnails, durability (partial text, boot recovery, idempotent sends, `transcripts`, crash suite).
- Superseded: no Claude transcript ([pi-only-plan](pi-only-plan.md)). Pi chats resume on another host once `transcripts` exists (DECISION 16).
- Partial text snapshots add writes: one debounced update per streaming chat every 500 ms, already inside the "2 debounced flushes/s" of the load estimate (section 6); the benchmark confirms it.
- Pi entry mirroring has no per-entry hook in Pi; an entry type the four events miss would be absent on resume. The mirror test (section 8) guards it.
- `transcripts` rows are large (whole tool results, inline images) and never compacted; resuming a long Pi chat reads all of them.

NOT doing:
- Storing each streaming delta (the partial text is stored as a snapshot every 500 ms, section 4).
- Rebuilding Pi or Claude history from `messages`, or `messages` from Pi entries.
- Automatic replay of an interrupted tool call.
- Per-turn segments or an event log.
- Typed columns for the ~50 message fields.
- Inline base64 images in rows.
- A whole-chat rewrite or whole-chat diff per flush.
- A spill/`$ref` framework or spill-to-file now.
- FTS triggers (drizzle does not model them, and push behaviour with them is unverified).
- Per-workspace database files.
- Multi-node writers.
- Export back to JSONL.
- Moving `meta/*-turn-anchors.json` into rows (they work; they could later become a `content.anchor` field).
- `createdBy` on messages before shared chats.
- A per-chat message limit.

## 10. Owner decisions

Resolved on 6 Oct 2026 (applied above, kept here for history; letters match data-architecture (k)):
- Row shape and identity (B): `messages(pk, workspaceId, chatId, id, "order", type, content, createdAt, updatedAt)`, uniques `(workspaceId, chatId, "order")` and `(workspaceId, chatId, id)`; no `text` column; `pk` = the explicit rowid, only for FTS (old 1, 2).
- Labels (A): chat labels live in `labels_entities`, not a chat table (data-architecture (c)).
- Images and big payloads (C): images are library objects shown through `/api/library/<id>/thumb`; the importer moves or drops inline images; 200k tool-result cap, no spill, 1 MB row guard (old 3, 4).
- FTS in the transaction (B, E): contentless `messages_fts` with `contentless_delete=1`, written by the same transaction; `push.ts` ignores `*_fts` as P3b's first step (old 5).
- Durability and memory (D): immediate flush per finalized message, 500 ms debounce for streaming changes, short `BEGIN IMMEDIATE` batches, `synchronous = FULL`; DB-first reads with running turns plus an LRU of 16 chats in memory (old 6, 7).
- Chat search scope (E): `messages_fts` for chats, `search_fts` for the other entities, one search RPC merges them (old 8).
- `workspaceId` everywhere: owner rule, applied to `messages`, `transcripts`, `labels_entities`, `routines_history` and `projects_members` (old 9, rule part).
- Harness direction (G): later, per-workspace containers that run tools only, with harness, transcript and credentials on the server and no model key in the container (refined by the Pi research, 6 Oct 2026); Claude through Pi only after a provider-terms check (section 3, data-architecture (h)).
- Durability first (owner direction, 6 Oct 2026: "durable is something key for us to make sure we have the highest quality possible"): partial text every 500 ms, boot recovery to `interrupted`, client ids for idempotent sends, the crash suite (section 4, 8; data-architecture "Durability").

Open, recommendation first, then the alternative:

1. **When `projects_members` gets `workspaceId`.** Recommended: in P3a, beside the other table work. Alt: in P2 with the workspace registry.
2. **Pi transcripts (= data-architecture DECISION 16, pending the owner).** Recommended: a `transcripts` table of Pi's entries verbatim beside `messages`, seeded into `SessionManager.inMemory` on resume and appended per event in the same transaction (section 3). Alt: `messages` as Pi's store (rejected by the research: lossy for a model, extra rows, no tree, no storage interface in Pi), or `.pi-sessions` files plus one S3 blob per chat in P7.
