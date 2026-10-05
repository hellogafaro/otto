# Contributing to Otto

Thanks for your interest in Otto. [AGENTS.md](AGENTS.md) is the full contributor guide;
this page is the short version.

## Setup

You need [Bun](https://bun.sh) and the Infisical CLI (secrets live in Infisical, never in files).

```bash
git clone https://github.com/hellogafaro/otto.git
cd otto
bun install
bun run dev
```

Run installs, generators and package changes from the repository root.

## Working rules

- **Small, cohesive changes.** Make the smallest correct change, reuse what exists and remove dead code before adding more. Removing a feature removes everything behind it (UI, state, IPC, config, storage, tests, strings, docs).
- **Design system.** UI follows [DESIGN.md](DESIGN.md) and `design/ui`. Change a shared look in the `design/ui` component; instance classes are for layout only. Record UI decisions in DESIGN.md in the same change and look at visible changes in a browser.
- **Domains and data.** A domain owns its tables and exposes plain functions. Ids come from `createId()`, storage is SQLite through Drizzle (`bun run db:push`).
- **Strict TypeScript** and the existing patterns of the codebase.

## Checks

Run the typecheck and the tests of what you touched, for example:

```bash
bun run typecheck:all
bun test
```

## Pull requests

1. Branch from `main` with a descriptive name (`feature/…`, `fix/…`, `docs/…`).
2. Commit per cohesive change with a clear message.
3. In the PR, say what changed and why, how you tested it, and include screenshots for UI changes.
4. Do not push to the main repository, deploy or create remotes; maintainers do that.

Open an issue for bugs and feature requests.

## License

By contributing, you agree that your contributions are licensed under the Apache License 2.0.
