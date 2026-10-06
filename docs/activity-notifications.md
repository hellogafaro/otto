# Activity, comments and notifications (plan)

Status: proposal, nothing built. Two tables (`activity`, singular like `library`: it already groups everything; and `notifications`), one small domain each, no new framework.

## Idea

A comment is just one kind of activity. Everything that happens to a task or project (created, status changed, assigned, commented) is one append-only row in `activity`. An inbox item is one row in `notifications` that points at an activity for one user. No comments table, no separate event bus.

## Data

`activity(id, workspaceId, subject, type, createdBy, content, createdAt, updatedAt)`
- `subject`: a typed reference to what it happened to, `task:<id>` or `project:<id>` (later `library:<id>`, `chat:<id>`), the same string shape as actors. One column, no `subjectType`/`subjectId` pair. Index (`workspaceId`, `subject`, `createdAt`).
- `type` (discriminator): `comment`, `status`, `assigned`, `unassigned`. There is no `created` (a task already has `createdBy`/`createdAt`; creating a task with assignees writes `assigned` rows) and no `updated`.
- `createdBy`: `user:<id>` or `agent:<id>`, filled by the server. The same column name as every other table: "who made this row". The word "actor" stays the name of the value's shape (an actor string), and of `projects_members.actor`, where it is the member and not an author.
- `content`: one text column. A `comment`: its markdown (the task editor's). A `status`: the new status (`done`). `assigned` / `unassigned`: the actor string added or removed (one row per person). No JSON, no `from` value: "Maria set the status to Done" is enough.
- `updatedAt` changes only when the author edits a comment; the author may delete their comment (hard delete, its notifications go with it). Everything else is immutable.

`notifications(id, userId, activityId, status, createdAt)`
- One row per recipient; the workspace comes from the activity. `status` (text): `unread` (default), `read`, and `pending` reserved for a notification queued for an outbound channel (email, push) that does not exist yet; nothing writes `pending` until a channel exists. "Clear" deletes the row. Index (`userId`, `status`, `createdAt`); unique (`userId`, `activityId`).
- The text is never copied: the inbox reads the activity.

## Who writes

- The `activity` domain exposes one function: `createActivity({ workspaceId, subject, type, createdBy, content?, notify })`. It inserts the activity, then a notification for each user in `notify` plus every `user:<id>` mentioned in `content`, minus the actor, only if that user is a workspace member. It never reads the tasks or projects tables.
- The tasks and projects domains call it inside their own write transaction and pass `notify` themselves: the task's assignees and creator; for a comment also whoever commented before. A domain write that fails writes nothing.
- Edits made by autosave (title, description, due date) are NOT activity: only status changes, assignment and comments are. Otherwise autosave floods the log.
- Agents comment through the same function as `agent:<id>`; agents get no notification rows (a later wake-up mechanism, not an inbox).

## RPCs

`activity:get(subject)` (members), `activity:comment`, `activity:updateComment`, `activity:deleteComment`, `notifications:get` (mine, newest first, with the activity and the subject title), `notifications:setStatus(id | all, status)` (mark read / unread), `notifications:clear(id | all)`. The guard (membership) is the same single wrapper as everywhere; a user only reads their own notifications.

## Live updates

The same domain-change push as everything else (`activity` filtered by workspace members, `notifications` filtered to the user), so a comment appears for the other person at once and the inbox badge counts without polling.

## UI

- Task and project detail: an Activity section under the description (comments and events in one timeline, newest last, a comment box at the end: Enter-modifier submit, not autosave: a comment is sent, not drafted).
- Sidebar Inbox row: a count of unread; the Inbox page is a list (the chats list pattern): actor avatar, one line ("Maria commented on Fix login", "Assigned to you: Ship v1"), time, unread dot; click opens the subject and marks read; "Mark all as read".
- Empty state "No notifications yet".

## Order

1. Domain + RPCs + tests (Sonnet), tasks and projects call `createActivity` (status, assignment, creation).
2. Activity section on the task and project pages and the Inbox page (Opus).
3. Later: mentions picker in the comment box, library items and chats as subjects, per-user mute.

## Not now

Providers in the database (a `providers` domain with `secretId`, replaces the connection files), automations that run a routine in a chat (needs the chat to project/task link first), chats in SQLite.
