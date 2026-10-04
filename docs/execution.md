# Implementation checkpoint

Current managed Pi/CLIProxyAPI implementation and qualification: [checkpoint](pi-implementation.md) and [source map](pi-gateway-plan.md). The earlier checkpoints and ACP/native-computer observations below are historical; they do not qualify the replacement.

Otto is a fresh app at the repository root. The former Buzz checkout is preserved in the external backup recorded in setup-backup.md. Canonical docs remain under docs/otto/. The selected shadcn preset bIkg4yR and pointer option determine the generated UI. No compute provider is selected and no host-local execution will stand in for isolation.

## Done checks by slice

- Foundation: generated Vite monorepo, separate Bun server, shared generated UI, Bun lock/scripts, strict TypeScript and Biome. Build and open generated web UI; retain browser screenshot.
- Collaboration: Better Auth login, closed operator bootstrap, recipient-bound single-use invitations, workspace/project membership, flat human-owned tasks, authorized-human Done, shared chats. Exercise persisted writes, forbidden cross-scope reads and removal.
- Execution admission: agents, unavailable compute capability, private Sessions, immutable Run inputs, atomic pg-boss dispatch, duplicate/stale delivery fencing and durable explicit outcomes. Prove rollback and permission recheck using isolated PostgreSQL.
- Content: stale-edit-protected Documents, Collections, scoped skills, private immutable File storage and audience checks. Prove supported paths and distinguish unavailable storage credentials.
- Connections and schedule: scoped capability metadata and guarded operations; manual/cron prompt/script admission with configuration fencing and bounded jobs. Prove supported queue behavior without claiming native execution.
- Realtime: authenticated WebSocket, saved-history catch-up and explicit current-view refresh after gaps. Recheck authorization on replay and delivery; no unselected sync engine or LISTEN/NOTIFY adoption.

## Validation contract

Vitest runs explicitly under Bun and checks Bun identity. Checks use disposable local PostgreSQL only. Record verified, failed and unverified boundaries, exact commands and evidence. Missing provider/credentials block dependent proof only. The user authorized a fresh local Git repository and first signed-off commit. No push, PR, deployment or Notion task changes. Root requests Argus review.

## Progress

- Read product plan and code principles. Docker/Podman were unavailable. Integration tests now provision their own PostgreSQL 18.4 process using a private Unix socket, with TCP disabled.

Historical intake reference: TSK-991. The user now reserves Notion tasks for client work; Otto progress stays in these docs and BB handoffs.

Generator invocation: `bunx --bun shadcn@latest init --preset bIkg4yR --template vite --monorepo --pointer --cwd /home/g4f4r0/projects/otto/app/.scaffold --name otto`. Generated files were relocated from `.scaffold/otto` into `app/`; UI remains in `packages/ui`.

## Clean-root setup

The user authorized replacing Buzz with Otto on 2 October 2026. Generated files first moved into app/, then into this clean root. Current paths are apps/web, apps/server, packages/ui and docs/execution.md. Preset resolves to base-vega, neutral colors, Remix icons, with pointer cursor CSS intact.

Every package mutation uses an explicit working directory and verifies package name `otto` first. Before promotion, the root manifest diff guard confirmed the Buzz package.json and pnpm files unchanged.

## Initial setup evidence

Verified on Bun 1.4.2: frozen-lockfile install, Biome, strict TypeScript including web, four Vitest tests with a Bun worker/process assertion, Pino redaction, bounded HTTP body rejection, and Vite 8.3.2 production build. The browser opened the generated page and returned `cursor: pointer` for its button. Screenshot: [generated web](evidence/generated-web.jpg).

All 33 canonical files survived promotion. A byte comparison found only the authorized platform-research.md historical link repair; local canonical Markdown links resolve. The new root has no Buzz remote, toolchain or application directories. The initial repo uses main and the existing configured author identity.

Unverified at this checkpoint: real PostgreSQL migrations/authentication/domain permissions, queue admission/recovery, realtime, storage, native subscription login and compute isolation. The initial domain functions are typed implementation in progress, not a completed backend. No performance or combined-stack certification is claimed.

## Backend checkpoint, 2 October 2026

The initial backend checkpoint extended setup commit `2bdcb93124bcb0bfb300382695faab7bf0c2c87f` with then-uncommitted backend slices. Argus passed only the setup/documentation recheck at that commit. The first backend review later found four defects; see the correction checkpoint below.

Verified: 31 Vitest tests under Bun against private PostgreSQL 18.4, Biome, strict TypeScript, the package-boundary check, frozen Bun installation, Vite production build and one Playwright test. Vitest and Playwright workers both assert Bun. The latest browser capture is [generated-web-playwright.png](evidence/generated-web-playwright.png).

The runtime suite covers real Better Auth login, closed bootstrap, verified recipient/single-use invitations, removal revoking unused invitations, workspace/project permissions, human-owned Task completion, migration replay, stale Document edits, typed Collection values, scoped skills and Connection revocation. It also covers Run/Session/job rollback, immutable skill snapshots, duplicate admission and real pg-boss worker redelivery, Schedule reconciliation/edit/pause fencing, Session scope changes, uncertain recovery state, HTTP validation/origin gates, WebSocket reconnect/current Document refresh, commit ordering, bounded frames and live/replay revocation, including restricted participants and saved Run output audiences.

File tests use real PostgreSQL with a named storage fixture. They prove pending/saved publication, retry identity, read permission and byte checks, archive behavior and immutable metadata. They do not prove Garage/S3 writes or restore. No provider, billing, native-login, VM recovery or performance certification is claimed.

The pinned pg-boss scheduling boundary and the exact outstanding external capabilities are recorded in [backend notes](backend.md). The small missing credential decision is a verified Otto Infisical project, environment and service path; no other project's secrets were used. The compute provider remains deliberately deferred.

Passing invocation summaries and tested source fingerprints are retained under [evidence](evidence/backend-validation.txt). Full product UI, rich editing, public shares, native tools and supporting skill-file workflows remain outside this backend checkpoint. The subsequent review and correction verdict are recorded below; broader qualification remains outside this checkpoint.

## Backend review correction, 2 October 2026

Argus reproduced four authorization/admission defects against the first backend checkpoint. Cody independently reran the original 31 tests and identified future provider prerequisites. The four corrections now have production-domain regressions: saved source-Run Resource audience caps on metadata/list/read, agent denial for restricted Documents/Resources, disconnected Connection denial on grant/snapshot/request/approval, and complete normalized Run request identity. The agent-identity finding is a pre-integration domain defect; current HTTP actors contain only a human user ID.

Verified after correction: 47 tests across six suites under Bun, private PostgreSQL migrations and replay, Biome (80 files), strict TypeScript and the 14-package boundary check. Before the fixes, the new regression suite reproduced the findings with 11 failing and three passing checks. Current checks have no failures. Tests retain the real Run/Session/job rollback and duplicate worker-delivery coverage. Storage remains an explicitly named fixture.

Migration `0004_many_leech.sql` adds the saved caller request identity. Existing Runs without that identity reject retries with a conflict because selected defaults and requested Session controls cannot be safely reconstructed. New exact retries retain their admitted snapshot despite later source edits. Listing scans at most 100 Resource candidates and advances its cursor over the scanned page, including filtered entries.

Current evidence and source fingerprint: [validation](evidence/backend-validation.txt). The generated web and dependency files were unchanged in this correction; their browser/build/frozen-install proof remains the earlier scoped result. No new provider, native-login, storage durability or performance proof is claimed. Argus and Cody (Claude) both passed the focused independent rechecks with no remaining blockers. Each independently verified all 96 source fingerprints and reran all 47 tests. Argus also reran Biome, TypeScript and the 14-package boundary check, with scores of 9/9/9. Root authorized one signed-off local commit of this unchanged reviewed source. This checkpoint PASS does not certify VM/native execution, Garage, external writes, the full product or performance. No push, deployment or Notion action.

## Historical first integrated freeze, 2 October 2026

The completion slice is integrated on baseline `03192913bfc93a733e721d270b5cd1c98c0a2c34`, with no new main commit or staging. Root-approved operations, content and Connections components now compose with the production Run runtime. Current scope and the 23 acceptance gates are in [backend-completion.md](backend-completion.md); the previous 47-test independent verdict remains historical and does not certify these changes. Fresh Otto-only review is pending.

Verified after the last behavior changes: **149 tests across 19 files**, `bun run test` (Vitest 5.0.3 under Bun 1.4.2), in 145.54 seconds. Real private PostgreSQL 18.4, Hono HTTP, authenticated WebSockets and pg-boss workers/clock are used. New proof covers verified invite -> Project/Task -> scoped Agent/accepted skill files -> queue/runtime -> agent Resource/readback/share/revoke; MCP approval/publication and policy revocation; two-Agent controls/peer requests/human answers; active archive/pause output and Stop; lost acknowledgements/restart; removed-sponsor startup/minute recovery and backlog. Compute and object storage in these flows are explicitly controlled fixtures.

Biome, strict server/web types, the 15-package dependency check, handwritten naming/shared-dependency/119-route consistency check, frozen Bun installation and generated web production build pass. Production migration upgrades populated 0000–0004, preserves numeric cursor42 and nullable historical timestamps, and replays unchanged; the legacy queue path refuses rather than abandoning pending work. Generated web/UI and historical migrations/snapshots 0000–0004 remain byte-identical to baseline.

Normalization uses dependency-free shared error/required/input/page/cleanup primitives; ordinary discovery has truthful limit+1 `{items,next}` pages and scanned continuation through filtered results. Reproduced catch defects now propagate temporary storage failure and release other computer handles after one cleanup fails. Current bounded summaries, measurements, source fingerprints and scan results are in [backend-completion-validation.txt](evidence/backend-completion-validation.txt); old evidence is preserved.

Unverified: real isolated compute, native login/subscription/quota/billing, VM/process-tree recovery, live GitHub/MCP/Infisical/Resend authorization, Garage durability/restore, production load and a clock crossing DST. Required human choices remain a verified Otto Infisical scope and first isolated compute backend/account. No live secrets or external writes were used. No product UI, Notion, push, remote, deployment or final commit. Actual human work time is unknown.

## Historical simplification checkpoint, 2 October 2026 (REQUEST CHANGES)

The user replaced the first integrated freeze with a lean naming/CRUD/transport correction. Current source passes **153 tests in 19 suites**, Vitest 5.0.3 under Bun 1.4.2, in 151.30 seconds, after the final behavior changes. Typecheck, Biome (130 files), 15-package boundaries, consistency (64 backend files, 115 routes), unchanged generated web build and frozen-lock installation also pass.

Changes include one authenticated API/context path with cohesive static routers, one page query with domain cursor validation, atomic Task owner edits with editToken and human/eligible-owner guards, consolidated ordinary field updates, canonical type/editToken/connectionId naming, and trusted harnessVersion resolution only in accepted Run/Session bindings. The populated migration fixture checks original saved inputs/audience/grants, native Session/context, scope, Resource intent/share, approved operation digest and queued schedule fences through upgrade and replay. A production lifecycle regression reproduced and corrected false-ready after runtime closure during a blocked DB probe.

Exact commands, current measurement, failed-then-passing scope, external qualification limits and [source fingerprints](evidence/backend-simplification-source.json) are retained in [current evidence](evidence/backend-simplification-validation.txt). Compute, storage and external service responses remain controlled fixtures; no live native/provider/billing/Garage certification. Historical evidence/manifest 81ece1 is unchanged. This source is ready for fresh Otto review, remains unstaged/uncommitted on 0319291, and is not an independent PASS. No UI changes, Notion, push, deployment or actual human-time claim.

## Historical 04c provider-independent checkpoint, 2 October 2026 (REQUEST CHANGES)

The complete author check now passes **209 tests across 24 suites in 263.62 seconds**, explicitly Vitest 5.0.3 under Bun 1.4.2, after all behavior corrections. Biome, server/web types, 15-package operation boundaries, consistency (65 backend files/113 routes), generated web build and frozen-lock installation pass. The 20 generated web/UI files remain byte-identical to the reviewed baseline. No staging or new main commit.

Independent Otto review of historical 198c9b returned REQUEST CHANGES F1–F6 despite its153 passing tests. Those controls/source/queue/ACP/script/tool corrections are now integrated, along with all concrete final domain-sweep findings: inherited viewer ceilings, eligible Task reopening, Project archive writer access, effective restricted content audiences, pending-launch fencing, durable shutdown cleanup uncertainty, exclusive computer binding, executing-Agent writer checks, accepted Task reads and viewer binding denial. The compact [red/green record](evidence/backend-current-regressions.txt) preserves failures and precise production-seam checks. New independent review remains **pending**, not PASS.

Latest user decisions are implemented: user/workspace visibility and server-derived owner identity for Agents/skills/Connections; sole Agent reusable skills/grants; bounded manual selected content; Schedule status with disabled manual execution and disabled restore; plural SQL tables; narrow invitation update; zero numbered app migrations with native development schema push. Fresh/repeated private-PG sync preserves definitions/data/native queue and rejects invalid references/checks. Pinned Drizzle composite-FK DDL churn is documented rather than called a no-op. Historical migration/upgrade evidence remains immutable and does not qualify current bootstrap.

Actual HTTP/auth/WS/PostgreSQL/pg-boss seams cover invitation, atomic admission/rollback/delivery, two-Agent runtime/tools, current and accepted audience revocation, Resource/share/readback, scoped MCP approvals, active controls, restart/recovery and readiness. Compute/storage/external peers are explicitly controlled. Real compute provisioning/native login/isolation/billing/VM recovery are deliberately deferred; live service credentials, Garage durability/restore and production performance are unverified. No UI product work, secrets, Notion or external publication. Actual human work time is unknown.

Exact source, commands, measured fixture context and scope are linked from [current validation](evidence/backend-current-validation.txt) and [the 23-gate checkpoint](backend-completion.md). Main freezes for root fingerprint verification and fresh independent Otto review.

## Current review corrections, 2 October 2026

Independent review of04c requested only R1/R2 unresolved-launch recovery and R3 effective current source-Run recipient checks. Narrow fixes reproduced all seven targeted cases red then green; full validation now passes **214 tests/24 suites**,264.11s, plus types/formatting/boundaries/consistency. New [validation](evidence/backend-review-validation.txt) and [source manifest](evidence/backend-review-source.json) preserve the exact corrected checkpoint. Old04c evidence remains unchanged; fresh independent affected-change review is pending. Scope, deferred providers and no-stage/no-commit restrictions remain unchanged.
