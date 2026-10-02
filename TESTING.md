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

The Playwright test builds the generated frontend, starts a private preview on 45174, checks rendering, keyboard focus, theme toggling and the selected pointer cursor, then writes `docs/evidence/generated-web-playwright.png`. It asserts Bun in the test worker. It does not exercise a finished Otto product UI. Use a different port if 45174 is already in use; do not stop an unrelated server.

Regressions must call production domain or transport paths and fail when the relevant guard is removed. Label controlled fixtures and missing proof. See [the implementation checkpoint](docs/execution.md) for the current evidence and external boundaries.

The combined runtime suite drives verified Better Auth HTTP, actual PostgreSQL/pg-boss, authenticated WebSocket replay, trusted agent tools and the production runtime with a controlled computer fixture. It includes elapsed-clock cron and Connection recovery; allow several minutes for the full suite. Those fixtures do not qualify a real VM, native subscription, external account or Garage. The schema suite runs the actual fresh development bootstrap and repeats native push, checks stable definitions/data and queue-owned objects, and submits invalid cross-workspace/human/check/size writes. Discovery and cleanup regressions exercise database authorization and real stream/provider boundaries; the consistency scan is a naming/dependency/route check, not runtime proof.

The simplification regressions cover stale Task owner edits and forged agent identity through actual HTTP/domain calls, common cursor validation, partial record updates, trusted harness pins, and runtime closure during a blocked readiness query. Numbered app migrations are retired before MVP; their populated-upgrade proof remains historical in immutable prior captures, not a current test claim. Installation maps in tests are explicitly controlled fixtures and do not prove native installations or account authorization.

Execution-review regressions cover viewer control denial, complete retained source scope and accepted-only tools, failed dispatch siblings, ACP controls during pending tools, unknown tree/tool cleanup fences, and actual Agent proposals/Task creation. Computer/storage/provider peers remain controlled fixtures.

The pinned Drizzle Kit 0.31.11 introspector reorders composite FK metadata and can emit drop/add FK DDL on a repeat push. The current gate is semantic stability: no destructive approval, identical constraints/indexes/data, and unchanged native queue objects/jobs. Do not call that second command a no-op. Physical schema references may be cyclic; business-operation imports remain acyclic.

Visibility tests use real HTTP/auth/PostgreSQL/pg-boss with explicitly controlled computer/storage peers. They cover exact user/workspace enums, server ownership, filtered continuation, maintainer-only configuration, accepted source revocation during I/O and active execution, member removal, and disabled manual Automation admission. Native account binding tests trust only the configured adapter's exact report; they do not prove real login or billing.
