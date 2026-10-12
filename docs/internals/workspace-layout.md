# Workspace layout

> For maintainers. Using Otto? See [docs/user](../user/).

A pnpm workspace driven by [vite-plus](https://vite.plus) (`vp`). See [scripts.md](./scripts.md) for
the task commands.

## apps

- `apps/server` (`ottoLegacy`): the execution runtime and the published CLI. Owns orchestration, provider
  drivers, checkpointing, VCS, filesystem access, auth, and the HTTP + WebSocket surface.
  Also serves the built web app.
- `apps/web` (`@otto/web`): React + Vite UI. Consumes the shared client runtime and adds routing,
  components, and web-specific platform layers.
- `apps/desktop` (`@otto/desktop`): Electron shell. Supervises a desktop-scoped `ottoLegacy` backend,
  loads the web bundle over the `otto://` protocol, and owns SSH-managed remote environments.
- `apps/mobile` (`@otto/mobile`): Expo/React Native client. Same client runtime composition as
  web, different platform layer and UI.

## packages

- `packages/contracts` (`@otto/contracts`): shared Effect Schema definitions. RPC group,
  orchestration commands/events/read model, auth scopes, environment descriptors, settings.
- `packages/shared` (`@otto/shared`): framework-agnostic utilities used by server and clients
  (`DrainableWorker`, git and remote-URL helpers, semver, logging, observability, and more).
- `packages/client-runtime` (`@otto/client-runtime`): connection lifecycle, authorization, RPC
  session, environment registry, and Atom-based domain state shared by web and mobile. See its
  [README](../../packages/client-runtime/README.md).
- `packages/ssh` (`@otto/ssh`): SSH config parsing, auth prompts, command execution, and the
  tunnel/environment manager behind desktop-managed SSH environments.
- `packages/tailscale` (`@otto/tailscale`): Tailscale CLI wrapper, including the
  `ensureTailscaleServe` / `disableTailscaleServe` serve lifecycle the server drives.
- `packages/effect-acp` (`effect-acp`): Effect client and agent implementation of the Agent Client
  Protocol, used by ACP-speaking provider drivers.
- `packages/effect-codex-app-server` (`effect-codex-app-server`): Effect client for the
  `codex app-server` JSON-RPC protocol.

## Other top-level directories

- `scripts/`: workspace tooling run through `vp run`. Dev runner, desktop artifact builds, release
  helpers, mobile static checks and showcase capture, update-manifest merging.
- `assets/`: brand and app icon sources for development and production builds.
- `patches/`: pnpm patches for pinned upstream dependencies.
- `oxlint-plugin-otto/`: repo-specific lint rules.
- `oxlint-plugin-anti-slop/`: vendored anti-slop lint rules. See [Lint rules](./lint.md).
- `experiments/`: throwaway prototypes. Not part of the shipped build.
- `docs/`: this documentation tree.

## Import conventions

`@otto/shared` and `@otto/client-runtime` use explicit subpath exports with no barrel index and
no root export. Import the narrow path (`@otto/shared/DrainableWorker`,
`@otto/client-runtime/state/threads`) rather than the package root. Files that are not exported
are implementation details. `@otto/contracts` exports a root alongside `./settings`.
