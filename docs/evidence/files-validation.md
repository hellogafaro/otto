# Files rename validation

Input: the captured pre-Files tree (329 files, manifest `79b1cc88…`, HEAD `084b76d`), run unchanged in its own process; output: this checkout. Private disposable PostgreSQL and controlled fixtures only. Not a live transfer, Garage durability, provider isolation or billing proof.

## Same-database old input → offline SQL → new code

One private PostgreSQL. A process running the **old** (Resources + Chats) code created, through real HTTP and the real runtime with the controlled computer fixture: two human users, a workspace File upload and a private File, a Resource-era Skill and an Artifact-era stored Skill form, a prompt Run (with the Skill's supporting file) and a script Run that both finished, a Chat Message and a Document attachment, a Task link, and two published frozen shares (one stored in the Artifact form). That process exited, `scripts/rename-files.sql` ran, then a separate process running the **new** code used the same database and disk-backed object store.

| Check | Observed |
| --- | --- |
| Refusals (all leave tables and rows unchanged) | busy Run, busy lease, pre-existing `files` table, extra `fileIds` column, mixed `file` link, leftover `artifact` link, un-renamed Chats, repeat |
| Rename | 13 compared tables equal modulo only the scalar names (`resources`→`files`, `resourceIds`→`fileIds`, link `resource`→`file`); Run `inputs`/`requestIdentity`, Session rows, `executionScope`, Skill and share JSON and `queue.job` rows byte-equal |
| Integrity | 436 public constraints, 0 invalid; the only remaining `resource` column is `connection_grants.resources` (native Connection grants) |
| Retired surface | `/resources` list/read/download/upload 404; `resourceIds` on a Message and `resourceId` on Skill files 400; `resource` share and link types 400 |
| New API | original File ID and bytes; exact upload retry returns the original File with no extra storage put; changed-metadata and changed-bytes retries 409 with no put; Document/Message `fileIds`; Task link `file` |
| Historical forms | Resource-era and Artifact-era Skills export `fileId` while stored JSON stays historical; both frozen shares read `type: "file"`, `fileType` with the original bytes while stored JSON stays `resource`/`artifact`; accepted Run `inputs` keep `artifactId`; accepted supporting-file bytes retrievable |
| Revocation | a second human reads a workspace File; private File 403; after the custodian makes it private the download is 403; a visibility change committed during storage I/O makes the download 403 |
| Real retained scopes | both original `executionScope` strings unchanged; a NEW prompt Run and a NEW script Run finish on the same Environments; an Agent `file.create` publication through a NEW Run records the Agent author and source Run; a changed source set is still refused (`admission_configuration_unavailable`); scopes unchanged after |
| Original evidence after the new process | original Runs, Sessions, shares, Skills and queue job `id/name/data` unchanged |
| Native push | repeated twice: `changed: true` on both the renamed database and a fresh database (known Drizzle Kit churn); constraint, index and column definitions (`pg_get_constraintdef`, `indexdef`, column types/defaults) identical before and after, identical to a fresh push, and every row unchanged |

Red observed during development, then fixed: a retired `resourceIds` Message field was silently dropped (non-strict body) and now returns 400; the renamed database differed from a fresh push only in PostgreSQL 18's `*_resourceIds_not_null` constraint names, now renamed by the script. `tests/files-transfer.test.ts` fails when the NOT NULL rename or the Task-link update is removed.

## Checks

`bun install --frozen-lockfile`, `bun run check`, `bun run typecheck` (including web), `check:boundaries` (17 packages), `check:consistency`, `bun run build` and `git diff --check` pass. The full Vitest suite under Bun passes: 37 files, 345 tests, no skips, including the actual published Pi plus the pinned Go gateway helper built from the unchanged source with Go 1.26.0. The Pi bridge, gateway source and tests are byte-identical to the input; the screenshot test wrote to private storage.
