# Otto Electron App

The primary desktop interface for Otto, built with Electron + React. Provides a multi-session inbox with chat interface for interacting with Claude via Otto workspaces.

## Quick Start

```bash
# From the project root
bun run electron:build   # Build the app
bun run electron:start   # Build and run
```

## Architecture

```
apps/electron/
├── src/
│   ├── main/              # Electron main process: a shell, no database (docs/desktop.md)
│   │   ├── index.ts       # Window creation, app lifecycle, main's own RPC server
│   │   ├── server-process.ts # The server child (packages/server under Bun): start, wait, stop
│   │   ├── handlers/      # Main's channels: windows, update, badge, notifications, browser panes
│   │   ├── menu.ts        # Application menu (File, Edit, View, Help)
│   │   └── deep-link.ts   # Deep link URL parsing and handling
│   ├── preload/           # Context bridge (main ↔ renderer)
│   │   └── bootstrap.ts   # Connects to main and to the server child, exposes electronAPI
│   ├── renderer/          # React UI
│   │   ├── app.tsx        # Main app, event handling
│   │   ├── components/
│   │   │   ├── chat/      # Chat UI (ChatInput, ChatDisplay)
│   │   │   ├── markdown/  # Markdown renderer with Shiki
│   │   │   └── ui/        # shadcn/ui components (incl. source-avatar.tsx)
│   │   ├── contexts/
│   │   │   └── navigation-context.tsx  # Type-safe routing and navigation
│   │   ├── lib/
│   │   │   └── navigate.ts  # Global navigate() function
│   │   ├── hooks/
│   │   │   └── useAgentState.ts  # Agent activation state machine
│   │   └── playground/    # Component development playground
│   └── shared/
│       ├── types.ts       # Shared TypeScript interfaces
│       ├── routes.ts      # Type-safe route definitions
│       └── route-parser.ts # Route string parsing
├── dist/                  # Build output
└── resources/             # App icons
```

## Key Learnings & Gotchas

### 1. Claude Code binary

Otto does not ship the Claude Agent SDK's per-platform native `claude` binary (`@anthropic-ai/claude-agent-sdk-{platform}-{arch}`, ~210 MB). The packaged app carries only the thin SDK core (`@anthropic-ai/claude-agent-sdk`); Claude subscriptions run the user's own installed `claude`, found on `PATH` or through `OTTO_CLAUDE_PATH`.

### 2. AgentEvent Type Mismatches

The `AgentEvent` types from `Otto` use different property names than you might expect:

| Event Type | Wrong | Correct |
|------------|-------|---------|
| `text_delta` | `event.delta` | `event.text` |
| `error` | `event.error` | `event.message` |
| `tool_result` | `event.toolName` | Only has `event.toolUseId` |

**Solution for tool_result:** Track `toolUseId → toolName` mapping from `tool_start` events:
```typescript
interface ManagedSession {
  // ...
  pendingTools: Map<string, string>  // toolUseId -> toolName
}

// In tool_start handler:
managed.pendingTools.set(event.toolUseId, event.toolName)

// In tool_result handler:
const toolName = managed.pendingTools.get(event.toolUseId) || 'unknown'
managed.pendingTools.delete(event.toolUseId)
```

### 3. Otto Constructor

`Otto` expects the full `Workspace` object, not just the ID:

```typescript
// Wrong:
new Otto({ workspaceId: workspace.id, model })

// Correct:
new Otto({ workspace, model })
```

### 4. Main and the server

Main runs under Electron's Node and has no server code: `bun run electron:build:main` bundles it with only `electron` external and fails when the bundle requires `bun:` (a sign it reached the database). The same script bundles the server into `dist/server.js` (`bun build --target bun`), which the packaged app runs under `vendor/bun`; in dev main runs `packages/server/src/index.ts` with `bun`.

## Environment Variables

### OAuth client ids

Secrets live in Infisical (project `otto`, env `dev`). Build-time OAuth client ids are read from the environment (or a local `.env`) and baked into main via esbuild `--define` flags (`scripts/electron-build-main.ts`).

**Creating your own OAuth credentials:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth Client ID (Web application type) — add your OAuth relay's `/auth/callback` URL as an authorized redirect URI
3. Enable required scopes in OAuth consent screen:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`

## Build Process

```bash
bun run electron:build:main      # Bundle main process (esbuild) and the server child (bun build)
bun run electron:build:preload   # Bundle preload script (esbuild)
bun run electron:build:renderer  # Bundle React app (Vite)
bun run electron:build:resources # Copy icons
bun run electron:build           # All of the above
```

## macOS Liquid Glass Icon

The app includes a pre-compiled `Assets.car` for macOS 26+ Liquid Glass icons. This enables the layered glass effect on macOS Tahoe. On older macOS versions, the app falls back to `icon.icns`.

**Regenerating after icon changes:**

If you modify `resources/icon.icon`, regenerate the Assets.car:

```bash
cd apps/electron
xcrun actool "resources/icon.icon" --compile "resources" \
  --app-icon AppIcon --minimum-deployment-target 26.0 \
  --platform macosx --output-partial-info-plist /dev/null
```

> **Note:** This requires macOS 26 with Xcode 26 (macOS 26 SDK). The pre-compiled Assets.car is committed to the repo so CI builds work without the SDK.

## Debugging

Enable console logging by checking the terminal where you ran `electron:start`. Key log prefixes:
- `[SessionManager]` - Session lifecycle, auth setup
- `[IPC]` - Inter-process communication

DevTools opens automatically (configured in `index.ts`). Remove `mainWindow.webContents.openDevTools()` for production.

## Current Limitations

1. **In development only** - No electron-builder config for distribution

## Implemented Features

- **Session persistence** - Sessions, messages, and names are saved to disk
- **File attachments** - Attach images, PDFs, and code files to messages
- **AI-generated titles** - Sessions get automatic titles after first exchange
- **Subagent support** - Load and apply agent definitions from documents
- **Shell integration** - Open URLs in browser, open files in default apps
- **Permission modes** - Three-level permission system (Explore, Ask to Edit, Auto)
- **Multi-file diff** - VS Code-style window for viewing all file changes in a turn
- **Dynamic statuses** - Workspace-customizable session workflow states
- **Theme system** - Cascading themes (app → workspace → agent)
- **Agent state machine** - useAgentState hook manages activation flow
- **Application menu** - Standard macOS/Windows menus with keyboard shortcuts
- **Component playground** - Development tool for testing UI components in isolation
- **Type-safe navigation** - Unified routing system for tabs, actions, and deep links

## Navigation System

The app uses a type-safe routing system for all internal navigation and deep links.

### Quick Start

```typescript
import { navigate, routes } from '@/lib/navigate'

// Tab routes
navigate(routes.tab.settings())           // Open settings
navigate(routes.tab.chat('session123'))   // Open chat
navigate(routes.tab.agentInfo('claude'))  // Open agent info

// Action routes
navigate(routes.action.newChat({ agentId: 'claude' }))  // New chat with agent
navigate(routes.action.deleteSession('id'))             // Delete session

// Sidebar routes
navigate(routes.sidebar.inbox())          // Show inbox
navigate(routes.sidebar.flagged())        // Show flagged
```

### Deep Links

External apps can navigate using `otto://` URLs:

```
otto://settings
otto://allSessions/session/session123
otto://sources/source/github
otto://action/new-chat
otto://workspace/{id}/allSessions/session/abc123
```

See `CLAUDE.md` for complete route reference.

## File Overview

| File | Purpose |
|------|---------|
| `main/index.ts` | App entry, window creation |
| `main/sessions.ts` | Otto wrapper, event processing, source integration |
| `main/ipc.ts` | IPC channel handlers (sessions, files, shell) |
| `main/menu.ts` | Application menu (File, Edit, View, Help) |
| `main/deep-link.ts` | Deep link URL parsing and handling |
| `main/sources-service.ts` | Source loading and authentication service |
| `preload/index.ts` | Context bridge API |
| `renderer/app.tsx` | React root, state management |
| `renderer/contexts/navigation-context.tsx` | Type-safe routing and navigation handler |
| `renderer/lib/navigate.ts` | Global navigate() function |
| `renderer/hooks/useAgentState.ts` | Agent activation state machine (IPC-based) |
| `renderer/hooks/use-statuses.ts` | Workspace status configuration |
| `renderer/hooks/use-theme.ts` | Cascading theme resolution |
| `renderer/components/chat/Chat.tsx` | Main chat layout with resizable panels |
| `renderer/components/chat/ChatInput.tsx` | Message input with file attachments |
| `renderer/components/chat/chat-display.tsx` | Message list with markdown rendering |
| `renderer/components/app-shell/input/structured/permission-request.tsx` | Bash command approval UI |
| `renderer/components/chat/session-list.tsx` | Session sidebar with rename support |
| `renderer/components/chat/attachment-preview.tsx` | File attachment bubbles |
| `renderer/components/ui/source-avatar.tsx` | Unified source icon component |
| `renderer/playground/` | Component development playground |
| `shared/types.ts` | IPC channels, Message/Session/FileAttachment types |
| `shared/routes.ts` | Type-safe route definitions and builders |
| `shared/route-parser.ts` | Route string parsing utilities |
