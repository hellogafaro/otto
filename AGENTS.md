# Otto contributor guide

Otto is a server runtime that owns teammate bots, their chats, projects, tasks, routines and the Library, with web, desktop and mobile clients over one authenticated Effect RPC WebSocket. Read [CONTEXT.md](CONTEXT.md) for product language, [architecture](docs/internals/overview.md) and [workspace layout](docs/internals/workspace-layout.md) before nontrivial work.

## Stack and workspace

- A pnpm workspace driven by vite-plus (`vp`). Strict TypeScript and Effect everywhere: Effect Schema for every contract, Effect services and layers on the server, Atom state in `packages/client-runtime`.
- `packages/contracts` holds the schemas: RPC methods, orchestration commands, events and read model, and the bot tool catalog and inputs (`otto-tools/`).
- `apps/server` is event-sourced: commands go through deciders (`orchestration/decider/`), events land in SQLite `orchestration_events`, projectors write the `projection_*` and `activity` tables, and the in-memory read model is built from those projections.
- Web is React + Vite + Tailwind with the shared components in `apps/web/src/components/ui`. Mobile is Expo; desktop is Electron.
- Every install, generator or package change runs in the repository root and first checks that `package.json` names `otto`.
- Never put secret values in files, messages or logs.

## Changing the data model

- Schema changes are numbered migrations in `apps/server/src/persistence/migrations/`, registered in `migrations.ts`. Never edit a migration that has shipped, and never reset or rewrite saved data except through a migration that preserves it.
- Saved events replay forever. A new field on a saved payload needs a decoding default, and renaming an event type needs a migration that renames the saved rows.
- Keep each change in one place: a field is added to the contract, decided in the decider, recorded in `taskChanges`-style history, projected, then exposed to tools and clients.
- Deciders stay pure over the read model. Checks that need other stores (Library visibility, comment authorship, organization members) run before the command is dispatched.
- The server derives who acted (`by`/`actor`) from the session; a client's own claim is never trusted over it.

## Names

- CRUD verbs everywhere: `create`, `read`, `update`, `delete`, and `list` for pages. Commands are `domain.thing.verb` (`task.time.create`), events past tense (`task.time-created`), RPC methods `domain.verbThing` (`activity.commentDelete`) and bot tools `noun_verb` (`task_comment_update`). Never `add`/`remove` for data. Domain verbs only for actions that aren't CRUD (`library_share`, `message_post`).
- Display labels are `title`; people and protocol identifiers keep `name`. Discriminators are `type`. Timestamps are `createdAt`, `updatedAt` or a meaningful `...At`; who did it is `createdBy`, `updatedBy`, `completedBy`.
- Lists are bounded (at most 100 a page), filter and sort in SQL before the limit, and continue with a sealed cursor. See [Index lists](docs/lists.md).

## Bot tools

- A tool is a catalog entry (`otto-tools/catalog.ts`) plus an input schema (`otto-tools/inputs.ts`). Every bot session gets every tool that has a handler, so a new task tool reaches every bot without per-bot settings.
- The tool schema is the bot's documentation: describe each field's rule with `described(...)` so it shows in the JSON schema the model reads. `null` clears a field only where its schema accepts null.
- Tools refuse with a result the bot can act on: `{ error, message, fields? }`, where `error` is a code such as `invalid_fields`, `not_found` or `not_author`.
- Bots have the same task rights as people: they create, complete, reassign, delete, comment and log time. A task's owner is always a person. Bots mention people, never other bots, so they can't wake each other in a loop.

## UI and design

- Follow [DESIGN.md](DESIGN.md) and keep `bunx @google/design.md lint DESIGN.md` passing. Record every new or changed UI decision there in the same change.
- Change shared looks in the shared component with an `// Otto:` comment, never per instance; instance classes are for layout only.
- Empty states follow DESIGN.md's empty-state rules.

## Small, cohesive changes

- Make the smallest correct change. Remove dead or duplicate code before adding more; reuse existing code and native mechanisms first. No generic repositories, registries, Result envelopes or permission frameworks.
- Match the surrounding code's naming, comment density and idiom. Comments explain why; code says what.

## Checks and delivery

Before editing, list what the change touches: server entry points (RPC, bot tools, reactors), clients (web, desktop, mobile), contracts and saved data, the reverse action (delete after create, reopen after complete) and connection modes (local, remote, reconnect). Mark what doesn't apply.

- Run the focused tests (`vp test run <file>` in the package), `tsgo --noEmit` in each changed package, `vp lint` and `vp fmt`. Tests exercise real commands, projections and permissions, not wording.
- Open visible changes in a real client in an isolated environment and keep the evidence, per [local verification](docs/internals/verification.md). Report what passed, what failed and what wasn't verified.
- Use dev/HMR, not production builds. Test against disposable state, never the user's saved data.
- No push, deployment or remote creation without an explicit request. Commits need authorization, a look at what is staged, and `git commit -s`.
