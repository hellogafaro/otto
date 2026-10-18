# Index lists

The Tasks, Projects, Routines and Library pages read their rows from the server one bounded page at a time instead of from the environment shell snapshot. The snapshot still carries what the shell itself needs; a list never asks for more than one page.

## Contract

- A list is one typed RPC per domain, named `<domain>.list` (`tasks.list`, `routines.list`, `projects.list`). There is no generic filter language, search domain or unified list endpoint.
- The query is a strict schema: that domain's own filters, a `sort` from its allowlist, an `order` (`asc` or `desc`, defaulting to the sort's natural order), an optional `limit` and an optional `cursor`. Unknown or malformed fields are rejected, never ignored on the server.
- A page holds at most 100 rows (`LIST_LIMIT_MAX`), and 100 when no limit is asked.
- The server filters and orders in SQL before the limit. Every sort ends with the row id, so each row has exactly one place and paging is stable.
- Paging is keyset, not offset: the next page starts strictly after the last row's sort key. The server returns that key as `nextCursor`, sealed with AES-GCM under a server secret together with the filter and order it belongs to. A client passes it back unread. A forged cursor, or one from a different filter, order or server, is refused rather than reinterpreted.
- A cursor never carries a value the caller could not read. When a domain hides rows per viewer, its query applies that visibility in the same SQL, before the limit, so neither the page nor the key after it comes from an unreadable row.
- A result may carry small aggregates over the whole filtered set that the page needs to render honestly, such as Tasks' per-status counts for its group bands.

## Tasks

`tasks.list` filters by `project`, `owner` and `assignee` (participant keys, `bot:<id>` or `person:<id>`), `status` (any of a comma list; none means everything but archived) and an inclusive `dueFrom`/`dueTo` range (undated tasks never match a bound). It sorts by `status` (moving work first, latest change first within it), `due` (undated last in either order), `updated`, `created` or `title`. Every workspace member reads every task, so no per-row visibility applies. Rows omit timesheets; a task page reads its own.

## Routines

`routines.list` filters by `status` (any of a comma list of `active`, `draft`, `paused` and `failed`, the status a routine's page shows; none means every routine) `bot` (one bot id), `search` (words in the title, any case) and `runFrom`/`runTo` (a routine whose next or last run falls in that range, which Home uses for today). It sorts by `status` (Active, Draft, Paused, Failed, latest change first within each), `next` (next run, unscheduled last in either order), `updated`, `created` or `title`. Deleted routines never list. A private routine (`visibility` `user`) lists only for the person who set it up, as everywhere else, and that check runs in the same SQL as the filter. Because what a viewer may read differs per person, a routine cursor is sealed to its viewer as well as its view, so one person's cursor is refused for another. Like Tasks, the result carries per-status counts for the group bands.

The shell snapshot carries no routines, runs, deleted-routine receipts or skill assignments; per-viewer routine events still stream. Each screen reads only what it shows into one per-environment routine cache: `routines.get` for a single routine's page (null when it is missing, deleted or private to someone else), `routines.list` for the Routines page, Home and the command palette (the newest 100 plus up to 100 title matches), and `routines.listThreadRuns`, which also returns a chat's routines (at most 100) and deleted-routine receipts. A counter of routine events and fresh snapshots tells open lists to reload.

## Projects

`projects.list` filters by `owner` (a participant key) and `status` (any of a comma list; none means everything but archived, and a project saved before statuses existed counts as in progress). It sorts by `updated` (the default), `created` or `title`. It never lists deleted projects or the General project. Every workspace member reads every project, so no per-row visibility applies. Rows carry what the Projects cards show: title, owner, status, cover and timestamps.

## Library

`library.list` lists one folder's level (`folder`, or the top level without it) or, with `everywhere`, the matching items of every folder, which the Documents, Images and Files tabs use. It filters by `type` (any of a comma list of `folder`, `document`, `image` and `file`, where `file` is PDFs and every other file) and `creator` (a participant key), and sorts by `updated` (the default), `created` or `title`, folders before files in either order. Folders and files live in separate tables, so one query unions them under a shared key: folders first, the sort value, then the id.

Visibility is applied in that same SQL exactly as the Library's rule (`canSeeLibraryItem`) decides it: a recursive pass finds, from the top down, the folders the person sees (a `user` folder only its creator; a chat's folder that chat's people, or only its creator once the chat or its group is gone), and an item is listed only when it passes the same check and every folder above it is seen. Public links are untouched. A Library cursor is sealed to the person as well as the view.

## Clients

The web page keeps the filter and sort in the URL, renders a virtualized table (or, for Projects and the Library, its card gallery with the pages loaded so far) and asks for the next page when the reader nears the end. When anything in the list changes it reloads the pages already shown, in place, so the reader keeps their position.
