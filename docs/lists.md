# Index lists

The Tasks, Projects, Routines and Library pages read their rows from the server one bounded page at a time instead of from the environment shell snapshot. The snapshot still carries what the shell itself needs; a list never asks for more than one page.

## Contract

- A list is one typed RPC per domain, named `<domain>.list` (`tasks.list`). There is no generic filter language, search domain or unified list endpoint.
- The query is a strict schema: that domain's own filters, a `sort` from its allowlist, an `order` (`asc` or `desc`, defaulting to the sort's natural order), an optional `limit` and an optional `cursor`. Unknown or malformed fields are rejected, never ignored on the server.
- A page holds at most 100 rows (`LIST_LIMIT_MAX`), and 100 when no limit is asked.
- The server filters and orders in SQL before the limit. Every sort ends with the row id, so each row has exactly one place and paging is stable.
- Paging is keyset, not offset: the next page starts strictly after the last row's sort key. The server returns that key as `nextCursor`, sealed with AES-GCM under a server secret together with the filter and order it belongs to. A client passes it back unread. A forged cursor, or one from a different filter, order or server, is refused rather than reinterpreted.
- A cursor never carries a value the caller could not read. When a domain hides rows per viewer, its query applies that visibility in the same SQL, before the limit, so neither the page nor the key after it comes from an unreadable row.
- A result may carry small aggregates over the whole filtered set that the page needs to render honestly, such as Tasks' per-status counts for its group bands.

## Tasks

`tasks.list` filters by `project`, `owner` and `assignee` (participant keys, `bot:<id>` or `person:<id>`), `status` (any of a comma list; none means everything but archived) and an inclusive `dueFrom`/`dueTo` range (undated tasks never match a bound). It sorts by `status` (moving work first, latest change first within it), `due` (undated last in either order), `updated`, `created` or `title`. Every workspace member reads every task, so no per-row visibility applies. Rows omit timesheets; a task page reads its own.

## Clients

The web page keeps the filter and sort in the URL, renders a virtualized table and asks for the next page when the reader nears the end. When anything in the list changes it reloads the pages already shown, in place, so the reader keeps their position.
