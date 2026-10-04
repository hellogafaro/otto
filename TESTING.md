# Testing Otto

Run commands from the Otto repository root with Bun 1.4.2 or later. The runtime checks below use Vitest 5.0.3 under Bun, not `bun test` or a Node worker.

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run check:boundaries
bun run check:consistency
bun run test
PLAYWRIGHT_SKIP_BROWSER_GC=1 bun --bun playwright install chromium
bun run test:browser
```

`bun run test` starts real PostgreSQL 18.4 from the pinned development binary package. Each suite creates a disposable data directory and a private 0700 Unix socket, disables TCP, runs native Drizzle push for declared public tables and pg-boss construction SQL, and stops its own process. It does not use a shared DB or require an Infisical secret. The test helper runs the binary package's symlink hydration script because that optional dependency setup is not executed by this Bun install. PostgreSQL fixture auth uses local trust inside the private socket directory; this is not production configuration.

The collaboration suite exercises Better Auth, bootstrap, invitations, workspace/project authorization and tasks. The Run suite exercises atomic rollback, exact snapshots, duplicate queue delivery, schedule reconciliation, Session scope and recovery fencing. The transport suite starts a real Bun HTTP/WebSocket server, uses Hono's typed client, and checks saved-history reconnect, current Document refresh, commit ordering, bounded frames and revocation. The content suite uses real PostgreSQL and a named in-memory storage fixture. That fixture tests metadata publication, immutability checks and retry behavior, not Garage durability.

The Playwright test builds the web app (the UI mockup on fixtures), starts a private preview on 45174, checks that Home renders without page errors, a rail button's focus and pointer cursor, and the `d` theme toggle, then writes `docs/evidence/generated-web-playwright.png`. It asserts Bun in the test worker. It does not exercise the backend: the web app is not wired to the API yet. Use a different port if 45174 is already in use; do not stop an unrelated server.

Regressions must call production domain or transport paths and fail when the relevant guard is removed. Label controlled fixtures and missing proof. See [the implementation checkpoint](docs/execution.md) for the current evidence and external boundaries.

The combined runtime suite drives verified Better Auth HTTP, actual PostgreSQL/pg-boss, authenticated WebSocket replay, trusted agent tools and the production runtime with a controlled computer fixture. It includes elapsed-clock cron and Connection recovery; allow several minutes for the full suite. Those fixtures do not qualify a real VM, native subscription, external account or Garage. The schema suite runs the actual fresh development bootstrap and repeats native push, checks stable definitions/data and queue-owned objects, and submits invalid cross-workspace/human/check/size writes. Discovery and cleanup regressions exercise database authorization and real stream/provider boundaries; the consistency scan is a naming/dependency/route check, not runtime proof.

The simplification regressions cover stale Task owner edits and forged agent identity through actual HTTP/domain calls, common cursor validation, partial record updates, trusted Pi pins, and runtime closure during a blocked readiness query. Numbered app migrations are retired before MVP; their populated-upgrade proof remains historical in immutable prior captures, not a current test claim. Installation maps in tests are explicitly controlled fixtures and do not prove native installations or account authorization.

Execution-review regressions cover viewer control denial, complete retained source scope and accepted-only tools, failed dispatch siblings, Pi controls during pending tools, unknown tree/tool cleanup fences, and actual Agent proposals/Task creation. Computer/storage/provider peers remain controlled fixtures.

The pinned Drizzle Kit 0.31.11 introspector reorders composite FK metadata and can emit drop/add FK DDL on a repeat push. The current gate is semantic stability: no destructive approval, identical constraints/indexes/data, and unchanged native queue objects/jobs. Do not call that second command a no-op. Physical schema references may be cyclic; business-operation imports remain acyclic.

Visibility tests use real HTTP/auth/PostgreSQL/pg-boss with explicitly controlled computer/storage peers. They cover exact user/workspace enums, server ownership, filtered continuation, maintainer-only configuration, accepted source revocation during I/O and active execution, member removal, and disabled manual Automation admission. Account qualification tests use confirmed controlled OAuth/Infisical peers; Computer reports qualify compute capabilities only. They do not prove real login or billing.

The managed Pi suite also runs the actual published 1.0.0 CLI, the embedded Go/native Codex executor, Otto HTTP/private PostgreSQL/queue and controlled provider peers. Build the gateway fixture using Go 1.26.0 before this suite:

```sh
(cd ops/gateway && go test -c -o /tmp/otto-gateway-fixture)
OTTO_GATEWAY_FIXTURE_BINARY=/tmp/otto-gateway-fixture bun run test
```

The helper denies nonfixture provider sockets and joins its own process. Missing Go/helper is a failed prerequisite, never a skipped acceptance check. Gateway production checks are `go test ./...`, `go vet ./...`, `go mod verify` and `CGO_ENABLED=0 go build ./...` from `ops/gateway`. Go race checks require a working C toolchain; absence is unverified. No Docker deployment or provider account is needed for these controlled proofs.

The Skills split is exercised by `skills-transfer.test.ts` (explicit private-DB transfer/refusal and unchanged accepted evidence), Skill HTTP/visibility/proposal cases in content/visibility/execution tests, and the actual published Pi materialization case in `pi-gateway-runtime.test.ts`. The latter requires the existing pinned Go controlled-upstream test helper described above. Document payloads reject retired Skill fields; ordinary Document proposals/Collections remain separate. See [Skills model and transfer](docs/skills.md).
