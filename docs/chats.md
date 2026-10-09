# Chats

`@otto/chats` owns shared Chats, their explicit participants, Messages and per-reader read cursors in `chats`, `chat_participants`, `messages` and `chat_reads`. There is one Chat model: visibility is `workspace | participants` and roles are `contributor | viewer`. There is no type, group or channel field or table; any direct/group presentation derives from participants in the client. Messages stay Messages. The previous Conversation domain, routes, fields and tool name are retired with no aliases.

## Contract

Routes are under `/api/workspaces/:workspaceId`; all use the existing authenticated, origin-checked workspace pipeline.

| Route | Purpose |
| --- | --- |
| `GET /chats` | Bounded discovery: `after`, `limit`, `projectId`, `archived`, `query` (title search) |
| `POST /chats` | Create `{title, projectId?, visibility}` strictly; the server derives `createdBy` and adds the creator as contributor |
| `GET /chats/:id`, `PATCH /chats/:id` | Read; creator-only title edit `{title}` strictly |
| `POST /chats/:id/archive` | Creator-only `{archived}`; archive blocks new Runs but saved reads and active work continue |
| `GET/POST /chats/:id/participants`, `DELETE /chats/:id/participants/:participantId` | Creator-managed human or Agent participants; a viewer caps writes and Agents always need a row |
| `GET/POST /chats/:id/messages` | `?after=<cursor>` replay; create `{requestId, body, replyTo?, mentionUserIds?, fileIds?}` with retry-safe `requestId` |
| `POST /chats/:id/read` | Monotonic `{cursor}` read position |
| `GET /chats/:id/sessions`, `GET/PUT /chats/:id/presence` | Private Session metadata and typing presence |
| `GET /attention` | Unread/mentioned Message summaries carry `chatId` |

Other Chat references use `chatId`/`chatIds`: Run create `{chatId, agentId, requestId, type, body, ...}` and `GET /runs?chatId=`, Schedule create/update, `POST /tasks/capture`, and the realtime WebSocket query/subscription (`/api/realtime?workspaceId=&chatId=&after=`). Discriminators are `chat`: Task links `{type: "chat", reference}` and share selections/snapshots `{type: "chat", targetId, messageIds}`. The scoped Pi tool is `chat.read`; `message.create` is unchanged. Retired `/conversations` routes return 404 and retired `conversationId`/`conversation` inputs are rejected on strict bodies without side effects.

Workspace visibility, creator management, participant roles, Agent membership, Project/workspace/audience intersection, archived continuation and human/Agent Run controls are unchanged by the rename.

## Persisted identities

Only scalar names and one scalar discriminator change. Accepted bytes are never rewritten:

- Run `requestIdentity` keeps the private accepted key `conversationId`, including on new admissions, so an exact old retry still matches.
- Environment `executionScope`, the retained computer scope the runtime serializes from a Run's accepted sources, keeps its historical private `conversationId` key holding the Chat ID. New Runs serialize the same bytes, so a populated Environment still binds after the rename. Saved scopes are never rewritten and the exact-equality bind check is unchanged: a changed source, audience, account or Chat is still refused.
- Run `inputs` and Session `scope` contain no Chat key; the Session binding uses the renamed `chatId` column.
- Frozen share `selection`/`preview`/`snapshot` JSON written before the rename keeps `type: "conversation"`; it is projected to `chat` when read (as `artifact` is projected to `resource`). New and re-previewed shares store `chat`.
- Native pg-boss tables, names and payloads contain no Chat key and are untouched. IDs, foreign keys, Message request IDs, cursors and read positions are unchanged.

## Transfer

Fresh development uses native `bun db:push`. For a populated pre-rename database, stop Otto, inspect/back up the database and review [rename-chats.sql](../scripts/rename-chats.sql) separately with `ON_ERROR_STOP`, after the Resources and Schedules renames and the Skills/Tasks transfers; the Files rename in [rename-files.sql](../scripts/rename-files.sql) follows it. It requires quiescent Runs and released leases, renames the three tables, the six scalar `conversationId` columns, constraints and indexes, and changes only Task-link `conversation` discriminators to `chat`. It refuses a repeat, mixed/partial state, un-renamed Schedules and busy Runs atomically. It never runs at startup, and a destructive drop/create push suggestion must not be approved. It is qualified only on disposable private PostgreSQL (`chats-transfer.test.ts`), not as a live transfer.

## Attachments

A File attached to a Message (`fileIds`) is readable by the participants of that Chat (and Agent participants) for as long as they can read the Chat; access follows the Chat's audience, not the File's visibility, and ends with membership. The File keeps its own visibility, so it does not appear in anyone else's library. Only the File's custodian can attach a private File; a participant cannot carry someone else's private File into another Chat. Files attached to a Chat are indexed by `messages_files_idx` (GIN on `messages.fileIds`). Skill supporting files, Document attachments and frozen shares keep their stricter audience checks.
