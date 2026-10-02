# Otto

Otto combines flat project tasks, shared conversations, documents, saved outputs and native coding agents. This is a fresh Bun application. Product contracts and research live in [docs/otto](docs/otto/README.md).

- `apps/web`: generated React/Vite/shadcn app, preset `bIkg4yR`, pointer cursor enabled.
- `apps/server`: Bun/Hono server and Better Auth composition.
- `packages/ui`: generated shared shadcn components.
- Domain packages own their records and operations. PostgreSQL is authoritative.

## Setup

Use Bun 1.4.2 or later:

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run check:boundaries
bun run test
bun run build
bun --bun run --cwd apps/web dev
```

The generated web page is currently the visual baseline. The backend has working domain and transport slices, exercised against isolated PostgreSQL. Native execution and external services remain unqualified. See [the execution checkpoint](docs/execution.md) for completed checks and open boundaries.

Server configuration is injected through the verified Infisical scope, never a committed environment file. Required names are `DATABASE_URL`, `BETTER_AUTH_SECRET` and `OTTO_ORIGIN`. No Otto secret scope has been selected here. Apply `bun run db:migrate` with that configuration before starting `bun --cwd apps/server start`. Public signup creates an unprivileged identity; workspace ownership is operator-controlled.

Compute selection is deferred. There is no host-local agent execution or claimed native subscription qualification. Storage and provider integration checks require their selected services and credentials.

See [TESTING.md](TESTING.md) for private database and Playwright checks, and [backend notes](docs/backend.md) for transaction, queue, realtime and integration boundaries.
