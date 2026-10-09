# Otto contributor guide

Read [README](docs/otto/README.md), [plan](docs/otto/plan.md), [code principles](docs/otto/code-principles.md), relevant research and [testing guidance](TESTING.md) before nontrivial work. Code principles hold the detailed conventions; the settled rules below supersede older conflicting guidance.
This is a fresh Otto Bun monorepo. Historical Buzz code and history stay outside it; do not restore that toolchain or protocol.

## Stack and workspace

- Use Bun, strict TypeScript, Hono/RPC, Zod, PostgreSQL/Drizzle, Better Auth, pg-boss and Pino. Web uses React/Vite/Tailwind/shadcn.
- Preserve shadcn preset `bIkg4yR` and generated `packages/ui` placement. Use Biome and Vitest explicitly under Bun.
- No pnpm, npm lock, Turbo, contracts framework or empty domain packages.
- Every install, generator or package mutation must use the explicit repository working directory and first verify `package.json` name is `otto`.
- Work only in the assigned checkout and owned files. Parallel work requires user authorization and isolated ownership. Project engineering work is assigned to the software engineering owner resolved from the live agent directory. Never overwrite another lane's work.
- Secrets live in Infisical. Read the secrets skill and use its wrapper before credential operations. Never put secret values in files, messages or logs.
- Test PostgreSQL uses a private disposable data directory and socket, never a shared database.

## UI and design

- Follow [DESIGN.md](DESIGN.md): tokens, color, type, layout, elevation, shapes, components and do's and don'ts for the web UI.
- Change shared looks in the `packages/ui` component with an `// Otto:` comment, never per instance; instance classes are for layout only.
- Empty states follow the binding "Empty-state rules" in DESIGN.md (title "No <things>", one description sentence, one main button, no permanent toolbar).
- Record every new or changed UI decision in DESIGN.md in the same change and keep it passing `bunx @google/design.md lint DESIGN.md`.

## Small, cohesive changes

- Make the smallest correct change. Remove dead or duplicate code before adding more; reuse existing code or native mechanisms first.
- Apply DRY and YAGNI to demonstrated shared behavior. Add helpers only when they remove real repetition. No generic repositories, contracts, registries, Result envelopes or permission frameworks.
- Keep domain operations cohesive and Hono typed routes thin, with one authentication, origin, context and transaction pipeline.
- Runtime domain-operation dependencies must be acyclic. Use domain APIs across private-table boundaries. Native schema-only lazy references may form relational cycles.
- Keep Otto models and permissions independent of providers through small domain-owned integration boundaries.

## Names and data

- Use `getTask` / `getTasks`, never `getMany` or compatibility aliases. One bounded typed plural getter replaces duplicate variants.
- Discovery lists are bounded (default and maximum 100), take a strict typed query with a per-domain `sort`/`order` allowlist and typed filters, order and filter in SQL before the limit, and continue with a sealed cursor that never carries an unreadable row's value. No generic filter language, search domain or unified endpoint. See [Discovery lists](docs/lists.md).
- Keep create, update, upsert and delete semantics explicit. Create means new only; upsert intentionally means create-or-update.
- Ordinary edits use one allowlisted partial update with field-specific authorization, not separate owner, view or metadata setters. Real permission and control transitions may keep explicit verbs.
- Otto display labels use `title`, including Collection fields; human names and native protocol/machine identifiers keep `name`. See code principles for the deliberate physical SQL mapping.
- Otto discriminators use `type`. Timestamps record actual events as `createdAt`, `updatedAt` or meaningful `...At`; numeric replay positions use `cursor`.
- Use `editToken` only for actual stale-edit, queued-policy or authority fences. Preserve distinct attempt and Environment generation fences; do not invent version history.
- All Otto-owned SQL tables use plural snake_case; pure junctions use plural entity names such as `agents_skills`. Keep native pg-boss vocabulary at its boundary; use server `queue.ts`, `startQueue`, `QUEUE_SCHEMA` and PostgreSQL schema `queue`.
- Use lifecycle status enums instead of redundant enabled booleans for mutually exclusive states. Keep unlike Task/Run states and native library flags distinct.
- Before MVP, use native `bun db:push` with zero numbered application migrations. Never reset shared/live data or automatically approve destructive schema changes; pg-boss owns its internal upgrades.

## Configuration and access

- Creator/maintainer identity is server-derived `createdBy`, not `createdById`. Keep transferable Task/Schedule `ownerId` and File human custodian/sponsor separate from Agent authorship.
- Agent skills persist only in the workspace-safe `agents_skills` junction; bounded `skillIds` is a selection/projection, not a second stored array. Accepted Run snapshots remain immutable. Agent is the sole reusable configuration for skills and Connection grants. No manual skill overrides or Project defaults for those settings.
- Schedules in `@otto/schedules` hold trigger, body, Agent and output destination; Project derives from the current output Chat. Optional Task association does not merge Schedules into Tasks. Do not add skill, Document or message override arrays. See [Schedules](docs/schedules.md) for unchanged private queue/accepted identity storage boundaries.
- Bounded manual Run selections of Documents, messages and Tasks are execution content, not standing grants. Preserve immutable accepted snapshots, current reauthorization and isolation from retained computer sources.
- Files own saved uploaded/generated bytes and their metadata in `@otto/files`/`files`; Documents stay separate editable content. A File is at most 100,000,000 bytes; only bounded consumers (8 MiB: Skill materialization, model tools, HTML preview) ever hold file bytes in memory. Simple nested Folders (`folders`, nullable `folderId` on Files and Documents; max depth 8) organize them in `@otto/files`: human-only, same workspace and Project, a `user` Folder holds only its creator's private items, only empty Folders archive, and placement never copies bytes or changes visibility, keys, requests or snapshots. A Drive is a client presentation only: no Drive domain, item graph, shortcuts, versions, sync or trash service. Large bytes use the binary `PUT /files/:requestId/content` upload and a verified spool download; see [Files](docs/files.md). Use `fileId`/`fileIds`, `/files` and `file.create`. Preserve accepted private identity keys and frozen snapshots through owning storage projections; see [Files](docs/files.md).
- Skills own instructions, format metadata, supporting files and proposals in `@otto/skills` and the `skills` table. Documents own ordinary content and Collections; never add skill flags or skill data to them.
- Agents, Skills, Documents, Files, Connections and Subscriptions use exactly `user` / `workspace` visibility with the existing workspace and authoritative human identity (`createdBy`, or File custodial `ownerId`). No Organization entity, personal/shared/private/public aliases or duplicate owner/scope model.
- Chats use `workspace | participants` visibility. Server-derived `createdBy` controls metadata/archive/participant management with current writer/Project authority; participant contributors retain discussion and authorized Run controls, explicit viewers cannot write, and Agents always need membership. See [Chats](docs/chats.md) for the one-model contract and retained private identity keys.
- The server derives creation identity. `user` visibility is creator-only. `workspace` visibility requires eligible current membership intersected with resource, role, audience and explicit grant checks.
- Documents and Files have one nonnullable visibility field and creator/custodian-controlled edits; per-user reader/writer ACLs are deferred. File metadata/visibility carries no edit token; immutable upload requests/bytes and saved/current source-Run audiences remain separate fences. Internet publication remains explicit frozen selected shares.
- Connections are external GitHub/MCP accounts with scoped grants. Subscriptions identify authorized AI accounts, separate from Pi and external Connections; retain one accepted account/model/billing channel per Run/Session. Models remain configured IDs, not a new catalog. Qualification uses the managed CLIProxyAPI Codex route and confirmed Infisical-backed account authentication; Computer inspection proves compute capabilities only.
- Project/Chat/File metadata and Subscription display edits need no edit token. Connection title-only edits preserve grants/approvals; real Connection policy changes retain their fence.
- Visibility never shares credentials, private Session context or native login, grants provider operations, or automatically shares private dependencies. The one exception is chat attachments: a File attached to a Message stays private to its custodian and is readable by that Chat's participants while they are participants; only the custodian attaches a private File.

## Execution guarantees

- Preserve human Task ownership and human-only authorized Done, Chat participants, private Session context and individual Run attempts.
- Manual Task time lives in `@otto/tasks`/`timesheets`: `duration` is positive whole minutes, not milliseconds or Agent runtime. Server-derived creator and logging timestamp are immutable; only that human with current Task writer access edits/deletes duration/notes, including on Done/archived Tasks. Task readers can read bounded entries; no timers, billing or admin edit-other-person bypass.
- Archive blocks new admission and queued launch. A disabled Schedule suppresses scheduled ticks; explicit owner-authorized manual Runs remain allowed. Configuration changes still fence prior queued attempts. Neither archive nor scheduling disable implicitly stops active Runs or invalidates authorized archived-source reads, control or output. Continue checking actual revocation.
- Atomic Run/queue admission, Environment leases, authority checks, explicit uncertain outcomes, attempt/generation/launch fences, immutable bytes and bounded I/O, control and cleanup are required, not optional simplifications.
- Protect retained source scope across fresh Sessions. Require confirmed remote process-tree stop and joined server-tool cleanup before Environment reuse.
- Pi is the runtime of every Agent, for coding, research, writing and tools. Package Pi and one account/model gateway with Otto; users connect supported accounts through Otto, without installing individual vendor CLIs or choosing a harness. CLIProxyAPI is the single managed gateway, initially Codex OAuth/Responses only; Magpie remains historical research. See [the Pi/gateway replacement map](docs/pi-gateway-plan.md).
- Model reasoning, Pi loop/tools, gateway authentication/model access and Otto authority/collaboration are separate responsibilities. Gateway/SDK auth intentionally replaces native-computer login requirements; it does not prove equivalent native behavior or billing. Never silently switch account, model or billing channel. Pi TUI informs the later GUI; no screen scraping or mandatory terminal-panel parity.
- This backend phase implements compute models and the existing small typed provider-agnostic internal connector only. Per-Agent provisioning and cloud/local provider selection are deferred; add no adapters, SDK framework or Mastra dependency.
- Qualify adapter/server contracts with controlled fixtures now. Real gateway/provider authorization, isolation and billing qualification come later; claim no automatic portability or account/host-local fallback. A worktree or host subprocess is not an isolated computer. No subscription/account fallback.

## Checks and delivery

- Run applicable formatting, type, build and integration checks. Tests must exercise production seams and actual permissions/fencing; no wording tests are needed for reversible prose edits.
- Open visible changes in a browser and retain inspected evidence. Report verified, failed and unverified checks honestly.
- Controlled fixtures prove only their exercised behavior, never native isolation, billing or storage certification.
- Backend acceptance requires independent review in a fresh, separate thread by a reviewer other than the author, resolved from the live agent directory. A WIP read or test count is not independent acceptance.
- No deployment, remote creation or push without explicit instruction. Commits require authorization, staged-content inspection and `git commit -s`.
- Track Otto/internal work in repository documentation and BB, never Notion. Return changed files, exact source/evidence hashes, checks and open items for the integrating owner's inspection.
