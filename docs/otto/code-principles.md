# Otto code principles

Guidance for the Otto application in this repository. Canonical product scope is defined in the plan; runtime claims require implementation evidence.

## Scope and principles

Work in the repository being changed unless the task spans repositories. Read the affected flow, product intent, and applicable test guidance first. Match repo language, framework, routing, styling, and package conventions. Keep unrelated cleanup separate.

Less is more. DRY and YAGNI apply to real shared behavior, not superficial similarity. Take the first adequate step: skip unnecessary work, reuse code, use the standard library or platform, use an installed dependency, then add minimum new code. Fix the root cause. Touch the fewest files the correct fix needs. Delete dead code before adding alternatives.

Preserve authorization, security, accessibility, and data-loss protection. Persist user commits atomically or durably reconcile partial work. Make retries safe or report uncertainty. Propagate failures or retain durable retry work. Bound resources, output, retries, and process trees. Fence stale asynchronous results. Keep the smallest meaningful regression check.

## Our models, replaceable integrations

Otto owns its product records, IDs, and behavior. Product and browser-facing types use Otto models, not provider SDK objects.

Use Pi for every Agent and one managed account/model gateway. Keep small domain-owned integration boundaries for Pi, compute, external services/MCP, storage, credentials, and authentication; no browser-selected harness or parallel gateway implementations. Keep provider identifiers and opaque references at these boundaries; integration-specific state stays server-only. Translate inputs, outputs, failures, and capabilities. Unsupported operations must be explicit.

Changing a provider must preserve Otto's authorization, audience, billing, isolation, and recovery rules. Pi Session context and gateway account state can remain provider-bound; never promise automatic portability or substitute accounts.

Keep concrete library choices. Domain-owned Drizzle queries and inferred Hono RPC types need no generic repositories or duplicate models. Adapt actual integration boundaries and extend when needed. This phase stops at the typed computer connector and controlled fixtures; real cloud/local adapters and provisioning await explicit provider selection. The Pi/gateway replacement requires its own exact-source proof; historical ACP tests do not qualify it. No universal plugin framework or wrapper around every dependency.

Business-domain operation dependencies are acyclic; operations and transports use domain APIs rather than another domain's private tables. Schema-only lazy references may form physical relational cycles. Declare foreign keys, checks and indexes in owning Drizzle table builders, with one server schema composition entry. Keep schema imports declared and boundary-checked; no metadata mutation or after-push SQL patch. Before MVP, use native `bun db:push` for development with zero numbered application migrations. Sync only declared public tables; pg-boss owns its queue schema and internal upgrades. Never reset shared/live data or auto-approve destructive schema changes.

## Naming

Files use kebab-case and describe their main export or responsibility. Keep one cohesive domain responsibility per file; related exports can share it. Follow generated-file and route conventions.

Variables/functions use camelCase. Types, interfaces, components, and classes use PascalCase. Module-level fixed constants use SCREAMING_SNAKE_CASE; ordinary local const bindings use camelCase.

Prefer short, meaningful names. Remove redundancy, but keep useful IDs, units, and distinctions: phone, connectionId, timeoutMs, phoneE164. Use domain nouns and plural collections. Use row only when database context makes its meaning clear.

Manual Task timesheets are the narrow duration-unit exception: `duration` stores positive whole minutes (1–2147483647, PostgreSQL integer range), never `durationMs`. `createdAt` is the server logging timestamp, not a backdated work date. `createdBy`, Task and workspace bindings stay immutable; duration/optional notes use creator-only last-write-wins corrections under current Task writer access, without an edit token or updated timestamp. Done/archive does not prevent current-authorized logging or correction. No Agent runtime is recorded as human time.

CRUD names use verb plus domain noun: getTask, getTasks, createTask, upsertTask, updateTask, deleteTask. Use one bounded, filtered plural getter; no getMany prefix or parallel plural aliases. Delete records or memberships with deleteTask/deleteMember/deleteParticipant. Permission verbs describe their effect, such as grantConnectionAccess; handle is for transport/event handlers. Create means new only; upsert intentionally means create-or-update. Implement supported operations, not a CRUD scaffold.

Prefer typed filter/options objects over getByX variants. Ordinary edits use one allowlisted partial update, returning the updated record. Require `editToken` when it prevents a demonstrated lost update or fences queued/configuration authority; do not add it to every record by habit. Keep field-specific authorization inside that atomic update: changing a Task owner requires a human current owner/admin and an eligible new human contributor. Do not add parallel owner, view or metadata setter endpoints. Separate actual permission changes, associations requiring audience checks, and control side effects into explicit verbs such as grantConnectionAccess, assignTask, archiveProject and stopRun; avoid a giant update with unrelated flags.

Otto-owned display labels use `title`: Workspaces, Projects, Agents, Schedules, Connections, Subscriptions and Collection field labels, matching content titles. Keep human names, package names, SQL constraint options, machine identifiers and native GitHub/MCP/ACP/SKILL.md `name` fields intact. The six renamed scalar properties deliberately map to existing SQL `name` columns with `text("name")`; there is one domain/public field, no alias or duplicate storage. New Collection field JSON uses `title`; the owning domain projects old stored label-only `name` to `title` without changing bytes, field identity, edit fences, accepted snapshots or operation identities. Native schemas and public DTOs do not expose parallel aliases.

Otto discriminators use `type`; configuration/edit fences use `editToken` (`agentEditToken` or `scheduleEditToken` only where the accepted reference needs disambiguation). AI account references use `subscriptionId`; external app/MCP references use `connectionId`. The managed `piVersion` pin belongs to trusted server configuration and accepted Run/Session bindings; never expose a harness selector. preserve old accepted snapshots and reject incompatible continuation rather than reinterpret it. Preserve external protocol names and immutable accepted authority; never silently refresh saved scope during a rename.

Creator/maintainer human identity uses `createdBy`, never `createdById`, on Agents, Connections, Subscriptions, Documents and Chats. Derive it from the authenticated human; no writable creator input or duplicate owner field. Task and Schedule `ownerId` is transferable human responsibility; File `ownerId` remains its human custodian/sponsor alongside actual `creatorAgentId` authorship.

Owned SQL tables use plural snake_case. Keep native queue delivery names inside the pg-boss boundary; `schedule_history.id` is its delivery identity and records skipped/deduplicated outcomes, while Runs own execution detail. Mutually exclusive lifecycle configuration uses status, not redundant enabled/archive booleans. Disabled Schedules stay paused while explicit owner-authorized manual Runs remain possible; restore leaves status disabled.

Agent reusable skills persist in `agents_skills` with composite Agent/Skill identity and same-workspace foreign keys, not a parallel JSON list. The bounded `skillIds` input/projection is an unordered selection, hydrated by skill ID; replace it atomically with the Agent edit fence. Keep accepted Run skill instructions/files as immutable JSON evidence. Agent owns reusable skills and the existing many-to-many `connection_grants`; do not add duplicate Connection links. No Project/manual Run skill overrides or Schedule context arrays. Schedule Project scope derives from its output Chat, without a duplicate Project field. Manual selected Document/message/Task content stays bounded, currently authorized and retained in immutable Run scope. Agents, Skills, Documents, Files, Connections and Subscriptions use exactly `visibility: user | workspace` and server-derived human identity (`createdBy`, or File custodial `ownerId`). Sharing permits eligible current workspace use, never configuration ownership, private dependencies or credentials. Documents and Files have one nonnullable visibility field and creator/custodian-only direct edits. Fine-grained reader/writer ACLs are deferred; public internet publication remains explicit frozen selection. Recheck source/recipient access after asynchronous I/O and on retained-context reuse.

Use is/has for predicates, format for presentation, on for callback props, and handle for handlers. Include the subject where scope does not make it clear.

Timestamps describe observed successful mutations: `createdAt`, `updatedAt`, and meaningful state times ending in `At`. Advance `updatedAt` in the same transaction as real successful changes; never fabricate historical timestamps when adding a field. Durations end in `Ms`; byte sizes and counts describe their unit. Numeric replay positions use `cursor`; numeric optimistic-concurrency tokens and Environment generations remain numeric and must not be replaced with timestamps. These fences are not user-facing version history.

## Backend values, pages, and errors

Domain operations return typed values and throw `DomainError` for expected authorization, input, state, and availability failures. Singular getters return a record or throw; they do not invent empty records. Database failures propagate. The server owns HTTP error translation and keeps raw provider errors and invalid values out of responses. One API entry supplies authentication, origin checks, dependencies and workspace transactions to cohesive typed route modules; public frozen-share routes mount before authentication. Reuse small primitive request validators without route-registration frameworks or factories for each module. Provider adapters may retain their own typed protocol errors internally.

Ordinary discovery getters return `{ items, next }`, with `next: null` at the end. Accept a typed filter/options object: optional exclusive `after`, optional integer `limit` from 1 to 100, default 100, and an optional per-domain `sort` allowlist with `order` (see [Discovery lists](../lists.md)). One ordinary HTTP page query is strict and accepts a bounded string cursor; the owning domain builds one `sortPlan` (`@otto/db`) that validates the cursor and sort before querying: id order keeps the plain UUID or human-ID cursor, a sorted order uses a sealed cursor of the typed position. Fetch `limit + 1` candidates ordered in SQL before the limit, then use `pageOf`/`getPage`; authorization filtering uses `filterPage` and preserves the cursor from scanned candidates even when the visible page is empty. A sort value of a scanned row is never exposed in `next`. Never infer continuation from visible item count. Numeric durable replay streams and fixed complete authorization snapshots are separate contracts: retain their ordering and overflow guards rather than silently paginating an authorization decision.

Use the dependency-free `@otto/shared` primitives only for demonstrated repetition: `required`, `parseInput`, page handling, and `withCleanup`. Keep database queries, Hono, Zod schemas and provider SDKs in their owning modules. Do not add a universal repository, Result envelope, or service framework.

Catch only to translate a known boundary failure, clean up, or retain a durable failure/uncertain/retry outcome. Propagate other failures. `withCleanup` releases an acquired resource and preserves both the original error and a cleanup error. Detached rejections must be observed by readiness/shutdown or a durable outcome; an empty result or success response is not error handling. Run the consistency scan for retired names, dependency direction and duplicate transport paths; its catch count is an audit inventory, not proof that error semantics are correct.

## Code and UI

Strict TypeScript, type-only imports, narrowed unknown, and Zod at untrusted boundaries. No any, suppressions, non-null assertions, or unchecked casts to hide uncertainty. Necessary assertions at verified library boundaries must be narrow and explained.

Prefer inferred Zod/domain types. Otherwise use interface for object shapes and type for unions/aliases. Prefer early returns and small functions. Options group related parameters; different behavior can need different functions. Introduce classes only for a concrete need.

Imports: external, internal, then type-only where Biome permits. Let formatting settle ordering. Document exported behavior when names/types are insufficient. Start with one sentence; add permission, error, side-effect, or lifecycle details when needed. Comments explain intent.

UI follows repo routes, configured shadcn CLI, and project tokens. React state/context owns temporary UI state; Query owns server records; validated URL parameters own shareable filters. Add Zustand only when needed. Keep semantics, keyboard access, focus, and necessary loading/error/recovery states. Visual composition remains a separate deliverable.

## Secrets, shell, and checks

Current secrets stay in Infisical, the team secrets manager. Never print, commit, or copy them into ordinary config, logs, messages, or resources. The future database credential-store alternative remains undecided.

Use the configured repo secret wrapper for credential-dependent commands. Commands needing no secrets need no injection. Missing setup means report it and stop only dependent work.

Repo scripts first. Use output compaction when available. Prefer rg, scoped structured output, fast file finding, and existing host CLI/API over scraping. Missing tools get appropriate fallbacks; missing validators are unverified, never passed.

Use Bun for Otto installs/scripts/server; separately qualify the packaged Pi runtime and gateway. An upstream RPC helper that spawns local Node is not an Otto remote ComputerProcess adapter. Run applicable Biome/type checks, Vitest under Bun, and Playwright workflows. Exercise real changed boundaries where needed. Do not write implementation-mirror tests or tests for reversible wording changes. Report passed, failed, and unverified checks. Broaden testing only when changes, failures, or unresolved concerns warrant it.

Project, Chat and File metadata use last-write-wins updates with current authorization and cursor advancement, without edit counters. Subscription identity is immutable; creator-authorized disable/reauth and trusted exact-account qualification use current state under the workspace transaction, without client CAS. Connection title-only edits do not change its policy token or revoke grants; config, credential and visibility edits retain exact approval/saved-scope fences. Content/skill edits and proposals, Task owner/Done, Agent selection/configuration and Schedule schedule changes retain their demonstrated stale-content or execution fences.

Connections are external GitHub/MCP accounts, with scoped `connection_grants`. Subscriptions identify AI accounts, with status `needs_auth | enabled | disabled`; no browser assertion enables an account. Confirmed Infisical-backed OAuth login qualifies them; Computer reports qualify compute capabilities only. The managed CLIProxyAPI Codex/Responses route retains trusted account-specific authorization, retaining creator/visibility/revocation and accepted account/model/billing fences. Pi is the sole Agent runtime; model IDs remain configuration, with no catalog/registry or extra auth tables. Read [the integration map](../pi-gateway-plan.md). Gateway caller keys, account-selection headers and provider OAuth support do not by themselves establish tenant isolation or billing eligibility.

File visibility remains capped by current workspace/Project access and its source Run’s accepted/current audience, including after storage I/O. Metadata edits never rewrite immutable request identity, digest/key or original Agent receipt. Persist only counters actually read: external operation identity already pins Connection token and grant generation, so operation rows need no duplicate counter columns. The complete retained-counter inventory and callers are in [the current cleanup checkpoint](../creator-skills.md).

Chat visibility is `workspace | participants`, not a Document-style ACL. Its server-derived creator alone manages metadata, archive and participants, while current eligible contributors retain discussion/Run controls. Creator identity is not recipient membership: an explicit participant viewer caps writes and Agents always need a participant row. No generic owner framework or per-user Document/File grants are introduced.

Skills own their schema and operations; Documents have no skill flag, format metadata or supporting-file fields. Pure junction tables use both plural entity names (`agents_skills`). New Skill APIs use `skillId`; the private accepted Run/Session skill snapshot key `documentId` remains a storage boundary so retained evidence is not rewritten. Existing skill-as-Document databases require an explicit inspected transfer, never startup conversion or destructive push. See [Skills split](../skills.md).

Files, Documents, Collections and Folders share the `@otto/library` domain. Files retain `files`, `fileId`/`fileIds` and `file.create`; editable Documents retain their own item semantics and tables. Keep accepted private JSON identity keys and frozen shares byte-exact through owning read projections rather than automatic saved-snapshot conversion. The [Library boundary](../library.md) describes this ownership consolidation; native Connection/MCP resources remain their own protocol vocabulary.

Schedules replace Automation vocabulary in current APIs/domain/schema (`@otto/schedules`, `schedules`, `schedule_history`, `scheduleId`). Preserve private accepted request and pg-boss delivery identities at their owning boundaries; no queue rewrite or public aliases. The [offline Schedule rename](../schedules.md) documents populated storage and unchanged manual/cron/owner behavior.
