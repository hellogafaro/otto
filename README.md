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

Server configuration is injected through the authorized runtime secret scope, never a committed environment file. Required names are `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (canonical base64 of 32 bytes) and `OTTO_ORIGIN`. Use native `bun run db:push` for pre-MVP development with that configuration before starting `bun --cwd apps/server start`. Ordinary email/password signup and sign-in work without SMTP or mandatory email verification. Signup creates an unprivileged identity and does not prove email ownership; workspace ownership is operator-controlled. Mail uses `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` and paired `SMTP_USER`/`SMTP_PASSWORD` for authenticated submission. Password reset and invitation delivery are explicitly unavailable when mail is unconfigured. Invitation acceptance requires the emailed private token, not merely a matching email or invitation ID. See [operations](docs/operations.md#smtp-mail) for the TLS and configuration contract.

Confined computer execution is deferred; there is no host-local execution or subscription fallback. `bun scripts/native-dev.ts` starts an isolated disposable development backend using private PostgreSQL and a loopback S3 peer; it is not a production-storage qualification. Operator enrollment is stdin-only. Storage and real-provider checks remain separate from deterministic fixtures.

For the reusable local instance, follow [durable localhost development](docs/local-dev.md), not the disposable fixture launcher. Its PostgreSQL restart path is verified; Garage credentials and authenticated workspace/default-Agent use retain their separately recorded setup and verification gates. Normal account creation and sign-in need no inbox.

See [TESTING.md](TESTING.md) for private database and Playwright checks, and [backend notes](docs/backend.md) for transaction, queue, realtime and integration boundaries.
