# Otto

Otto combines flat project tasks, shared chats, documents, saved outputs and native coding agents. This is a fresh Bun application. Product contracts and research live in [docs/otto](docs/otto/README.md).

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
bun run check:consistency
bun run test
bun --bun run --cwd apps/web dev
```

The pre-Craft v1 UI and PostgreSQL domains are the restored foundation. Official native Mastra owns execution and conversation history; OpenAI, Anthropic and explicit OpenAI-compatible protocols use server-only encrypted API keys. See [native acceptance](docs/native-acceptance.md) for current evidence and remaining gates. Historical Pi/gateway reports are not current runtime instructions. Local feedback uses dev/HMR; production builds and deployment require separate approval.

Server configuration is injected through the authorized runtime secret scope, never a committed environment file. Required names are `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (canonical base64 of 32 bytes) and `OTTO_ORIGIN`. Use native `bun run db:push` for pre-MVP development with that configuration before starting `bun --cwd apps/server start`. Production signup requires configured SMTP verification mail and creates an unprivileged identity; workspace ownership is operator-controlled. Mail uses `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` and paired `SMTP_USER`/`SMTP_PASSWORD` for authenticated submission. Mail is explicitly unavailable when unconfigured. See [operations](docs/operations.md#smtp-mail) for the TLS and configuration contract.

Confined computer execution is deferred; there is no host-local execution or subscription fallback. `bun scripts/native-dev.ts` starts an isolated disposable development backend using private PostgreSQL and a loopback S3 peer; it is not a production-storage qualification. Operator enrollment is stdin-only. Storage and real-provider checks remain separate from deterministic fixtures.

For the reusable local instance, follow [durable localhost development](docs/local-dev.md), not the disposable fixture launcher. Its PostgreSQL restart path is verified; Garage credentials, normal signup mail and authenticated app startup still require the recorded setup approvals and verification.

See [TESTING.md](TESTING.md) for private database and Playwright checks, and [backend notes](docs/backend.md) for transaction, queue, realtime and integration boundaries.
