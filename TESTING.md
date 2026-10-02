# Testing Otto

Run commands from the Otto repository root with Bun 1.4.2 or later. The runtime checks below use Vitest 5.0.3 under Bun, not `bun test` or a Node worker.

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run check:boundaries
bun run test
PLAYWRIGHT_SKIP_BROWSER_GC=1 bun --bun playwright install chromium
bun run test:browser
```

`bun run test` starts real PostgreSQL 18.4 from the pinned development binary package. Each suite creates a disposable data directory and a private 0700 Unix socket, disables TCP, applies Drizzle and pg-boss construction SQL, and stops its own process. It does not use a shared DB or require an Infisical secret. The test helper runs the binary package's symlink hydration script because that optional dependency setup is not executed by this Bun install. PostgreSQL fixture auth uses local trust inside the private socket directory; this is not production configuration.

The collaboration suite exercises Better Auth, bootstrap, invitations, workspace/project authorization and tasks. The Run suite exercises atomic rollback, exact snapshots, duplicate queue delivery, schedule reconciliation, Session scope and recovery fencing. The transport suite starts a real Bun HTTP/WebSocket server, uses Hono's typed client, and checks saved-history reconnect, current Document refresh, commit ordering, bounded frames and revocation. The content suite uses real PostgreSQL and a named in-memory storage fixture. That fixture tests metadata publication, immutability checks and retry behavior, not Garage durability.

The Playwright test builds the generated frontend, starts a private preview on 45174, checks rendering, keyboard focus, theme toggling and the selected pointer cursor, then writes `docs/evidence/generated-web-playwright.png`. It asserts Bun in the test worker. It does not exercise a finished Otto product UI. Use a different port if 45174 is already in use; do not stop an unrelated server.

Regressions must call production domain or transport paths and fail when the relevant guard is removed. Label controlled fixtures and missing proof. See [the implementation checkpoint](docs/execution.md) for the current evidence and external boundaries.
