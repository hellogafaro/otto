# Otto

Otto is a local-first agent workspace with web, desktop and mobile clients.

This fork starts from the MIT-licensed [Akeru source](https://github.com/opencoredev/akeru-bot/tree/020a7b5c9630fa7a2a603771cca25128b3cacc15), itself derived from T3 Code. Original copyright and third-party license notices remain intact. Product names, first-party packages, internal identities, environment variables and owned artwork are branded Otto. External providers retain their actual names.

## Development

Use Node 24 and the pnpm version declared in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The launcher reports the API and web ports. `OTTO_HOME` selects a separate state directory. Do not point this foundation at an existing BB/Otto or Akeru database: no saved-data migration is implemented. Development in a linked worktree defaults to a worktree-local `.otto` directory.

Pairing links are single-use. To mint another link for a running dev instance, run `node apps/server/src/bin.ts pair --base-dir <same-state-directory> --public-url <web-origin>` from this checkout. Treat its output as a password; do not publish it. No npm package is configured for this fork, so do not substitute `npx otto` for the source CLI.

## Verification

```sh
pnpm typecheck
pnpm test
```

Package-scoped checks use the repository's Vite+ scripts through pnpm. Use development/HMR, not a production build, for local acceptance. Current source and verification evidence are recorded in `docs/native-acceptance.md`.

## Fork boundaries

The explicitly authorized Akeru replacement supersedes historical runtime and toolchain directions in the preserved root `AGENTS.md` and `DESIGN.md`. Those files and the owned source assets remain unchanged. This phase is a rebrand, not a redesign or new room implementation; see `docs/otto-rebrand.md`.

Git history and the former application's saved data are retained. No public release, npm package, hosted service, deployment or cloud account is implied. Product-hosted endpoints use reserved `.localhost` addresses until owned infrastructure is explicitly configured; upstream provider integrations are not renamed. Do not publish or deploy without separate authorization.
