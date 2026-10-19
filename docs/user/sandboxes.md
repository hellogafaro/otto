# Configure sandboxes

Open **Settings > Computer** to connect E2B, Daytona, Vercel Sandbox, Railway, or Boat. E2B, Daytona,
Vercel Sandbox and Railway run on Mastra's official sandbox packages. Local workspaces need no
credential and are always available.

Every bot gets its own computer. A bot's sandbox is keyed to the bot, so its files and browser logins
are never shared with another bot.

A bot's chats share its computer, so it stays warm between them, but each chat works in its own
folder, `chats/<chat id>`. The chat's shell starts there, and each repository linked in the project
gets its own git worktree there, so two chats never edit the same files or branch. The shared clones
stay in `repos/`.

Select **Connect** and enter the provider credentials. The environment stores secret values outside
`settings.json`. Clients receive only a redacted marker after a secret is saved.

## Local

Local workspaces run on the environment's own machine. Where the host supports it (sandbox-exec on
macOS, bubblewrap on Linux), commands run inside Mastra's native isolation: writes are limited to the
bot's workspace and temporary directories, and network access stays on. Reads are not restricted on
macOS. Hosts without an isolation backend run Local commands unisolated.

## Choose the default

Only connected services appear in the default sandbox selector. Disconnecting the current default
changes the default to Local.

The default applies to a bot without its own sandbox choice. A bot-specific choice stays in place,
so connect that service before you start the bot.

## Session behavior

Otto stops remote sandboxes other than Railway while bots are idle and reconnects to the saved
provider workspace when bot work resumes. E2B pauses, Vercel Sandbox snapshots its filesystem, and
Daytona stops the sandbox. If a remote pause fails, Otto keeps the workspace and retries the pause
while it remains idle, except on Boat, where it reconnects to the saved VM on the next use.

Railway VMs remain running while idle and can continue accruing charges. Connect with a
`RAILWAY_API_TOKEN` and `RAILWAY_ENVIRONMENT_ID`. Previews require a Railway CLI tunnel;
Otto cannot attach its sandbox browser. See [Railway workspaces](railway-sandboxes.md)
for credential rotation and VM cleanup.

Boat runs persistent Linux VMs. Stopping a VM saves a native lifecycle snapshot; resuming it
restores that workspace. Boat stops a VM by itself after 5 idle minutes; while a bot is working, Otto
pushes that back every 2 minutes, and the next turn resumes it with its files in place. Otto requests protected, token-authenticated access for its browser-control
endpoint. If session setup fails, Otto preserves the VM and waits for snapshot cleanup before
reporting the error. Snapshot archival can take up to five minutes; retries wait for that cleanup to
finish. New VMs do not inherit credentials from your Boat account environment.
Boat commands support timeouts of up to ten minutes. Requests for longer timeouts are rejected
before the command starts rather than silently shortened.
If Boat confirms that a saved VM no longer exists, Otto creates a replacement on the next use.
Connection failures and permission errors retain the saved VM identity rather than replacing it.
Connect it with a Boat API key.

Changing a provider credential replaces active sessions that use the connection. A running session
cannot continue with the old credential.
