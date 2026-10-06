# Projects and tasks

Three domains in `packages/shared/src`: `projects` (and its members), `tasks` and the time logged on them (timesheets, inside `tasks`). Plain functions that take the workspace id first, failures thrown with `domainError(code, message)` from `@otto/shared/utils` (`not_found`, `conflict`, `invalid`; the RPC response error carries that `code` so the UI can tell `conflict` from `not_found`), RPCs `projects:*`, `tasks:*`, `timesheets:*`.

## Data

- `projects(id, workspaceId, title, description, status, resources, createdAt, updatedAt)`
- `projects_members(projectId, actor, role)`, primary key (`projectId`, `actor`); `role` is `contributor` or `viewer`.
- `tasks(id, workspaceId, projectId, title, description, status, dueAt, assignees, resources, createdBy, createdAt, updatedAt)`
- `timesheets(id, workspaceId, taskId, createdBy, createdAt, time, notes)`

Join and child tables name both words in the plural (`projects_members`).

## Rules

- Statuses: projects `active`, `archived`, `deleted`; tasks `todo`, `doing`, `done`, `archived`, `deleted`. Archiving and deleting only set the status: there is no hard delete and no archived flag. Lists hide `archived` and `deleted` unless `status` asks for them; restoring is setting `active` / `todo`. A deleted row cannot be edited until restored. Tasks sort by `doing`, `todo`, `done`, then newest update.
- `resources` (project and task): JSON array of `{ type: 'url' | 'library' | 'chat', title, ref }`, at most 50. `ref` is an http(s) URL, a library item id or a chat id; library and chat refs are not looked up and may dangle. Files that belong to a project are library items referenced here.
- Actors are `'user'` or `'agent:<id>'` (`'agent:default'` until agents are modeled). `createdBy`, `assignees` (deduplicated, at most 20) and members are actors. `getTasks({ assignee })` filters with SQLite `json_each`.
- A task belongs to one project of the same workspace, which must exist and not be deleted when the task is created or moved there. Tasks stay when their project is archived or deleted.
- `updateProject` / `updateTask` take `expectedUpdatedAt`; a different stored `updatedAt` is a `conflict` and nothing changes.
- `time` is whole milliseconds, 1 to 24 hours per entry; `notes` at most 4000 characters. `getTaskTime` sums a task's entries. Timesheets have no status and are deleted for real.
- The creator of a project becomes a contributor. Roles are data only: nothing enforces them until users exist.
- A chat binds to a project by `projectId` (session metadata). The agent prompt gets the project's title, description and resources (`getProjectPromptContext`); an unknown or deleted id adds nothing. The old file-based projects (config, memory file, assets folder, working directory, color) are gone and their folders are ignored.

## Not built

The Projects and Tasks pages (they stay empty states), a project picker for chats, timers, authorization, and a change broadcast.
