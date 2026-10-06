# Otto contributor guide

Otto is a Bun monorepo that started from Otto (see [UPSTREAM](UPSTREAM.md)) and is being rebuilt in place on our own design system. The earlier Otto build lives in history (tag `otto-v1-archive`); its old rules for Postgres, Hono and Better Auth do not apply here.

## Stack and workspace

- Bun and strict TypeScript. The renderer (`apps/electron/src/renderer`, served in the browser by `apps/webui`) is React 19 and Tailwind v4 on `design/ui` (shadcn, Base UI, Lucide).
- Storage is SQLite through Drizzle (below). Every install, generator or package change runs from the repository root after checking `package.json` is the monorepo's.
- Secrets live in Infisical (project `otto`, env `dev`); use the secrets skill. Never put a value in a file, message, log or commit.
- Run the app with `bun run dev`. Work only in the assigned checkout and owned files.

## UI and design

- Follow [DESIGN.md](DESIGN.md): tokens, type, layout, radii, components and do's and don'ts.
- Change a shared look in the `design/ui` component, marked `// Otto:`; instance classes are for layout only.
- The in-place rebuild and what to delete as each part is swapped is tracked in [docs/ui-rebuild.md](docs/ui-rebuild.md). A finished swap deletes its old dependency.
- A shortcut or command is always shown with the `Kbd` component (in a tooltip: the label, then its `Kbd`), never as text like "(Esc)".
- Copy never hardcodes the product or an agent's name: use `PRODUCT_NAME` (`@otto/shared/branding`; `{{product}}` in i18n strings) and the agent's name from state; write "your agents" where no agent is in context.
- Record every new or changed UI decision in DESIGN.md in the same change. Open visible changes in a browser and look at them.

## Small, cohesive changes

- Follow [Ponytail](https://github.com/dietrichgebert/ponytail): before writing code, stop at the first rung that holds. Does it need to exist? Is it already in this codebase? Does the standard library, the platform or an installed dependency do it? Is it one line? Only then write the minimum that works. A deliberate shortcut is fine when marked with its limit.
- Make the smallest correct change. Remove dead or duplicate code before adding more; reuse what exists. YAGNI: add nothing for a need that has not shown up.
- No generic repositories, registries, frameworks or abstraction layers for one use.
- Removing a feature removes the code behind it: the UI, its state and handlers, IPC channels, config keys, storage, tests, locale strings and docs. Nothing stays "dormant"; a leftover is a bug in the removal.
- Fix the cause, not the symptom, and look for the same pattern elsewhere.
- Files and directories are kebab-case (`panel-header.tsx`, `use-update-checker.ts`); component and hook identifiers keep their names. Exempt: conventional all-caps docs (README, AGENTS, ...), `Dockerfile*`, Python files, `__tests__`, GitHub templates, locale codes. `bun test scripts/file-names.test.ts` enforces it.

## Domains and data

- A domain owns its tables and exposes plain functions; other domains call those functions and never read its tables.
- Every row id is `createId()` from `@otto/shared/id` (12 lowercase letters and digits). No uuids, autoincrement or other id shapes.
- Names are in [docs/schema.md](docs/schema.md). Tables and columns are snake_case (`workspace_id`, `created_at`), written as the explicit name in each builder (`workspaceId: text('workspace_id')`; TypeScript properties stay camelCase, no Drizzle `casing`). Display labels are `title`, discriminators `type`, tree parents `parent_id`, order `position`, timestamps `created_at` / `updated_at` (ms; `updated_at` only where something reads it). A flag with a moment is one nullable `*_at` (`read_at`, `paused_at`), not a boolean. Every workspace-scoped table has `workspace_id`. `getThing` / `getThings` only read existing data; when a function does more than read, name what it does: `init…` (set up once, at boot or first use), `create…`, `update…`, `delete…`, `run…`, `handle…`.
- `library` is the one singular table name (owner-approved): it holds files, documents and folders as one kind of item.
- `secrets` is its own domain: `secrets(id, title, value)`, one `ENCRYPTION_KEY` env (32 bytes; the server refuses to boot without it; dev has a placeholder in Infisical), AES-256-GCM, no rotation or versioning. Other domains keep a `secretId`; the value never leaves the server.
- Drizzle on `bun:sqlite`. Each domain keeps its tables in its own `schema.ts` and queries through `initDb()` from `@otto/shared/db`; only `db/` and the `schema.ts` files know the database is SQLite, so Postgres later swaps the driver and the `sqlite-core` imports.
- No migrations until the MVP is stable: `bun run db:push` (run by `bun run dev`) diffs every `schema.ts` against the database and applies it, and refuses data loss without `--force`. Tests build a `:memory:` db with `openDb(':memory:')` and `pushSchema`.
- Pi is the only harness: no second harness, no agent abstraction over it. Subscription bridges (Claude) are Pi providers registered by `pi-agent-server`; provider accounts and sign-in stay in the `connections` domain, never in Pi.

## Checks and delivery

- Run typecheck and the tests of what you touched; report verified, failed and unverified checks honestly.
- Commit per cohesive change. Do not push, deploy or create remotes without explicit instruction.
