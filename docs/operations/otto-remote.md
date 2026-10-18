# Otto Remote operations

> Maintainer runbook for releases, services, and diagnostics. Using Otto? See
> [remote access](../user/remote-access.md).

Otto Remote runs an Otto environment on a machine you control. The supported paths are the
Linux/macOS installer, the Windows PowerShell installer, and the Docker Compose deployment.
Tailscale Serve is the default endpoint; direct loopback plus a user-managed HTTPS proxy is the
fallback. SSH forwarding can be used by the desktop client.

## Installation

The installers download a release manifest, verify its detached signature and SHA-256 checksums,
install the runtime below `~/.local/share/otto` (or the configured install root), and register a
per-user service. Use `--no-tailscale` when Tailscale is managed separately. Otto state lives in
`OTTO_HOME`, or `~/.otto` when it is unset. The installers, the `otto` launcher, and the admin
helpers derive the server's `OTTO_LEGACY_HOME` from that value, so an ambient Otto Legacy home is never used.
Pass `--base-dir PATH` to an `otto` server command to choose another directory explicitly.

```sh
curl -fsSL --proto '=https' https://github.com/hellogafaro/otto/releases/latest/download/install-remote.sh | sh
# or, on Windows:
# irm https://github.com/hellogafaro/otto/releases/latest/download/install-remote.ps1 -OutFile install-remote.ps1
# powershell -NoProfile -ExecutionPolicy Bypass -File .\install-remote.ps1
```

The installers support Linux x64, macOS arm64, and Windows x64 and refuse other platforms; use
Docker or build from source there. No published release carries the Remote archives today (see
[Publishing a release](#publishing-a-release)), so the installers only work against a release that
someone packaged by hand.

The installer records the owned Tailscale Serve mapping and refuses to remove a handler graph that
has changed. If installation or cleanup is interrupted, rerun the same command and inspect the
saved state before retrying.

## Docker

`deploy/docker/compose.yaml` runs Otto and a Tailscale sidecar in one network namespace.
`compose.direct.yaml` binds Otto to loopback for a reverse proxy. Mount only the workspace paths
bots need and keep the `/data` volume backed up before changing image tags.

```sh
docker compose -f deploy/docker/compose.yaml up -d
# Follow the Tailscale login URL when no TS_AUTHKEY is configured.
```

No Docker image is published. Build it from the release tag with
`OTTO_IMAGE=otto-remote:VERSION docker compose build otto` (see `deploy/docker/README.md`). The
image health check polls `/.well-known/ottoLegacy/environment` every 30 seconds.

Account directory and relay services are intentionally outside this release. Pair clients directly
with `otto pair --tailscale`, through a LAN or HTTPS endpoint, or through the desktop-managed SSH
tunnel.

## Administration and diagnostics

The bundled `otto remote` helper supports `status`, `doctor`, `logs`, `update`, `rollback`,
and `uninstall`. `doctor --json` emits the typed `RemoteDoctorReport`; `--repair` only
fixes safe local permissions, log directories, and missing machine credentials. Support bundles
are redacted and written mode 0600.

`otto remote update` works the same way on Linux, macOS, and Windows. It resolves the latest
release, checks the signed `OTTO-REMOTE-MANIFEST.txt` against the pinned release key, verifies the
platform archive's SHA-256, stages it under the install root's `versions` directory, and asks the
running service to start the transactional update. A bad signature or checksum exits non-zero
before anything is staged. On Windows, the hourly `Otto Remote Update` scheduled task runs this
command.

The service launcher snapshots SQLite before an update, runs a trial process, and retains the prior
runtime and database for seven days. An active bot turn defers an update; the hourly timer retries.
Use `otto remote rollback` when a committed update must be reverted.

## Reboot checks

Linux uses systemd user services and enables lingering. macOS uses per-user launch agents; Tailscale
requires the user to remain signed in. Windows uses per-user Task Scheduler tasks. From another
trusted device, check the endpoint and then run `otto remote doctor --json` locally:

```sh
curl -fsS https://MACHINE.TAILNET.ts.net/.well-known/ottoLegacy/environment
systemctl --user is-active otto.service otto-update.timer
```

## Publishing a release

No workflow publishes Otto Remote. The retired release workflow attached the Remote archives,
installers and signed manifest to each GitHub release;
[Release macOS app](../../.github/workflows/release-mac.yml) publishes only the Mac app. To package
Remote by hand, build each archive on its own platform, because the server ships native modules:
`scripts/package-remote.ts archive` stages the `pnpm deploy --prod` runtime with that machine's
Node binary, the `otto` launcher and the admin helpers. Then copy `scripts/install-remote.sh` and
`scripts/install-remote.ps1` beside the archives and run `scripts/package-remote.ts manifest`,
which writes `OTTO-REMOTE-MANIFEST.txt` with SHA-256 lines for the archives, the installers and
the pinned Tailscale package, and signs it.

Signing needs the PKCS#8 PEM Ed25519 private key that matches
`scripts/otto-release-manifest.pub`; the manifest step fails when the key is missing or does not
match. `scripts/verify-release-assets.ts` rejects a release that lacks any of these assets or
contains extra files.
