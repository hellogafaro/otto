# Operations lane handoff

Baseline: `03192913bfc93a733e721d270b5cd1c98c0a2c34`. Lane: `thr_dq35gzttru`; coordinating thread: `thr_g6sbbikxpg`; main integrator: `thr_kfugrrgbs4`.

Implemented server config validation, safe startup/shutdown and partial cleanup, migration serialization, dependency readiness, verification/reset delivery through a small Resend boundary, private S3 integrity/reconciliation, workspace member-directory/role operations, and self-host configuration/runbook. No package or lockfile mutation was needed beyond the frozen install. No product UI code changed.

Verified: 63 tests in 9 suites, Biome, TypeScript, boundaries, generated build, shell/YAML/TOML syntax, and the official Garage binary version. See [the evidence](operations-proof.md) and [operator runbook](../operations.md). The real server process and auth/local-mail-sink flow ran against private PostgreSQL. The S3 fixture deliberately ignores conditional writes; it is not Garage service proof.

## Main integration contract

- `startServer(config)` returns `{ server, stop, isReady }`; `createApp(options?, { isReady(): Promise<boolean> })` adds `/ready`.
- `createAuth(db, secret, origin, mail?: Mail | null)`: production always supplies a sender or null. Null requires verified login and disables signup. Undefined retains the reviewed in-process auth fixture behavior; do not use that fixture composition in production.
- `Mail.send({ to, subject, text, key }): Promise<void>`; `createResendMail({from, apiKey})` uses a fixed production HTTPS endpoint. A test-only injected fetch redirects to a local sink. Main must compose invitation delivery after the invitation transaction commits and expose sent/unavailable/uncertain status rather than claim delivery on an error. Explicit retry can call `getInvitation` under current authorization before sending.
- `getMembers(c, {after?})` returns `{members:[{userId,name,role}],next?}`; `updateMemberRole(c,userId,role)` accepts admin/contributor/viewer. It protects owner/admin authority. Main must run `assertNoOpenOwnedTasks` and `assertNoOwnedAutomations` before demotion to viewer in the same workspace transaction. `deleteMember` replaces `removeMember`; preserve its existing composed ownership checks. Member/invite route transport proof remains pending main composition.
- Workspace numeric replay property is `cursor: integer("revision")`; `advanceCursor(c)` and `getCursor(c)` return a number. This preserves stored values without a rename migration. Main/content own caller and wire-field updates in their lanes.
- Queue callers use `startQueue(db,pool,{workers?,install?,runtime?})`, with default options. Main owns the authoritative `queue.ts` and its cleanup. Both migration and runtime reject an existing `otto_jobs` schema; pending jobs must not be silently abandoned.
- Storage `put/get` signatures remain unchanged. Content's `createArtifact` must write new keys as `workspaceId/intentUuid/sha256`. Adapter validates bytes, GET-reconciles exact existing bytes, and GET-verifies a new PUT. Correctness does not depend on `If-None-Match`, which pinned Garage source ignores. Legacy saved reads/existing exact retries work; missing legacy pending bytes fail explicitly and retain the intent for operator recovery. No key/byte replacement or version history is introduced.

The [source manifest](operations-source.json) records every tested source hash and queue provenance. The queue copy now matches main exactly at capture. The isolated test checkout has an unstaged integration overlay: main's queue module plus only required queue/cursor/deleteMember caller renames in baseline tests/domains. Those files are not staged as ops ownership. Main must compose the committed lane files with its own queue/options/naming implementation, content digest-key creation, and actual invitation/member routes, then rerun the integrated suite. The standalone lane commit intentionally depends on those coordinated interface changes.

## Files owned by this lane

- `apps/server/src/app.ts`, `auth.ts`, `index.ts`, `config.ts`, `lifecycle.ts`, `mail.ts`
- `packages/artifacts/src/storage.ts`
- `packages/workspaces/src/index.ts`, `schema.ts`
- `scripts/migrate.ts`, `health.ts`
- `.dockerignore`, `ops/Dockerfile`, `Caddyfile`, `compose.yaml`, `garage.toml`, `run.sh`
- `tests/operations.test.ts`, `storage-boundary.test.ts`, `workspace-members.test.ts`
- `docs/operations.md`, `docs/evidence/operations-proof.md`, this handoff

Unverified external boundaries: no verified Otto Infisical scope is linked; no credential was read from another project or provisioned outside the store. Docker is absent. Real Garage startup, S3 access/conditional behavior, restart durability and coordinated PostgreSQL+Garage backup/restore remain blocked. Compose/Caddy deployment is unverified. The runbook describes a cold coordinated encrypted recovery procedure but does not claim a completed rehearsal. No external mail, deployment, push, remote creation or Notion work occurred. Compute remains deferred.

Root must commission the independent Otto review on the composed result. Actual human work time is unknown; agent runtime is not human time.
