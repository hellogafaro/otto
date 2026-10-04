# Folders and larger uploads validation

Input: the captured main tree (334 files, manifest `4be73f2e…`, HEAD `084b76d`). Private disposable PostgreSQL, the real server entry process (`apps/server/src/index.ts`), the real AWS S3 client and a controlled S3-compatible HTTP peer (`tests/fixtures/s3-peer.ts`). The peer is not Garage and proves no durability, authentication or multipart behavior; memory figures are for this fixture on one machine.

## Baseline before any change (input tree, same harness)

| Request | Observed |
| --- | --- |
| `POST /folders`, `GET /folders`, `GET /library` | 404 |
| 50 MB binary `PUT` to the new upload route | 413 (global 1 MiB cap; no such route) |
| JSON/base64 upload of about 2 MB and 50 MB | 413 |
| AWS adapter `put` of 9 MiB | `Invalid object bytes` (8 MiB limit in the domain, adapter and database check) |

## After

| Check | Observed |
| --- | --- |
| 50 MB and 100,000,000 B upload, then download | digest-exact; one storage put and one object each; upload 248 ms / 300 ms, download 187 ms / 306 ms |
| Server resident memory (kernel `VmHWM`) | idle 132 MB; peak 187 MB after 50 MB and 189 MB after 100 MB (does not grow with size); 226 MB while an 80 MB upload and a 60 MB download ran together |
| Unrelated `/ready` + API requests during that transfer | slowest 95 ms |
| 100,000,001 B | 413 for a declared length (answered in under 2.5 s without reading the body) and for a chunked stream; no row, object or spool file remains |
| No `Content-Length` (chunked); short body; mid-body disconnect | chunked accepted and digest-exact; short and abandoned bodies save nothing and free the spool |
| Denial before any body byte (100 MB declared, never sent) | unauthenticated 401, foreign origin 403, viewer 403, non-member 403, invalid metadata 400, unknown folder 404, each in under 2.5 s |
| Retries | exact retry returns the same File with no new put; changed bytes, changed length and changed metadata 409; two concurrent exact retries converge on one row; first folder placement wins |
| Storage failure and lost acknowledgement | request fails 5xx and leaves one hidden pending intent; the retry saves it once with exactly one object |
| Corrupt or truncated stored object | the download answers an error with no file bytes |
| Revocation during storage I/O and during delivery | the first yields 403; the second truncates the response after the re-check; abandoned downloads release their disk lease |
| Disk budget | a second transfer is refused 503 while one holds the budget, accepted after it ends; a full disk maps to 503 |
| Small consumers | a 12 MB File cannot be attached to a Skill (400) or previewed as sandboxed HTML (400); its public frozen download streams digest-exact and a revocation during storage I/O gives 404 |
| Folders (`folders.test.ts`, 8 tests) | nesting, depth 8, cycles including a concurrent crossing move, placement and privacy rules, empty-only archive with hidden and archived children, mixed library paging, atomic Document edits; removing the cycle, emptiness or user-folder rule turns the suite red |
| Populated database (exact input process → native push → new code) | rows, queue jobs, Run/Session/scope/Skill/share bytes unchanged and every `folderId` null; the 8 MiB `files_size` check is replaced by `files_size_100000000` (8,388,609 and 100,000,000 accepted by direct write; 100,000,001 and −1 rejected); repeated pushes keep data and definitions; constraints, indexes and columns equal a fresh push; 26 new-code checks pass including a 20 MB upload above the former limit, an exact binary retry of an original JSON upload, folder moves of existing Files and Documents, and two new Runs on the retained scopes |

Native push does not re-diff a changed CHECK expression, so the limit is part of the constraint name. Repeated native push still reports `changed: true` as it does on a fresh database; definitions and rows were identical before and after.

## Corrections after independent review

An independent review of the first freeze reproduced five defects, each now fixed with a regression that turns red when the fix is removed (fast `file-delivery.test.ts` for delivery behavior; `uploads.test.ts` through the real server process for the rest):

| Finding | Correction | Evidence |
| --- | --- | --- |
| HEAD on a download route ran the spool delivery and never consumed it (five anonymous 100 MB HEADs held 500 MB and every transfer answered 503) | HEAD returns the authorized GET headers plus `X-File-Size` with no storage read, spool or lease; an unconsumed body self-releases at the stall limit | six HEADs leave 0 spool files, 0 storage reads and the full budget; mutation: HEAD runs the delivery turns red |
| A failed S3 put leaked an open descriptor on an unlinked spool file | the file body is destroyed and joined in `finally`; the copy loops cancel their source and close and join their file on every exit; accounting is released only afterwards | 10 failed and 4 reset puts leave 0 descriptors in the server process; mutation: body left open turns red |
| Binary put trusted HEAD size and self-reported metadata, so silent corruption and a lost acknowledgement over it could publish | the stored bytes are streamed back through SHA-256 after the put and when reconciling a retry; metadata is never trusted | silently corrupted store: upload 500, intent stays pending, never listed; with a lost acknowledgement the same; mutation: verification removed turns red |
| Bun's 30 s idle timeout closed a download before the first byte while S3 verification was pending | the idle timeout is disabled on the two transfer routes only, replaced by explicit receive/storage/delivery deadlines and a stall limit | download whose storage read takes 35.7 s completes digest-exact; reviewer probe: 100 MB at 2.5 and 3.2 MB/s completes |
| Disabling the idle timeout left completed or refused transfer connections open forever (reviewer p21/p22) | the timeout is disabled only after admission and every admitted transfer response closes its connection (`Connection: close`); Bun cannot re-arm a per-connection timeout | `uploads.test.ts` keep-alive raw-socket test red on the previous tree, green on the fix, red again with `Connection: close` removed; slow-verification raw socket >30 s still delivers its first byte; reviewer probes p21/p22/p19 rerun on the fixed tree |
| No total delivery deadline: a steady slow anonymous reader held 100 MB for hours | total deadline (`TRANSFER_BASE_MS` + size at `TRANSFER_MIN_BYTES_PER_SECOND`) and stall limit, both joined before release; anonymous readers capped at half of the budget but never below one maximum File | slow reader cut at the deadline in under 8 s, non-reading client released at the stall limit, silent chunked upload answered 503 in under 6 s, steady upload answered 503 and the connection closed; mutations: total deadline, stall limit, upload deadline, upload idle limit each turn red |

Also: the authority re-check now runs before disclosing beyond each 4 MiB or 2 s and before the final chunk (mutations of both turn `file-delivery.test.ts` red); reads are demand-driven. Measured on loopback, a revocation committed during a 100 MB delivery let 13 MB arrive afterwards (the reviewer measured about 31 MB before); bytes already in socket and kernel buffers cannot be recalled. A republished share during delivery setup now answers 404, and a mismatching `X-Content-SHA256` is refused (both have regressions). Server memory with the corrections: idle 131 MB, peak 211 MB after a 100 MB round trip, 237 MB with an 80 MB upload and a 60 MB download together.

## Checks

`bun install --frozen-lockfile`, `bun run check`, `bun run typecheck` (including web), `check:boundaries`, `check:consistency`, `bun run build` and `git diff --check` pass; the full Vitest run, which includes the actual published Pi plus the pinned Go helper built from the unchanged source, is recorded in the handoff. An earlier full run on the first revision failed in `pi-gateway-runtime.test.ts` (a cascade that began at a Stop returning 503); that file passed alone (19/19) and in the later full runs, and the cause was not established.
