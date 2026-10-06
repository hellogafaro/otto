# Harness plan: one small seam, one store, one computer per agent

Research 6 Oct 2026, read-only; nothing built. It builds on `docs/agent-computers.md` (plan D), `docs/pi-research.md`, `docs/messages-design.md` and `docs/data-architecture.md` ("Durability", (h), P8). It does not repeat the `pi-durable` storage spike running in `/tmp/pi-durable-spike` (`otto-storage.ts`, `bun-facade.ts`; results land in `docs/pi-research.md`). All URLs were read on 6 Oct 2026.

Owner context: Otto is multiplayer, and one agent can chat with several people at once. Every agent gets one Linux computer. Tools are code; skills (folders) and MCP sources are the dynamic parts, pushed on `domain:changed`. A chat's runs use the chat creator's own subscription; for Claude that means the unmodified Claude Code, signed in by the user inside the box. History lives in one store. The harness is headless and swappable.

**Verdict.** Keep Pi as the default harness. Neither AI SDK harnesses (fx, `HarnessAgent`) nor Mastra is better for Otto today. Both are broader, change weekly or daily, and own the conversation history themselves; that rules out the one store the owner asked for. Two findings change the earlier plan:
1. The Claude Agent SDK has a `SessionStore` that mirrors Claude Code's transcript into our database, even when the CLI runs in a container. The Claude transcript can therefore live in the same table as Pi's, and the planned P7 blob goes away.
2. Anthropic's Agent SDK page says plainly: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." The Claude subscription route needs Anthropic's written OK before it ships.

## (a) How it glues together

```
browser/desktop ──WS──> Otto server (Bun) ─────────────────────────────── otto.db (SQLite)
                          │  chat run = Harness.run(turn)                    messages: ONE row per fact
                          │   ├─ Pi adapter (in process, default)            (harness entries verbatim
                          │   └─ Claude adapter (Agent SDK on server,         + Otto rows), FTS, chats
                          │        CLI spawned in the box, SessionStore -> messages)
                          │  tools (hard-coded) + MCP pool proxies run HERE; secrets never leave
                          │  docker exec -u <human uid> ...
                          v
                 agent computer (1 container per agent, named volume)
                   /home/agent/files   shared working files       Chromium (CDP) + Xvfb + noVNC
                   /home/agent/chats/<chatId>  per-chat cwd        agent-browser --session <chatId>
                   /skills (read-only mount, synced on domain:changed)   otto CLI (scoped run token)
                   ~/.claude per human uid (only for Claude-route users)
```
Every turn follows the same five steps:
1. The server loads the chat's rows.
2. It hands the adapter one `Turn`: history, input, tools, MCP proxies, skills path, computer and connection.
3. The adapter streams events and emits durable `entries`.
4. The server commits the entries, display changes and FTS in one transaction.
5. Tools touch only the agent's computer.

## (b) The harness-agnostic boundary

**It already exists and is too big.** `AgentBackend` (`packages/shared/src/agent/backend/types.ts:331`) has about 45 members: titles, mini completions, permission modes, sources, working-directory setters and more. Each harness re-implements all of them (`claude-agent.ts` is 3,274 lines, `pi-agent.ts` 2,810, `pi-agent-server` 1,936). The seam to keep is the turn. Everything else is server logic, which harnesses should not hold. `factory.ts` keeps a `DRIVER_REGISTRY` for two drivers; a `switch (chat.harness)` replaces it, since a registry for one use breaks the AGENTS.md rule.

The smallest viable seam is one file, `packages/shared/src/agent/harness.ts`:

```ts
export interface Harness {
  /** Run one turn to settlement. Resume = run with history. Interrupt = abort the signal. */
  run(turn: Turn, emit: (event: HarnessEvent) => void, signal: AbortSignal): Promise<void>
  /** Join the running turn (Pi steer, Claude streamInput); false = the server queues it as the next turn. */
  steer(chatId: string, input: UserInput): boolean
  /** Pure: what people see for one stored row of this harness. Display and FTS text come from here. */
  toDisplay(row: MessageRow): StoredMessage[]
}

export type Turn = {
  chat: { workspaceId: string; chatId: string; agentId: string; cwd: string } // cwd inside the computer
  history: MessageRow[]          // this harness's rows of the chat, in "order" (the one store)
  input: UserInput               // text, attachments, sender userId, client id (idempotent)
  model: string; thinkingLevel: ThinkingLevel; instructions: string
  tools: OttoTool[]              // hard-coded tools, executed on the server
  mcp: McpProxy[]                // our pool's sources, executed on the server, tokens never in the box
  skillsDir: string              // folder inside the computer; the harness indexes it, never inlines it
  computer: Computer             // where built-in tools run
  connection: Connection         // the chat creator's credential handle (API key, or "signed in inside the box")
}

export type HarnessEvent = AgentEvent /* today's union: text_delta, tool_start, ... */
  | { type: 'entries'; entries: MessageRow[] }  // durable: committed by the server with the turn's display rows

export interface Computer {
  id: string
  ensureRunning(): Promise<void>
  exec(argv: string[], o: { cwd?: string; env?: Record<string, string>; user?: string; stdin?: boolean; signal?: AbortSignal }): Spawned
}
```

**Adapters.**
- **Pi (first).** Seeds `SessionManager.inMemory(cwd, { id }, history)`. It redirects `read/write/edit/bash/grep/find/ls` through `operations` to `computer.exec`, and passes `tools` and `mcp` as `customTools`. Skills come in through the `ResourceLoader` from `skillsDir`. At `message_end`, `turn_end`, `compaction_end` and `agent_settled` it emits the new entries from `getEntries()` as `entries`; how this mirroring works is in pi-research 2a.
- **Claude Code in the box (second).** The Agent SDK runs on the server and starts the CLI with `spawnClaudeCodeProcess` → `docker exec -i -u <uid> <box> claude …`. The SDK documents that option as the way "to run Claude Code in VMs, containers, or remote environments" ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript)). Its `sessionStore.append` emits `entries`. `tools` and `mcp` become `createSdkMcpServer` servers, which "run in the same process as your application", so they run on the server. This is how `createSourceProxyServers` already works (`claude-agent.ts:434`).
- **Later candidates.** `pi-durable`: its `Storage` over the same rows, which is P8 and the spike. AI SDK `HarnessAgent`. Codex app-server. Each one is a new adapter plus its `toDisplay`; nothing else changes.

**The one store.** This replaces the two-table plan of DECISION 16 and needs the owner's choice (E2). `messages` keeps its decided shape (`pk, workspaceId, chatId, id, "order", type, content, createdAt, updatedAt`, FTS, `BEGIN IMMEDIATE` batches) and gains two columns:
- `source`: `'otto' | 'pi' | 'claude'`.
- `parentId`: Pi's tree.

Harness rows hold the harness's entry **verbatim** in `content`. Otto rows hold today's `StoredMessage` JSON: the user message with its sender (committed before the ack), `error`, `info`, `plan`, `auth-request`, the 500 ms partial-text snapshot, and the in-flight tool status. The last two are deleted in the transaction that commits the harness's final entry.

The rules that follow:
- Nothing is copied into a second table.
- `load` = `WHERE chatId AND source = :harness ORDER BY "order"`.
- Display is `toDisplay(row)` on read, and FTS text is taken from it at write.
- The harness echoes the user's text back as its own user entry. That is the one unavoidable duplicate: a few bytes, hidden by `toDisplay`.

Swapping the harness means:
- A chat is pinned to the harness it started with (`chats.harness`).
- New chats use the new adapter.
- An old chat continues on its old adapter, or branches into the new one with a summary (`buildRecoveryContext` already does this).

The trade-off: verbatim rows break two decided rules. They no longer have the 200k-char cap or the "no inline base64" rule. The 200k cap therefore moves into `toDisplay`. The Pi adapter's write path can move inline images into library items and re-inline them on `load`; that is lossless but not built, so ship without it first. Status: not verified (see (f)).

## (c) Comparison

| | Pi 1.0.4 (coding-agent; durable is experimental) | AI SDK harness adapter / fx | AI SDK agents (`ai` 7) | Mastra 1.74 | Claude Code CLI (in the box) | Codex CLI |
|---|---|---|---|---|---|---|
| Headless | SDK in process, or RPC mode | `HarnessAgent`; Claude/Codex/fx run as a bridge **inside** a sandbox; Pi runs in the host process | yes, library | yes, library; durable features need a `Mastra` instance | `claude -p --output-format stream-json`, or the Agent SDK | `codex exec --json`; app-server JSON-RPC over stdio/WS |
| MCP | yes (1.0); we keep our pool | `mcpServers` per adapter | `@ai-sdk/mcp` stable (HTTP, OAuth) | `@mastra/mcp` v2 | yes; SDK in-process MCP runs on the server | yes |
| Skills | native, read on demand | "surfaced by the adapter" | no local loader in core (`bash-tool` has an experimental one) | native (agentskills.io) | native (`~/.claude/skills`, `.claude/skills`) | plugins/skills |
| Per-agent computer | tools via `operations` (Gondolin/ssh pattern); harness stays on the server | sandbox provider; Docker only via a one-maintainer package (`ai-sdk-sandbox-docker` 0.1.2) | experimental `SandboxSession` (bash only) | `@mastra/docker`; computer use only on E2B Desktop/Daytona | the CLI runs in the box | runs in the box |
| History you own | yes: seed from our rows (coding-agent); a `Storage` interface (durable) | **no**: "the session owns its native conversation history"; prior `messages` are not replayed; mirror only | yes (you store `UIMessage`s) | its own `mastra_*` tables (uuid ids); custom `MemoryStorage` undocumented | yes, through `SessionStore` (a mirror; resume from the store) | **no**: `thread/resume` by stored thread id only (rollout files) |
| Durability | today: our P3b plan; durable: checkpointed runs, idempotent submits | Workflow DevKit utilities, state per run | `WorkflowAgent` + Workflow 5 (self-hosted Postgres World is a "reference implementation") | durable agents beta | transcript mirror is "best-effort" (drops a batch after 3 tries) | rollout files on the box |
| Subscriptions, legally | ChatGPT: Pi's Codex OAuth works; for a hosted product **unverified** (commercial "Sign in with ChatGPT" is a waitlist). Claude: no | the Claude adapter reads `~/.claude/.credentials.json` and injects the token: the "intermediate credentials" Anthropic forbids | API keys; the community Claude Code provider has the same problem | API keys; Mastra Code's Claude OAuth is a "grey area" in its own words | allowed for "the unmodified Claude Code binary" hosted with the user's own sign-in, but the Agent SDK note requires approval: **ask Anthropic** | user's own ChatGPT login in the CLI; hosted terms unverified |
| Maturity | 1.0, stable core; durable "changes without notice" | "experimental", ~170 versions in 4 months; fx 0.0.13 | v7 stable; harness and sandbox experimental | weekly minors; Beta/Harness surfaces break in minors; `ee/` licence | stable, vendor-maintained | stable CLI; app-server parts experimental |
| Effort to adopt | none (running today); seam carving S-M | L (new runtime, bridges, sandbox provider) and we lose history ownership | L (re-build what Pi does) | L (framework, tables, licence check) | M (runs today on the host; box + spawn + store) | M (no store interface) |

Sources:
- fx and the harness adapter: [changelog fx](https://vercel.com/changelog/fx-ai-sdk-harness-adapter), [fx.sh](https://fx.sh/), [harness changelog](https://vercel.com/changelog/program-agent-harnesses-with-ai-sdk), [harness docs](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/harness-agent), [adapters](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/harness-adapters), [Claude adapter](https://ai-sdk.dev/v7/providers/ai-sdk-harnesses/claude-code). The `claude-code-subscription.ts` credential read is in the npm tarball source.
- AI SDK: [registry](https://registry.npmjs.org/ai), [loop control](https://ai-sdk.dev/docs/agents/loop-control), [sandbox](https://ai-sdk.dev/docs/reference/ai-sdk-core/sandbox), [persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence), [WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent), [Postgres World](https://workflow-sdk.dev/worlds/postgres).
- Mastra: [registry](https://registry.npmjs.org/@mastra/core), [durable agents](https://mastra.ai/docs/harness/durable-agents.md), [storage](https://mastra.ai/docs/storage.md), [Docker sandbox](https://mastra.ai/integrations/sandboxes/docker.md), [computer](https://mastra.ai/docs/sandbox/computer.md), [ACP agent](https://mastra.ai/reference/acp/acp-agent.md) (no history: `hasOwnMemory()` false), [EE licence](https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE).
- Claude: [session storage](https://code.claude.com/docs/en/agent-sdk/session-storage), [legal](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [headless](https://code.claude.com/docs/en/headless), [authentication](https://code.claude.com/docs/en/authentication).
- Codex: [non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode), [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

**Why not switch.**
- fx/`HarnessAgent` is the closest thing to the "newer, more composable harness" the owner has in mind. It is already an interface over Claude Code, Codex, Pi, OpenCode, Cursor and fx. It fails three of our requirements:
  - It cannot be seeded from our history (mirror only), which breaks the one store.
  - Its Claude subscription path lifts the user's token out of the credentials file.
  - It is experimental, with near-daily releases.
- Our `Harness` is shaped so a `HarnessAgent` adapter can be added later without touching the rest. Watch it.
- Mastra adds a framework with its own tables, uuid ids and an EE-licensed auth part. It gives no new subscription route, and computer use is hosted-only.
- Plain AI SDK agents would mean rebuilding Pi's compaction, steering, sessions and skills ourselves.

**Code evidence for the Claude adapter.** The SDK we pin (`@anthropic-ai/claude-agent-sdk` 0.3.280) passes `--session-mirror` to the CLI and receives `transcript_mirror` frames over stdio (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`). The mirror therefore works when the CLI runs in a container. The SDK warns: "sessionStore with custom spawnClaudeCodeProcess: ensure the subprocess CLAUDE_CONFIG_DIR matches the parent (same path …) or transcript_mirror frames will be dropped." Resume-from-store writes the transcript into a temporary config directory **on the server**. A remote CLI would not see that directory, so resume keeps the box's own `~/.claude` on its volume. When that copy is missing, the adapter writes the stored rows back into the box's JSONL before spawning. Both steps are spike items.

## (d) Recommendation and phases

Pi stays the default; Claude Code in the box is the Claude-subscription route, once Anthropic confirms. Each phase ships on its own:

| Phase | What | Size | Ships |
|---|---|---|---|
| H0 | `harness.ts` (`Turn`, `HarnessEvent` with `entries`, `Computer`, `toDisplay`). The Pi adapter implements it on the host (`Computer` = local exec). The `DRIVER_REGISTRY` becomes a `switch`. Members that are not turn work (titles, mini completion, permission mode, sources) move out of the backend one at a time as they are touched | M | same behaviour, smaller seam |
| H1 | One store (if E2): `messages.source` + `parentId`; Pi rows verbatim; `toDisplay` for Pi; Claude `SessionStore` → rows (`append` dedupes by `entry.uuid`). This replaces the `transcripts` table in P3b and the Claude blob in P7 | M (inside P3b) | Pi and Claude chats resume from the DB on any host |
| H2 | The computer: one `otto-agent` image, details below. Container per agent, named volume, `Computer.exec` = `docker exec`. Pi tools go into it. Skills read-only mount. Per-chat dirs. Uid per human. Lifecycle and limits. noVNC behind the server's auth with short-lived tokens. Then the agent-computers spike (screenshot, kill mid-`bash`) | M | agents on API keys or ChatGPT get a computer |
| H3 | Claude route, only after Anthropic's written OK (E1). `spawnClaudeCodeProcess` → `docker exec -i -u <uid> claude`; the user signs in through Anthropic's own flow in a terminal in their box (paste-code flow); `CLAUDE_CONFIG_DIR` per uid on the volume; mirror to rows; restore-if-missing | S-M | Claude subscriptions, terms-clean |
| H4 | `pi-durable` adapter behind the same `Harness` (P8, using the spike's storage result) | M | mid-turn resume after a crash |
| later | Hosted computers: a second `Computer` (E2B Desktop with memory pause/resume, or a Firecracker/Kata host); same image | M | hosted plan |

**The computer (H2), simplest that works.**
- **Image.** Debian slim with Xvfb, Openbox, x11vnc + noVNC, Chromium (CDP on loopback, `--no-sandbox --disable-dev-shm-usage`), `agent-browser`, tmux, git, node, uv, the `otto` CLI and, for H3, `claude`.
- **Container settings.** Non-root, `--cap-drop ALL`, no-new-privileges, default seccomp, `--memory 2g --cpus 1 --pids-limit 512 --shm-size 1g`. Egress open with an allow-list later, the same defaults as OpenClaw's ([docker backend](https://docs.openclaw.ai/gateway/sandboxing/docker-backend)).
- **Lifecycle.** Start on demand at the first tool call (`ensureRunning` → `docker start`, under 1 s plus a few seconds for Chromium). Stop after 15 idle minutes. The named volume keeps `/home` across stops; RAM state is lost.
- **Density.** About 300-600 MB idle and 1-1.5 GB active (estimate; measure). That is roughly 15-25 active or 40+ mostly idle agents on 8 vCPU / 32 GB.
- **Skills.** The server's materialized workspace skills folder is bind-mounted **read-only** at `/skills`, so a `domain:changed` sync shows up with no copy step. It is symlinked to `~/.claude/skills` for Claude Code. Pi gets `/skills` through the `ResourceLoader` (name + description + path in the prompt, `SKILL.md` read on demand). Hosted later: pull from object storage on `domain:changed`.
- **MCP sources.** They stay in the server pool and reach both harnesses as proxy tools, so tokens never enter the box.
- **Runtime choice.** Pass on gVisor until a Chromium smoke test passes, since reports conflict ([gVisor compat](https://gvisor.dev/docs/user_guide/compatibility/)).
- **Rejected.** Kasm: the community edition is non-commercial and limited to 5 sessions ([licence](https://kasm.com/docs/latest/license.html)). Daytona: archived ([repo](https://github.com/daytonaio/daytona)).

**Multiplayer edge cases (one computer, many people).**

| Case | Recommendation |
|---|---|
| Concurrent chats on one computer | Each chat's cwd is `/home/agent/chats/<chatId>`, and shared work goes in `/home/agent/files`. Shell isolation needs nothing extra, since every `bash` call is its own process; long-running processes go in tmux session `<chatId>`. Cap runs per agent (for example 4 at once); the rest queue with a visible "waiting for the computer" status |
| Browser contention | One Chromium per agent and one profile, which carries the agent's own site logins. Each chat gets an isolated `agent-browser --session <chatId>` context, so chats browse in parallel without fighting ([agent-browser](https://github.com/vercel-labs/agent-browser), [contexts](https://playwright.dev/docs/browser-contexts)) |
| Who owns the screen | The visible desktop (pixel-level computer use, a human taking over through noVNC) is one per agent, under a **lock with a lease**: one chat holds it (2 min idle lease), others queue, and the UI shows who holds it. A human in noVNC always takes precedence |
| Whose connection pays | Always the **chat creator's** connection (owner rule), shown in the chat header ("runs on Ana's plan"). Another participant's message never switches the connection. A creator with no connection: the chat cannot run, and the UI asks them to connect |
| Credentials of several users in one box | Pi route: none in the box. Claude route: one **Unix user per human** inside the agent's box; that user's `CLAUDE_CONFIG_DIR` is mode 0700 and their runs exec as that uid. Another person's chat on the same agent cannot read the token |
| Privacy between people's chats and files | The same uid split covers it: chat dirs are owned by the creator's uid (0700), and `/home/agent/files` is group-shared. The agent's memory and browser profile are shared by design, because they are the agent's. Server-side guards stay as they are (private chats, scoped run token as the chat's user) |
| Messages while a turn runs | Per chat, one run at a time. A new message steers by default (Pi `steer`, Claude `streamInput`); otherwise it is queued as a follow-up. Messages from several people enter in commit order, each with its sender. Stop aborts the run and drops queued messages, as today |
| Computer dies or restarts mid-turn | Pi route: the running tool call returns "computer restarted; the action may have run", the turn continues, and the next call runs `ensureRunning`. Claude route: the CLI dies with it, the turn ends `interrupted` (boot-recovery rules), and the next message resumes from the stored transcript |
| Idle shutdown with active chats | Stop only when no run is active, no noVNC viewer is attached and 15 minutes have passed. A skill tells the agent that background processes die on idle stop; a keep-awake lease is added only when it is asked for |
| Cost caps | Subscriptions are capped by the provider's plan. For API-key connections: a per-run step and token cap plus a monthly per-connection budget from usage rows. Compute: container limits plus a volume quota per agent |
| Server restarts mid-turn | Unchanged: data-architecture "Durability" (P3b), and mid-turn continuation with `pi-durable` (H4) |

**Easy to migrate and update.**
- A Pi version bump touches only the Pi adapter.
- A new harness is one adapter, its `toDisplay`, and `chats.harness` for new chats.
- A new computer backend is one `Computer`.
- Skills are folders and sources are pool entries, so neither needs a harness change.
- The image is versioned; `docker pull` plus restart at idle.

## (e) Open decisions for the owner

1. **E1. Claude subscriptions.** Recommended: ask Anthropic (sales) in writing whether Otto may drive a user's unmodified Claude Code, signed in by that user in their agent's box, through the Agent SDK. The Agent SDK note forbids offering "claude.ai login or rate limits … unless previously approved". Until then, Claude runs in Pi on the user's own API key. Alternative: ship H3 on the "hosted unmodified binary" clause alone, which carries an enforcement risk without notice.
2. **E2. One store.** Recommended: one `messages` table with harness entries verbatim plus Otto rows, and display derived by the adapter. This replaces DECISION 16's `transcripts` table, and verbatim rows lift the 200k and no-base64 rules for harness rows. Alternative: two tables (`messages` for display, `transcripts` for Pi) as planned, which copies each answer once.
3. **E3. Isolation inside a computer.** Recommended: a Unix user per human in each agent's box (credentials and private chat dirs separated). Alternative: one user for everyone, which is simpler, but on that agent any chat can read the other chats' files.
4. **E4. ChatGPT route for a hosted product.** Recommended: keep Pi's native ChatGPT sign-in for local and self-hosted use, and apply to OpenAI's "Sign in with ChatGPT" programme before hosted launch. Alternative: Codex CLI in the box (a third adapter; history only in its rollout files).
5. **E5. Concurrency per agent.** Recommended: at most 4 concurrent runs per agent, with the rest queued, and one desktop lock. Alternative: no cap, where the 2 GB/1 CPU box becomes the cap.

## (f) Not verified

- That Anthropic treats the Agent SDK spawning the unmodified binary, with the user's own sign-in in a hosted box, as allowed. Its two pages point in different directions (E1).
- `spawnClaudeCodeProcess` with `docker exec`, and the `transcript_mirror` path, when `CLAUDE_CONFIG_DIR` paths differ between server and box. The resume-if-missing write-back of rows into the box's JSONL is also untested.
- Verbatim harness rows in `messages`: size and read cost with long Pi transcripts (2.2 MB real file); Pi image re-inlining; `toDisplay` matching today's live event mapping.
- Pi's ChatGPT OAuth and Codex CLI under OpenAI's terms for a hosted multi-user product.
- `ai-sdk-sandbox-docker` with the Claude Code bridge end to end (the package's GitHub repo returned 404); AI SDK harness behaviour beyond its docs and tarball source.
- Mastra custom `MemoryStorage` as a supported path; whether `@mastra/docker` adopts a container we created.
- Box density, Chromium start time in our image, `agent-browser --session` concurrency on one Chromium, and gVisor with Chromium.
- `pi-durable` on Bun with our storage: the spike in `/tmp/pi-durable-spike` answers this; see `docs/pi-research.md` when it lands.
