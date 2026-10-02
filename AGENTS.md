# Otto contributor guide

Read [README](docs/otto/README.md), [plan](docs/otto/plan.md), [code principles](docs/otto/code-principles.md), relevant research and [testing guidance](TESTING.md) before nontrivial work. Code principles hold the detailed conventions; the settled rules below supersede older conflicting guidance.
This is a fresh Otto Bun monorepo. Historical Buzz code and history stay outside it; do not restore that toolchain or protocol.

## Stack and workspace

- Use Bun, strict TypeScript, Hono/RPC, Zod, PostgreSQL/Drizzle, Better Auth, pg-boss and Pino. Web uses React/Vite/Tailwind/shadcn.
- Preserve shadcn preset `bIkg4yR` and generated `packages/ui` placement. Use Biome and Vitest explicitly under Bun.
- No pnpm, npm lock, Turbo, contracts framework or empty domain packages.
- Every install, generator or package mutation must use the explicit repository working directory and first verify `package.json` name is `otto`.
- Work only in the assigned checkout and owned files. Parallel work requires user authorization, isolated ownership and the project's configured Otto identity. Never overwrite another lane's work.
- Secrets live in Infisical. Read the secrets skill and use its wrapper before credential operations. Never put secret values in files, messages or logs.
- Test PostgreSQL uses a private disposable data directory and socket, never a shared database.

## Small, cohesive changes

- Make the smallest correct change. Remove dead or duplicate code before adding more; reuse existing code or native mechanisms first.
- Apply DRY and YAGNI to demonstrated shared behavior. Add helpers only when they remove real repetition. No generic repositories, contracts, registries, Result envelopes or permission frameworks.
- Keep domain operations cohesive and Hono typed routes thin, with one authentication, origin, context and transaction pipeline.
- Runtime domain-operation dependencies must be acyclic. Use domain APIs across private-table boundaries. Native schema-only lazy references may form relational cycles.
- Keep Otto models and permissions independent of providers through small domain-owned integration boundaries.

## Names and data

- Use `getTask` / `getTasks`, never `getMany` or compatibility aliases. One bounded typed plural getter replaces duplicate variants.
- Keep create, update, upsert and delete semantics explicit. Create means new only; upsert intentionally means create-or-update.
- Ordinary edits use one allowlisted partial update with field-specific authorization, not separate owner, view or metadata setters. Real permission and control transitions may keep explicit verbs.
- Otto display labels use `title`, including Collection fields; human names and native protocol/machine identifiers keep `name`. See code principles for the deliberate physical SQL mapping.
- Otto discriminators use `type`. Timestamps record actual events as `createdAt`, `updatedAt` or meaningful `...At`; numeric replay positions use `cursor`.
- Use `editToken` only for actual stale-edit, queued-policy or authority fences. Preserve distinct attempt and Environment generation fences; do not invent version history.
- All Otto-owned SQL tables use plural snake_case. Keep native pg-boss vocabulary at its boundary; use server `queue.ts`, `startQueue`, `QUEUE_SCHEMA` and PostgreSQL schema `queue`.
- Use lifecycle status enums instead of redundant enabled booleans for mutually exclusive states. Keep unlike Task/Run states and native library flags distinct.
- Before MVP, use native `bun db:push` with zero numbered application migrations. Never reset shared/live data or automatically approve destructive schema changes; pg-boss owns its internal upgrades.

## Configuration and access

- Creator/maintainer identity is server-derived `createdBy`, not `createdById`. Keep transferable Task/Automation `ownerId` and Artifact human custodian/sponsor separate from Agent authorship.
- Agent skills persist only in the workspace-safe `agent_skills` junction; bounded `skillIds` is a selection/projection, not a second stored array. Accepted Run snapshots remain immutable. Agent is the sole reusable configuration for skills and Connection grants. No manual skill overrides or Project defaults for those settings.
- Automations hold trigger, body, Agent and output destination; Project derives from the current output Conversation. Do not add skill, Document or message override arrays.
- Bounded manual Run selections of Documents, messages and Tasks are execution content, not standing grants. Preserve immutable accepted snapshots, current reauthorization and isolation from retained computer sources.
- Skills remain Documents; do not add a skill table.
- Agents, Documents (including skills), Artifacts, Connections and Subscriptions use exactly `user` / `workspace` visibility with the existing workspace and authoritative human identity (`createdBy`, or Artifact custodial `ownerId`). No Organization entity, personal/shared/private/public aliases or duplicate owner/scope model.
- Conversations use `workspace | participants` visibility. Server-derived `createdBy` controls metadata/archive/participant management with current writer/Project authority; participant contributors retain discussion and authorized Run controls, explicit viewers cannot write, and Agents always need membership.
- The server derives creation identity. `user` visibility is creator-only. `workspace` visibility requires eligible current membership intersected with resource, role, audience and explicit grant checks.
- Documents and Artifacts have one nonnullable visibility field and creator/custodian-controlled edits; per-user reader/writer ACLs are deferred. Artifact metadata/visibility carries no edit token; immutable upload requests/bytes and saved/current source-Run audiences remain separate fences. Internet publication remains explicit frozen selected shares.
- Connections are external GitHub/MCP accounts with scoped grants. Subscriptions hold native AI account qualification (`needs_auth`, `enabled`, `disabled`), not credentials, billing or harnesses. Only trusted exact computer reports enable them; select one `subscriptionId` per Agent/accepted Run/Session. Models remain configured IDs.
- Project/Conversation/Artifact metadata and Subscription display edits need no edit token. Connection title-only edits preserve grants/approvals; real Connection policy changes retain their fence.
- Visibility never shares credentials, private Session context or native login, grants provider operations, or automatically shares private dependencies.

## Execution guarantees

- Preserve human Task ownership and human-only authorized Done, Conversation participants, private Session context and individual Run attempts.
- Archive blocks new admission and queued launch. A disabled Automation suppresses scheduled ticks; explicit owner-authorized manual Runs remain allowed. Configuration changes still fence prior queued attempts. Neither archive nor scheduling disable implicitly stops active Runs or invalidates authorized archived-source reads, control or output. Continue checking actual revocation.
- Atomic Run/queue admission, Environment leases, authority checks, explicit uncertain outcomes, attempt/generation/launch fences, immutable bytes and bounded I/O, control and cleanup are required, not optional simplifications.
- Protect retained source scope across fresh Sessions. Require confirmed remote process-tree stop and joined server-tool cleanup before Environment reuse.
- This backend phase implements compute models and the existing small typed provider-agnostic internal connector only. Per-Agent provisioning and cloud/local provider selection are deferred; add no adapters, SDK framework or Mastra dependency.
- Qualify adapter/server contracts with controlled fixtures now. Real provider, isolation and native billing qualification come later; claim no automatic portability or account/host-local fallback. A worktree or host subprocess is not an isolated computer. No subscription/account fallback.

## Checks and delivery

- Run applicable formatting, type, build and integration checks. Tests must exercise production seams and actual permissions/fencing; no wording tests are needed for reversible prose edits.
- Open visible changes in a browser and retain inspected evidence. Report verified, failed and unverified checks honestly.
- Controlled fixtures prove only their exercised behavior, never native isolation, billing or storage certification.
- Backend acceptance requires independent review in a fresh, separate thread of the project's configured Otto identity. A WIP read or test count is not independent acceptance.
- No deployment, remote creation or push without explicit instruction. Commits require authorization, staged-content inspection and `git commit -s`.
- Track Otto/internal work in repository documentation and BB, never Notion. Return changed files, exact source/evidence hashes, checks and open items for the integrating owner's inspection.
