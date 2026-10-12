# Otto contributor guide

## Current restoration and native-runtime direction

The 9 October 2026 direction restores the exact pre-Craft v1 foundation from `2a6e9a79be8b268b6cac583f68a68fa674be2fe9`. Hono, Better Auth, PostgreSQL, domain-owned Drizzle functions and the v1 React UI are the foundation again. The Craft/Electron/SQLite application is a recovery checkpoint, not a second runtime or compatibility layer.

Native Mastra replaces Pi and the managed subscription gateway. Use official native APIs directly within the existing server/domain boundaries, with one persisted native conversation history. Support OpenAI and Anthropic API-key providers and explicit OpenAI-compatible endpoint protocols; remote HTTP MCP only. Do not execute old subscription/local-source records, host-folder mounts or local MCP commands. Computer execution requires a separately confined computer per writer; never substitute this development host. Preserve unsupported capabilities explicitly rather than claiming they work.

Preserve v1 pages, navigation, sidebar and components wherever functional. The authorized visual exceptions are the preserved current login appearance, Home backgrounds and domain-connected information presentation, a large main panel with left/right toolbar actions, and necessary provider/connection settings. Use the observed Capy interaction only for necessary new surfaces, with existing shadcn/Base UI components and Otto tokens. No blanket redesign or private Capy assets. Keep preserved v1 and deliberate additions distinct in DESIGN.md.

Work directly on the sole assigned local main checkout, with one integration/commit owner and disjoint worker ownership. Local commits and owned dev/HMR restarts are authorized; no remote push, deployment, production build or unrelated cleanup. Preserve recoverable source and saved data; use isolated disposable PostgreSQL for testing rather than converting the saved SQLite database. Fictional users and test-effect approvals are permitted only in isolated test instances, with normal authentication and no external email or business side effects.

Otto is an internal MVP tool. Do not create, update or maintain Otto tracking in Notion: no tasks, projects, documents, reports, evidence uploads or timesheets. Keep engineering checks and the existing repository acceptance matrix local. Every supported operation and relevant multiplayer scenario needs passed, failed or unverified evidence tied to a source revision. Deterministic provider fixtures are not real model proof. Independent final acceptance must inspect the actual app, authentication, authorization, persisted results and reload behavior. These current rules supersede conflicting Notion-tracking, Pi, subscription-gateway, BB-only tracking and historical phase restrictions below and in restored documents.

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

- Creator/maintainer identity is server-derived `createdBy`, not `createdById`. Keep transferable Task/Routine `ownerId` and File human custodian/sponsor separate from Agent authorship.
- Agent skills persist only in the workspace-safe `agents_skills` junction; bounded `skillIds` is a selection/projection, not a second stored array. Accepted Run snapshots remain immutable. Agent is the sole reusable configuration for skills and Connection grants. No manual skill overrides or Project defaults for those settings.
- Routines in `@otto/routines` hold trigger, body, Agent and output destination; Project derives from the current output Chat. Optional Task association does not merge Routines into Tasks. Do not add skill, Document or message override arrays. See [Routines](docs/routines.md) for unchanged private queue/accepted identity storage boundaries.
- Bounded manual Run selections of Documents, messages and Tasks are execution content, not standing grants. Preserve immutable accepted snapshots, current reauthorization and isolation from retained computer sources.
- Library is the single `@otto/library` backend domain for Files, editable Documents, Collections and Folders. File bytes and Document content retain their distinct storage and permission semantics in the existing tables; this consolidation does not migrate saved data. A File is at most 100,000,000 bytes; only bounded consumers (8 MiB: Skill materialization, model tools, HTML preview) ever hold file bytes in memory. Simple nested Folders (`folders`, nullable `folderId` on Files and Documents; max depth 8) organize them: human-only, same workspace and Project, a `user` Folder holds only its creator's private items, only empty Folders archive, and placement never copies bytes or changes visibility, keys, requests or snapshots. No separate Drive domain, item graph, shortcuts, versions, sync or trash service. The Library page replaces separate Files/Documents lists; existing resource API paths and native action names remain stable. Large bytes use binary `PUT /files/:requestId/content` and verified spool download. Preserve `fileId`/`fileIds`, `file.create`, accepted private identity keys and frozen snapshots. See [Library](docs/library.md) and [File semantics](docs/files.md).
- Skills own instructions, format metadata, supporting files and proposals in `@otto/skills` and the `skills` table. Documents own ordinary content and Collections; never add skill flags or skill data to them.
- Agents, Skills, Documents, Files, Connections and Subscriptions use exactly `user` / `workspace` visibility with the existing workspace and authoritative human identity (`createdBy`, or File custodial `ownerId`). No Organization entity, personal/shared/private/public aliases or duplicate owner/scope model.
- Chats use `workspace | participants` visibility. Server-derived `createdBy` controls metadata/archive/participant management with current writer/Project authority; participant contributors retain discussion and authorized Run controls, explicit viewers cannot write, and Agents always need membership. See [Chats](docs/chats.md) for the one-model contract and retained private identity keys.
- The server derives creation identity. `user` visibility is creator-only. `workspace` visibility requires eligible current membership intersected with resource, role, audience and explicit grant checks.
- Documents and Files have one nonnullable visibility field and creator/custodian-controlled edits; per-user reader/writer ACLs are deferred. File metadata/visibility carries no edit token; immutable upload requests/bytes and saved/current source-Run audiences remain separate fences. Internet publication remains explicit frozen selected shares.
- Connections are external GitHub/MCP accounts with scoped grants. Subscriptions identify authorized native API-key accounts, separate from external Connections; retain one accepted account/model/protocol/endpoint identity per Run/Session. Models remain configured IDs, not a new catalog. Old subscription gateway/device-login execution is removed; real provider qualification remains distinct from controlled SDK fixtures.
- Project/Chat/File metadata and Subscription display edits need no edit token. Connection title-only edits preserve grants/approvals; real Connection policy changes retain their fence.
- Visibility never shares credentials, private Session context or native login, grants provider operations, or automatically shares private dependencies. The one exception is chat attachments: a File attached to a Message stays private to its custodian and is readable by that Chat's participants while they are participants; only the custodian attaches a private File.

## Execution guarantees

- Preserve human Task ownership and human-only authorized Done, Chat participants, private Session context and individual Run attempts.
- Manual Task time lives in `@otto/tasks`/`timesheets`: `duration` is positive whole minutes, not milliseconds or Agent runtime. Server-derived creator and logging timestamp are immutable; only that human with current Task writer access edits/deletes duration/notes, including on Done/archived Tasks. Task readers can read bounded entries; no timers, billing or admin edit-other-person bypass.
- Archive blocks new admission and queued launch. A disabled Routine suppresses scheduled ticks; explicit owner-authorized manual Runs remain allowed. Configuration changes still fence prior queued attempts. Neither archive nor scheduling disable implicitly stops active Runs or invalidates authorized archived-source reads, control or output. Continue checking actual revocation.
- Atomic Run/queue admission, authority checks, explicit uncertain outcomes, attempt/generation/launch fences, immutable bytes and bounded I/O, control and cleanup are required, not optional simplifications.
- Protect retained source scope across native Sessions and join server-tool cleanup before execution reuse. Confined computer provisioning, process-tree termination and Environment lease execution are unavailable, not simulated through this host.
- Native Mastra is the sole agent runtime. Provider credentials, model execution and Otto authority/collaboration remain separate responsibilities. Never silently switch the provider account, model, endpoint protocol or billing channel.
- Computer provisioning remains explicitly unverified until an authorized confined provider is exercised; agent tools operate through authorized Otto domain functions, not host access.
- Qualify adapter/server contracts with controlled fixtures now. Real gateway/provider authorization, isolation and billing qualification come later; claim no automatic portability or account/host-local fallback. A worktree or host subprocess is not an isolated computer. No subscription/account fallback.

## Checks and delivery

- Run applicable formatting, type and integration checks. Use dev/HMR only, not production builds. Tests must exercise production seams and actual permissions/fencing; no wording tests are needed for reversible prose edits.
- Open visible changes in a browser and retain inspected evidence. Report verified, failed and unverified checks honestly.
- Controlled fixtures prove only their exercised behavior, never native isolation, billing or storage certification.
- Backend acceptance requires independent review in a fresh, separate thread by a reviewer other than the author, resolved from the live agent directory. A WIP read or test count is not independent acceptance.
- No deployment, remote creation or push without explicit instruction. Commits require authorization, staged-content inspection and `git commit -s`.
- Do not track this execution in Notion or synchronize it to another external task system. Keep checks and evidence local; return changed files, exact source/evidence hashes, checks and open items for the integrating owner's inspection.
