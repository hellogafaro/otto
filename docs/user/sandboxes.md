# Configure sandboxes

Open **Settings > Computer** to connect Boat. Local workspaces need no credential and are
always available.

Every chat gets its own computer. A chat's sandbox is keyed to the bot and the chat, so two
chats of the same bot never share files, processes or browser logins.

Each computer still keeps a `chats/<chat id>` folder. The chat's shell starts there, and each
repository linked in the project gets its own git worktree there.

Select **Connect** and enter the Boat API key. The environment stores secret values outside
`settings.json`. Clients receive only a redacted marker after a secret is saved.

## Local

Local workspaces run on the environment's own machine. Where the host supports it (sandbox-exec on
macOS, bubblewrap on Linux), commands run inside Mastra's native isolation: writes are limited to the
chat's workspace and temporary directories, and network access stays on. Reads are not restricted on
macOS. Hosts without an isolation backend run Local commands unisolated.

## Choose the default

Only connected services appear in the default sandbox selector. Disconnecting the current default
changes the default to Local.

The default applies to a bot without its own sandbox choice. A bot-specific choice stays in place,
so connect that service before you start the bot.

## Session behavior

Otto stops a Boat computer when that chat is idle and reconnects to the saved VM when work in the
chat resumes. A later turn in the same chat resumes the existing VM instead of creating a new one.
If a remote pause fails, Otto reconnects to the saved VM on the next use.

While a chat is working, Otto pushes Boat's auto-stop back every 2 minutes. When a turn ends, Boat
stops the VM 2 minutes later unless another turn in that chat starts first, and it stops by itself
5 minutes after Otto last reached it, even when Otto is down. A turn waiting on your answer lets
the VM stop; your answer resumes it with its files in place. Running processes such as dev servers
do not survive a stop. Boat's dashboard names each VM `{bot id}_{chat id}`.

Secrets reach Boat commands through a private file on the VM, never in the command text, because Boat
keeps each command's text in its history. Otto requests protected, token-authenticated access for its browser-control
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
