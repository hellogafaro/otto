# Comments and notifications

Status: decided (owner); backend, RPCs, live updates and hooks built (see As built), pages follow. Two tables, `comments` and `notifications`, one small domain each; a task's activity events are `comments` rows of type `event`, not a separate log.

## Idea

People talk on a task or a project in **comments**. You hear about it through **notifications**, and a notification is always a *mention* of you: either you were @mentioned in a comment, or you were assigned. Nothing else notifies. What happens to a task (status, title, assignees, due date, project, links, time logged) is an **activity event**: a `comments` row of type `event` that the task's activity feed shows between its comments, and that never notifies anyone (an assignment still gives the newly assigned person their "assigned" notification, as before). Mentions are the one concept; groups (`@assignees`, `@everyone`) are later tokens expanded by the same resolver.

## Naming

An **entity** is anything with an identity, written as a typed reference `<type>:<id>` (`task:<id>`, `comment:<id>`). The column is `entity`, and the allow-list of types is `ENTITY_TYPES` (discriminators are `type` everywhere). It avoids "subject" (in OAuth and auth that is who acts) and "resource" (here that is the `{type, ref}` links attached to tasks and projects).

## Data

`comments(id, workspaceId, entity, type, createdBy, content, createdAt, updatedAt)`
- `type`: `comment` (written by someone) or `event` (an activity event a domain wrote; `content` is the event JSON, read back as `event`). Default `comment`, so the push gave every existing row its type.
- `entity`: what the comment is on, any typed reference `<type>:<id>` (`task`, `project` now; `comment` is allowed so replies work later; `library`, `chat` when they get comments). The allow-list is one constant (`ENTITY_TYPES`, `packages/shared/src/entities.ts`): a new type is one line, never a schema change. The same string shape as actors. Index (`workspaceId`, `entity`, `createdAt`).
- `createdBy`: `user:<id>` or `agent:<id>`, filled by the server.
- `content`: markdown (the task editor's). A mention is the token `user:<id>` that the editor inserts (picker later; the server finds it with a regex).
- Authors edit (`updatedAt`) and hard-delete their own comments; an event can be neither edited nor deleted (`forbidden`).
- An event is `{kind, ...}`: `status`, `title`, `project` (`{from, to}`), `due` (`{from, to}`, ms or null), `assignees` (`{from, to}`, actor lists), `links` (`{added, removed}`, resources compared by `type:ref`), `time` (`{time}`, ms logged), and `created`, which is never stored (the reader adds it, so older tasks have it too).

`notifications(id, userId, workspaceId, entity, type, createdBy, status, createdAt)`
- One row per recipient, read as a sentence: `createdBy` `type` you on `entity`. `type` is an open verb, validated in code against `NOTIFICATION_TYPES` (`mention`, `assigned` now; later `comment`, `reply`, `shared`...), with no CHECK in the database.
- `entity` is where it happened: `comment:<id>` for a mention (the comment holds the text and its own `entity`, so a click goes to the comment's entity), `task:<id>` for an assignment. The text is never copied.
- `status`: `unread` (default), `read`, and `pending` reserved for an outbound channel (email, push) that does not exist yet; nothing writes `pending` until one does. "Clear" deletes the row. Index (`userId`, `workspaceId`, `status`, `createdAt`); unique (`userId`, `entity`, `type`): the same sentence again does not add a row, it makes the existing one unread and new.

## Who writes

- `createComment(...)` (comments domain): inserts the comment, then one `mention` notification on `comment:<id>` for each `user:<id>` in `content`, minus the author, only workspace members, deduped.
- The tasks domain calls `createNotification` for each user newly added to `assignees` (type `assigned`, entity `task:<id>`), minus the actor, in the same transaction as the task write. Domains call plain functions and never read each other's tables.
- The tasks domain writes the activity events through `createEvent` (comments domain), in the same transaction as the task write and as its actor: `updateTask` one per changed field (the description writes none), `setTaskStatus` the status, `createTimesheet` the time logged (deleting a timesheet writes none). A change to the same value writes nothing; a from/to event by the same actor of the same kind within 5 minutes of the entity's newest row (that row) is merged into it, and deleted when it lands back on its `from`, so autosave does not flood the feed. Events never notify and are not searched.
- A status change, an autosave edit, or a comment on a task you merely follow notifies nobody. If people want "comments on my tasks" later, it is one more recipient rule inside `createComment`, not a new table.
- Deleting a comment deletes the notifications whose entity is `comment:<id>`. Editing a comment does not notify newly added mentions (not now).
- Agents comment as `agent:<id>`; agents receive no notification rows (waking agents is a separate mechanism).

## RPCs

`getComments(entity, page?)` (`comments:get`, returns `{items, more}`: comments and events oldest first, the newest `page.limit` (50, at most 500) before the item `page.before`; `more` = older items remain; the oldest page of a task starts with its synthesized `created` event, id `created-<taskId>`; another workspace's entity is an empty page), `createComment(entity, content)`, `updateComment(id, content, expectedUpdatedAt?)`, `deleteComment(id)`, `getNotifications()`, `setNotificationStatus(ids | 'all', status)`, `clearNotifications(ids | 'all')`, `getUnreadNotificationCount()`. The membership guard is the same single wrapper; a user only reads their own notifications.

## Live updates

The same `domain:changed` push as every domain (`comments` to the workspace's members, `notifications` only to the notified users). Task updates, status changes and logged time push `comments` too, so an open activity feed reloads.

## UI

- Task and project detail: a Comments section under the description (newest last, a comment box at the end; a comment is sent, not autosaved).
- Sidebar Inbox row: the unread count; the Inbox page is a list (chats list pattern): avatar, one line ("Maria mentioned you in Fix login", "Maria assigned you Ship v1"), time, unread dot; click opens the entity and marks read; "Mark all as read".
- Empty state "No notifications yet".

## Later

Group mentions, comments on library items and chats, per-user mute, email delivery (where `pending` is used), activity events on projects.

## As built

- Domains: `packages/shared/src/comments/` (`createComment`, `createEvent`, `getComments` (paged, comments and events), `getCommentsById`, `searchComments` (comments only), `updateComment`, `deleteComment`, `getMentions`; `EVENT_MERGE_MS`) and `notifications/` (`createNotification`, `getNotifications`, `updateNotificationStatus`, `deleteNotifications`, `deleteEntityNotifications`, `getUnreadCount`); the allow-lists are in `entities.ts` and `notifications/index.ts`. Tests build `:memory:` databases.
- RPCs: `handlers/rpc/comments.ts` (`comments:get|create|update|delete`; `get` takes `(entity, page?)` and returns `{items, more}` with the synthesized `created` event of a task; `create` checks that a task or project entity exists) and `notifications.ts` (`notifications:get|setStatus|clear|getUnreadCount`). `notifications:get` returns `{ id, type, status, createdAt, createdBy, entity, entityTitle, comment }`; for a `comment:<id>` entity `comment` is `{ id, content, entity }` and `entityTitle` is the title of the comment's own entity (null when gone). A click opens `comment?.entity ?? entity`.
- Events: `tasks/index.ts` (`updateTask`, `setTaskStatus(workspaceId, id, status, actor)`, `createTimesheet`) through `createEvent`; the agent CLI reads them with `otto comments list <entity> [page]`.
- Live updates: `handlers/rpc/domain-changes.ts` lists every write channel and the domains it makes stale. `notifications` is pushed to the people the write notifies (the task's assignees, the people a new comment mentions, the caller for their own inbox) and to the whole workspace when a comment is deleted.
- Pages: `components/comments/comment-thread.tsx` (`CommentThread({ entity })`: the Comments section with the `@` people picker that inserts `user:<id>`; on the task page, the project page next), `pages/inbox/inbox-page.tsx` (`/{ws}/inbox`, `?unread=1`) with the sidebar's unread count, and `components/entities/` (`EntityChip`, `EntityText`: a stored token drawn as a chip with its live title). The token regex is `ENTITY_TOKEN` (`entities.ts`), which `getMentions` uses too. UI rules in DESIGN.md (Comments, Inbox, Tags).
- Renderer: `hooks/use-comments.ts` (`useComments(entity)` gives `comments`, `loaded`, `refresh`, `createComment`, `updateComment`, `deleteComment`) and `hooks/use-notifications.ts` (`notifications`, `unreadCount`, `setStatus`, `clear`). API names: `getComments`, `createComment`, `updateComment`, `deleteComment`, `getNotifications`, `setNotificationStatus`, `clearNotifications`, `getUnreadNotificationCount`.
