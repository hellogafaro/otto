# Discovery lists: sorting, filtering and labels

Every ordinary collection `GET` shares one contract. A client such as a command panel queries these lists directly: there is no separate search domain or unified endpoint. For a compact recent view, call the owning list with `sort=updatedAt&order=desc&limit=5` (or 10) and the filters it needs; the page is exact before the limit, so the latest item is always first.

## Contract

- `limit`: integer 1–100, default 100, and 100 is also the maximum. A smaller limit is always allowed.
- `sort` and `order`: `sort` is one of the owning domain's allowlisted fields (below) and `order` is `asc` (default) or `desc`. `order` without `sort` is refused. Without `sort` every list keeps its previous order: id ascending, with the plain UUID `next` cursor.
- Unknown query keys, unknown sort fields, bad enum values and `limit` outside 1–100 return 400. Nothing is ignored silently.
- Filters are typed fields of the owning domain, not a query language. They only narrow rows the caller may already read; a private, revoked or foreign row is never revealed by a filter, a count or a cursor.
- Ordering and filtering run in the database before the limit. The order is `value, id`: NULL values sort last in both directions, the id tie-break runs in the same direction as `order`, text sorts compare the full value case-insensitively (`lower(value)`) and timestamps keep their microseconds.
- `next` is an opaque string, or `null` at the end. Pass it back unchanged as `after` with the same filters and `sort`/`order`; `limit` may change between pages.
- Every list scans only rows the caller can read: each getter's SQL applies the same read rule as the domain's `getX` (below), so a hidden row never shifts a page, leaves an empty page or names a position. Still continue until `next` is `null` and never infer the end from the item count.
- Sorted positions are mutable ranking. A row edited between pages may be seen twice or missed in that walk; there is no snapshot.

## Cursors

Without `sort`, `next` is the last scanned row's UUID, as before. With `sort`, `next` is sealed (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`) and carries the sort, order, row id and typed position of the last scanned row. Because every scanned row is readable by the caller, that value is one the caller could already read. The sealed data is bound to the operation, workspace, user (and Agent), the sort and every filter, so a cursor moved to another list, person, workspace, filter or sort, tampered with, or issued under a rotated secret returns 400. The position is a value, not a row to look up, so deleting the cursor row does not break continuation. A sort value too large to seal (over about 3 KB) returns 503 instead of being truncated; the widest supported title seals to about 1,700 characters and the cursor limit is 4,096.

## Readable rows only

A reader must not learn a hidden row's value from where it sorts, from an empty page between their own rows, or from a token's length. So the list SQL carries the read rule of the domain's `getX`, as a small fragment exported by the domain that owns it (`projectReadable`, `creatorIsMember`, `chatReadable`/`chatHasSponsor`, `runAudienceHas`), next to the visibility and creator rules already in SQL. `getX` remains the authority and still runs on every row:

| Rule | Lists |
| --- | --- |
| Project read (a membership row) | Documents, Files, Folders, Agents, Skills, Collections, and Chats, Schedules and Runs through their Chat |
| Creator still a workspace member | Documents, Folders, Skills, Connections, Subscriptions, Operations (through the Connection) |
| Chat read (Project, participant row for participant-only Chats; an Agent is always a participant) | Chats, Schedules, Runs, and Files with a source Run |
| File source-Run audience (the sponsor is in the saved and the current human audience; an Agent also in the saved Agents) | Files |
| Agent actor's selected Skills and private-creator match | Skills |

In sorted order, a row that SQL admits but `getX` denies fails closed (`unavailable`, no cursor) instead of being skipped. This holds because reads hold the workspace row `FOR SHARE` and authority writes hold it `FOR UPDATE`, so authority cannot change inside one read; a denial means the SQL and `getX` disagree. Id order keeps skipping a denied row. Audience-size limits (over 500 workspace or Project humans, over 100 explicit Chat participants) still make `getX`, and therefore the list, return `unavailable`.

## Per-domain query matrix

`sort` values and typed filters per list. `archived` defaults to `false` where the list has it. A `—` sort means the list keeps id order for the reason given.

| List | Sorts | Filters |
| --- | --- | --- |
| `GET /workspaces` | `title` | `role`, `query` |
| `…/members` | `name` | `role`, `query` (name) |
| `…/projects` | `title`, `createdAt`, `updatedAt` | `archived`, `query` |
| `…/projects/:id/members` | `name` | `role`, `query` (name) |
| `…/tasks` | `title`, `createdAt`, `updatedAt`, `dueAt` | **`projectId` required**, `archived`, `query`, `status`, `ownerId`, `assigneeUserId`, `assigneeAgentId`, `dueFrom`, `dueTo` |
| `…/tasks/:id/links` | `type`, `reference` | `type` |
| `…/timesheets` | `createdAt`, `duration` | **`taskId` required**, `createdBy`, `from`, `to` |
| `…/chats` | `title`, `createdAt`, `updatedAt` | `projectId`, `archived`, `query`, `visibility`, `createdBy` |
| `…/chats/:id/participants` | `role`, `type` | `role`, `type` (`human` or `agent`) |
| `…/chats/:id/sessions` | `createdAt`, `updatedAt` | `agentId` |
| `…/agents` | `title`, `createdAt`, `updatedAt` | `projectId`, `archived`, `query`, `visibility`, `createdBy` |
| `…/documents` | `title`, `createdAt`, `updatedAt` | `projectId`, `archived`, `query`, `collectionId`, `visibility`, `createdBy`, `label` |
| `…/collections` | `title`, `createdAt`, `updatedAt` | `projectId`, `archived`, `query` |
| `…/documents/:id/proposals` | `title` | `proposerId`, `agentId`, `query` |
| `…/files` | `title`, `createdAt`, `updatedAt`, `byteLength` | `projectId`, `archived`, `query`, `type`, `ownerId`, `visibility`, `label` |
| `…/folders` | `title`, `createdAt`, `updatedAt` | `parentId`, `root`, `projectId`, `archived`, `query`, `visibility`, `createdBy` |
| `…/library` | `title`, `createdAt`, `updatedAt`, inside each kind | `folderId`, `projectId`, `archived`, `query`, `label` |
| `…/shares` | — (no title or time column) | `published`, `type` (`document`, `chat`, `file`) |
| `…/skills` | `title`, `createdAt`, `updatedAt` | `projectId`, `archived`, `query`, `visibility`, `createdBy` |
| `…/skills/:id/proposals` | `title` | `proposerId`, `agentId`, `query` |
| `…/connections` | `title`, `createdAt`, `updatedAt` | `type`, `visibility`, `createdBy`, `connected`, `query` |
| `…/connections/:id/operations` | `createdAt`, `updatedAt` | `state` |
| `…/subscriptions` | `title`, `createdAt`, `updatedAt` | `status`, `provider`, `visibility`, `createdBy`, `query` |
| `…/schedules` | `title`, `createdAt`, `updatedAt` | `status`, `ownerId`, `agentId`, `type`, `query` |
| `…/schedules/:id/history` | `receivedAt` | `outcome`, `runId` |
| `…/runs` | `createdAt`, `updatedAt` | `chatId`, `state`, `agentId`, `sponsorId`, `type` |

`query` is the existing word match (`to_tsvector('simple')`): whole words, not prefixes. It covers the title, plus body or instructions where the list already searched them. Timestamps in a sort are the real event fields of the domain; Timesheets keep only `createdAt` (a log entry has no later change) and Shares have none, so neither gains a fabricated `updatedAt`. A Chat's `updatedAt` records metadata edits and archiving, not its latest Message, so it is not a "recent conversation" order.

The library keeps its grouping: folders, then Files, then Documents, with `sort` ordering inside each kind. It is not a global recent list. `label` can only match Files and Documents, so it leaves Folders out; a `folder:` cursor is refused while it is set. Its `next` is `<kind>:<child cursor>`.

### Not generic lists

These keep their own order and completeness rules and refuse `sort`, `order` and filters:

- Chat Messages and Run activity: numeric commit-ordered replay (`after` is a cursor number).
- Runs in `cursor` replay mode (domain API only): commit order; mixing it with `after`, `sort` or the discovery filters is refused.
- `GET /attention`: four independent id cursors composed from Runs, questions, mention attention and approvals.
- Fixed complete results and singular reads: Run usage, the Subscription model catalog, Environment, Agent and other `GET /:id` routes.

Task and Timesheet lists are always scoped to a Project or Task the caller names; there is no workspace-wide Task search.

## Labels

Documents and Files carry `labels`: a plain list of strings with no label entity, catalog, junction or taxonomy. Each label is trimmed, 1–200 characters, case-sensitive; an item holds at most 30 and duplicates are kept as sent. `labels` is accepted on Document and File creation (File creation was limited to 20 and now matches the 30 of File edits; existing values stay valid) and on edits, where `[]` clears them. Older Documents read `[]`. List with one exact `label` (no prefix, case folding or multiple labels). A Document label edit is a normal Document edit: creator only and fenced by the edit token. A File label edit is a custodian-only metadata edit; the accepted upload request, an Agent's creation receipt, source-Run audience, frozen share snapshots and accepted Run/Skill bytes never change, and an exact upload retry returns the current File without resetting later labels. The new `documents.labels` column is added by native push (default `[]`) with no migration.
