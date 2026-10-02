# Implementation checkpoint

Otto is a fresh app at the repository root. The former Buzz checkout is preserved in the external backup recorded in setup-backup.md. Canonical docs remain under docs/otto/. The selected shadcn preset bIkg4yR and pointer option determine the generated UI. No compute provider is selected and no host-local execution will stand in for isolation.

## Done checks by slice

- Foundation: generated Vite monorepo, separate Bun server, shared generated UI, Bun lock/scripts, strict TypeScript and Biome. Build and open generated web UI; retain browser screenshot.
- Collaboration: Better Auth login, closed operator bootstrap, recipient-bound single-use invitations, workspace/project membership, flat human-owned tasks, authorized-human Done, shared conversations. Exercise persisted writes, forbidden cross-scope reads and removal.
- Execution admission: agents, unavailable compute capability, private Sessions, immutable Run inputs, atomic pg-boss dispatch, duplicate/stale delivery fencing and durable explicit outcomes. Prove rollback and permission recheck using isolated PostgreSQL.
- Content: stale-edit-protected Documents, Collections, scoped skills, private immutable Artifact storage and audience checks. Prove supported paths and distinguish unavailable storage credentials.
- Connections and automation: scoped capability metadata and guarded operations; manual/cron prompt/script admission with configuration fencing and bounded jobs. Prove supported queue behavior without claiming native execution.
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

The runtime suite covers real Better Auth login, closed bootstrap, verified recipient/single-use invitations, removal revoking unused invitations, workspace/project permissions, human-owned Task completion, migration replay, stale Document edits, typed Collection values, scoped skills and Connection revocation. It also covers Run/Session/job rollback, immutable skill snapshots, duplicate admission and real pg-boss worker redelivery, Automation reconciliation/edit/pause fencing, Session scope changes, uncertain recovery state, HTTP validation/origin gates, WebSocket reconnect/current Document refresh, commit ordering, bounded frames and live/replay revocation, including restricted participants and saved Run output audiences.

Artifact tests use real PostgreSQL with a named storage fixture. They prove pending/saved publication, retry identity, read permission and byte checks, archive behavior and immutable metadata. They do not prove Garage/S3 writes or restore. No provider, billing, native-login, VM recovery or performance certification is claimed.

The pinned pg-boss scheduling boundary and the exact outstanding external capabilities are recorded in [backend notes](backend.md). The small missing credential decision is a verified Otto Infisical project, environment and service path; no other project's secrets were used. The compute provider remains deliberately deferred.

Passing invocation summaries and tested source fingerprints are retained under [evidence](evidence/backend-validation.txt). Full product UI, rich editing, public shares, native tools and supporting skill-file workflows remain outside this backend checkpoint. The subsequent review and correction verdict are recorded below; broader qualification remains outside this checkpoint.

## Backend review correction, 2 October 2026

Argus reproduced four authorization/admission defects against the first backend checkpoint. Cody independently reran the original 31 tests and identified future provider prerequisites. The four corrections now have production-domain regressions: saved source-Run Artifact audience caps on metadata/list/read, agent denial for restricted Documents/Artifacts, disconnected Connection denial on grant/snapshot/request/approval, and complete normalized Run request identity. The agent-identity finding is a pre-integration domain defect; current HTTP actors contain only a human user ID.

Verified after correction: 47 tests across six suites under Bun, private PostgreSQL migrations and replay, Biome (80 files), strict TypeScript and the 14-package boundary check. Before the fixes, the new regression suite reproduced the findings with 11 failing and three passing checks. Current checks have no failures. Tests retain the real Run/Session/job rollback and duplicate worker-delivery coverage. Storage remains an explicitly named fixture.

Migration `0004_many_leech.sql` adds the saved caller request identity. Existing Runs without that identity reject retries with a conflict because selected defaults and requested Session controls cannot be safely reconstructed. New exact retries retain their admitted snapshot despite later source edits. Listing scans at most 100 Artifact candidates and advances its cursor over the scanned page, including filtered entries.

Current evidence and source fingerprint: [validation](evidence/backend-validation.txt). The generated web and dependency files were unchanged in this correction; their browser/build/frozen-install proof remains the earlier scoped result. No new provider, native-login, storage durability or performance proof is claimed. Argus and Cody (Claude) both passed the focused independent rechecks with no remaining blockers. Each independently verified all 96 source fingerprints and reran all 47 tests. Argus also reran Biome, TypeScript and the 14-package boundary check, with scores of 9/9/9. Root authorized one signed-off local commit of this unchanged reviewed source. This checkpoint PASS does not certify VM/native execution, Garage, external writes, the full product or performance. No push, deployment or Notion action.
