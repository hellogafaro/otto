# Independent Task timesheets review

Verdict: **PASS**. No required findings. This is independent acceptance of the exact frozen bytes specified below, not of a later revision. The reviewer used only the assigned isolated baseline checkout and immutable thread-storage artifacts; the author main checkout and separate UI worktree were not inspected or changed.

## Reviewed source and archive

Baseline: `084b76d23abb3a5880474af73cee991d090e0d68`.

- `source.json` SHA256: `105843dc2ba6eac7616c9c3cda2518c8fbd93f0eea68ab293dbff1f1d64b7834`
- `source.tar.gz` SHA256: `c05e89fe37cd4dc9ac2d204f4d53e12e5eaca0a45bb82d5df855801046995f13`
- `delta.tar.gz` SHA256: `842026a9e0863c9fb304aaa4647d2f84a4cf5102b45d7be48c24aaf067c88962`
- `input-relative.patch` SHA256: `3d8e65ca6275ac276e5ca6fbd3569ed5c5796739eec3529c3cd3694cefbb6a46`
- `proof.json` SHA256: `fc690414db645a2a0c9d4cd40e1e0ea8c5750017d3d653f2a96f21ab4510389b`

Verified safe regular-file members, exact paths, no absolute/traversal/symlink/deletion entries, no duplicate archive members, all 302 full-source file hashes. Delta contains exactly seven changed files and one new file. The other 294 baseline fingerprints remain unchanged, including UI, package/lock/setup, Pi/gateway and historical evidence. Final HEAD/index/source checks pass after all review commands.

| Changed/added file | SHA256 |
| --- | --- |
| `AGENTS.md` | `bf7f3ccd96d41546730d95ddcb9acb0846482991eaa1c2f3826f7617fef0e80c` |
| `apps/server/src/collaboration-api.ts` | `4966d491d6cbc2118b5de5710e33c4629820b5e619ca0e024e4c9b054ef3304e` |
| `docs/otto/README.md` | `f5ea9d3b579572ae8363e7154593cb381e878275f3131f22b6fb414168e5c5c2` |
| `docs/otto/code-principles.md` | `b69348587d4919a5f6dd4ff6607ed90ef5c69ed0ba8d136ab1b0c0d843469d59` |
| `docs/otto/plan.md` | `709a0e4fb668d2eca4fd554bb52d766e00862641f1ccdd2af77a7cee8ddb4332` |
| `packages/tasks/src/index.ts` | `deb7b5a537417a73c371bede596f3abd67b2e644da39ea6377d34171dcfa5b9e` |
| `packages/tasks/src/schema.ts` | `fcdf99747e394d21b72b21d727901ca8dd153b556dc83d97d485738f73c6543d` |
| `tests/timesheets.test.ts` | `ddbc186d8887f4a634067942d329e7868ed389ae247a69743b66ce2facc2e050` |

## Inspection and real behavior

One Tasks-owned table with positive PostgreSQL integer minutes, nullable bounded UTF8 notes, nonnullable server-default logging timestamp, human FK, and same-workspace Task FK. No new dependency/domain/framework/timer/billing/stored total/runtime-derived time. The API reuses Better Auth, origin, server human identity, workspace transaction and Hono inferred route types. Domain mutations explicitly allowlist duration/notes and retain immutable author/date/Task/workspace. Current Task/Project authorization and human/creator checks remain required on corrections/deletion, with no owner/admin bypass. List queries authorize the required Task before selecting its bounded entries; exclusive UUID position is independent of row existence. Runtime operation imports remain acyclic.

Independently read every new assertion before executing the actual production HTTP/auth/private PostgreSQL seams. Seven affected suites (timesheets, collaboration, membership transport, workspace members, schema, pagination and transport) verified 25 tests. Timesheet cases themselves verify real HTTP 200 writes/server-owned fields; HTTP 400 forged/backdated/reassigned/invalid inputs; viewer 403, other-creator/admin 403, foreign 404, missing-login 401 and origin 403; direct Agent writes forbidden and invalid domain inputs; rows/cursor unchanged on denial; Task/author/date/cursor bounds and continuation after deleting cursor row; Done/archive corrections and member removal; SQL 23503 FK, 23514 check, 22P02 fractional integer and 22003 overflow refusals; two native pushes preserve timesheet rows/constraints and pending queue delivery. Schema suite independently verifies fresh native bootstrap, repeated constraints/indexes/data and exact queue-owned objects/job preservation. Direct schema access is limited to controlled fixtures in disposable private databases.

Additional probes cover the material gaps in those original assertions:

| Real input | Observed result |
| --- | --- |
| Native push on populated private baseline-shaped schema lacking timesheets | Added empty table; exact Task/Project rows, baseline constraints, cursor and pending queue delivery preserved |
| Non-owner contributor logs max integer minutes/4000 UTF8 bytes then duration-only correction | HTTP 200; own author retained, notes and all immutable fields retained, cursor +1, other rows/Tasks/Projects unchanged |
| Project viewer still owns saved entry | GET/list 200; own PATCH/DELETE/create 403; exact entries/cursor unchanged |
| Workspace viewer still owns saved entry | GET/list 200; own PATCH/DELETE/create 403; exact entries/cursor unchanged |
| Direct-domain backdate/forged creator/bad UUID/bounds, nonmember actor and Agent mutations | invalid/forbidden; exact entries/cursor unchanged |
| Successful domain create/update/delete followed by transaction failure | Each fully rolls back entry/cursor changes |
| Exact logging-date fixture entries at lower/upper timestamp and equivalent +02:00 offsets | from includes lower; to excludes upper; same page across offsets |
| Done + archived Task + archived Project, current contributor own logging/correction/deletion | All HTTP 200 under current authority |
| Creator deletes one entry and repeats deletion | 200 then 404; first removes exact row/cursor+1, repeat has no effects; unrelated Task/Project/entries unchanged |
| Own server/queue/private PostgreSQL cleanup | Joined; own disposable data/socket directory absent |

The exact timestamp endpoint probes use clearly controlled fixture timestamps in the private DB; server-owned current logging timestamps are separately tested through authenticated production creation. These are backend proofs; no provider isolation, account, billing or storage certification is claimed.

## Checks

- `affected-tests-rerun.log`: PASS: 25/25 across 7 suites (19.25s).
- `types-rerun.log`: PASS: backend and web.
- `biome-rerun.log`: PASS: changed TypeScript files.
- `boundaries.log`: PASS: 17 packages and operation DAG.
- `consistency.log`: PASS: 78 backend files and 133 routes.
- `whitespace.log`: PASS.
- `build.log`: PASS.
- `adversarial.log`: PASS: 10 observation groups; fixture cleanup verified.

Failed prerequisite, resolved: initial test/type/format commands could not find local dependencies in the fresh worktree. Original failure logs are retained; verified package name `otto` then ran `bun install --frozen-lockfile` with explicit assigned cwd. No package or lock bytes changed. All applicable reruns passed. There are no unresolved failed checks.

Unverified/outside this additive slice: broad unaffected runtime/Pi/gateway suites, native Go provider-helper qualification, real providers/accounts/billing, live databases, and UI/browser behavior. No new UI or runtime/gateway bytes changed; these are not acceptance requirements for this amendment. The affected suites and probes do not use the native Go/Pi helper, so no missing helper prerequisite was skipped. Original author evidence hashes (18 files) were verified and preserved. No broad baseline suites were run during preparation.

Own Bun test/probe/type/build processes ended; own HTTP/pg-boss/private PostgreSQL fixtures were joined and disposable data/socket removed. No shared DB, credentials, secret operations, source fixes, commits, staging, remote writes, Notion or UI checkout access. Actual human time unknown.

## Standalone copyable review

Independent configured Otto review: PASS, no required findings. Reviewed baseline 084b76d23abb3a5880474af73cee991d090e0d68 + frozen source.json 105843dc2ba6eac7616c9c3cda2518c8fbd93f0eea68ab293dbff1f1d64b7834, full archive c05e89fe37cd4dc9ac2d204f4d53e12e5eaca0a45bb82d5df855801046995f13 and delta 842026a9e0863c9fb304aaa4647d2f84a4cf5102b45d7be48c24aaf067c88962. All 302 source hashes and 294 protected baseline hashes remained unchanged; no author checkout inspected or source edited. Independently inspected schema/domain/Hono/auth/docs and exercised 25 affected tests across 7 suites plus focused real HTTP/private PostgreSQL probes for own non-owner corrections, revoked authored-entry writes, exact timestamp filters, rollback, archive states, exact deletion side effects and additive populated push/queue preservation. Type/Biome/DAG/consistency/whitespace/build pass. Creator/date/bindings immutable; human whole-minute entries remain separate from Agent runtime. No unresolved failures. Own fixtures cleaned. Broad unaffected runtime/provider and UI behavior were not rerun or requalified. Acceptance covers only these frozen bytes. Actual human time unknown.
