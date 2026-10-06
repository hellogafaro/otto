# Pi research: how Pi is meant to be used, and how our plan fits

Status: applied to the plans on 6 Oct 2026 (`docs/data-architecture.md`, `docs/messages-design.md`); the `transcripts` table is recommended, pending the owner (data-architecture DECISION 16). The line-framing fix is done (data-architecture P0c). Research date 6 Oct 2026. Sources: the three Earendil posts (read in full), the Pi repo at `main` commit `36a686e` (6 Oct 2026, release `v1.0.4`), and this repo. `PI/` = `https://github.com/earendil-works/pi/blob/main/`. `PAS` = `packages/pi-agent-server/src/index.ts`. Quotes are short and verbatim.

## 0. Answer in one paragraph

Pi has **two** harnesses. The one we use, `pi-coding-agent` (SDK `createAgentSession`), has **no pluggable storage interface**: `SessionManager` is a concrete class that is either a JSONL file or in memory, but it can be **seeded from entries we hold elsewhere** (`SessionManager.inMemory(cwd, { id }, entries)`), which is the supported way to keep Pi's transcript in our database instead of `.pi-sessions`. The new one, **`pi-durable`** (first published 1.0.0 on 1 Oct 2026, README: "**Experimental.** The API changes without notice between releases"), has exactly what the owner describes: a small `Storage` interface with memory, SQLite and JSONL backends and a conformance suite, crash-resume of runs, idempotent submissions, multi-client views, and a per-conversation `ExecutionEnv` for containers. Our plan matches Pi's intent on the big lines (harness trusted, tools in a sandbox, providers outside Pi, skills + CLIs over a big tool list). It conflicts in one place: `messages` should **not** be Pi's session store (it is a lossy display table and also carries Claude-harness and UI rows). The right shape is a second, harness-owned table of Pi entries next to `messages`, and a planned later move to `pi-durable` once it stabilises, which is what would deliver "highest quality" durability.

## 1. What Pi is

| Package (all `1.0.4`, MIT) | Role | Otto uses |
|---|---|---|
| `pi-ai` | Multi-provider LLM API, OAuth, credentials store, model catalog | yes |
| `pi-agent-core` | `Agent` + agent loop only (0.99 removed its experimental harness: "Use `@earendil-works/pi-durable` for durable sessions", `PI/packages/agent/CHANGELOG.md`) | types only |
| `pi-coding-agent` | The CLI, plus the SDK (`createAgentSession`), RPC mode, extensions, skills, MCP, codemode | yes (`PAS:24-37`) |
| `pi-durable` | Durable conversations, tasks, documents over pluggable storage | no |
| `chord` | Generic plugin/service/replicated-state runtime used by `pi-durable` and the experimental server | no |
| `pi-env` | `RemoteExecutionEnv` for durable: a Rust daemon reached over SSH | no |
| `pi-mcp`, `pi-codemode` | Standalone MCP client (with OAuth); QuickJS sandbox that can only call injected tools | no |
| `pi-server`, `pi-client`, `pi-protocol` | "experimental" routed remote sessions over CBOR | no |

- **License:** MIT (`PI/LICENSE`, "Copyright (c) 2025 Mario Zechner"); the 1.0 post: "Both are MIT licensed."
- **What 1.0 promises** ([pi-1-0](https://earendil.com/posts/pi-1-0/)): "a hardened, minimal, extensible agent harness"; "a stable piece of software that people and businesses can depend on". No semver or API-stability policy is written anywhere in the repo; the changelog keeps a `### Breaking Changes` section per release (`PI/AGENTS.md:106`). Pi Durable is explicitly excluded: "Pi Durable is experimental, and the API might still change."
- **Agent loop** (`PI/packages/coding-agent/docs/how-pi-works.md`): user message appended to the active branch, request built from system prompt + branch + tools, assistant streamed, tool calls executed and recorded, repeat until no tool call or queued message. Steering enters after the current turn, follow-ups after the run.
- **Integration surfaces** (`docs/cli-integration.md`, `docs/rpc.md`): SDK in process ("For an in-process Node.js or Bun integration, prefer the SDK"), or RPC mode `pi --mode rpc` (JSONL commands/events on stdio) with a typed `RpcClient`.

### SDK surface we should integrate through (`PI/packages/coding-agent/docs/sdk.md`, read in full)

- `createAgentSession(options)` returns an `AgentSession` that "owns one conversation, its model and tools, queued messages, compaction state, and extension runtime".
- Every boundary is injectable: `modelRuntime`/`model`/`thinkingLevel`, `settingsManager` (in-memory available), `sessionManager` ("persistent or in-memory conversation history"), `resourceLoader` (extensions, skills, prompt templates, context files; "Supply a custom `ResourceLoader` when the host owns resource storage and discovery completely"), `tools`/`customTools`/`excludeTools`.
- Storage rule: "`SessionManager` is authoritative for finalized model context. Restore external history by constructing the session with a manager containing those entries. Assigning `session.agent.state.messages` does not replace persisted context."
- Prompting: `prompt()`, `steer()`, `followUp()`, `abort()`, `waitForIdle()`. Events via `session.subscribe`: `message_end` "contains the authoritative completed message"; `agent_settled` = Pi will not continue automatically.
- `AgentSessionRuntime` adds `newSession()`, `switchSession()`, `fork()`, `importFromJsonl()`.
- SDK sessions do **not** load the built-in `codemode`, `tool_search` and MCP extensions; add them via `DefaultResourceLoader.extensionFactories`.

Otto already uses this surface correctly in shape (`PAS:605-780`: in-memory `ModelRuntime`, in-memory settings, custom resource loader, `customTools` + allowlist).

## 2. Durability and storage

### 2a. `pi-coding-agent` (what we run)

- **Format** (`docs/session-format.md`): JSONL, header line then entries `{type, id, parentId, timestamp, ...}` forming a **tree**; the leaf selects the active branch. Types: `message` (an `AgentMessage`, including `system` messages that patch prompt sections and `toolsAdded/Removed`), `model_change`, `thinking_level_change`, `usage`, `compaction` (`summary`, `firstKeptEntryId`, system checkpoint), `context_edit`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`. Version 3, auto-migrated.
- **Resume needs the whole entry list** of the session (the manager rebuilds context with `buildSessionContext()`: path from leaf to root, latest compaction, context edits). Compaction never deletes entries.
- **Pluggable?** No interface. `export class SessionManager` with a `private constructor` and factories `create/open/continueRecent/inMemory/forkFrom` (`PI/packages/coding-agent/src/core/session-manager.ts:987-1815`). Persistence is `appendFileSync` per entry, and the file is created only once a user/assistant message exists (`:1160-1200`). The supported escape hatch: `static inMemory(cwd, options?, entries?)`, "Create an in-memory session (no file persistence), optionally from entries held outside the filesystem" (added 0.85.0, present in our pinned 0.87.1: `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:377`).
- **Write-back:** no "entry appended" hook for every entry (`entry_appended` is emitted only for boundary drafts, cache warming and virtual-model state: `src/core/agent-session.ts:496,834,1027,1249`). A host mirrors by reading `session.sessionManager.getEntries()` (stable ids) at `message_end`, `turn_end`, `compaction_end` and `agent_settled` and inserting unseen ids. Unverified: that this catches every entry type in every path; it needs a test that compares the mirror to a file-backed run.
- **Crash behaviour:** a partial streamed answer is never written; an assistant tool call without a result gets a synthetic `"No result provided"` result on the next request (`PI/packages/ai/src/api/transform-messages.ts:158-223`). No mid-turn resume.

### 2b. `pi-durable` (what "pi-durable" describes, [post](https://earendil.com/posts/pi-durable/), `PI/packages/durable/README.md`)

- "a harness opens over a storage backend. Pi Durable ships memory, SQLite, and JSONL storage, plus a conformance suite and benchmarks for your own backend"; "The storage interface is small and easy to implement on top of whatever you have, like a key-value store or Postgres"; "One process owns a storage at a time".
- **Extension point:** `interface Storage` (`PI/packages/durable/src/types.ts:1001-1093`): `commit(writes, ctx)` (atomic batch of `conversation|entry|task|submission|document.*` writes, returns a sequence), `mintId()`, `conversation`, `scanConversations`, `entry`, `findLatestHeadMarker`, `scanEntries`, `task`, `scanTasks`, `submission`, `scanSubmissions`, `submissionByRequest`, `findDocument`, `document`, `scanDocuments`, `close`. Test with `registerStorageConformance()` from `@earendil-works/pi-durable/testing`. For SQLite you only implement a `SqliteDatabase` facade (`exec/run/get/all/transaction/close`, `src/storage/sqlite/database.ts`); "with a small adapter it runs on Bun".
- **Its SQLite schema** (`src/storage/sqlite/migrations.ts`): `durable_metadata, record_ids, conversations, entries, tasks, submissions, documents, document_revisions`, integer ids from one session-global counter, records as JSON text. These names and id shapes clash with our rules and with `db:push` (it would plan to drop unknown tables, as it did for FTS; `docs/messages-design.md` 6), so they belong in their own file, not `otto.db`.
- **Entries:** `{id, conversationId, kind, model?: Message[], data?, head?, edits?, byTaskId?}`; the model sees entries from the newest reset/compaction head. Forks see parent history "without copying it".
- **Streaming:** "Partial answers and tool output are committed at most every 100 ms by default, so a crash loses at most that window" (tunable `settings.progress`).
- **Compaction:** a background durable task; "The older messages always stay in storage"; on a too-long rejection it "compacts and retries once".

## 3. Durability: guarantees, what we do, gaps (top requirement)

| Guarantee | `pi-durable` (evidence) | `pi-coding-agent` + our `pi-agent-server` + `session-manager` today |
|---|---|---|
| Crash-safe runs, resume mid-turn after restart | Yes: "every step of a run is a task that stores a checkpoint"; `harness.resume()` continues unfinished tasks | No. Turn is lost; Pi file holds completed messages only; our tool rows stay `executing` (`messages-design.md` 3) |
| Model request cut off | "sent again; the partial answer stays in the transcript, marked as aborted" (at-least-once billing) | Lost; user must re-prompt |
| Tool call cut off | Intent committed before `execute()`; reruns only if `replay: "safe"` (at-least-once), else model is told it was interrupted (at-most-once). Effects are idempotent only if the tool uses a key/`api.memo` | Effect may have happened with no record; Pi later inserts "No result provided" |
| Duplicate submission | Exactly-once per `requestId` (`submissionByRequest`) | Partial: `optimisticMessageId` dedupe in memory (`SC/sessions/session-manager.ts:826,929`); not across restart (unverified) |
| Streaming loss window | ≤100 ms of partial text and tool output | All streamed text of the current message (never stored); ≤500 ms of tool-row updates (`messages-design.md` 4) |
| Compaction crash | Durable task, resumes | Compaction entry not written, originals kept, recompacts later (safe, but the wait in `compaction-wait.ts` is lost) |
| Multiple tabs/devices, late join | `viewState()`/`watch()`: late joiner gets current view incl. streamed partial and running tools; any client can steer | Per-client push with a per-client ring buffer, 500 events / 30 s, clients kept 60 s (`packages/shared/src/protocol/types.ts:165-171`, `SC/transport/server.ts:472-545`); in-flight partial for a late tab: unverified |
| Reconnect after server restart | Reattach to committed state | Buffers are in memory: `stale: true`, full refresh, in-flight turn gone |
| Durable app state with transcript | `defineDoc` documents in the same commit | `chats` row + `messages` in one SQLite transaction (planned, `messages-design.md` 4) |

`chord` does **not** give durability by itself: it is "an application-composition runtime ... facets, services, replicated state, and a pluggable remote-service boundary" and "is not a Pi package" (`PI/packages/chord/README.md`); its plan says "This is not a stable public API contract yet" (`PLANNING.md`). Durability is `pi-durable`; chord supplies its cancellation `Context`, replicated document state and deltas. Multi-client remote sessions are `pi-server`/`pi-client` ("experimental") on chord. **Do not adopt chord directly**; adopting `pi-durable` brings it in as a dependency. It does not replace our transport (WebSocket RPC + push) either; at most its replicated-state deltas could later feed our push channel.

**Gaps we must close, by failure mode (mapped to phases):**
1. *Server crash while streaming:* store the partial assistant text at the same ≤500 ms cadence as tool rows (a `content.partial` flag), and on boot mark it aborted. Today's "never store deltas" rule (`messages-design.md` 9) is the main durability gap. P3b.
2. *Server crash during a tool call:* on boot, rows still `executing` become `interrupted` (not left spinning), and Pi gets a matching tool result. Tag our tools read-only vs side-effecting now (Pi already models this with `annotations.readOnlyHint` and durable `replay`). P3b.
3. *Crash during compaction:* nothing to do with coding-agent (originals kept); verify by test.
4. *Pi transcript survives restarts and moves to containers:* store Pi entries in SQLite (section 6) instead of `.pi-sessions`. P3b, removes the Pi half of P7.
5. *Two tabs / reconnect:* a tab opening mid-turn must get the in-flight partial from the server, not only from the push buffer; after a restart the client reloads from rows (already the `stale` path).
6. *Duplicate send across restart:* persist the client's `optimisticMessageId` as the message id, so a retried send is an upsert, not a second turn.
7. *Resume a run after restart* (true mid-turn recovery): only `pi-durable` gives this without building our own task system. Target it as a later phase (P8), behind an adapter, once its API settles.

## 4. Tools, extensions, skills, MCP

- **Tools are TypeScript** objects with a TypeBox schema and `execute()` (`docs/extensions.md` "Tools"); results carry `content` + `details`, optional `outputSchema`/`structuredContent`, `isError`. There is no Python tool runtime. Non-TS tools reach Pi three ways: (a) **bash** running a CLI, (b) an extension tool whose `execute()` shells out or calls HTTP, (c) **MCP** over stdio or streamable HTTP.
- **Registration at runtime:** `pi.registerTool()`, `pi.setActiveTools()`, re-register with `exposure: "hidden"` to withdraw ("tools cannot be unregistered"); `exposure` = `direct | model-only | codemode | deferred | hidden`; `ctx.executeTool()` for nested calls.
- **Permission hooks:** `pi.on("tool_call")` can mutate input or `{ block: true, reason }`; "A `tool_call` handler failure blocks the tool as a fail-safe"; applies to MCP and codemode calls too. Pi itself has none: "Pi does not include a built-in permission system" (`README.md`).
- **Skills and context:** Agent Skills spec; only name + description + path in the system prompt, `SKILL.md` read on demand (`docs/skills.md`). `AGENTS.md`/`CLAUDE.md` load as context files; a custom `ResourceLoader` replaces discovery.
- **The "no MCP" post** ([you-said-no-mcp](https://earendil.com/posts/you-said-no-mcp/)): MCP moved into core because "what Pi needs is quite similar to what MCP needs: a sandbox to play with in the form of an interpreter". It still holds: "The biggest issue with MCP continues to be that it's hard to compose" and "The reason CLIs are so functional is that the agent and model just wire stuff together with efficient bashisms." It wants MCP "much closer to OpenAPI with intelligent tool discovery": structured results, tools found by description. Codemode "runs where the harness runs" (trusted side), tools often "within a sandbox that is not really all that trusted".
- **Pi MCP now** (`docs/mcp.md`): `mcp.json` or `pi.registerMcpServer(name, config)` per session (not saved); stdio (`command/args/env/cwd`) or streamable HTTP (`url/headers/oauth`), SSE rejected. Servers connect in the background at `session_start`; only `direct` tools are awaited (10 s). Default exposure is `codemode`; `deferred` uses `tool_search`; `toolExposure` per tool with `*` patterns. OAuth: dynamic registration, CIMD, RFC 9728/8414/9207 checks, tokens in `~/.pi/agent/mcp-auth.json`. Text results over 20 KB are truncated to a temp file. Tool calls are never retried. Connections are per session.
- **Fit with our sources:** we already pool MCP connections in the server and give Pi proxy tools (`packages/shared/src/mcp/mcp-pool.ts`: "Shared clients across sessions ... No credential cache files"; `PAS:919-980`). Keep that: it keeps tokens in `secrets` and out of any container, and shares one connection per workspace source, which Pi's per-session, file-token MCP cannot. **Reuse:** `@earendil-works/pi-mcp` could replace `@modelcontextprotocol/sdk` in the pool (it has OAuth and "Inject `McpOAuthStateStore` ... for durable credentials", i.e. a `secrets`-backed store); register proxy tools with `exposure: "codemode"`/`"deferred"` plus `annotations` so a calendar source with 40 tools does not flood the prompt; enable `createCodemodeExtension()`/`createToolSearchExtension()`. **Build:** the `secrets`-backed OAuth store, a server-side redirect URL for hosted OAuth (Pi's flows assume a loopback callback), mapping source `permissions` onto a `tool_call` gate. Not for the MVP.

## 5. Sandboxes, containers, providers

- Pi's stance (`docs/security.md`): running everything inside a container is "usually the strongest practical option"; harness outside with only tools inside is "a narrower form of isolation" that protects host resources from tool actions. `docs/containerization.md` lists plain Docker, Docker Sandboxes, OpenShell, and the **Gondolin** extension that keeps Pi and credentials on the host and overrides `read, write, edit, bash, grep, find, ls` to run in a micro-VM.
- **Redirecting tools:** built-in tool factories take `operations` (`BashOperations.exec`, `ReadOperations`, ...; `src/core/tools/bash.ts:75,216`) and a `spawnHook`; `examples/extensions/ssh.ts` runs them over SSH. In durable, `env` builds an `ExecutionEnv` per tool call, "so one function serves a directory per conversation or a container per conversation" (example `29-sandbox-per-conversation.ts`), and `pi-env` ships a remote daemon.
- **Providers:** `pi-ai` providers with `createProvider()` for "any OpenAI/Anthropic-compatible endpoint", `models.json`, or `pi.registerProvider()`; credentials via an injected `CredentialStore` (we use `InMemoryCredentialStore`, `PAS:540-570`). OAuth providers listed: "Anthropic (Claude Pro/Max subscription)", OpenAI ChatGPT, Codex, Copilot, OpenRouter (`PI/packages/ai/README.md` "OAuth Providers"). The Docker Sandboxes section uses `claude setup-token` to give Pi a Claude token. **Compliance:** none of the three posts or the docs discuss provider terms for using Claude subscriptions in Pi; we have nothing from Pi to cite on that question.

## 6. Map to our plan

| Our decision | What Pi offers | Verdict |
|---|---|---|
| Chat messages in a SQLite `messages` table | coding-agent: JSONL tree or in-memory seeded from entries; durable: `Storage` with SQLite | **Match for display.** Keep `messages` as the display/search table. Do not make it Pi's store (see below) |
| Pi resume from `<chat>/.pi-sessions`, S3 blob in P7 | `SessionManager.inMemory(cwd, {id}, entries)` | **Better way:** a harness-owned table of Pi entries, restore by seeding, mirror by id. No blob, no restore step, no P7 object for Pi |
| Agent tools as Python generated from our API | TS tools, bash + CLIs, MCP, skills | **Match** if the Python package is a **CLI the agent runs through bash**, taught by a skill (the post's "efficient bashisms"). Typed, gated calls should stay server-side proxy tools (below) |
| Agents in per-workspace containers/VMs | whole-process in container, or harness on host + tools via `operations`/`ExecutionEnv` | **Better way:** harness (Pi + transcript + credentials) on the server, only tool execution in the container (Gondolin pattern). The container then needs no model key and no transcript |
| Secrets in a DB table | `CredentialStore` injection; MCP `McpOAuthStateStore` injection; files only by default | **Match**, if we always inject (never let Pi write `auth.json`/`mcp-auth.json`) |
| S3-compatible files | Nothing in Pi (tools see a filesystem through the env) | **Neutral**: the read-through disk cache must exist in the container before a turn |
| Claude through Pi via the providers gateway | `createProvider()`/custom endpoint with an `anthropic-messages` base URL (we already do `registerCustomEndpointModels`, `PAS:489`) | **Match**; gateway stays outside Pi, as AGENTS.md says. Terms check stays open |
| Providers/sign-in/routing outside Pi | Pi can own `/login` and OAuth, but every store is injectable | **Match** |

**Should `messages` BE Pi's session store? No.** (1) It is lossy by design: tool results capped at 200k chars, paths tokenised, no thinking blocks or signatures (`messages-design.md` 3). (2) It holds rows Pi does not have (`error`, `info`, `plan`, `auth-request`, Claude-harness turns) and lacks Pi's tree (`parentId`, compaction, `context_edit`, system deltas). (3) coding-agent has no storage interface to plug it into. One source of truth for model context is still reachable: a `transcripts` table (beside `chats` and `messages`; `workspaceId, chatId, id, parentId, type, content, "order", createdAt`, schema in data-architecture (c) "chats") holding Pi entries verbatim, seeded into `SessionManager.inMemory` on resume and appended by id after each event. With `pi-durable` later, its entries/documents would become that table (own SQLite file, our `SqliteDatabase` adapter over `bun:sqlite`) and the display could be derived from `viewState()`.

**What `pi-agent-server` hand-builds that Pi provides:**

| Ours | Pi |
|---|---|
| JSONL stdio protocol: `prompt, steer, abort, set_model, set_thinking_level, compact, set_auto_compaction, ...` (`PAS:1782-1880`) | RPC mode + `RpcClient` (`docs/rpc-commands.md`: same commands plus `follow_up`, `get_entries`, `fork`, `get_session_stats`) |
| `readline` framing on both sides (`PAS:1885`, `packages/shared/src/agent/pi-agent.ts:513`) | Pi warns: "Node.js `readline` also splits on `U+2028` and `U+2029`" (`docs/rpc.md`). **Verified bug:** a JSON line with ` ` splits in two under Bun and Node. Fixed (data-architecture P0c, done): both sides frame lines through a shared `jsonl-lines` helper (`packages/shared/src/utils/jsonl-lines.ts`, 15 tests plus a regression test) |
| Per-tool permission wrapper `wrapSingleTool` (`PAS:823-918`) | `tool_call` hook, also covering MCP/codemode/nested calls; RPC extension UI for confirm dialogs |
| Large-result summarisation gate | `tool_result` hook; MCP 20 KB truncation to a file |
| `.pi-agent` dir to block global extensions (`PAS:676-681`) | Custom `ResourceLoader` (already used) with `noExtensions`; the empty dir may be removable (unverified) |
| Fork via `forkFrom` + `branch(anchor)` (`PAS:690-714`) | Same API; with DB-held entries it becomes "copy entries up to anchor, seed" |

Keeping a subprocess is still reasonable (crash isolation); the protocol could become Pi's RPC mode plus one small extension for proxy tools and the permission handshake. Running the SDK in-process in the Bun server is the other option Pi recommends for Node/Bun hosts.

**Python tools with Pi, three shapes:**
1. **CLI + skill (recommended default):** generate the `otto` Python package as a CLI from our server API; it calls the server over HTTP with a per-chat token scoped to the chat's user; a workspace skill documents it; the agent uses `bash` in the container. Composable, no tool-list growth, matches the post.
2. **Extension tool that shells out:** one TS tool per API area whose `execute()` runs `python -m otto ...` through the env. Typed schema and permission gating, but duplicates the schema in two languages.
3. **Server-side proxy tools:** typed, guarded in the server, nothing to install in the container. Use for the few calls that must be gated or approved. (This is the role of the single `otto_rpc` session tool planned earlier; that plan was replaced by decision F in data-architecture (k), and DECISION 12 there is now the activity log.)

**Edits made on 6 Oct 2026** (where each landed):
- `docs/messages-design.md` 3: model context stays with the harness, Pi's in the `transcripts` table seeded through `SessionManager.inMemory`; the P7 object is Claude-only; new subsection "Relation to Pi sessions (`transcripts`)".
- `messages-design.md` 3 "Direction: tools in per-workspace containers or VMs": the container runs tools only; Pi, its transcript and credentials stay on the server (Gondolin/`operations` pattern), so the container holds no model key and no transcript. "Claude through Pi" then leaves **no** blob at all.
- `messages-design.md` 4, 8 and 9: partial assistant text saved at the 500 ms cadence; boot recovery marks `executing`/partial rows `interrupted`; the client's id is the message id; the durability test suite; "storing each streaming delta" stays in NOT doing (snapshots are stored instead).
- `messages-design.md` 10: open decision 2 = data-architecture DECISION 16, Pi transcripts in SQLite (recommended) vs `.pi-sessions` files + S3.
- `docs/data-architecture.md`: new section "Durability (first-class requirement)" with the failure-mode table; (b) `.pi-sessions` row becomes DB `transcripts`, P3b; (c) "chats" holds the `transcripts` schema; (f) P0c (framing fix, done), P0d (Pi 0.87.1 -> 1.0.4), P3b's durability chunk, P7 without a Pi blob, P8 (`pi-durable` trial behind an adapter, own SQLite file).
- `data-architecture.md` (g) "Agent tools in Python": the `otto` package is a CLI the agent runs through `bash`, taught by a generated skill, with server-side proxy tools for gated calls; no Pi loader.
- `data-architecture.md` (h) "Direction: harnesses and sandbox": the container runs tools only and carries no model key (this replaced the earlier "its connection's own API key in its env" wording); MCP sources keep our server-side pool, possibly on `pi-mcp` with a `secrets`-backed `McpOAuthStateStore`, after the MVP.

## 7. Not verified, and versions

- **Versions:** Otto pins `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai` at **0.87.1** (`packages/pi-agent-server/package.json`, `packages/shared/package.json`, root `package.json:161-162`, installed `node_modules` = 0.87.1, released 22 Sep 2026). Latest is **v1.0.4** (5 Oct 2026; `gh release list`). Between them: one breaking change that touches us, the Azure provider rename `azure-openai-responses` -> `azure` (`coding-agent/CHANGELOG.md` 1.0.3; we reference the old id in `pi-agent-server/src/model-resolution.ts`, `shared/src/config/models-pi.ts` and 8 other files). The exports we import still exist in 1.0.4 (checked `src/index.ts`). 0.99/1.0 add MCP, codemode, tool exposure, virtual models.
- Not verified: that mirroring `getEntries()` at events captures every entry type; `pi-durable` on Bun (only "with a small adapter" is claimed); `pi-durable` performance on our data; whether an empty `.pi-agent` dir is still needed; whether a tab joining mid-turn gets the partial today; provider-terms questions for Claude in Pi (no source in Pi's posts or docs); the experimental `coding-agent/src/experimental/{server,coordinator,session-worker}.ts` remote-session code (undocumented, not read in depth).
