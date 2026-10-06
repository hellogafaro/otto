# Comments and notifications

Status: decided (owner); backend, RPCs, live updates and hooks built (see As built), pages follow. Two tables, `comments` and `notifications`, one small domain each, no event log.

## Idea

People talk on a task or a project in **comments**. You hear about it through **notifications**, and a notification is always a *mention* of you: either you were @mentioned in a comment, or you were assigned. Nothing else notifies. There is no activity log: a status change or an assignment is not a row anywhere except the task itself (and the "assigned" notification). Mentions are the one concept; groups (`@assignees`, `@everyone`) are later tokens expanded by the same resolver.

## Naming

An **entity** is anything with an identity, written as a typed reference `<type>:<id>` (`task:<id>`, `comment:<id>`). The column is `entity`, and the allow-list of types is `ENTITY_TYPES` (discriminators are `type` everywhere). It avoids "subject" (in OAuth and auth that is who acts) and "resource" (here that is the `{type, ref}` links attached to tasks and projects).

## Data

`comments(id, workspaceId, entity, createdBy, content, createdAt, updatedAt)`
- `entity`: what the comment is on, any typed reference `<type>:<id>` (`task`, `project` now; `comment` is allowed so replies work later; `library`, `chat` when they get comments). The allow-list is one constant (`ENTITY_TYPES`, `packages/shared/src/entities.ts`): a new type is one line, never a schema change. The same string shape as actors. Index (`workspaceId`, `entity`, `createdAt`).
- `createdBy`: `user:<id>` or `agent:<id>`, filled by the server.
- `content`: markdown (the task editor's). A mention is the token `user:<id>` that the editor inserts (picker later; the server finds it with a regex).
- Authors edit (`updatedAt`) and hard-delete their own comments.

`notifications(id, userId, workspaceId, entity, type, createdBy, status, createdAt)`
- One row per recipient, read as a sentence: `createdBy` `type` you on `entity`. `type` is an open verb, validated in code against `NOTIFICATION_TYPES` (`mention`, `assigned` now; later `comment`, `reply`, `shared`...), with no CHECK in the database.
- `entity` is where it happened: `comment:<id>` for a mention (the comment holds the text and its own `entity`, so a click goes to the comment's entity), `task:<id>` for an assignment. The text is never copied.
- `status`: `unread` (default), `read`, and `pending` reserved for an outbound channel (email, push) that does not exist yet; nothing writes `pending` until one does. "Clear" deletes the row. Index (`userId`, `workspaceId`, `status`, `createdAt`); unique (`userId`, `entity`, `type`): the same sentence again does not add a row, it makes the existing one unread and new.

## Who writes

- `createComment(...)` (comments domain): inserts the comment, then one `mention` notification on `comment:<id>` for each `user:<id>` in `content`, minus the author, only workspace members, deduped.
- The tasks domain calls `createNotification` for each user newly added to `assignees` (type `assigned`, entity `task:<id>`), minus the actor, in the same transaction as the task write. Domains call plain functions and never read each other's tables.
- A status change, an autosave edit, or a comment on a task you merely follow notifies nobody. If people want "comments on my tasks" later, it is one more recipient rule inside `createComment`, not a new table.
- Deleting a comment deletes the notifications whose entity is `comment:<id>`. Editing a comment does not notify newly added mentions (not now).
- Agents comment as `agent:<id>`; agents receive no notification rows (waking agents is a separate mechanism).

## RPCs

`getComments(entity)`, `createComment(entity, content)`, `updateComment(id, content, expectedUpdatedAt?)`, `deleteComment(id)`, `getNotifications()`, `setNotificationStatus(ids | 'all', status)`, `clearNotifications(ids | 'all')`, `getUnreadNotificationCount()`. The membership guard is the same single wrapper; a user only reads their own notifications.

## Live updates

The same `domain:changed` push as every domain (`comments` to the workspace's members, `notifications` only to the notified users).

## UI

- Task and project detail: a Comments section under the description (newest last, a comment box at the end; a comment is sent, not autosaved).
- Sidebar Inbox row: the unread count; the Inbox page is a list (chats list pattern): avatar, one line ("Maria mentioned you in Fix login", "Maria assigned you Ship v1"), time, unread dot; click opens the entity and marks read; "Mark all as read".
- Empty state "No notifications yet".

## Later

Group mentions, comments on library items and chats, per-user mute, email delivery (where `pending` is used), status events on the task timeline if people ask for them.

## As built

- Domains: `packages/shared/src/comments/` (`createComment`, `getComments`, `getCommentsById`, `updateComment`, `deleteComment`, `getMentions`) and `notifications/` (`createNotification`, `getNotifications`, `updateNotificationStatus`, `deleteNotifications`, `deleteEntityNotifications`, `getUnreadCount`); the allow-lists are in `entities.ts` and `notifications/index.ts`. Tests build `:memory:` databases.
- RPCs: `handlers/rpc/comments.ts` (`comments:get|create|update|delete`; `create` checks that a task or project entity exists) and `notifications.ts` (`notifications:get|setStatus|clear|getUnreadCount`). `notifications:get` returns `{ id, type, status, createdAt, createdBy, entity, entityTitle, comment }`; for a `comment:<id>` entity `comment` is `{ id, content, entity }` and `entityTitle` is the title of the comment's own entity (null when gone). A click opens `comment?.entity ?? entity`.
- Live updates: `handlers/rpc/domain-changes.ts` lists every write channel and the domains it makes stale. `notifications` is pushed to the people the write notifies (the task's assignees, the people a new comment mentions, the caller for their own inbox) and to the whole workspace when a comment is deleted.
- Pages: `components/comments/comment-thread.tsx` (`CommentThread({ entity })`: the Comments section with the `@` people picker that inserts `user:<id>`; on the task page, the project page next), `pages/inbox/inbox-page.tsx` (`/{ws}/inbox`, `?unread=1`) with the sidebar's unread count, and `components/entities/` (`EntityChip`, `EntityText`: a stored token drawn as a chip with its live title). The token regex is `ENTITY_TOKEN` (`entities.ts`), which `getMentions` uses too. UI rules in DESIGN.md (Comments, Inbox, Tags).
- Renderer: `hooks/use-comments.ts` (`useComments(entity)` gives `comments`, `loaded`, `refresh`, `createComment`, `updateComment`, `deleteComment`) and `hooks/use-notifications.ts` (`notifications`, `unreadCount`, `setStatus`, `clear`). API names: `getComments`, `createComment`, `updateComment`, `deleteComment`, `getNotifications`, `setNotificationStatus`, `clearNotifications`, `getUnreadNotificationCount`.
