<p align="center">
  <img src="design/brand/otto-app-icon.svg" alt="Otto" width="96" />
</p>

# Otto

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

Otto is an agent workspace for Claude, ChatGPT and local models. It runs as a
desktop app (Electron) and as a browser UI served by a headless server, both on
the same server code.

- **Agents and sessions**: run many agent sessions side by side, with status, labels, skills and automations.
- **Sources**: connect MCP servers, REST APIs and local folders, and let the agent set them up.
- **Connections**: sign in with Claude, ChatGPT/Codex or GitHub Copilot, use API keys, or point at a local model.
- **Permission modes**: Explore, Ask to Edit and Auto, with customizable rules.

Otto is under active development and being rebuilt on its own design system;
expect rough edges.

## Quick start

You need [Bun](https://bun.sh) and the [Infisical CLI](https://infisical.com/docs/cli/overview)
(secrets live in the Infisical project `otto`, env `dev`; never put values in files).

```bash
bun install
bun run dev        # pushes the db schema, then serves the app with `infisical run --env dev`
```

Desktop build: `bun run electron:start`. Contributor rules, checks and conventions are in
[AGENTS.md](AGENTS.md).

## Project layout

- `apps/electron`: the desktop app and its React renderer.
- `apps/webui`: the same renderer in the browser, talking to the server over WebSocket.
- `apps/cli`, `apps/viewer`: the terminal client and the read-only session viewer (sharing is planned, the hosted viewer is not live yet).
- `packages/`: shared domains and services (`core`, `shared`, `server`, `server-core`, `pi-agent-server`, `ui`, messaging and session tools).
- `design/`: the design system (`design/ui`, shadcn on Base UI and Lucide) and brand sources (`design/brand`).

## Docs

- [DESIGN.md](DESIGN.md): tokens, type, layout and components.
- [docs/ui-rebuild.md](docs/ui-rebuild.md): the in-place UI rebuild and what is deleted as each part is swapped.
- [docs/cli.md](docs/cli.md): the command-line client.
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [TRADEMARK.md](TRADEMARK.md).

## Origin

Otto started from [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss) by
Craft Docs Ltd. (Apache-2.0). See [UPSTREAM.md](UPSTREAM.md) for the exact commit.

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Otto name and logo are
covered by [TRADEMARK.md](TRADEMARK.md).
