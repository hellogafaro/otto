# Computer isolation: one computer per chat

Otto supports two compute providers: **Local** and **Boat**. Every other sandbox (E2B, Daytona,
Vercel, Railway, Ascii Box, Upstash, Tenki, Otto Cloud) is removed. Saved settings and identity
files that still name a deleted provider fall back to Local or are swept; they do not crash the
server.

A **thread** is an Otto chat. A **computer** is a Mastra workspace (local directory or remote VM).
Each chat gets its own computer on both Local and Boat.

```
Bot
  └── Computer  (one per chat)
        files, processes, ports, browser, Watch target
        shell starts at the computer root; project repos live in repos/
```

There is no shared per-bot home. The first turn in a chat pays for toolbox and clone; later turns
resume the same computer. That is simpler than snapshot-fork, and Boat's start quota is why later
turns must resume rather than create.

## Naming

Scope: `{botId}_{chatId}`, or `thread-{chatId}` when a session has no bot.

The bot id stays in the name so sweep can delete a bot's computers, Boat's dashboard can show
which bot a VM belongs to, and Watch can tell chats of the same bot apart.

Pool key:

- Local: `local:<cwd|no-workspace>:{botId}_{chatId}`
- Boat: `boat:<credentialFingerprint>:{botId}_{chatId}`

Durable id: `otto-` + SHA-256 prefix of that key. Identity lives at
`{stateDir}/bot-workspaces/{id}.json`.

## Lifecycle

### Local

Acquire creates a directory for the chat's computer if none exists. Sleep stops the sandbox
process; the files stay. Sweep deletes the folder when the bot is gone or the sandbox changed.

Two chats of the same bot are two directories. They do not share CPU cgroups or a slot cap;
those are follow-ups if the host gets oversubscribed.

### Boat

Acquire looks up the saved `providerId` and resumes that VM. Create happens only when there is
no identity, or Boat confirms 404. Create uses an idempotency key and a 300s TTL. While a turn
runs, Otto pushes the TTL back every 2 minutes. After the turn, idle shortens it to 120s unless
another turn on _this_ computer is still running.

A later turn in the same chat resumes the existing VM. A new chat creates a new VM.

## Migration

- Settings `defaultProvider` `ascii` becomes Boat. Every other retired default becomes Local.
- Leftover `providers.e2b` / `railway` / … keys are dropped on decode.
- A bot or routine saved as a deleted sandbox becomes Local (`ascii` bots become Boat).
- Identity files for deleted providers are swept as `sandbox_changed`. Otto does not call those
  providers' APIs.
- Identity files keyed only by the bot (`{botId}` or `bot-{botId}`) are swept as `replaced`. The
  next chat turn mints a per-chat computer instead of reusing the old shared VM.
- Unscoped remote records get a 7-day orphan grace, then delete.

## Follow-ups

- Slot cap if 5–10 concurrent Local chats oversubscribe the host.
- cgroup / memory limits on Local.
- Optional bot-home snapshot that new chat computers fork from, if toolbox/clone cost becomes the
  pain.
