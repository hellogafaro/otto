# Otto stack options

Researched 1 October 2026. The human selected the libraries below after the initial comparison. Earlier rankings remain reference material. Pino is now selected. Credential storage for a fresh installation remains open; execution is provider agnostic, with VM/backend selection deferred. No selected library is runtime-certified by this document.

## Fixed choices

TypeScript, Bun workspaces/package management/lockfile/scripts/server runtime, React, Vite, Tailwind CSS v4, shadcn/ui, Better Auth, PostgreSQL, Drizzle, pg-boss, Garage, Caddy, and Docker Compose. Vitest is required. Native Codex/Claude/ACP adapter executables keep their own required runtime inside the isolated Environment; the Bun requirement applies to Otto's code and tool execution, not replacing those harnesses.

## Selected libraries

| Responsibility | Selection |
| --- | --- |
| Server and typed calls | Hono and Hono RPC |
| Browser routing and server data | TanStack Router and TanStack Query |
| UI state | React state/context initially; Zustand only when needed |
| Input validation | Zod |
| Document editor | Tiptap core with required extensions and our shadcn UI |
| Formatting and lint | Biome |
| Browser workflow tests | Playwright alongside mandatory Vitest |
| Structured logging | Pino, one server logger and JSON stdout |

These selections supplement the fixed choices. Keep handlers thin and domain logic internal. Query owns server records; React state owns temporary UI state. Do not install a second state store preemptively.

## Logging selection

Use [Pino](https://github.com/pinojs/pino): one server logger, structured JSON to stdout, and child loggers for request/Run context. Its compact API and established ecosystem fit the preference for a familiar, simple dependency. The [API](https://github.com/pinojs/pino/blob/main/docs/api.md) supplies structured fields, child loggers, and redaction. Limit ordinary log fields to operational metadata and configure secret redaction; do not log credentials or complete provider payloads. No additional logging service or worker transport is needed initially.

Pino is selected rather than LogTape. We have not measured a relative speed or reliability advantage. Its official documentation targets Node, so qualify the selected release's JSON output, errors, redaction, and shutdown behavior under Bun before implementation adoption. No logging runtime was exercised in this update.

## Credential storage discussion

Connections keep the same product model either way: an account, scoped grants, and server-only credential access. Credential storage is an implementation detail, not a new domain or user-facing object.

| Deployment | Lean recommendation | Responsibility |
| --- | --- | --- |
| This installation, with Infisical already available | Reuse Infisical; PostgreSQL keeps Connection metadata and secret references | Operate the existing store and enforce scoped server access |
| A fresh standalone installation | Consider encrypted credentials in PostgreSQL to avoid another required service | Otto must implement encryption, key rotation, and recovery correctly |

Infisical's [Compose template includes Infisical, PostgreSQL, and Redis](https://infisical.com/docs/self-hosting/overview). That is infrastructure we would add if the store did not already exist. Database storage removes that service dependency but does not remove key management. This alternative is not selected or implemented.

If adopted, encrypt the credential payload on the server using a standard authenticated-encryption implementation, such as AES-GCM. Store ciphertext, its unique nonce, and key ID in server-only Connection storage. Bind the ciphertext to its Connection/workspace identity as authenticated associated data. Keep the encryption key outside PostgreSQL and agent Environments, inject it through deployment secret management, retain keys needed during rotation, and prove database-plus-key recovery. [Authenticated encryption](https://doc.libsodium.org/secret-key_cryptography/aead) detects tampering as well as concealing plaintext. A compromised server holding the key can still decrypt. Connection secret values must never reach browser/RPC responses, ordinary metadata, logs, messages, or artifacts. Existing secrets remain in Infisical; no credentials are read or moved for this discussion. Native provider subscription login remains private in its Environment rather than being copied into this store.

## Compute provider model

VM/backend selection is deferred. Keep all Otto domain models independent of integration providers. For compute, keep the Environment model independent of a particular provider, with a provider identifier and opaque computer reference. Runs keep their own execution reference. Agent configuration, Session context, Run state, and scoped Connections stay the same across providers.

The server uses a thin adapter for create/start, inspect, execute with stdin/stdout/stderr, stop, and reset. Reuse the chosen backend's existing operations. Check capabilities before exposing attach, resume, or desktop controls; do not promise every provider supports them. Start with one implementation when execution is built. No provider registry, plugin framework, or support for every backend is required now.

Each backend must pass the same existing proof requirements: private persistent agent state, multiple isolated computers, interactive ACP streams, lost-launch acknowledgement reconciliation, targeted process-tree Stop, bounded execution after server loss, stale execution fencing, and recovery. Provider management access stays server-only. A provider identifier alone does not establish isolation or safe recovery. Agent networks cannot reach host control services, Otto's database, or other agents; shared output passes through scoped Otto operations.

The earlier Incus, Firecracker, and container comparison is reference material, not a selection. [Incus VMs and containers have different kernel boundaries](https://linuxcontainers.org/incus/docs/main/explanation/containers_and_vms/). Its existing [guest execution agent](https://linuxcontainers.org/incus/docs/main/instance-exec/) is backend infrastructure, not an Otto runner. [Firecracker](https://github.com/firecracker-microvm/firecracker) is another possible backend. Do not treat these as interchangeable isolation guarantees. A future VM provider may require compatible host virtualization and setup beyond application Docker Compose. No compute provider was selected or operated here.

## pg-boss schema control

We can choose a PostgreSQL schema name, control schema creation, and turn automatic migrations off. The inspected release exports construction and migration SQL. Pin a compatible release, apply that SQL through the deployment migration process, and use migrate: false at application startup. A missing migration must fail startup rather than silently change the database.

That gives us control over when and how the schema is deployed, not arbitrary queue table design. pg-boss expects its own tables, columns, functions, indexes, and schema version. Renaming or restructuring them means maintaining a fork. Keep its internals in a dedicated jobs schema, and keep Otto's Projects, Runs, Automations, and other domain tables in Drizzle. Jobs reference Run IDs; they do not replace the Run record. Verify runtime privileges, fixed queue setup, schedule transactions, and upgrades on the chosen release.

Primary inspected source: [constructor options](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/api/constructor.md), [SQL plan exports](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/src/index.ts), and [Drizzle transaction adapter](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/api/adapters.md). The library owns its structure; Otto owns domain data and deployment.

## Three options for each remaining choice

This is the original ranked comparison for reference. The selected-libraries section above takes precedence; Pino supersedes the earlier logging ranking, and compute selection is deferred behind the provider model. Order is my judgment for Otto's brief, not a benchmark. All alternatives still need selected-release Bun checks; being installable with Bun does not prove their processes run on Bun.

| Responsibility | First choice | Second choice | Third choice |
| --- | --- | --- | --- |
| Server HTTP framework | [Hono](https://hono.dev/docs/getting-started/bun): thin routing and middleware | [Elysia](https://elysiajs.com/quick-start): Bun-focused framework with more integrated features | [Bun.serve](https://bun.sh/docs/runtime/http/server): fewest dependencies, more routing/auth glue |
| Typed browser/server calls | [Hono RPC](https://hono.dev/docs/guides/rpc): reuse Hono's inferred client | [oRPC](https://orpc.dev/docs/adapters/fetch-api): dedicated typed procedure and streaming transport | [tRPC](https://trpc.io/docs/server/adapters/fetch): dedicated typed procedure framework |
| Browser routing | [TanStack Router](https://tanstack.com/router/latest/docs/overview): typed routes and URL filters | [React Router](https://reactrouter.com/start/declarative/installation): familiar declarative router | [Wouter](https://github.com/molefrog/wouter): small router with fewer built-in features |
| Server-data fetching/cache | [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview): queries, mutations and invalidation | [SWR](https://swr.vercel.app/docs/data-fetching): compact fetching/revalidation model | [RTK Query](https://redux.js.org/toolkit/rtk-query/overview): useful when Redux already owns the app |
| Local UI state | [React state/context](https://react.dev/reference/react/useState): start without another store | [Zustand](https://github.com/pmndrs/zustand): a small shared UI store when needed | [Jotai](https://jotai.org/docs): atomic shared state |
| Input validation | [Zod](https://zod.dev/): direct schemas and inferred types | [Valibot](https://valibot.dev/guides/introduction/): modular validation API | [ArkType](https://arktype.io/docs/intro): TypeScript-like runtime schemas |
| Document editor | [Tiptap core](https://tiptap.dev/docs/editor/getting-started/overview): compose needed extensions and our shadcn UI | [BlockNote](https://www.blocknotejs.org/docs): more ready-made block-editor UI | [Lexical](https://lexical.dev/docs/intro): lower-level editor building blocks |
| Formatting/lint | [Biome](https://biomejs.dev/): one formatter/linter tool | [Oxlint](https://oxc.rs/docs/guide/usage/linter) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter): separate focused tools | [ESLint](https://eslint.org/docs/latest/use/getting-started) + [Prettier](https://prettier.io/docs/): flexible plugin ecosystem, more configuration |
| Browser workflow tests; Vitest stays required | [Playwright](https://playwright.dev/docs/intro): first browser-test candidate alongside Vitest | [Cypress](https://docs.cypress.io/app/get-started/why-cypress): alternative browser runner | [WebdriverIO](https://webdriver.io/docs/gettingstarted/): alternative WebDriver-based tooling |
| Structured logging | [LogTape](https://logtape.org/manual/start): first Bun-oriented logger candidate | [Pino](https://github.com/pinojs/pino): established structured JSON logger | [Winston](https://github.com/winstonjs/winston): configurable transports |
| Credential store | [Existing Infisical](https://infisical.com/docs/self-hosting/overview): reuse the available store | [OpenBao](https://openbao.org/docs/what-is-openbao/): self-hosted alternative requiring its own operation | [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html): alternative for an AWS installation |
| Agent execution backend | [Rootless Podman](https://docs.podman.io/en/latest/markdown/podman-run.1.html): first Linux proof candidate, including backend-enforced container timeout | [Rootless Docker](https://docs.docker.com/engine/security/rootless/): reuse Docker, prove a server-independent deadline | [Incus VMs](https://linuxcontainers.org/incus/docs/main/instance-exec/): separate-kernel alternative with more host setup |

Hono RPC goes with Hono. If Elysia wins instead, use its [Eden client](https://elysiajs.com/eden/overview) rather than adding an unrelated RPC stack. All network handlers remain thin adapters to internal domain functions; they do not define another business model or require a public API product. Live progress uses the existing authenticated WebSocket/catch-up design independently of the typed command transport.

Use TanStack Query for server records, React state for temporary UI state, and validated URL parameters for saved/shareable filters. Do not mirror the same server records into another global store. The editor recommendation uses open-source core and selected extensions; no paid collaboration, history, AI service, or real-time co-editing is required. Additional managed secret stores are alternatives for other deployment needs, not extra services for this installation. Current credentials remain in Infisical; the database alternative above is discussion only.

The execution backend ranking assumes the initial Linux self-hosted target. Podman's documented maximum container lifetime is useful evidence, not an Otto Run deadline proof. Validate persistent private homes, interactive ACP I/O, exact process identity, targeted tree stop, expired leases, reset/restart, and deadline behavior after server loss. Rootless containers share the host kernel; Incus VMs supply a different isolation boundary and require the existing incus-agent guest process for direct execution; this is a backend component, not a new Otto daemon. Never expose the container-engine socket to an agent. No backend was operated in this comparison.

## Bun and Vitest evidence

A scratch check ran on Bun 1.4.2, Vitest 5.0.3, and Vite 8.3.1. The test asserted that its worker had Bun's runtime object and version, then invoked Bun.spawnSync and verified the child process result.

- bun --bun run test: one test passed; the worker executed Bun APIs.
- bun run test: the same test failed with Bun undefined; the Node path was the negative control.

The test files, dependency lock, and logs are in thread storage under research/stack/vitest-bun. This proves the small worker/API path, not mocks, coverage, React component tests, full browser tooling, or the application. Vitest's [installation guide](https://vitest.dev/guide/) documents Bun package management but still lists Node requirements. Its [coverage guide](https://vitest.dev/guide/coverage.html) states that V8 coverage does not work on Bun; evaluate Istanbul instrumentation when coverage is needed. Keep Vitest and force Bun explicitly instead of accidentally selecting Bun's separate test runner with bun test or a Node worker through a shebang.

## Recommendation status

Argus passed the earlier comparison with no blockers, 9/10 across all criteria. Argus also passed the preceding selection and focused discussions with no findings, 9/10 across all criteria. Argus passed this narrow Pino selection and provider-model follow-up with no findings, 9/10 across all criteria. Human-selected libraries are listed above. Fresh-install credential storage remains open and VM/backend selection is deferred. All selected releases still need appropriate compatibility proof. No Otto implementation, migration, credential handling, container backend, UI, or full test pipeline was built. The canonical product and scope remain in [the plan](plan.md).
