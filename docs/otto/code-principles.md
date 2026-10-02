# Otto code principles

Guidance for the future Otto app. This does not replace the current Buzz checkout's instructions. Argus passed the documentation review with no findings, 9/10 across all criteria. Implementation remains unverified.

## Scope and principles

Work in the repository being changed unless the task spans repositories. Read the affected flow, product intent, and applicable test guidance first. Match repo language, framework, routing, styling, and package conventions. Keep unrelated cleanup separate.

Less is more. DRY and YAGNI apply to real shared behavior, not superficial similarity. Take the first adequate step: skip unnecessary work, reuse code, use the standard library or platform, use an installed dependency, then add minimum new code. Fix the root cause. Touch the fewest files the correct fix needs. Delete dead code before adding alternatives.

Preserve authorization, security, accessibility, and data-loss protection. Persist user commits atomically or durably reconcile partial work. Make retries safe or report uncertainty. Propagate failures or retain durable retry work. Bound resources, output, retries, and process trees. Fence stale asynchronous results. Keep the smallest meaningful regression check.

## Our models, replaceable integrations

Otto owns its product records, IDs, and behavior. Product and browser-facing types use Otto models, not provider SDK objects.

Use small domain-owned adapters for agent harnesses, compute, external services/MCP, storage, credentials, and authentication. Keep provider identifiers and opaque references at these boundaries; integration-specific state stays server-only. Translate inputs, outputs, failures, and capabilities. Unsupported operations must be explicit.

Changing a provider must preserve Otto's authorization, audience, billing, isolation, and recovery rules. Native Session context and login can remain provider-bound; never promise automatic portability or substitute accounts.

Keep concrete library choices. Domain-owned Drizzle queries and inferred Hono RPC types need no generic repositories or duplicate models. Adapt actual integration boundaries, implement one provider first, and extend when needed. No universal plugin framework or wrapper around every dependency.

## Naming

Files use kebab-case and describe their main export or responsibility. Keep one cohesive domain responsibility per file; related exports can share it. Follow generated-file and route conventions.

Variables/functions use camelCase. Types, interfaces, components, and classes use PascalCase. Module-level fixed constants use SCREAMING_SNAKE_CASE; ordinary local const bindings use camelCase.

Prefer short, meaningful names. Remove redundancy, but keep useful IDs, units, and distinctions: phone, connectionId, timeoutMs, phoneE164. Use domain nouns and plural collections. Use row only when database context makes its meaning clear.

CRUD names use verb plus domain noun: getTask, getManyTasks, createTask, upsertTask, updateTask, deleteTask. Prefer get/getMany over list and delete over remove for records. Create means new only; upsert intentionally means create-or-update. Implement only supported operations, not a CRUD scaffold.

Prefer typed filter/options objects over getByX variants. Allowlist editable fields and bound queries. Separate distinct permissions, transitions, and side effects into explicit verbs such as assignTask, archiveProject, stopRun; avoid a giant update with unrelated flags.

Use is/has for predicates, format for presentation, on for callback props, and handle for handlers. Include the subject where scope does not make it clear.

## Code and UI

Strict TypeScript, type-only imports, narrowed unknown, and Zod at untrusted boundaries. No any, suppressions, non-null assertions, or unchecked casts to hide uncertainty. Necessary assertions at verified library boundaries must be narrow and explained.

Prefer inferred Zod/domain types. Otherwise use interface for object shapes and type for unions/aliases. Prefer early returns and small functions. Options group related parameters; different behavior can need different functions. Introduce classes only for a concrete need.

Imports: external, internal, then type-only where Biome permits. Let formatting settle ordering. Document exported behavior when names/types are insufficient. Start with one sentence; add permission, error, side-effect, or lifecycle details when needed. Comments explain intent.

UI follows repo routes, configured shadcn CLI, and project tokens. React state/context owns temporary UI state; Query owns server records; validated URL parameters own shareable filters. Add Zustand only when needed. Keep semantics, keyboard access, focus, and necessary loading/error/recovery states. Visual composition remains a separate deliverable.

## Secrets, shell, and checks

Current secrets stay in Infisical, the team secrets manager. Never print, commit, or copy them into ordinary config, logs, messages, or artifacts. The future database credential-store alternative remains undecided.

Use the configured repo secret wrapper for credential-dependent commands. Commands needing no secrets need no injection. Missing setup means report it and stop only dependent work.

Repo scripts first. Use output compaction when available. Prefer rg, scoped structured output, fast file finding, and existing host CLI/API over scraping. Missing tools get appropriate fallbacks; missing validators are unverified, never passed.

Use Bun for Otto installs/scripts/server; native harnesses retain required runtimes. Run applicable Biome/type checks, Vitest under Bun, and Playwright workflows. Exercise real changed boundaries where needed. Do not write implementation-mirror tests or tests for reversible wording changes. Report passed, failed, and unverified checks. Broaden testing only when changes, failures, or unresolved concerns warrant it.
