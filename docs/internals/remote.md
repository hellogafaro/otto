# Remote architecture

> For maintainers. Using Otto? See [remote access](../user/remote-access.md).

A client connects to one Otto server over HTTP and WebSocket. The server owns providers,
projects, threads, git, and filesystem access. Remote access changes how the client
reaches the server. It does not split that runtime.

## Connection targets

The shared client runtime defines three target types:

| Target                    | Use                                                         |
| ------------------------- | ----------------------------------------------------------- |
| `PrimaryConnectionTarget` | The platform-managed local server.                          |
| `BearerConnectionTarget`  | A saved server reached through direct HTTP and WebSocket.   |
| `SshConnectionTarget`     | A server started and forwarded by the desktop SSH launcher. |

Tailscale uses the bearer target. It supplies a reachable address but does not add another
connection type.

A saved target is local to one client. The server remains the source of projects, threads, settings,
and provider state.

## Pairing

The server issues a short-lived pairing credential. A client exchanges it for a scoped bearer
session and saves the connection locally. The pairing credential is single-use for ordinary links.

A pairing URL contains the server address and keeps the credential in the URL fragment. The client
removes the credential from browser history after the exchange. The client then connects directly to
that server. No Otto service proxies the session.

The server may advertise loopback, LAN, Tailscale, or custom HTTPS endpoints. Clients treat those
addresses as hints. A connection attempt is the final reachability check. Automatic LAN discovery
skips Tailscale IPv4 addresses so a tailnet-first interface list does not advertise the same host
as both Local network and Tailscale. Tailscale-only machines stay network-accessible.

## Direct and Tailscale access

Direct LAN and custom HTTPS addresses use the same bearer flow. HTTPS pages can connect only to
HTTPS and WSS servers because browsers block mixed content.

Tailscale Serve can publish the local server through an HTTPS MagicDNS address. The server manages
that mapping when the user enables it. The resulting address still uses ordinary pairing and bearer
authorization.

## Desktop SSH access

The desktop app can start or reuse Otto on an SSH host and open a local port forward. The
remote host owns all server state. The desktop stores an `SshConnectionTarget` and reconnects
through the forwarded endpoint. Managed remote servers exec the resolved CLI without an npm wrapper
so the recorded PID is the server itself. A stop that does not confirm exit keeps ownership files
and reports failure; reconnect waits for that stop on the same target.

SSH is a desktop capability because it requires local process and SSH access. Web and mobile can use
a directly reachable server after normal pairing.

## Desktop shell (hybrid)

The desktop app is a thin native shell around the web app. Its window always loads `otto://app`
(`otto-dev://app` in development), and the shell's protocol handler proxies every request on that
origin to one server:

- the Otto server the desktop is connected to, when one is set (`serverUrl` in the desktop
  settings, an http(s) origin), or
- the bundled local server, or the Vite dev server in development.

So the web UI is whatever that server serves. A fix in `apps/web` reaches desktop users when the
server deploys it and the window reloads; only changes to `apps/desktop` (window, preload, bridge,
menus, protocol) need a new desktop build. The renderer calls the server's API and WebSocket
directly with the account's bearer session, as it does for the local server.

`window.desktopBridge.setServerUrl(url | null)` connects the window: the shell checks that an Otto
server answers at `/.well-known/ottoLegacy/environment`, saves the origin, clears everything the
previous server's app stored on the `otto://app` origin (its session token included) and reloads
the window onto the new server. `getServerUrl()` reads it back. While connected to a remote server,
`getLocalEnvironmentBootstraps()` returns only that server, never a local backend or its bootstrap
credential. If the server stops answering, the shell serves a small page with "Try again" and "Use
this computer". The web app served by the connected server runs with the full bridge, so connect
only to servers you trust.

`window.desktopBridge.version` is the shell's own version (`app.getVersion()`; a development
build reports Electron's version). The web app updates without the shell, so feature-detect shell
capabilities with it, or with the presence of a bridge method, instead of assuming the newest
shell. Shells older than the hybrid desktop have no `version`.

## Environment identity

Each server stores a stable `environmentId` in its state directory. Clients use that identifier to
reject endpoints that point at a different server than the saved target. Remote production web
cookies use that same identity, so two `otto serve` instances on one hostname keep separate
sessions. Initialization publishes a complete ID atomically. Empty or whitespace-only ID files are
repaired using a retained `<stateDir>/environment-id.recovery` file so concurrent and delayed
repairs choose the same ID. Existing nonempty ID files remain authoritative.

Repository identity may group related clones in the interface. It never changes routing. A project
always belongs to one environment.

## Connection ownership

`packages/client-runtime` owns target resolution, retries, transport lifetime, cached projections,
and environment-scoped commands. Web and mobile provide platform storage and lifecycle signals.
React components do not create sockets or retry loops.

See [connection runtime](./connection-runtime.md) and
[environment authentication](./environment-auth.md) for the detailed contracts.
