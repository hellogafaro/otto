# Install Otto

This fork currently runs from its source checkout. No npm package, signed installer or public
release has been qualified for this replacement. Use Node 24 and the pinned pnpm version:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Desktop app

Desktop packaging is retained in source, but producing and verifying Otto installers is separate
work. The inherited targets are:

- macOS: Apple silicon DMG
- Windows: Windows 10 or 11 x64 installer
- Linux: x86_64 AppImage

Open the app and follow setup to connect an account and create a bot. You can also connect an account
later under **Settings > Providers**. The desktop app manages the local server.

## Command-line server

The development CLI runs directly from this checkout:

```bash
node apps/server/src/bin.ts --help
```

The `otto` commands in the operational documentation assume an explicitly installed, trusted
Otto binary. In this checkout, use `node apps/server/src/bin.ts` instead. Do not use a similarly
named public npm package as a substitute.

Use the [background service](./background-service.md) when the server must stay available after you
close the terminal.

## Connect a subscription

Open **Settings > Providers**. Mobile lists these options under **Provider connections**:

| Account         | Supported access                        |
| --------------- | --------------------------------------- |
| ChatGPT         | Plus, Pro, Business, Enterprise, or Edu |
| Claude          | Pro or Max                              |
| Grok            | Shared xAI login                        |
| Kimi For Coding | Kimi For Coding plan                    |
| OpenCode Go     | OpenCode Go API key                     |

Select **Connect** and finish the provider's sign-in flow. ChatGPT, Grok, and Kimi use a device code.
Claude asks you to paste the returned authorization code into Otto. OpenCode Go asks you to paste an API key.

The environment server owns the connection. It currently saves one subscription account or API
key per provider per environment. Reconnecting replaces that credential. Separate provider instances
can have different runtime settings, but share the saved provider credential. The server stores
credentials outside the workspace. Clients receive connection status, sign-in progress, and an
account identifier when the provider supplies one; they never receive the credential.

After sign-in, select **Check** to test an OAuth login or **Check key** to test an API key.
Use **Reconnect** after a revoked or expired login. Otto cannot verify whether an xAI login includes
SuperGrok or X Premium+.

### Connect an API key

Web and desktop use **Settings > Providers**. Mobile uses **Settings > Providers > Provider connections**.
Select an environment first if you have more than one environment.

ChatGPT, Claude, Grok, Kimi For Coding, and OpenCode Go accept API keys. Select **API key** beside a
provider. For OpenCode Go, select **Connect**.

Enter the key in the password field. Optionally enter a **Base URL** for a compatible endpoint.
Grok uses its default endpoint and does not show a Base URL field.
Leave the URL empty to use the provider default. The URL must use HTTP or HTTPS and must not contain
credentials, a query, or a fragment. The environment sends the key to this endpoint, so use an endpoint
you trust. API billing can be separate from your subscription.

Select **Save** to store the key on the environment. **Cancel** discards the form. A saved key has not
necessarily passed a provider request; select **Check key** to check access.

Use **Replace key** to replace the key or change the endpoint.
The form shows the saved endpoint but never shows the saved key. Enter the key again when you change
the endpoint. Use **Use OAuth** to return to subscription login where supported. **Disconnect** removes
the saved connection from the environment.

## What Otto runs

Codex, Claude, Grok, Kimi For Coding, OpenCode Go, and Custom API use Otto's custom Mastra-based runtime.
Otto supplies the workspace, memory, plugins, approval rules, and subscription access for each
chat.

Claude and Grok use their provider adapters. OpenCode Go uses Otto's Mastra-based runtime.
Both paths keep provider-specific session and permission behavior behind the same Otto chat interface.

## Next steps

- [Configure bots](./bots.md)
- [Choose a permission mode](./permission-modes.md)
- [Connect another device](./remote-access.md)
- [Use Codex](./providers-codex.md)
- [Use Claude](./providers-claude.md)
