# Chat rename validation

Input: the captured pre-rename tree (324 files, manifest `179ce60b…`, HEAD `084b76d`), run unchanged in its own process. Output: this checkout. Evidence is from private disposable PostgreSQL and controlled fixtures only; it is not a live transfer, provider isolation or billing proof.

## Same-database old input → offline rename → new code

An orchestrator started one private PostgreSQL. A separate process running the **old** Conversation code created, through its real HTTP API: two Conversations (one `participants`), human and Agent participants, a Message and a reply, a read cursor, a Project/Task with a `conversation` link, a script Run with its request identity, an enabled Schedule, a published frozen share, a retained Session/Environment scope, and the native queue jobs. That process exited, then `scripts/rename-chats.sql` ran, then a separate process running the **new** code used the same database.

| Check | Observed |
| --- | --- |
| Busy Run (`queued`) | refused `Quiescent Runs…`; tables and every row unchanged |
| Pre-existing `chats` table (mixed state) | refused `Expected only old Conversation tables`; unchanged |
| Rename | all 13 compared tables equal to before, modulo only top-level `conversationId`→`chatId` and Task-link `conversation`→`chat`; Run `requestIdentity`/`inputs`, Session `scope`, frozen share JSON and `queue.job` rows byte-equal; this early harness used a fixture `executionScope` string, so retained runtime scopes are covered by the correction below |
| Integrity | 436 public constraints, 0 invalid; an orphan Message insert is rejected by `messages_chatId_workspace_fk`; no `conversation`-named column, constraint or index remains |
| Repeat | refused; unchanged |
| New API | `GET /chats/:id` 200 with the original ID; `/conversations`, `/conversations/:id`, `/conversations/:id/messages` 404; Messages expose `chatId` and no `conversationId`; Message retry returns the original Message ID |
| Accepted Run retry | original `requestId` with `chatId` returns the original Run ID (`chatId`, no `conversationId`); a changed body is 409; the retired `conversationId` input is 400 |
| Frozen share | `GET /api/shares/:id` returns `type: "chat"` with the original two Message bodies; the owner's list shows a `chat` selection; the stored JSON stays `conversation` |
| Other | Task link `chat`, Session list 1, Schedule `chatId`, attention 200, new Chat create 200; repeated native `bun db:push` left the other compared tables (including queue jobs) equal; Chats and participants grew only by the one new Chat |

`tests/chats-transfer.test.ts` repeats the refusal/preservation/parity cases in the repository's own suite and compares constraint, index and column names with a fresh native push. Breaking the script (an omitted column rename, an omitted discriminator update) fails it.

## Checks

`bun install --frozen-lockfile`, `bun run check`, `bun run typecheck`, `check:boundaries` (17 packages), `check:consistency` (79 backend files), `bun run build` and `git diff --check` pass. The full Vitest suite under Bun passes: 36 files, 344 tests, no skips, including the actual published Pi plus the pinned Go gateway helper built from the unchanged gateway source with the official Go 1.26.0 linux-amd64 archive (SHA256 `aac1b08a…`). `go test ./...`, `go vet ./...`, `go mod verify` and `CGO_ENABLED=0 go build ./...` in `ops/gateway` pass. The Pi bridge, gateway source and tests, and `docs/evidence/content-share-sandbox.png` are byte-identical to the input; the screenshot test wrote to private storage.

## Correction: runtime-produced retained scopes

The earlier freeze serialized the Chat as `chatId` in the runtime's retained `executionScope` while populated Environments hold the historical `conversationId` key. Same-database probe (old input code, own process: a real prompt Run on one Agent and a real script Run on another, both finished, stable audience; `rename-chats.sql`; new code, own process), run against that earlier freeze: both new Runs on the retained Environments failed `admission_configuration_unavailable` (2 of 27 checks red). The runtime now serializes the Chat ID under the same private `conversationId` key, so the bytes equal the old code's; `bindExecutionScope`'s exact comparison and every saved scope are untouched.

Against the corrected source the same probe passes 27/27: both original `executionScope` byte strings unchanged in the database, a new prompt Run and a new script Run on the same Environments finish, and the scopes are unchanged afterwards. `chats-transfer.test.ts` now also produces prompt and script scopes through the real runtime before the rename, requires the `conversationId` key and no `chatId` in the stored bytes, and after the rename requires byte-equal scopes, new prompt and script Runs finishing on the same Environments, and a Run with a changed source set still refused with `admission_configuration_unavailable`.
