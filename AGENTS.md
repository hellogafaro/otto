# Otto contributor guide

Otto is a Bun monorepo that started from Craft Agents (see [UPSTREAM](UPSTREAM.md)) and is being rebuilt in place on our own design system. The earlier Otto build lives in history (tag `otto-v1-archive`); its old rules for Postgres, Hono and Better Auth do not apply here.

## Stack and workspace

- Bun and strict TypeScript. The renderer (`apps/electron/src/renderer`, served in the browser by `apps/webui`) is React 19 and Tailwind v4 on `design/ui` (shadcn, Base UI, Lucide).
- Storage is `bun:sqlite`. Every install, generator or package change runs from the repository root after checking `package.json` is the monorepo's.
- Secrets live in Infisical (project `otto`, env `dev`); use the secrets skill. Never put a value in a file, message, log or commit.
- Run the app with `bun run dev`. Work only in the assigned checkout and owned files.

## UI and design

- Follow [DESIGN.md](DESIGN.md): tokens, type, layout, radii, components and do's and don'ts.
- Change a shared look in the `design/ui` component, marked `// Otto:`; instance classes are for layout only.
- The in-place rebuild and what to delete as each part is swapped is tracked in [docs/ui-rebuild.md](docs/ui-rebuild.md). A finished swap deletes its old dependency.
- Record every new or changed UI decision in DESIGN.md in the same change. Open visible changes in a browser and look at them.

## Small, cohesive changes

- Make the smallest correct change. Remove dead or duplicate code before adding more; reuse what exists. YAGNI: add nothing for a need that has not shown up.
- No generic repositories, registries, frameworks or abstraction layers for one use.
- Fix the cause, not the symptom, and look for the same pattern elsewhere.

## Domains and data

- A domain owns its tables and exposes plain functions; other domains call those functions and never read its tables.
- Every row id is `createId()` from `@craft-agent/shared/id` (12 lowercase letters and digits). No uuids, autoincrement or other id shapes.
- Tables are plural snake_case. Display labels are `title`, discriminators `type`, timestamps `createdAt` / `updatedAt`. Getters are `getThing` / `getThings`.
- `secrets` is its own domain: `secrets(id, name, value)`, one `ENCRYPTION_KEY` env (32 bytes), AES-256-GCM, no rotation or versioning. Other domains keep a `secretId`; the value never leaves the server.
- Pi stays lean: one protocol, one endpoint. Provider accounts, sign-in, model discovery and routing belong to the `providers` domain and the gateway that turns the Claude and Codex CLIs into APIs, never to Pi.

## Checks and delivery

- Run typecheck and the tests of what you touched; report verified, failed and unverified checks honestly.
- Commit per cohesive change. Do not push, deploy or create remotes without explicit instruction.
