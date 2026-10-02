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

- Read product plan and code principles. Local Docker, Podman and PostgreSQL binaries are not on PATH; locating an isolated database option while implementation proceeds.

Historical intake reference: TSK-991. The user now reserves Notion tasks for client work; Otto progress stays in these docs and BB handoffs.

Generator invocation: `bunx --bun shadcn@latest init --preset bIkg4yR --template vite --monorepo --pointer --cwd /home/g4f4r0/projects/otto/app/.scaffold --name otto`. Generated files were relocated from `.scaffold/otto` into `app/`; UI remains in `packages/ui`.

## Clean-root setup

The user authorized replacing Buzz with Otto on 2 October 2026. Generated files first moved into app/, then into this clean root. Current paths are apps/web, apps/server, packages/ui and docs/execution.md. Preset resolves to base-vega, neutral colors, Remix icons, with pointer cursor CSS intact.

Every package mutation uses an explicit working directory and verifies package name `otto` first. Before promotion, the root manifest diff guard confirmed the Buzz package.json and pnpm files unchanged.

## Initial setup evidence

Verified on Bun 1.4.2: frozen-lockfile install, Biome, strict TypeScript including web, four Vitest tests with a Bun worker/process assertion, Pino redaction, bounded HTTP body rejection, and Vite 8.3.2 production build. The browser opened the generated page and returned `cursor: pointer` for its button. Screenshot: [generated web](evidence/generated-web.jpg).

All 33 canonical files survived promotion. A byte comparison found only the authorized platform-research.md historical link repair; local canonical Markdown links resolve. The new root has no Buzz remote, toolchain or application directories. The initial repo uses main and the existing configured author identity.

Unverified at this checkpoint: real PostgreSQL migrations/authentication/domain permissions, queue admission/recovery, realtime, storage, native subscription login and compute isolation. The initial domain functions are typed implementation in progress, not a completed backend. No performance or combined-stack certification is claimed.
