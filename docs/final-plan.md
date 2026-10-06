# Final plan

Status: the plan of record, 6 Oct 2026. Nothing in it is built unless marked. It merges [harness-plan](harness-plan.md), [pi-research](pi-research.md) (with the pi-durable spike), [messages-design](messages-design.md), [data-architecture](data-architecture.md), [agent-computers](agent-computers.md), [composer](composer.md) and [users-and-workspaces](users-and-workspaces.md). Where they disagree, this file wins. Column names follow [schema.md](schema.md) (forthcoming: snake_case, simplified); this file names only the tables and columns that matter for the design. Section 4 is the one list to approve: say "go" and every DEFAULT there is what the build assumes.

## 1. Everything in one picture

```
browser / desktop ──WS──> Otto server (Bun): harness, state, secrets, MCP pool ──> otto.db (SQLite, Drizzle) + S3
   │ chat run = Harness.run(Turn)       Turn = agent row + chat rows + creator's connection + skills + sources
   │   ├─ Pi adapter (default, on the server)        tools run in the box via Computer.exec
   │   └─ Claude Code adapter (SDK on server, CLI in the box; only after Anthropic's written OK)
   │ messages: ONE store (otto rows + harness rows verbatim, source + parent_id), FTS in the same transaction
   │ MCP sources: one server-side pool → proxy tools to both harnesses; tokens only in `secrets`
   v docker exec -u <human uid>
 agent computer: 1 container per agent (Xvfb/Openbox/noVNC/Chromium), named volume, lazy start, 15 min idle stop
   /home/agent/files (shared)  /home/agent/chats/<chat_id> (per chat)  /skills (read-only)  otto CLI (run token)
```

**Already decided** (not reopened here):

| Area | Decision |
|---|---|
| Where things run | The server holds the harness, the transcripts, the secrets and the MCP pool. The box holds tools and files only (plus Claude Code and that human's own Claude login on the Claude route) |
| Storage | One SQLite store through Drizzle, a `schema.ts` per domain, `createId()` ids, `workspace_id` on every workspace table, `db:push` (no migrations). S3 for bytes (library built; skills, sources and chat files next) |
| Who pays | Each person connects their own subscription or key (`connections.scope` = `install` \| `workspace:<id>` \| `user:<id>`); a chat always runs on its **creator's** connection |
| Computer | One Linux Docker computer per agent; hosted adapters (E2B, Boat) later behind the same `Computer` interface |
| Harness | One small `Harness` seam: Pi (default) and Claude Code in the box. Nothing else (no Mastra, no AI SDK harness, no proxy) |
| History | One `messages` store per [harness-plan](harness-plan.md) (b), FTS5 written in the row's transaction, durability suite (500 ms partial text, boot recovery, idempotent sends) |
| Chats | Private to their creator; several people use one agent at once through their own chats |
| Agent tools | The `otto` Python CLI through `bash`, taught by a skill; a few server-side proxy tools for gated calls |
| Composer | One composer, Edit and "+" prefill it; no edit popovers |

## 2. Architecture

### 2.1 Runtime: the harness seam

- One file, `packages/shared/src/agent/harness.ts`: `Harness { run(turn, emit, signal); steer(chatId, input); toDisplay(row) }`, `Turn`, `HarnessEvent` (+ `entries`), `Computer { ensureRunning(); exec(argv, opts) }`. Shapes as in [harness-plan](harness-plan.md) (b), with three fields added by sections 2.6 and 2.7: `Turn.agent` (id, title), `Turn.skills` (the agent's allowed skill rows) and `Turn.instructions` (assembled, never a file).
- `DRIVER_REGISTRY` becomes a `switch (chat.harness)`. The ~45-member `AgentBackend` shrinks as members are touched: titles, mini completions, permission modes and sources move to server code.
- **Pi adapter** wraps today's `pi-agent-server` subprocess first (crash isolation, no rewrite); built-in tools go through `operations` into `computer.exec`. **Claude adapter** keeps the Agent SDK on the server and spawns the CLI with `spawnClaudeCodeProcess` → `docker exec -i -u <uid> <box> claude …`.
- **Harness per chat** is decided when the chat is created, from the creator's resolved connection: a Claude subscription (`authType = oauth`, provider anthropic) gives `claude`, everything else `pi` (while the H3 flag is off, a Claude subscription does not resolve, so Claude models need an Anthropic API key and run in Pi). Stored on the chat (`chats.harness`), never changed; a later switch branches with `buildRecoveryContext`.

### 2.2 Credentials and connection resolution

| Step | Rule |
|---|---|
| Which connection | The agent names a **provider and model**, not an account. At run time the server takes the chat creator's connection of that provider: their own (`user:<id>`), else the workspace's, else the install's (the existing `ConnectionContext` lookup) |
| None found | The chat cannot run; the composer says "Connect {provider} to talk to {agent}" and opens Settings › Models |
| Shown | Chat header: "Runs on {person}'s plan" (or "workspace plan") |
| Other participants | Never switch the connection; a steer from someone else still runs on the creator's |
| Where the secret goes | Pi route: injected into Pi's in-memory `CredentialStore` on the server; never in the box. Claude route: nothing from us; the human signs in to the unmodified CLI inside their uid's `CLAUDE_CONFIG_DIR` (0700) |
| MCP tokens | `secrets` rows referenced by `sources.secret_id`; read by the pool on the server only |
| Run token | Per turn, bound to (user, workspace, chat), 1 h max, hashed in memory, reaches the box as `OTTO_AGENT_TOKEN` for the `otto` CLI |

### 2.3 History: chats and messages

- Tables: `chats`, `messages`, `messages_fts` (contentless FTS5). Columns in [schema.md](schema.md) (forthcoming); the design is [messages-design](messages-design.md) with the one-store change below.
- **One store, no `transcripts` table** (DECISION D2): `messages` gains `source` (`otto` \| `pi` \| `claude`) and `parent_id` (Pi's tree). Harness rows hold the harness entry verbatim; Otto rows hold today's `StoredMessage` JSON (user message with sender, error, info, plan, auth-request, partial text, in-flight tool status). Load = `WHERE chat_id AND source = :harness ORDER BY position`. Display = `toDisplay(row)` on read; FTS text from it at write. The 200k cap and image rule apply to Otto rows; harness rows are verbatim (moving inline images to the library is a later lossless step).
- `chats` gains `agent_id` (null = the workspace's default agent) and `harness`. Everything else as data-architecture (c).
- Claude chats: the SDK's `sessionStore.append` writes rows (dedupe on `entry.uuid`); the box's `~/.claude` keeps a working copy and the adapter writes rows back into its JSONL when missing (spike).
- `pi-durable` stays a later trial behind the same seam (phase H4), on its own file; it forces integer ids and has no skills/MCP loader, so it is not the MVP store.

### 2.4 Files and S3

| What | Where |
|---|---|
| Library bytes | S3 (`workspaces/<ws>/library/<id>`), disk read-through cache (built, P4a) |
| Skills, sources | S3 bundles by slug (`workspaces/<ws>/skills/<slug>/…`; S1 dropped the `rev`, see object-storage.md), rows as index (`skills`, `sources`); materialized folder on the server, mounted read-only into boxes |
| Chat files (plans, notes, downloads) | P7: S3 under `workspaces/<ws>/chats/<chat_id>/`; until then the box volume |
| Agent working files | The agent's named volume (`/home/agent/files`, `/home/agent/chats/<chat_id>`, `/home/agent/memory`) |
| Messages | Database only; never S3 |

### 2.5 The computer and multiplayer rules

- Image `otto-agent` (Debian slim, Xvfb, Openbox, x11vnc + noVNC, Chromium with CDP on loopback, `agent-browser`, tmux, git, node, uv, the `otto` CLI; `claude` for the Claude route). Non-root, `--cap-drop ALL`, no-new-privileges, `--memory 2g --cpus 1 --pids-limit 512 --shm-size 1g`. Container name `otto-agent-<agent_id>`, docker labels carry workspace and agent: **no `computers` table** (docker is the truth).
- Lifecycle: `ensureRunning` at the first tool call; stop after 15 idle minutes with no run and no noVNC viewer. noVNC behind the server's auth with short-lived tokens.
- Desktop (local) mode: `Computer` = local exec on the host, as today.
- **In progress** (uncommitted, by another agent): `packages/shared/src/computer/` (`LocalComputer`, `DockerComputer`, idle stop, `COMPUTER_RESTARTED`, chat dirs) and `docker/otto-agent/`; see [computers.md](computers.md). Tested only against a fake `docker`. Delta from this plan: the image's `~/.claude/skills -> /skills` link becomes the plugin dir of 2.6 (`/opt/otto/plugin/skills -> /skills` + `.claude-plugin/plugin.json`).

| Case | Rule |
|---|---|
| Concurrent chats on one agent | Per-chat cwd `/home/agent/chats/<chat_id>`; shared `/home/agent/files`; at most **4** concurrent runs per agent, the rest queue with "Waiting for the computer" |
| Browser | One Chromium per agent (its logins); each chat its own `agent-browser --session <chat_id>` context |
| The screen | One desktop lease per agent (2 min idle); the UI shows the holder; a human in noVNC always wins |
| Privacy in the box | One Unix user per human: chat dirs 0700 for the creator's uid, `files` group-shared, `CLAUDE_CONFIG_DIR` per uid 0700 |
| Messages during a run | One run per chat; a new message steers (Pi `steer`, Claude `streamInput`), else queues; Stop drops the queue |
| Box dies mid-turn | Pi: the tool call returns "computer restarted; the action may have run", the turn goes on. Claude: the turn ends `interrupted`, the next message resumes from rows |

### 2.6 MCP, skills and instructions for both harnesses

**One source of truth.** `sources` and `skills` rows plus their S3 bundles; `agents.sources` / `agents.skills` pick which ones an agent gets (`[]` = all); `agents.instructions` and the workspace's `instructions` setting hold the prompt text. Every turn renders that truth into the harness's native form. No harness reads its own config files from the box.

**What exists today** (Craft-derived code, read 6 Oct 2026; `S` = `packages/shared/src`):

| | Claude (`S/agent/claude-agent.ts`) | Pi (`S/agent/pi-agent.ts` + `packages/pi-agent-server`) |
|---|---|---|
| MCP | `mcpServers` = `session` (Otto's tools) + one in-process `createSdkMcpServer` per source (`createSourceProxyServers`, :434-470), never stdio/http; names `mcp__<slug>__<tool>` | The same tools as proxy definitions over the JSONL protocol (`getProxyToolDefs`, `mcp__session__*`), executed by the host (`routeToolCall`, :1468) |
| Pool | `McpClientPool` (`S/mcp/mcp-pool.ts`) **per chat** (`session-manager.ts:3785`): HTTP/SSE via streamable HTTP, stdio with an allow-listed env, API sources in-process; tokens from `credentials.enc` via `SourceCredentialManager` | same pool |
| Gate | `permissionMode: 'bypassPermissions'`; all gating in an internal `PreToolUse` hook (`runPreToolUseChecks`, :1337); no `canUseTool` | `pre_tool_use_request` per wrapped tool → `handlePreToolUseRequest` (:1213) → the same checks |
| Tool search | none configured | none (Pi 0.87.1) |
| Skills | Not native: `plugins: []`, `Skill` tool disallowed; a `[skill:slug]` mention prepends "read this SKILL.md" and blocks tools until read (`base-agent.ts:931-975`); no skill list in the prompt | same mention mechanism; Pi's own skill listing never reaches the model |
| Instructions | `systemPrompt: preset claude_code + append getSystemPrompt()` (paths of found AGENTS.md/CLAUDE.md listed); `settingSources` **unset**, so the CLI also loads `~/.claude`, project settings and CLAUDE.md itself | A `before_agent_start` extension replaces the **whole** system prompt with Otto's (`system-prompt-override.ts`), dropping Pi's context files and skill list |
| Where config lives | Sources `<ws>/sources/<slug>/` and skills `~/.agents/skills`, `<ws>/skills`, `<cwd>/.agents/skills` are files; per chat `enabledSourceSlugs` in the session header; no per-agent anything | same |

So the shared core already exists (one pool, proxy tools to both, one gate); what changes is where the truth lives (rows + S3), per-agent selection, native skill listing on both harnesses and a hermetic Claude config.

**MCP.** The server's `McpClientPool` stays as built (per chat; stdio sources run on the server, never in the box); sharing one connection per workspace source waits until connection counts hurt. Per turn the server builds `Turn.mcp` = proxy tools for the agent's enabled sources whose `auth_status` is `ok`, named `mcp__<source-slug>__<tool>`. Each proxy call goes through one permissions gate (workspace rules + the source's `permissions.json` + the chat's permission mode) before the pool runs it. OAuth: the server runs the flow with a server-side redirect (`/api/sources/<id>/oauth/callback`), tokens and refresh tokens go to `secrets`; a source needing sign-in shows `needs_auth` and its tools are absent from the turn. Large source tool lists are deferred (Claude tool search, on by default; Pi `exposure: "deferred"` with `tool_search` after Pi 1.0).

**Skills.** The server materializes the workspace's skills folder from S3 (`<ws>/skills/<slug>/`) and bind-mounts it read-only at `/skills` in every box of the workspace. Each harness lists the agent's skills natively (name + description in the prompt); `SKILL.md` is read on demand from `/skills/<slug>/SKILL.md`. Per-agent selection filters what the harness lists; the files of other skills stay readable (accepted: skills are workspace-shared). The `[skill:slug]` mention stays as the way a person forces a skill (today's read-before-execute directive). Global and `<cwd>/.agents/skills` scopes are deleted (S1).

**Instructions.** Assembled per turn into `Turn.instructions`, in this order: Otto base prompt (product, tools, the `otto` CLI skill pointer), workspace instructions (setting `workspace:<id>` key `instructions`), then `<agent name="{title}">{agents.instructions}</agent>` (BB's order), then the chat context (project, page entity, routine run). Repo files (`AGENTS.md`, `CLAUDE.md`) inside a cloned repo in the box are working files, not Otto config: the base prompt says "if the working folder has an AGENTS.md or CLAUDE.md, read it first", which works the same on both harnesses.

**Translation table** (what the adapter does with each `Turn` field):

| Turn field | Pi adapter (server, `createAgentSession`) | Claude adapter (Agent SDK on the server, CLI in the box) |
|---|---|---|
| `instructions` | Custom `ResourceLoader` `systemPrompt` = `Turn.instructions`, **replacing** today's whole-prompt override extension so Pi's own skill list is appended; `agentsFilesOverride: () => []` (Pi's context-file discovery would read the **server's** disk, not the box) | `systemPrompt: { type: 'preset', preset: 'claude_code', append: Turn.instructions }` (as today) |
| settings / config files | In-memory `SettingsManager`, isolated `agentDir`, no extensions (as today) | `settingSources: []` (new; today unset loads `~/.claude`, project settings, `.mcp.json`, CLAUDE.md/AGENTS.md from the box) |
| `skills` (+ `/skills` mount) | `ResourceLoader.additionalSkillPaths` = the server's materialized folder; `skillsOverride` filters to `Turn.skills` and rewrites each path to `/skills/<slug>/SKILL.md` so the redirected `read` finds it in the box | `plugins: [{ type: 'local', path: '/opt/otto/plugin' }]`, a plugin dir in the image whose `skills/` is a symlink to `/skills` (with `settingSources: []`, `.claude/skills` is not scanned, so the symlink lives in the plugin); `skills: Turn.skills.map(s => 'workspace:' + s.slug)`; `Skill` leaves `disallowedTools` |
| `mcp` (source proxies) | Proxy tool definitions over the protocol (as today); `exposure: 'deferred'` above 20 tools once on Pi 1.0 | One `createSdkMcpServer` per source (`createSourceProxyServers`, as today); its tools run in the server process even with the CLI in the box (the SDK relays `mcp_message` frames over the CLI's stdio); SDK tool search is on by default |
| `tools` (Otto proxy tools) | `mcp__session__*` proxies (as today) | The `session` SDK server (as today) |
| permissions gate | `pre_tool_use_request` → `runPreToolUseChecks` (as today), plus the agent's source filter | Internal `PreToolUse` hook → the same checks (as today); `bypassPermissions` stays so the hook is the only gate |
| built-in tools location | `read/write/edit/bash/grep/find/ls` `operations` → `computer.exec` | Native, inside the CLI in the box |
| history | `SessionManager.inMemory(cwd, { id }, rows)`; new entries from `getEntries()` at `message_end`, `turn_end`, `compaction_end`, `agent_settled` | `sessionStore` (mirror → rows); resume from the box's `~/.claude`, rewritten from rows when missing |
| connection | In-memory `CredentialStore` with the creator's secret | The human's own sign-in in their uid's `CLAUDE_CONFIG_DIR` |
| cwd | `/home/agent/chats/<chat_id>` passed to `operations` | `cwd` of the spawned CLI, same path |

### 2.7 Agents domain (mimics BB)

**What BB has** (`/home/g4f4r0/projects/bb`, `packages/db/src/schema.ts:1412-1434`): ONE `agents` table and no child tables: `name` (unique), `description`, `provider_id` (the harness), `model`, `reasoning_level`, `secondary_model`/`secondary_reasoning_level` (sub-agent threads), `skills_json` and `mcp_servers_json` (name lists, `[]` = all), `instructions` (≤20k, appended after workspace instructions as `<bb_agent>`), `mascot` (10 pixel sprites), `color` (1-8). `threads.agent_id` (`ON DELETE SET NULL` → default agent). Default agent = the oldest; the last one cannot be deleted; a "bb" agent is seeded. Memory = a git-backed home folder per agent. No schedules, sharing, permissions, runtime or status on the agent. UI: Settings › Agents, a **card grid** (mascot, name, "Default" pill, description, or "Provider · Model · N skills · N MCPs"), search, "New agent" **prefills the composer** ("Create a new bb agent: ") and the agent runs `bb agent create`; the detail page is **one column, no tabs, autosave** (600 ms, diff PATCH, toast "Agent updated"): Profile (Name, Description, Icon, Color), Model (Primary, Secondary), Skills (checklist, "can use every skill" / "N of M skills"), MCPs (same), Instructions; header menu with Delete. Composer has an agent picker; the thread status icon is the agent's mascot.

**Otto today:** no `agents` table; one implicit actor `agent:default` named `AGENT_DEFAULT_NAME` (`apps/electron/src/renderer/hooks/use-workspace-members.ts:33`, `packages/shared/src/branding.ts`); DESIGN.md already specifies Settings › Agents with mascots and checklists.

**The `agents` table** (domain `packages/shared/src/agents/`, one table, no children):

| Column | Type | Drives in a run (`Turn`) |
|---|---|---|
| `id` | text PK `createId()` | `Turn.agent.id`; the computer `otto-agent-<id>`; actor `agent:<id>` |
| `workspace_id` | text NN | scope of every query and guard |
| `title` | text NN (UI label "Name", ≤80) | `<agent name>` in instructions; "Reply to {agent}" |
| `description` | text NN default '' | card and picker only |
| `instructions` | text NN default '' (≤20,000) | `Turn.instructions` after the workspace instructions |
| `provider` | text NN | which of the creator's connections pays (2.2); with it, the harness (2.1) |
| `model` | text (null = the connection's default) | `Turn.model` |
| `thinking_level` | text NN default 'medium' | `Turn.thinkingLevel` |
| `skills` | text NN JSON default '[]' (skill ids, `[]` = all) | `Turn.skills` |
| `sources` | text NN JSON default '[]' (source ids, `[]` = all usable) | `Turn.mcp` |
| `mascot` | text NN (BB's ten sprites, from a name hash) | avatar everywhere |
| `color` | int NN 1-8 | avatar color |
| `created_by` | text NN actor | who may edit (with workspace owners) |
| `created_at`, `updated_at` | int NN | |

Skipped from BB (Ponytail): secondary model (no sub-agent threads yet), git-backed home (the box volume's `/home/agent/memory/` is the memory; the base prompt says so), unique name and slug (ids for refs; titles may repeat), permission modes (the chat's mode + workspace rules apply), live hub events beyond today's `domain:changed` push.
Kept from BB: `[]` = all; default agent = the workspace's oldest; the last cannot be deleted; deleting sets `chats.agent_id` to null (falls back to the default); instructions after workspace instructions; one page, autosave.
Seeding and import: a workspace gets one agent at creation (title `AGENT_DEFAULT_NAME`, the creator's default provider); `initAgentsImport()` creates it for existing workspaces and rewrites `agent:default` in `tasks.created_by`/`assignees`, `projects_members.actor` to `agent:<id>` (one transaction, idempotent).
Rules: any member can use any agent and create one; editing and deleting = its creator or a workspace owner. Agents run as the chat's user (tools and CLI), never with their own rights.

**UI** (DESIGN.md patterns; one DESIGN.md entry updated in the same change):

| Piece | Spec |
|---|---|
| Place | Settings › Agents (`/{ws}/settings/agents`, `/{ws}/settings/agents/{id}`), the Skills/Sources page anatomy |
| List | `Gallery` of 4 tiles (171px): mascot on its color, title, "Default" badge, description or "Model · N skills · N sources". Title row (`PageHeaderRow density="roomy"`): Filter-less, a search field only if > 8 agents (YAGNI otherwise), `CreateButton` "+" last |
| Create | "+" prefills the composer: "Create an agent named " (copy in `agentEdit.*`, `{{product}}` never typed). The agent creates it with the `agents_edit` session tool until PT, then `otto agents create` |
| Detail | One roomy column, **no tabs**. Sections: Profile (Name, Description, mascot and color pickers as 28px buttons), Instructions (the card is the field), Model (provider + model + thinking picker; a muted line "Runs on each person's own {provider} connection"), Skills and Sources (checklists, "Can use 3 of 8 skills.", All first, whole row toggles), Computer (status Running/Stopped, Open screen (noVNC), Restart), Routines (rows of this agent's routines, "+" prefills "Every "). Title row: `AgentEditButton` (Edit prefills "Edit the agent {title} to "), More (Copy link, Delete; none on the default agent) |
| Saving | Autosave as you go, 600 ms, one toast "Agent saved". DESIGN.md's "Multi-field Agent … explicit Save/Cancel" line is removed in the same change |
| Elsewhere | Composer "With" picker on a new chat (last pick per workspace in localStorage); chat header and the chat list show the agent's mascot; "Reply to {agent}" |

**A1 as built** (backend, 6 Oct 2026; the UI is A2). Owner changes since the table above: `mascot` and `color` are one `avatar` column (`''` = a generated avatar from the id hash, else `library:<id>` of an uploaded image; only the format is checked, `library` existence is A2's), and the system prompt is Otto's **addition after the harness's own prompt**, built as XML groups.
- **Code.** `packages/shared/src/agents/`: `schema.ts` (explicit snake_case columns, camelCase properties), `types.ts` (browser-safe types and limits), `index.ts` (`getAgents`, `getAgent`, `getDefaultAgent`, `createAgent`, `updateAgent` with `expectedUpdatedAt`, `deleteAgent`, `initAgentsSeed`, `getDefaultProvider`, `getWorkspaceInstructions`, `canEditAgent`, `getAgentRunConfig`), `import.ts` (`initAgentsImport`), `instructions.ts` (`assembleInstructions`), `agents.test.ts`. `updateAgentActor(db, workspaceId, from, to)` was added to `tasks` (created by, assignees, timesheets), `projects` (members) and `library` (created by). Subpaths `@otto/shared/agents`, `/types`, `/import`.
- **Rules.** Default = oldest (created strictly after the newest, so no ties); the last agent cannot be deleted; `provider` defaults to the creator's default connection (`piAuthProvider ?? type`, else `anthropic`). **Deviation:** deleting an agent does not rewrite chats (file-backed headers belong to the session manager): a header `agentId` (new optional, persistent field of `SessionConfig`/`SessionHeader`/`SessionMetadata`, `createSession` option) that no longer exists falls back to the default agent in `getAgentRunConfig`. With P3b's `chats` table, `deleteAgent` sets `chats.agent_id` to null in its transaction (TODO in the code).
- **Seed and import.** `initAgentsSeed(workspaceId, createdBy, provider)` runs when a workspace is created (`workspaces:create`, `server:createWorkspace`) and at the first `agents:list` of a workspace with none; `initAgentsImport()` runs at boot (headless and Electron) once per workspace (`imports` key `agents:<id>`), creator = first owner else first user (none: left for the next boot), and in one transaction rewrites `agent:default` to `agent:<id>` in tasks, timesheets, projects_members and library.
- **Channels.** `agents:list|get|create|update|delete` (`handlers/rpc/agents.ts`, the connection's workspace like tasks; REMOTE_ELIGIBLE; `domain:changed` kind `agents` for create/update/delete; renderer `getAgents` ... `deleteAgent`, `useAgents`). Guard: `AGENT_WRITE_CHANNELS` in `bootstrap/authorize.ts` (update and delete: creator or workspace owner, by `canEditAgent`; an id that is no agent of the workspace passes and gets `not_found`), tested in `authorize.isolated.ts`. Setting `instructions` (workspace entity, at most 20,000 characters) is in the catalogue; owners write it through the generic settings channel.
- **Interim tool.** `agents_edit` (list, get, create, update, delete) in `session-tools-core` and `runWorkspaceConfigAction(..., 'agents', ...)`; any member creates, creator or owner changes. Bundled doc `agents.md`, `DOC_REFS.agents`.
- **Prompt assembly.** `assembleInstructions({ product, rules?, workspaceInstructions, agent: { title, instructions, homePath? }, toolGuidance?, sources?, runMode? })` returns `<{product}_rules>`, `<{product}_workspace>`, `<{product}_agent name home>` (its instructions, else a one-line home hint, else omitted), `<{product}_tools>`, `<connected_mcps>`, `<{product}_run mode="unattended">`, each omitted when empty, attributes escaped as in BB. `getAgentRunConfig(agentId, workspaceId?)` returns `{ agent, instructions (workspace + agent only), workspaceInstructions, agentInstructions, provider, model, thinkingLevel, skills, sources }`.
- **TODO for M1/Pi wiring (not done, `agent/**` is another lane).** Call `getAgentRunConfig(chat.agentId, workspaceId)` per turn and `assembleInstructions` with rules, tool guidance, sources and `runMode`; append it after Pi's own prompt; configure Pi with no context-file discovery (no AGENTS.md/CLAUDE.md: `agentsFilesOverride: () => []` on the `ResourceLoader` in `pi-agent.ts`/`pi-agent-server`); set `agentId` on new chats from `sessions:create` options and show it in the chat DTO; widen the `'labels' | 'statuses' | 'permissions'` types in `agent/session-scoped-tool-callback-registry.ts` and `session-manager.ts` (`broadcastDomainChanged`) to include `'agents'` (works at run time today), and add `'agents_edit': 'Edit Agents'` to the tool names in `session-manager.ts`.

### 2.8 Routines

- `routines` + `routines_history` as data-architecture (c), plus `routines.agent_id` (null = default agent). An agent's schedule **is** a routine with its `agent_id`; no schedule on the agent.
- A run creates a chat owned by the routine's `created_by`, with `chats.agent_id` = the routine's agent and `triggered_by = 'routine:<id>'`, so it runs on the routine creator's connection. No connection: the run is `error` "Connect {provider}".
- `slot` unique per routine = fires once across restarts; retry rows in `routines_history`.

### 2.9 Search

- `messages_fts` (chats, private rule in the join) + `search_fts` (tasks, projects, comments, library documents; agents later only if asked). One search RPC merges them. Both created with raw SQL; `db:push` skips `*_fts` (P3b's first step).

### 2.10 Security and durability rules

1. Secrets only in `secrets` (AES-256-GCM, `ENCRYPTION_KEY`); no token in a file, S3, a box env or a log. The box never sees a model key, an MCP token or `otto.db`.
2. Agent env from the `agentEnv()` allow-list (built). Only `OTTO_AGENT_TOKEN` and `OTTO_API_URL` enter the box on purpose.
3. An agent does nothing its user cannot: CLI and proxy tools run as the chat's user through the same guards and the private-chat rule.
4. Every workspace-scoped query is bounded by `workspace_id`; every new channel joins `WORKSPACE_ARG_CHANNELS` / the session guard tests.
5. Durable by default: user message committed before the ack and idempotent by client id; partial text every 500 ms; boot recovery marks `executing`/partial rows `interrupted`; one `BEGIN IMMEDIATE` per batch with rows, FTS and chat fields; failed writes retried, never dropped; `synchronous = FULL`.
6. Tools are tagged read-only or side-effecting; nothing replays a side-effecting call automatically.
7. The box: non-root, caps dropped, resource limits, egress open (allow-list later), noVNC only through the server with short-lived tokens.

## 3. Build plan

Sizes: S < half a day, M one agent-day, L = listed M chunks. Each phase ships alone, keeps typecheck and its tests green, and is verified in the browser where visible.

| # | Phase | What ships | Size | Needs | Verify |
|---|---|---|---|---|---|
| N0 | snake_case + `position` | Every table and column renamed per [schema.md](schema.md), in one hand-written `ALTER TABLE … RENAME` step before `db:push` (push alone would drop and re-add); Better Auth field mapping checked | M | schema.md | test db pushed twice with no diff; Better Auth sign-in test; a copy of the owner's db renamed and opened |
| P0d | Pi 0.87.1 → 1.0.4 | Azure id rename; MCP/tool exposure available | S | - | Pi chat works; tests |
| H0 | Harness seam | `harness.ts`; Pi adapter over today's `pi-agent-server`; `switch` replaces the registry; `Computer` = local exec | M | P0d | same behaviour; existing agent tests |
| P3b | Chats and messages in SQLite | (1) `*_fts` filter, `chats` + `messages` + importer; (2) manager/queue, DB-first reads, LRU; (3) RPC paging, renderer, FTS search, thumbnails; (4) durability + one store (`source`, `parent_id`, Pi rows verbatim, `toDisplay`), crash suite | L (4 M) | N0; chunk 4 needs H0 | importer twice = same rows; crash suite; benchmarks in messages-design 8 |
| A1 | Agents domain | `agents` table, CRUD functions, seed + `initAgentsImport`, `agents:*` RPCs and guards, `chat.agent_id` (session header until P3b's column), `Turn.agent/instructions/model` from the row, workspace `instructions` setting, interim `agents_edit` tool | M | N0, H0 | unit tests; a chat with agent B uses B's instructions and model |
| A2 | Agents UI | Settings › Agents gallery and detail (autosave), composer "With" picker, mascots in chat header and list, DESIGN.md entry | M | A1 | browser at 390/768/1440, both themes |
| S1 | Skills on rows + S3 | P4b: `skills` table, `updateBundle`, materialize, watcher, importer; global/project skill code deleted | L (2 M) | N0 | sync round trip; two writers conflict test |
| S2 | Sources on rows + S3 | P4c: `sources`, `auth_status`, source credentials and MCP OAuth tokens in `secrets`, server-side OAuth callback | L (2 M) | S1 | a source signs in; token only in `secrets` |
| M1 | Render per turn, both harnesses | Translation table (2.6): per-agent source and skill filters; Pi `ResourceLoader` prompt (override extension deleted), skills filter + path rewrite, no context files, deferred exposure; Claude `settingSources: []`, plugin skills, `Skill` enabled | M | A1, S2, H0 | same agent, same skill and source, both harnesses: listed, read on demand, gated |
| C1 | The computer | `otto-agent` image, `Computer` = `docker exec`, `/skills` mount, per-chat dirs, lifecycle, limits (**interface, DockerComputer and image written, not run**: computers.md); left: run on a real daemon, Pi tools into it (needs H0), the 1-day spike (screenshot, kill mid-`bash`) | M | H0 for Pi wiring | spike checklist (agent-computers 2) |
| C2 | Multiplayer box | uid per human, desktop lease, 4-run cap and queue, noVNC behind auth, "Open screen" in A2's Computer section | M | C1, A2 | two users, one agent, parallel chats, private dirs |
| PT | `otto` CLI | `/api/agent/rpc`, run token, generated package and skill, first modules incl. `otto agents`; `labels_edit`/`agents_edit` interim tools deleted | L (2 M) | P3b | generator test; CLI smoke against `:memory:` |
| R1 | Routines on the DB | P5a + `agent_id`; runs create chats on the creator's connection; P5b webhook | L (2 M) + S | A1, P3b | slot fires once across restart; routine on agent B |
| H3 | Claude route | `spawnClaudeCodeProcess` into the box, sign-in in a box terminal, `CLAUDE_CONFIG_DIR` per uid, `sessionStore` → rows, restore-if-missing; flag on only after the written OK | S-M | C2, M1, P3b(4), **Anthropic's OK** | Claude chat resumes after box restart |
| P6 / P7 | Search, cleanup | `search_fts` + merged RPC; chat files on S3, `credentials.enc`/`config.json`/legacy folders out | M / L | P3b / P3b, S2 | |
| H4 | `pi-durable` trial | Own SQLite file, conformance suite, one chat behind a flag, crash suite; adopt, wait or drop | M | P3b, P0d | crash suite passes on it |

**Order and lanes** (smallest risk first; separate agents, separate files):

| Lane | Sequence | Can start |
|---|---|---|
| Core | N0 → P3b(1-3) → P3b(4) → PT → P6/P7 | now (N0 waits for schema.md) |
| Harness | P0d → H0 → M1 (after A1, S2) → H3 (after the OK) | now, beside Core |
| Agents | A1 → A2 → R1 | after N0 and H0 |
| Bundles | S1 → S2 | after N0, beside Core |
| Computer | C1 → C2 | now (C1 is under way); Pi wiring after H0 |
| Later | H4, hosted `Computer` adapter | after P3b |

Blocks: N0 blocks every new table; H0 blocks P3b(4), A1, C1, M1; S2 + A1 block M1; C2 + M1 + P3b(4) + Anthropic block H3. Conflict zones (one agent at a time): `session-manager.ts` (P3b, A1), `pi-agent-server` (H0, M1, P3b(4)), `claude-agent.ts` (M1, H3).

## 4. Decisions ("go" = every DEFAULT)

| # | Decision | DEFAULT (assumed on "go") | Alternative | Cost of switching later |
|---|---|---|---|---|
| D1 | Claude subscriptions (E1) | Ask Anthropic in writing now; build H3 behind a flag that stays off; until then Claude runs in Pi on the user's own API key | Ship H3 on the "hosted unmodified binary" clause alone | Flag flip either way; enforcement risk without notice if shipped unasked |
| D2 | Transcripts (DECISION 16, E2) | **Merged**: one `messages` table, `source` + `parent_id`, harness rows verbatim, no `transcripts` | A separate `transcripts` table (copies each answer once) | Before users: S (move rows by `source`); after: M |
| D3 | Linux users in a box (E3) | One Unix user per human (C2), created by `docker exec -u root useradd`; the box keeps `CHOWN, SETUID, SETGID, DAC_OVERRIDE` (root inside is reachable only from the server) instead of `--cap-drop ALL` | One user for all; or recreate the box with users baked in at `docker run` | S: chown + exec user; cross-chat file reads until then |
| D4 | ChatGPT route (E4) | Pi's native ChatGPT sign-in for local and self-hosted; apply to "Sign in with ChatGPT" before hosted launch; no Codex adapter | Codex CLI in the box (third adapter, history only in its rollout files) | M (one adapter + `toDisplay`) |
| D5 | Concurrency (E5) | 4 runs per agent, rest queued; one desktop lease | No cap (the 2 GB box is the cap) | A constant |
| D6 | snake_case | Switch now (N0), before P3b creates `chats`/`messages`, per schema.md | Keep camelCase columns | Grows with every table and query; after P3b ~L |
| D7 | `order` column | Rename to `position` (no keyword quoting) | Keep `"order"` | S rename now, more later |
| D8 | Agent instructions | In the DB (`agents.instructions`; workspace `instructions` setting), assembled per turn; no AGENTS.md as config; `settingSources: []` and no Pi context files | An editable `AGENTS.md` in the agent's home on the volume | S: read a file into the same slot |
| D9 | Which account an agent uses | Provider + model on the agent; the chat creator's connection pays | Pin `connection_id` on the agent (DESIGN.md's "names its one account") | S column add, but breaks "your plan powers your agents" for shared agents |
| D10 | Agents UI | BB's: Settings › Agents gallery, one-page detail, no tabs, autosave, "+" prefills | Top-level Agents nav item; tabs | S (route move) |
| D11 | Agent rights | Every member uses and creates; creator + owners edit/delete | Owners only create | S (guard set) |
| D12 | Agent memory | Files under `/home/agent/memory/` on the volume, no table, no git | BB's git-backed home, or a `memory` column | S-M |
| D13 | Skills/sources per agent | JSON id lists on `agents`, `[]` = all | Child tables `agents_skills`, `agents_sources` | S |
| D14 | Box-local repo instructions | Not auto-loaded by either harness; the base prompt tells the agent to read `AGENTS.md`/`CLAUDE.md` in its working folder | Claude `settingSources: ['project']` (native AGENTS.md/CLAUDE.md, also `.mcp.json` and settings from the box) | S, but loses "DB is the only truth" |
| D15 | `pi-durable` | Trial later (H4), not the MVP store | Adopt now (port `pi-agent-server`, integer-id exception) | M-L either way |
| D16 | Stdio MCP sources | Run on the server in the pool (today) | Run in the agent's box | M; tokens would enter the box |
| D17 | How skills reach the model | Native listing on both harnesses (name + description; agent picks), `[skill:slug]` mention kept to force one | Today's mention-only (no list in the prompt) | S |

## 5. Risks and what is unverified

| Item | Status |
|---|---|
| Anthropic allowing the Agent SDK to drive the unmodified CLI with a user's own sign-in in a hosted box | Unverified; the legal page allows hosted unmodified Claude Code, the SDK page forbids claude.ai login "unless previously approved" (D1) |
| `spawnClaudeCodeProcess` over `docker exec`; `transcript_mirror` with differing `CLAUDE_CONFIG_DIR`; restore-if-missing | Unverified (H3 spike) |
| SDK in-process MCP servers when the CLI runs in the box | Code-level yes: the SDK bridges them as `mcp_message` control frames over the CLI's stdio (`sdk.mjs`); not run |
| Claude Code reading credentials from `CLAUDE_CONFIG_DIR` with `settingSources: []`; plugin skills from a symlinked dir | Unverified (H3 spike) |
| Claude Code and AGENTS.md | **Verified** in the docs: since v2.1.277 it reads `AGENTS.md` when no `CLAUDE.md`/`CLAUDE.local.md` is in the cwd or above; setting `instructionFiles` can load both. Irrelevant with D8/D14 (`settingSources: []`) |
| Claude skills discovery | **Verified** in the docs: from `settingSources` (`user`, `project`, `--add-dir`) or the `plugins` option; no programmatic API; `skills` option filters by name (SDK 0.3.280 has it) |
| Pi mirror at four events catches every entry type | Unverified; P3b(4) compares with a file-backed run |
| Verbatim Pi rows: size and read cost (a real Pi file is 2.2 MB vs 281 KB of messages) | Measured only in the spike on tmpfs; benchmark on disk with `synchronous = FULL` |
| Pi skills path rewrite (`skillsOverride`) so the redirected `read` finds `/skills/...`; Pi keeping its skill list when `systemPrompt` comes from the `ResourceLoader` | Unverified; M1 test (fallback: Otto writes the list into `Turn.instructions` for Pi) |
| Pool per chat with many open chats (one MCP connection per source per chat) | Accepted for now; share per workspace if counts hurt |
| Pi's ChatGPT OAuth and Codex CLI under OpenAI terms for a hosted multi-user product | Unverified (D4) |
| Box density (15-25 active, 40+ idle per 8 vCPU / 32 GB), Chromium start, `agent-browser --session` concurrency, gVisor + Chromium | Estimates; C1 spike measures |
| N0 renames: drizzle-kit sees a rename as drop + add | Hand-written rename step; Better Auth on renamed columns needs a test |
| `session-manager.ts` and `pi-agent-server` are touched by several phases | Serialize per the conflict zones in 3 |
| BB facts | Read from BB at commit 23af67d23; not run |
