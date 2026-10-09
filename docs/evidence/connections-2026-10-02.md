# Connections production-seam evidence

The goal was to exercise the Connections lifecycle, exact approval identity, scoped external operations, durable outcomes and failure bounds through their actual domain and HTTP adapter paths at baseline `03192913bfc93a733e721d270b5cd1c98c0a2c34`.

`tests/connections.test.ts` runs under Bun/Vitest against disposable PostgreSQL 18.4 with a private 0700 Unix socket and TCP disabled. A Bun HTTP server binds an automatically assigned loopback port. It serves controlled public fixture responses through the production Infisical v4, GitHub App and MCP Streamable HTTP clients. An ephemeral in-memory signing key tests JWT production/verification and is never saved or printed. These peers establish Otto behavior, not real provider authentication, permissions, isolation or durability.

The suite demonstrates scoped secret-reference lookup before manager access; selected-repository token requests and provider-permission intersection; exact arguments/account/target/Run/attempt identity; mandatory Run-derived Agent and launch-key checks; explicit grant audience intersection with a valid saved Run audience; unknown legacy audience denial; human digest approval; durable request and execution deduplication; grant/config changes and expiry; refresh from the same reference; disconnect/revoke during I/O; publication denial; lost-write acknowledgement; restart without replay; bounded HTTP, MCP tool/resource output and stalled resolvers; explicit read retries; ownership-bound approval filters; legacy identity denial; stale claim recovery and completion fencing. Native-subscription metadata stays unavailable without a qualified adapter.

The server recovery cases remove the sponsor through the workspace domain while a real fixture HTTP write is in flight. The trusted Database entry retires its aged write claim and an aged read claim without provider requests, and the late response produces no Conversation message. Three deterministic PostgreSQL lock races change the token, state or age after candidate selection; all three claims survive that stale scan. A 105-claim backlog retires in batches of 100 and 5, followed by a zero-change pass. Human administrator recovery remains exercised separately.

Two attention cases first failed because `getOperations` required `connectionId`, then passed with the optional Connection filter and UUID pagination. They query the production getter as a contributor, traverse two-item pages across owned Connections, exclude a different sponsor and another owned workspace, reject agent access and invalid bounds/cursors, hide ownership loss, and reject approval after grant revocation. The returned views retain their existing private-field exclusions.

The test composition validates Run/attempt/Environment/audience against real PostgreSQL records and publishes through `createMessage` in the supplied transaction. Its cross-domain validator is an explicit test fixture; it does not qualify the main owner's production Run adapter.

| Check | Observed result |
| --- | --- |
| `bun --bun vitest run tests/connections.test.ts` | Passed: 28 tests after the bounded attention getter follow-up; proof-only callback and recovery contracts unchanged. |
| `bun --bun tsc --ignoreConfig --noEmit --target ES2023 --module Preserve --moduleResolution bundler --strict --noUncheckedIndexedAccess --skipLibCheck --types bun tests/connections.test.ts packages/connections/src/server.ts` | Passed: Connections plus the test's transitive production imports. |
| `bun run check` | Passed: repository Biome check. |
| `bun run check:boundaries` | Passed: 14 packages; declared imports, no private cross-domain schema imports or cycles. |
| `bun run build` | Passed: generated frontend type/build. No UI was changed. |
| `bun run test` | Failed at the pre-integration checkpoint: 62 passed, 2 failed, with 17 Connections cases then present. Both failures are the existing `grantConnection` import in `tests/authorization.test.ts:320` and `tests/content.test.ts:282`. |
| `bun --bun tsc --noEmit` | Failed again on the attention follow-up source: 9 old import/call-signature errors in shared `api.ts`, `authorization.test.ts` and `content.test.ts`; none in the new lane sources/test. |

The failing shared callers belong to the integrator and were preserved under the lane ownership restriction. The passing new suite calls the replacement lifecycle and trusted operation boundary rather than retaining unsafe old aliases. There is no independent review verdict in this lane evidence.
