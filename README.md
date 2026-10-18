<p align="center">
  <img src="assets/readme-icon.png" width="128" height="128" alt="Otto app icon">
</p>

<h1 align="center">Otto</h1>

<p align="center">A shared workspace where your team and its bots get work done together.</p>

## Why Otto

- **One place for people and bots.** Invite your team, chat with a bot alone or in a group, and
  hand it a task. The bot keeps the task's history, so nobody has to repeat themselves.
- **You stay in control.** Bots ask before they act. Approve or decline right in the chat, or always
  allow an action you trust.
- **Bots that do the work, not just talk about it.** Each bot gets its own computer and can use your
  GitHub, connected apps and MCP servers. Recurring work runs on a schedule with routines.
- **Use the AI you already pay for.** Connect a ChatGPT or Claude subscription, or an API key.
- **Reach bots where you already talk**, such as Slack, Telegram or Discord.
- **Your data stays yours.** Otto runs on your own server. Chats, files and settings live there,
  not with us.

## Download

Get the signed Mac app from [GitHub Releases](https://github.com/hellogafaro/otto/releases). It
updates itself, and Settings > General > Updates switches between the Stable and Beta channels.

## Host it yourself

Otto is one Docker image that serves the app on port 3773 and keeps everything on a volume at
`/data`. The first person to open a new Otto becomes its owner and invites the rest.

**Railway:** create a service from this repository with the Dockerfile at
`deploy/docker/Dockerfile`, a volume at `/data` and a public domain. Step by step:
[deploy/railway/README.md](deploy/railway/README.md).

**Docker:** on any server with Docker Compose:

```sh
export OTTO_PUBLIC_URL=https://otto.example.com
export OTTO_ENCRYPTION_KEY="$(openssl rand -base64 32)"
docker compose -f deploy/docker/compose.yaml up -d --build --wait
```

HTTPS, mail, backups and updates: [deploy/docker/README.md](deploy/docker/README.md).

The settings that matter:

| Variable              | What it does                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| `OTTO_PUBLIC_URL`     | The address people open, for example `https://otto.example.com`.                |
| `OTTO_ENCRYPTION_KEY` | Seals the credentials Otto saves. Keep it in a password manager; don't lose it. |
| `PORT`                | Railway only: set it to `3773` so Railway routes traffic to Otto.               |
| `COMPOSIO_API_KEY`    | Optional. Lets everyone connect apps through Composio.                          |

## Build it yourself

In case you don't trust our builds, which is fine. You need Node 24.13 or newer and pnpm 11
(`corepack enable` picks the version this repository pins).

```sh
git clone https://github.com/hellogafaro/otto.git
cd otto
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the server and the web app and prints the address to open.

To build the Mac app you also need Xcode; the build uses its own macOS SDK:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
SDKROOT=$(xcrun --sdk macosx --show-sdk-path) \
pnpm dist:desktop:dmg:arm64
```

The DMG lands in `release/`. Without your own Developer ID the app is signed ad hoc: it runs on your
Mac but doesn't update itself. Signing and releases:
[deploy/desktop-mac/README.md](deploy/desktop-mac/README.md).

## License

MIT. See [LICENSE](LICENSE).
