# Claude

Connect a Claude Pro or Max subscription from Otto. Claude chats run through Otto's built-in
runtime, with the same chat controls as other providers. The Claude CLI is not required.

## Connect Claude

1. Open **Settings > Providers**.
2. Find **Claude** and select **Connect**.
3. Finish the Anthropic sign-in flow in the browser.
4. Copy the authorization code from Anthropic.
5. Paste the code into Otto and select **Connect**.

The environment server completes the exchange and stores the credential. No inbound callback to the
Otto server is required, so this flow also works from a remote browser or mobile client.

## Check the connection

The provider card reports the current state. A connected account can still show **Detected** until a
real provider request succeeds.

- Select **Check OAuth** to test the stored login.
- Select **Reconnect** after an expired or revoked login.
- Disconnect the account to remove its stored credential from this environment.

If the login expires or is revoked, reconnect Claude in **Settings > Providers**. A usage-limit
failure means you should send the message again after the limit resets.

Sign-in state belongs to one environment. Connect Claude again on each separate Otto server that
should use the account.

Chat titles and worktree branch names use the same Otto connection as Claude chats, not a separate
Claude Code login. On a remote connection, credentials stay on the connected environment server.

## Continue a Claude chat

Otto keeps Claude's provider-specific session identity when a chat continues. Changing to an
incompatible provider starts a new provider session instead of reusing Claude's resume state.

Installed plugins and MCP servers stay attached to the Otto chat. A provider change restarts the
provider session with the same enabled plugin set.

## Permissions

Claude maps Otto's chat mode to its own permission behavior. Protected actions still ask even when
the chat uses **Full access**.

See [Permission modes](./permission-modes.md) for the four modes and the actions that always need
approval.
