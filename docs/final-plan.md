# Final plan

Status: the plan of record, 6 Oct 2026. Nothing in it is built unless marked. It merges [harness-plan](harness-plan.md), [pi-research](pi-research.md) (with the pi-durable spike), [messages-design](messages-design.md), [data-architecture](data-architecture.md), [agent-computers](agent-computers.md), [composer](composer.md) and [users-and-workspaces](users-and-workspaces.md). Where they disagree, this file wins. Otto is **Pi only**: [pi-only-plan](pi-only-plan.md) supersedes the Claude parts of all of them (phases B2 and B3 built). Column names follow [schema.md](schema.md) (forthcoming: snake_case, simplified); this file names only the tables and columns that matter for the design. Section 4 is the one list to approve: say "go" and every DEFAULT there is what the build assumes.

## 1. Everything in one picture

```
browser / desktop ──WS──> Otto server (Bun): Pi, state, secrets, MCP pool ──> otto.db (SQLite, Drizzle) + S3
   │ chat run = a PiAgent turn (pi-agent-server)   agent row + chat rows + creator's connection + skills + sources
   │   tools run in the box via Computer.exec; a Claude subscription is the `claude-code` Pi provider (the human's own `claude`)
   │ messages: ONE store (otto rows + Pi entries verbatim, parent_id), FTS in the same transaction
   │ MCP sources: one server-side pool → proxy tools to Pi; tokens only in `secrets`
   v docker exec -u <human uid>
 agent computer: 1 container per agent (Xvfb/Openbox/noVNC/Chromium), named volume, lazy start, 15 min idle stop
   /home/agent/files (shared)  /home/agent/chats/<chat_id> (per chat)  /skills (read-only)  otto CLI (run token)
```

**Already decided** (not reopened here):

| Area | Decision |
|---|---|
| Where things run | The server holds Pi, the transcripts, the secrets and the MCP pool. The box holds tools and files only; no Claude login |
| Storage | One SQLite store through Drizzle, a `schema.ts` per domain, `createId()` ids, `workspace_id` on every workspace table, `db:push` (no migrations). S3 for bytes (library built; skills, sources and chat files next) |
| Who pays | Each person connects their own subscription or key (`connections.scope` = `install` \| `workspace:<id>` \| `user:<id>`); a chat always runs on its **creator's** connection |
| Computer | One Linux Docker computer per agent; hosted adapters (E2B, Boat) later behind the same `Computer` interface |
| Harness | Pi only; Claude subscriptions via the `claude-code` Pi provider ([pi-only-plan](pi-only-plan.md)). Nothing else (no Mastra, no AI SDK harness, no proxy) |
| History | One `messages` store (2.3), FTS5 written in the row's transaction, durability suite (500 ms partial text, boot recovery, idempotent sends) |
| Chats | Private to their creator; several people use one agent at once through their own chats |
| Agent tools | The `otto` Python CLI through `bash`, taught by a skill; a few server-side proxy tools for gated calls |
| Composer | One composer, Edit and "+" prefill it; no edit popovers |

## 2. Architecture

### 2.1 Runtime: Pi

- **Built (pi-only-plan B2, B3).** Every chat runs on `PiAgent` (`packages/shared/src/agent/pi-agent.ts`) through the `pi-agent-server` subprocess (crash isolation). `createBackend` is `new PiAgent`; the session layer holds `type AgentInstance = PiAgent`. `AgentBackend`, `DRIVER_REGISTRY`, `BACKEND_CAPABILITIES`, `detectProvider` and the Claude backend are deleted. There is no `Harness` seam and no `chats.harness`. `Turn` below only names what a turn is built from (agent, instructions, skills, sources), not a type.
- `Computer { ensureRunning(); exec(argv, opts) }` stays (2.5); Pi's built-in tools go through `operations` into `computer.exec`. Titles, mini completions, permission modes and sources move to server code as they are touched.
- A Claude subscription is a connection `type: 'claude-code'`. `pi-agent-server` registers its `claude-code` Pi provider (`packages/pi-agent-server/src/claude-code-provider.ts`), which runs the user's own `claude` (`OTTO_CLAUDE_PATH`, else the one on PATH) with Claude's tools off; Pi runs every tool. Existing Claude chats continue in Pi: their first Pi turn carries a recovery summary of their last messages (`recoverHistory`).
- Lost with the Claude backend: TodoWrite, `Task` subagents within a turn, background shells and the keep-alive query (pi-only-plan 4).

### 2.2 Credentials and connection resolution

| Step | Rule |
|---|---|
| Which connection | The agent names a **provider and model**, not an account. At run time the server takes the chat creator's connection of that provider: their own (`user:<id>`), else the workspace's, else the install's (the existing `ConnectionContext` lookup) |
| None found | The chat cannot run; the composer says "Connect {provider} to talk to {agent}" and opens Settings › Models |
| Shown | Chat header: "Runs on {person}'s plan" (or "workspace plan") |
| Other participants | Never switch the connection; a steer from someone else still runs on the creator's |
| Where the secret goes | Keys and tokens: injected into Pi's in-memory `CredentialStore` on the server; never in the box. Claude subscription (`claude-code`, `auth_type: 'cli_login'`): no secret; the human's own `claude` login (desktop: their installed `claude`; hosted: their own container, B5) |
| MCP tokens | `secrets` rows referenced by `sources.secret_id`; read by the pool on the server only |
| Run token | Per turn, bound to (user, workspace, chat), 1 h max, hashed in memory, reaches the box as `OTTO_AGENT_TOKEN` for the `otto` CLI |

### 2.3 History: chats and messages

- Tables: `chats`, `messages`, `messages_fts` (contentless FTS5). Columns in [schema.md](schema.md) (forthcoming); the design is [messages-design](messages-design.md) with the one-store change below.
- **One store, no `transcripts` table** (DECISION D2): `messages` gains only `parent_id` (Pi's tree); no `source`. Pi rows hold the Pi entry verbatim; Otto rows hold today's `StoredMessage` JSON (user message with sender, error, info, plan, auth-request, partial text, in-flight tool status); `type` tells them apart. Display is derived from the row on read; FTS text from it at write. The 200k cap and image rule apply to Otto rows; Pi rows are verbatim (moving inline images to the library is a later lossless step).
- `chats` gains `agent_id` (null = the workspace's default agent); no `harness`. Until then the session header carries `agentId` (built). Everything else as data-architecture (c).
- `pi-durable` stays a later trial (phase H4), on its own file; it forces integer ids and has no skills/MCP loader, so it is not the MVP store.

### 2.4 Files and S3

| What | Where |
|---|---|
| Library bytes | S3 (`workspaces/<ws>/library/<id>`), disk read-through cache (built, P4a) |
| Skills, sources | S3 bundles by slug (`workspaces/<ws>/skills/<slug>/…`; S1 dropped the `rev`, see object-storage.md), rows as index (`skills`, `sources`); materialized folder on the server, mounted read-only into boxes |
| Chat files (plans, notes, downloads) | P7: S3 under `workspaces/<ws>/chats/<chat_id>/`; until then the box volume |
| Agent working files | The agent's named volume (`/home/agent/files`, `/home/agent/chats/<chat_id>`, `/home/agent/memory`) |
| Messages | Database only; never S3 |

### 2.5 The computer and multiplayer rules

- Image `otto-agent` (Debian slim, Xvfb, Openbox, x11vnc + noVNC, Chromium with CDP on loopback, `agent-browser`, tmux, git, node, uv, the `otto` CLI; no `claude`). Non-root, `--cap-drop ALL`, no-new-privileges, `--memory 2g --cpus 1 --pids-limit 512 --shm-size 1g`. Container name `otto-agent-<agent_id>`, docker labels carry workspace and agent: **no `computers` table** (docker is the truth).
- Lifecycle: `ensureRunning` at the first tool call; stop after 15 idle minutes with no run and no noVNC viewer. noVNC behind the server's auth with short-lived tokens.
- Desktop (local) mode: `Computer` = local exec on the host, as today.
- **In progress** (uncommitted, by another agent): `packages/shared/src/computer/` (`LocalComputer`, `DockerComputer`, idle stop, `COMPUTER_RESTARTED`, chat dirs) and `docker/otto-agent/`; see [computers.md](computers.md). Tested only against a fake `docker`. Delta from this plan: the image's `~/.claude/skills -> /skills` link goes (no `claude` in the box).

| Case | Rule |
|---|---|
| Concurrent chats on one agent | Per-chat cwd `/home/agent/chats/<chat_id>`; shared `/home/agent/files`; at most **4** concurrent runs per agent, the rest queue with "Waiting for the computer" |
| Browser | One Chromium per agent (its logins); each chat its own `agent-browser --session <chat_id>` context |
| The screen | One desktop lease per agent (2 min idle); the UI shows the holder; a human in noVNC always wins |
| Privacy in the box | One Unix user per human: chat dirs 0700 for the creator's uid, `files` group-shared |
| Messages during a run | One run per chat; a new message steers (Pi `steer`), else queues; Stop drops the queue |
| Box dies mid-turn | The tool call returns "computer restarted; the action may have run", the turn goes on |

### 2.6 MCP, skills and instructions

**One source of truth.** `sources` and `skills` rows plus their S3 bundles; `agents.sources` / `agents.skills` pick which ones an agent gets (`[]` = all); `agents.instructions` and the workspace's `instructions` setting hold the prompt text. Every turn renders that truth into Pi's native form. Pi reads no config files from the box.

**What exists today** (Craft-derived code, read 6 Oct 2026, instructions as built in B2; `S` = `packages/shared/src`):

| | Pi (`S/agent/pi-agent.ts` + `packages/pi-agent-server`) |
|---|---|
| MCP | Otto's tools and one proxy per source tool as definitions over the JSONL protocol (`getProxyToolDefs`, `mcp__session__*`, `mcp__<slug>__<tool>`), executed by the host (`routeToolCall`) |
| Pool | `McpClientPool` (`S/mcp/mcp-pool.ts`) **per chat**: HTTP/SSE via streamable HTTP, stdio with an allow-listed env, API sources in-process; tokens from `credentials.enc` via `SourceCredentialManager` |
| Gate | `pre_tool_use_request` per wrapped tool → `handlePreToolUseRequest` → `runPreToolUseChecks` |
| Tool search | none (Pi 0.87.1) |
| Skills | Not native: a `[skill:slug]` mention prepends "read this SKILL.md" and blocks tools until read (`base-agent.ts`); Pi's own skill listing never reaches the model |
| Instructions | A `before_agent_start` extension replaces Pi's whole system prompt with Otto's (`system-prompt-override.ts`); `PiAgent` appends the agent's assembled instructions after it (2.7); context-file discovery is off (`agentsFilesOverride: () => ({ agentsFiles: [] })`) |
| Where config lives | Sources `<ws>/sources/<slug>/` and skills `~/.agents/skills`, `<ws>/skills`, `<cwd>/.agents/skills` are files; per chat `enabledSourceSlugs` in the session header |

So the core already exists (one pool, proxy tools, one gate); what changes is where the truth lives (rows + S3), per-agent source and skill selection, and native skill listing.

**MCP.** The server's `McpClientPool` stays as built (per chat; stdio sources run on the server, never in the box); sharing one connection per workspace source waits until connection counts hurt. Per turn the server builds `Turn.mcp` = proxy tools for the agent's enabled sources whose `auth_status` is `ok`, named `mcp__<source-slug>__<tool>`. Each proxy call goes through one permissions gate (workspace rules + the source's `permissions.json` + the chat's permission mode) before the pool runs it. OAuth: the server runs the flow with a server-side redirect (`/api/sources/<id>/oauth/callback`), tokens and refresh tokens go to `secrets`; a source needing sign-in shows `needs_auth` and its tools are absent from the turn. Large source tool lists are deferred (Pi `exposure: "deferred"` with `tool_search` after Pi 1.0).

**Skills.** The server materializes the workspace's skills folder from S3 (`<ws>/skills/<slug>/`) and bind-mounts it read-only at `/skills` in every box of the workspace. Pi lists the agent's skills natively (name + description in the prompt); `SKILL.md` is read on demand from `/skills/<slug>/SKILL.md`. Per-agent selection filters what Pi lists; the files of other skills stay readable (accepted: skills are workspace-shared). The `[skill:slug]` mention stays as the way a person forces a skill (today's read-before-execute directive). Global and `<cwd>/.agents/skills` scopes are deleted (S1).

**Instructions** (built, B2). Per turn the session manager calls `getAgentRunConfig(chat.agentId, workspaceId)` and `assembleInstructions` (workspace instructions, then the agent's; `runMode` unattended for automation and CLI runs), and `PiAgent` appends the result after its base system prompt. Pi's AGENTS.md/CLAUDE.md discovery is off. Repo files (`AGENTS.md`, `CLAUDE.md`) inside a cloned repo in the box are working files, not Otto config: the base prompt says "if the working folder has an AGENTS.md or CLAUDE.md, read it first".

**Translation table** (what Pi does with each `Turn` field):

| Turn field | Pi (server, `createAgentSession`) |
|---|---|
| `instructions` | Built: appended after the base prompt, `agentsFilesOverride: () => ({ agentsFiles: [] })` (Pi's discovery would read the **server's** disk, not the box). M1: a custom `ResourceLoader` `systemPrompt` **replaces** the whole-prompt override extension so Pi's own skill list is appended |
| settings / config files | In-memory `SettingsManager`, isolated `agentDir`, no extensions (as today) |
| `skills` (+ `/skills` mount) | `ResourceLoader.additionalSkillPaths` = the server's materialized folder; `skillsOverride` filters to `Turn.skills` and rewrites each path to `/skills/<slug>/SKILL.md` so the redirected `read` finds it in the box |
| `mcp` (source proxies) | Proxy tool definitions over the protocol (as today); `exposure: 'deferred'` above 20 tools once on Pi 1.0 |
| `tools` (Otto proxy tools) | `mcp__session__*` proxies (as today) |
| permissions gate | `pre_tool_use_request` → `runPreToolUseChecks` (as today), plus the agent's source filter |
| built-in tools location | `read/write/edit/bash/grep/find/ls` `operations` → `computer.exec` |
| history | `SessionManager.inMemory(cwd, { id }, rows)`; new entries from `getEntries()` at `message_end`, `turn_end`, `compaction_end`, `agent_settled` |
| connection | In-memory `CredentialStore` with the creator's secret; none for `claude-code` (the provider runs the human's own `claude`) |
| cwd | `/home/agent/chats/<chat_id>` passed to `operations` |

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
| `provider` | text NN | which of the creator's connections pays (2.2) |
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

**A1 as built** (backend, 6 Oct 2026; the UI is A2). Owner changes since the table above: `mascot` and `color` are one `avatar` column (`''` = a generated avatar from the id hash, else `library:<id>` of an uploaded image; only the format is checked, `library` existence is A2's), and the system prompt is Otto's **addition after Pi's own prompt**, built as XML groups.
- **Code.** `packages/shared/src/agents/`: `schema.ts` (explicit snake_case columns, camelCase properties), `types.ts` (browser-safe types and limits), `index.ts` (`getAgents`, `getAgent`, `getDefaultAgent`, `createAgent`, `updateAgent` with `expectedUpdatedAt`, `deleteAgent`, `initAgentsSeed`, `getDefaultProvider`, `getWorkspaceInstructions`, `canEditAgent`, `getAgentRunConfig`), `import.ts` (`initAgentsImport`), `instructions.ts` (`assembleInstructions`), `agents.test.ts`. `updateAgentActor(db, workspaceId, from, to)` was added to `tasks` (created by, assignees, timesheets), `projects` (members) and `library` (created by). Subpaths `@otto/shared/agents`, `/types`, `/import`.
- **Rules.** Default = oldest (created strictly after the newest, so no ties); the last agent cannot be deleted; `provider` defaults to the creator's default connection's `type` (its Pi provider id), else `anthropic`. **Deviation:** deleting an agent does not rewrite chats (file-backed headers belong to the session manager): a header `agentId` (new optional, persistent field of `SessionConfig`/`SessionHeader`/`SessionMetadata`, `createSession` option) that no longer exists falls back to the default agent in `getAgentRunConfig`. With P3b's `chats` table, `deleteAgent` sets `chats.agent_id` to null in its transaction (TODO in the code).
- **Seed and import.** `initAgentsSeed(workspaceId, createdBy, provider)` runs when a workspace is created (`workspaces:create`, `server:createWorkspace`) and at the first `agents:list` of a workspace with none; `initAgentsImport()` runs at boot (headless and Electron) once per workspace (`imports` key `agents:<id>`), creator = first owner else first user (none: left for the next boot), and in one transaction rewrites `agent:default` to `agent:<id>` in tasks, timesheets, projects_members and library.
- **Channels.** `agents:list|get|create|update|delete` (`handlers/rpc/agents.ts`, the connection's workspace like tasks; REMOTE_ELIGIBLE; `domain:changed` kind `agents` for create/update/delete; renderer `getAgents` ... `deleteAgent`, `useAgents`). Guard: `AGENT_WRITE_CHANNELS` in `bootstrap/authorize.ts` (update and delete: creator or workspace owner, by `canEditAgent`; an id that is no agent of the workspace passes and gets `not_found`), tested in `authorize.isolated.ts`. Setting `instructions` (workspace entity, at most 20,000 characters) is in the catalogue; owners write it through the generic settings channel.
- **Interim tool.** `agents_edit` (list, get, create, update, delete) in `session-tools-core` and `runWorkspaceConfigAction(..., 'agents', ...)`; any member creates, creator or owner changes. Bundled doc `agents.md`, `DOC_REFS.agents`.
- **Prompt assembly.** `assembleInstructions({ product, rules?, workspaceInstructions, agent: { title, instructions, homePath? }, toolGuidance?, sources?, runMode? })` returns `<{product}_rules>`, `<{product}_workspace>`, `<{product}_agent name home>` (its instructions, else a one-line home hint, else omitted), `<{product}_tools>`, `<connected_mcps>`, `<{product}_run mode="unattended">`, each omitted when empty, attributes escaped as in BB. `getAgentRunConfig(agentId, workspaceId?)` returns `{ agent, instructions (workspace + agent only), workspaceInstructions, agentInstructions, provider, model, thinkingLevel, skills, sources }`.
- **Pi wiring (done, B2).**
  - Per turn the session manager calls `getAgentRunConfig(chat.agentId, workspaceId)` and `assembleInstructions` (workspace and agent instructions, `runMode` unattended for automation and CLI runs; the base prompt already carries rules, tools and sources), and `PiAgent` appends the result after its base prompt.
  - Pi's context-file discovery is off: `agentsFilesOverride: () => ({ agentsFiles: [] })`.
  - New chats take `agentId` from `sessions:create` options; the chat DTO has `agentId`.
  - The domain types include `'agents'`, and `agents_edit` is named "Edit Agents" in `session-manager.ts`.

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
| H0 | Pi only (delete Claude backend) | **Built** (pi-only-plan B2, B3): `PiAgent` used directly, `AgentBackend`, the registry and the Claude backend deleted; Claude subscriptions through the `claude-code` Pi provider | M | - | typecheck; Pi agent tests; an old Claude chat continues |
| P3b | Chats and messages in SQLite | (1) `*_fts` filter, `chats` + `messages` + importer; (2) manager/queue, DB-first reads, LRU; (3) RPC paging, renderer, FTS search, thumbnails; (4) durability + one store (`parent_id`, Pi rows verbatim), crash suite | L (4 M) | N0; chunk 4 needs H0 | importer twice = same rows; crash suite; benchmarks in messages-design 8 |
| A1 | Agents domain | `agents` table, CRUD functions, seed + `initAgentsImport`, `agents:*` RPCs and guards, `chat.agent_id` (session header until P3b's column), `Turn.agent/instructions/model` from the row, workspace `instructions` setting, interim `agents_edit` tool | M | N0, H0 | unit tests; a chat with agent B uses B's instructions and model |
| A2 | Agents UI | Settings › Agents gallery and detail (autosave), composer "With" picker, mascots in chat header and list, DESIGN.md entry | M | A1 | browser at 390/768/1440, both themes |
| S1 | Skills on rows + S3 | P4b: `skills` table, `updateBundle`, materialize, watcher, importer; global/project skill code deleted | L (2 M) | N0 | sync round trip; two writers conflict test |
| S2 | Sources on rows + S3 | P4c: `sources`, `auth_status`, source credentials and MCP OAuth tokens in `secrets`, server-side OAuth callback | L (2 M) | S1 | a source signs in; token only in `secrets` |
| M1 | Render per turn in Pi | Translation table (2.6): per-agent source and skill filters; Pi `ResourceLoader` prompt (override extension deleted), skills filter + path rewrite, deferred exposure (context files already off) | M | A1, S2 | same agent, same skill and source: listed, read on demand, gated |
| C1 | The computer | `otto-agent` image, `Computer` = `docker exec`, `/skills` mount, per-chat dirs, lifecycle, limits (**interface, DockerComputer and image written, not run**: computers.md); left: run on a real daemon, Pi tools into it (needs H0), the 1-day spike (screenshot, kill mid-`bash`) | M | H0 for Pi wiring | spike checklist (agent-computers 2) |
| C2 | Multiplayer box | uid per human, desktop lease, 4-run cap and queue, noVNC behind auth, "Open screen" in A2's Computer section | M | C1, A2 | two users, one agent, parallel chats, private dirs |
| PT | `otto` CLI | `/api/agent/rpc`, run token, generated package and skill, first modules incl. `otto agents`; `labels_edit`/`agents_edit` interim tools deleted | L (2 M) | P3b | generator test; CLI smoke against `:memory:` |
| R1 | Routines on the DB | P5a + `agent_id`; runs create chats on the creator's connection; P5b webhook | L (2 M) + S | A1, P3b | slot fires once across restart; routine on agent B |
| B1-B5 | Claude bridge | The phases of [pi-only-plan](pi-only-plan.md) 6: B1 spike, B2 Pi-only session path and B3 Claude backend deleted are built; B4 UI and connection cleanup; B5 hosted route (`otto-claude-<userId>` container), flag off until the written OK | S-M each | B5: **Anthropic's OK** | pi-only-plan 6 |
| P6 / P7 | Search, cleanup | `search_fts` + merged RPC; chat files on S3, `credentials.enc`/`config.json`/legacy folders out | M / L | P3b / P3b, S2 | |
| H4 | `pi-durable` trial | Own SQLite file, conformance suite, one chat behind a flag, crash suite; adopt, wait or drop | M | P3b, P0d | crash suite passes on it |

**Order and lanes** (smallest risk first; separate agents, separate files):

| Lane | Sequence | Can start |
|---|---|---|
| Core | N0 → P3b(1-3) → P3b(4) → PT → P6/P7 | now (N0 waits for schema.md) |
| Harness | H0 (built) → P0d → M1 (after A1, S2); B4 → B5 (after the OK) | now, beside Core |
| Agents | A1 → A2 → R1 | after N0 and H0 |
| Bundles | S1 → S2 | after N0, beside Core |
| Computer | C1 → C2 | now (C1 is under way); Pi wiring after H0 |
| Later | H4, hosted `Computer` adapter | after P3b |

Blocks: N0 blocks every new table; S2 + A1 block M1; Anthropic's written OK blocks B5. Conflict zones (one agent at a time): `session-manager.ts` (P3b, A1), `pi-agent-server` (M1, P3b(4), B4, B5). `claude-agent.ts` no longer exists.

## 4. Decisions ("go" = every DEFAULT)

| # | Decision | DEFAULT (assumed on "go") | Alternative | Cost of switching later |
|---|---|---|---|---|
| D1 | Claude subscriptions (E1) | Through the `claude-code` Pi provider and the human's own `claude`: local and self-hosted now; hosted (B5) behind a flag that stays off until Anthropic's written OK; ask now | Ship hosted on the "unmodified binary" clause alone (high risk) | Flag flip either way; enforcement risk without notice if shipped unasked |
| D2 | Transcripts (DECISION 16, E2) | **Merged**: one `messages` table, `parent_id`, Pi rows verbatim, no `source`, no `transcripts` | A separate `transcripts` table (copies each answer once) | Before users: S (move Pi rows by `type`); after: M |
| D3 | Linux users in a box (E3) | One Unix user per human (C2), created by `docker exec -u root useradd`; the box keeps `CHOWN, SETUID, SETGID, DAC_OVERRIDE` (root inside is reachable only from the server) instead of `--cap-drop ALL` | One user for all; or recreate the box with users baked in at `docker run` | S: chown + exec user; cross-chat file reads until then |
| D4 | ChatGPT route (E4) | Pi's native ChatGPT sign-in for local and self-hosted; apply to "Sign in with ChatGPT" before hosted launch; no Codex adapter | Codex CLI in the box (a second harness, history only in its rollout files) | M (one adapter) |
| D5 | Concurrency (E5) | 4 runs per agent, rest queued; one desktop lease | No cap (the 2 GB box is the cap) | A constant |
| D6 | snake_case | Switch now (N0), before P3b creates `chats`/`messages`, per schema.md | Keep camelCase columns | Grows with every table and query; after P3b ~L |
| D7 | `order` column | Rename to `position` (no keyword quoting) | Keep `"order"` | S rename now, more later |
| D8 | Agent instructions | In the DB (`agents.instructions`; workspace `instructions` setting), assembled per turn; no AGENTS.md as config; no Pi context files (built) | An editable `AGENTS.md` in the agent's home on the volume | S: read a file into the same slot |
| D9 | Which account an agent uses | Provider + model on the agent; the chat creator's connection pays | Pin `connection_id` on the agent (DESIGN.md's "names its one account") | S column add, but breaks "your plan powers your agents" for shared agents |
| D10 | Agents UI | BB's: Settings › Agents gallery, one-page detail, no tabs, autosave, "+" prefills | Top-level Agents nav item; tabs | S (route move) |
| D11 | Agent rights | Every member uses and creates; creator + owners edit/delete | Owners only create | S (guard set) |
| D12 | Agent memory | Files under `/home/agent/memory/` on the volume, no table, no git | BB's git-backed home, or a `memory` column | S-M |
| D13 | Skills/sources per agent | JSON id lists on `agents`, `[]` = all | Child tables `agents_skills`, `agents_sources` | S |
| D14 | Box-local repo instructions | Not auto-loaded by Pi (context-file discovery off, built); the base prompt tells the agent to read `AGENTS.md`/`CLAUDE.md` in its working folder | Pi context-file discovery redirected into the box | S, but loses "DB is the only truth" |
| D15 | `pi-durable` | Trial later (H4), not the MVP store | Adopt now (port `pi-agent-server`, integer-id exception) | M-L either way |
| D16 | Stdio MCP sources | Run on the server in the pool (today) | Run in the agent's box | M; tokens would enter the box |
| D17 | How skills reach the model | Native listing in Pi (name + description; agent picks), `[skill:slug]` mention kept to force one | Today's mention-only (no list in the prompt) | S |

## 5. Risks and what is unverified

| Item | Status |
|---|---|
| Bridge billing: the server reads the appended system text and can bill extra usage or answer `400 Third-party apps now draw from your extra usage` | Unverified; no real `claude` run yet (pi-only-plan 2, B1 item 5) |
| Account risk on the bridge route (one Max account suspended after using a bridge, cause unknown; enforcement without notice) | Medium for local and self-hosted on the user's own login; high for hosted until Anthropic's written OK (D1) |
| Bridge details checked only against the SDK's code and a fake `claude`: `--thinking-display`, Pi's anthropic model ids as `--model`, the `dontAsk` + `mcp__pi` rule, the JSONL record shape, `CLAUDE_CODE_ENTRYPOINT=sdk-ts` for billing; Pi 1.0.4; Docker RSS and cold start | Unverified (pi-only-plan 8) |
| Pi mirror at four events catches every entry type | Unverified; P3b(4) compares with a file-backed run |
| Verbatim Pi rows: size and read cost (a real Pi file is 2.2 MB vs 281 KB of messages) | Measured only in the spike on tmpfs; benchmark on disk with `synchronous = FULL` |
| Pi skills path rewrite (`skillsOverride`) so the redirected `read` finds `/skills/...`; Pi keeping its skill list when `systemPrompt` comes from the `ResourceLoader` | Unverified; M1 test (fallback: Otto writes the list into `Turn.instructions` for Pi) |
| Pool per chat with many open chats (one MCP connection per source per chat) | Accepted for now; share per workspace if counts hurt |
| Pi's ChatGPT OAuth and Codex CLI under OpenAI terms for a hosted multi-user product | Unverified (D4) |
| Box density (15-25 active, 40+ idle per 8 vCPU / 32 GB), Chromium start, `agent-browser --session` concurrency, gVisor + Chromium | Estimates; C1 spike measures |
| N0 renames: drizzle-kit sees a rename as drop + add | Hand-written rename step; Better Auth on renamed columns needs a test |
| `session-manager.ts` and `pi-agent-server` are touched by several phases | Serialize per the conflict zones in 3 |
| BB facts | Read from BB at commit 23af67d23; not run |
