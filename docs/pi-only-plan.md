# Pi only: one harness, Claude subscriptions through a Pi provider bridge

Research 6 Oct 2026, read-only; nothing built. Owner decision: Otto is **Pi only**. There is no `Harness` seam, no second harness, no `messages.source` and no `chats.harness`. The default "Otto" agent is a normal Pi session with orchestrator instructions and the app's tools. Claude subscriptions go through a Pi provider that drives the user's own `claude` CLI. This document supersedes the Claude parts of [harness-plan](harness-plan.md), [final-plan](final-plan.md) 2.1/2.3/2.6/H3 and [agent-computers](agent-computers.md) D. `S` = `packages/shared/src`, `PAS` = `packages/pi-agent-server/src`. Bridge sources were read at eli `5fb69c4` (2 Oct 2026), `@fractaal/pi-claude-bridge` 1.12.1 and `@vanillagreen/pi-claude-bridge` 4.1.0 (npm tarballs).

**Verdict.** The bridge works and the mechanism is sound: Claude acts as a model behind Pi, Pi runs every tool, and Pi owns the history. Don't take a package as a dependency. Write our own provider in `PAS` (~150-300 lines), adapted from elidickinson's MIT code. The terms and billing risk is **medium** for local or self-hosted use with the user's own `claude` login and **high** for hosted Otto until Anthropic gives a written OK. Deleting the Claude backend removes about **9.2k lines** of whole files (5.7k source, 3.4k tests), plus an estimated 1.5k lines inside shared files and a ~220 MB native binary per platform.

## 1. The three bridges

All three are one codebase. elidickinson's is the upstream; vanillagreen forked it, and fractaal forked vanillagreen. None of them reads or replays OAuth tokens. All three run the **real `claude` binary** through `@anthropic-ai/claude-agent-sdk` `query()`.

| | [elidickinson/pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) (npm `pi-claude-bridge` 0.9.1) | [@fractaal/pi-claude-bridge](https://pi.dev/packages/@fractaal/pi-claude-bridge) 1.12.1 (`fractaal/pi-extensions`) | [@vanillagreen/pi-claude-bridge](https://pi.dev/packages/@vanillagreen/pi-claude-bridge) 4.1.0 (`vanillagreencom/kendex`) |
|---|---|---|---|
| Licence, stars, open issues | MIT, 571, 69 | MIT, 0, 4 (#28: "no Pi tools reach Claude on Pi 1.0.x") | MIT, 83 and 135 (whole monorepo) |
| Last commit; downloads per week | 2 Oct 2026; ~22k | 6 Oct 2026; ~1k | 6 Oct 2026; ~1.2k |
| Size | 4.5k lines (`index.ts` 2,720); peers `pi-ai`/`pi-coding-agent`/`pi-tui` `>=0.86.1`; uses `cc-session-io` | 4.4k lines; SDK pinned exactly to 0.3.286 | 10.1k lines in 38 files: a claude.ai connectors pass-through and a multi-account router (`account-router.ts:110`) |
| Extras | AskClaude tool and TUI, a guard against the third-party gate (`prompt-capture.ts:276-281`) | Plan quota in the UI; `systemPromptMode: "pi"` sends Pi's raw prompt (risky, see 2) | Connectors, account rotation |

**How they work** (cited from eli; the forks match at fractaal `index.ts:2131-2155` and vanillagreen `query-options.ts:166-195`):

| Concern | Behaviour |
|---|---|
| Shape | A Pi extension calls `pi.registerProvider(name, { models, streamSimple })` (`index.ts:2594`). Pi 0.87.1 supports a custom `streamSimple` (`pi-coding-agent/dist/core/provider-composer.d.ts:21`, `extensions/types.d.ts:1095`) |
| Spawn | `query({ tools: [], permissionMode: "bypassPermissions", includePartialMessages: true, systemPrompt: { type: "preset", preset: "claude_code", append }, resume, mcpServers, pathToClaudeCodeExecutable })` (`index.ts:1973-2002`). Extra args `--strict-mcp-config` and `--thinking-display summarized`. Child env sets `ENABLE_CLAUDEAI_MCP_SERVERS=0` and `DISABLE_AUTO_COMPACT=1` (`index.ts:52-55`) |
| Tools | Claude's built-in tools are off (`tools: []`; the forks also use `disallowedTools` and `allowedTools: mcp__<server>__*`). Pi's active tools are exposed to Claude through one **in-process** SDK MCP server (`mcp-server.ts:85`, `{type:"sdk", instance}`). Each handler blocks until **Pi** has run the tool. MCP sources and skills reach Claude only as Pi tools and Pi prompt text |
| Round trip | When Claude calls a tool, the bridge ends Pi's stream with a tool call. Pi executes the tool and calls `streamSimple` again. The bridge resolves the pending MCP handler and the same `claude` turn continues (`index.ts:1160-1176`). One CLI process lives for the whole Pi turn |
| System prompt | Claude Code's preset plus an append made from Pi's prompt (AGENTS.md, skills block, append text). Pi's own preamble is stripped, because it trips Anthropic's gate (section 2) |
| Streaming, thinking, images | Text, thinking and signature deltas from partial stream events (`index.ts:1214-1300`). Images go as base64 blocks (`convert.ts:77-83`) |
| Abort, steer | The abort signal kills the query, marks the session for rebuild and rotates its id (`index.ts:2017-2061`). Steering is pushed into the open prompt stream |
| Usage | SDK usage frames (input, output, cache read/write, thinking) go to Pi's `calculateCost` (`usage.ts`) |
| History | **Not stateless.** The bridge `--resume`s a Claude session and sends only the new message. When Pi's history diverges (abort, compaction, branch, model switch, reload), it **rewrites Claude's JSONL from Pi's history** and resumes from that ("REUSE vs REBUILD", `index.ts:722-854`). Pi stays the source of truth and Pi compacts. Every rebuild misses the prompt cache. Most open bugs are here (#55, #62, #86, #104, #114, #154, #165, #172) |
| Auth | Whatever login `claude` already has: `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`), the macOS Keychain, `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. The bridge never reads the contents. An inherited `ANTHROPIC_BASE_URL` or `ANTHROPIC_API_KEY` silently hijacks the child (eli #107) |

**Best base:** none as a dependency. They are built around Pi's TUI and extension loading; our `PAS` loads no extensions and registers providers directly (`PAS/index.ts:523`). Write `PAS/claude-code-provider.ts`:
- `registry.registerProvider('claude-code', { models, streamSimple })`
- `query()` with the options above and our scrubbed env
- one `createSdkMcpServer` relaying Pi's tools
- delta mapping and usage
- `spawnClaudeCodeProcess` for the box
- Rebuild on divergence: start a fresh Claude session seeded by rewriting the JSONL (port eli's REUSE/REBUILD rules, about 300 lines)

Credit eli (MIT) in the file header.

## 2. Terms and billing

| Source | What it says |
|---|---|
| [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | Developers, "including those using the Agent SDK, should use API key authentication"; Anthropic "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users"; developers may not "collect, store, or intermediate" those credentials. It does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". Enforcement may come "without prior notice" |
| [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) | "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." The product may not be branded "Claude Code"; "{Name} Powered by Claude" is fine |
| [Support, 15 Jun 2026](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | "For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits" (the paused credit plan) |
| 4 Apr 2026 ([TechCrunch](https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/)) | Third-party harnesses draw from "extra usage", billed separately |
| [eli #88](https://github.com/elidickinson/pi-claude-bridge/issues/88), [gotgenes/pi-packages#883](https://github.com/gotgenes/pi-packages/issues/883) | Even through the real CLI, the server **reads the appended system text**. Pi's doc-routing line (`docs/custom-provider.md` and `docs/packages.md` together) produced `400 Third-party apps now draw from your extra usage, not your plan limits` |
| [eli #118](https://github.com/elidickinson/pi-claude-bridge/issues/118) (open, 22 Sep 2026) | A new Max account was suspended hours after it started using the bridge; the appeal was rejected; the cause is unknown |

**What this means for Otto:**
- The bridge spawns the unmodified binary with the user's own login, and Otto never touches the credential. That is the documented exception, and it is better than today's code. Today Otto runs its **own** Claude OAuth with Claude Code's client id (`S/auth/claude-oauth-config.ts:12`), stores the token and injects `CLAUDE_CODE_OAUTH_TOKEN` (`S/config/llm-connections.ts:1081-1089`). That is exactly the "collect, store, intermediate" case the legal page forbids, and it gets deleted.
- Billing stays on the subscription only while the classifier does not label the request third-party. Otto's orchestrator instructions travel in the append, so whether they pass is **unverified** and is a spike item.

| Deployment | Risk | Why |
|---|---|---|
| Desktop / self-hosted, one person, their own installed `claude` and login | **Medium** | It fits the "unmodified binary, own sign-in" exception. The SDK page's "unless previously approved" still applies to a product offering it. The classifier can switch billing to extra usage or answer 400. One unexplained ban |
| Hosted Otto (our infrastructure, many users, a "Connect Claude" button) | **High** | This is "offering claude.ai login … for their products", and multi-user use is not "ordinary, individual usage". Needs Anthropic's written OK (final-plan D1 stays) |

## 3. How it runs in our world

| Item | Plan |
|---|---|
| Where the bridge runs | In `pi-agent-server` on the server, as a Pi provider. `query()` runs there; Claude's tool calls come back over stdio as `mcp_message` frames and execute in Pi. Pi's tools then run in the agent's computer through `operations` (unchanged) |
| Where `claude` runs | **Desktop:** the user's own installed `claude` (`pathToClaudeCodeExecutable` = `which claude`; we no longer ship the SDK's ~220 MB native binary, `scripts/build/common.ts:316-332`). **Hosted:** a small **per-human** container `otto-claude-<userId>` (just `claude`, no desktop) with a volume for `CLAUDE_CONFIG_DIR`. The SDK calls `spawnClaudeCodeProcess` → `docker exec -i otto-claude-<userId> claude …` (stdio pipes, no TTY) |
| Why not the agent's box | With `tools: []`, `claude` is only a model endpoint and never touches the computer. Putting it in a per-human container means one sign-in per human instead of one per agent box, no Unix user per human just for Claude, and no `CLAUDE_CONFIG_DIR` in agent boxes. The per-uid split in D3 is then only needed for chat-file privacy |
| Sign-in | The human runs `claude` → `/login` themselves: a terminal on the desktop, or a web terminal into their container (paste-code flow). Otto stores no secret. The connection row only says "uses this human's Claude Code sign-in" |
| Per-user connections | A `claude-code` connection is **always `user:<id>`**, never workspace or install, because sharing one person's plan with others is "on behalf of their users". A chat runs on its creator's connection (unchanged). Steers from other members still bill the creator: allowed by our rule, but it stretches "individual usage" (an owner call, risk noted) |
| Concurrency | One live `claude` process per running turn. Resident size and cold start are **unverified** (spike). The per-agent cap of 4 runs still applies |
| History | Pi rows in `messages` are the truth. Claude's session files in the container are a cache: they are rebuilt from Pi's history on divergence, and the JSONL is written through `docker exec` (`cat > file`). Nothing needs a server-side mirror; the H3 `sessionStore` and restore-if-missing steps go away |
| Env hygiene | The child gets an allow-listed env: never `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` or `CLAUDE_CODE_OAUTH_TOKEN` from the server (eli #107) |

## 4. The simplification

**Delete whole files** (`wc -l`, 6 Oct 2026):

| Files | Lines |
|---|---|
| `S/agent/claude-agent.ts` 3,274; `claude-sdk-error-mapper.ts` 407; `claude-llm-query.ts` 84; `options.ts` 259 (Claude subprocess options) | 4,024 |
| `S/agent/backend/claude/{event-adapter 693, persistent-input 99, pending-steers 92, task-notification 64, index 12}` | 960 |
| `S/agent/backend/internal/drivers/anthropic.ts` 163; `S/config/llm-validation.ts` 150 (validates through `query()`) | 313 |
| `S/auth/claude-oauth.ts` 302, `claude-oauth-config.ts` 38, `claude-token.ts` 86 (Otto-held Claude OAuth) | 426 |
| **Source total** | **5,723** |
| Tests: `S/agent/__tests__/claude-*.test.ts` (14 files), `backend/claude/*.test.ts`, `drivers/anthropic.test.ts` | 3,443 |

**Shrink** (estimated; measured when done):

| File | Change |
|---|---|
| `S/agent/backend/factory.ts` (867) | Delete `DRIVER_REGISTRY`, `detectProvider`, the anthropic cases, `BACKEND_CAPABILITIES`, `providerTypeToAgentProvider`, `connectionTypeToProvider`; `createBackend` becomes `new PiAgent`. ~-450 |
| `S/agent/backend/types.ts` (696) | `AgentBackend` (`:334-647`, ~45 members) and the `provider`/`legacyAuthType` config fields go; `PiAgent` is the type. ~-300 |
| `S/agent/backend/internal/{runtime-resolver 259, driver-types 120}`, `drivers/pi.ts` | Claude executable path, the `piAuthProvider` indirection. ~-100 |
| `packages/server-core/src/sessions/session-manager.ts` (9,438) | Claude turn anchors (`:291-370`), the Claude branch path (`:3200-3250`), the auth env (`:2264-2300`), `sdkSessionId`/`sdkCwd`, provider switches (`:3064`, `:3160`). ~-400 |
| `S/auth/state.ts`, `server-core/handlers/rpc/onboarding.ts`, the `START_CLAUDE_OAUTH` channel, onboarding UI (`credentials-step.tsx`, `provider-select-step.tsx`, `use-onboarding.ts`), 5 locale keys × 7 locales, provider icons | Claude OAuth UI out; "Use your Claude Code sign-in" in. ~-300 |
| Build scripts (`scripts/build/*.ts`, `electron-*.ts`: 32 Claude lines), the native binary packages in `package.json` | Stop bundling the binary |

**What stays:**
- `PiAgent` (`S/agent/pi-agent.ts`) and `pi-agent-server` (crash isolation).
- `BaseAgent`, the permissions and mode managers, `pre-tool-use.ts`, the MCP pool and session tools.
- `claude-context.ts`, which despite its name builds the session-tool context Pi uses (`pi-agent.ts:81`); rename it later.
- `@anthropic-ai/claude-agent-sdk` core (5 MB). The bridge needs it, and `tool()`/`createSdkMcpServer` define session and API-source tools for the pool (`S/sources/api-tools.ts`, `S/session-scoped-tools.ts`, `S/mcp/mcp-pool.ts:289-293`).
- The network interceptor (Pi preloads it, `pi-agent.ts:466`).

**The Pi wrapper the session manager uses today.** These are the `AgentBackend` members `server-core` actually calls (grep over `sessions/`, `handlers/`, `bootstrap/`); the other ~10 can go with the interface:

| Group | Members |
|---|---|
| Turn | `chat`, `redirect`, `canSteerNow`, `takePendingSteers`, `forceAbort`, `interruptForHandoff`, `isProcessing`, `isCompactionInFlight`, `setBackgroundEventSink`, `getCurrentTurnUserMessage` |
| Lifecycle | `postInit`, `ensureBranchReady`, `supportsBranching`, `destroy`, `dispose`, `disposeForRestart`, `getSessionId` |
| Runtime | `getModel`, `setModel`, `setThinkingLevel`, `updateRuntimeConfig`, `setPermissionMode`, `updateWorkingDirectory`, `updateSdkCwd` |
| Sources | `setSourceServers`, `setAllSources`, `markSourceUnseen`, `setPendingSourceActivationRestart` |
| Side calls | `generateTitle`, `regenerateTitle`, `runMiniCompletion`, `getSummarizeCallback`, `respondToPermission` |
| Callbacks | `onPermissionRequest`, `guardedModeCheck`, `onPlanSubmitted`, `onAuthRequest`, `onPermissionModeChange`, `onDebug`, `onSourceActivationRequest`, `onBackendAuthRequired`, `onSpawnSession` |

Target: `type AgentInstance = PiAgent` (`session-manager.ts:659`), with no interface and no registry. `updateSdkCwd` merges into `updateWorkingDirectory`. Titles and mini completions become plain server functions as they are touched (same rule as before, minus the seam).

**Connections become Pi providers.** `connections.type` = the Pi provider id. This replaces `anthropic | pi | pi_compat` (`S/connections/index.ts:45`) and moves `config.piAuthProvider` into `type`.

| Connection | `type` | `auth_type` | Secret | Pi provider |
|---|---|---|---|---|
| Anthropic API key | `anthropic` | `api_key` | key | built-in `anthropic` (today's `pi` + `piAuthProvider: anthropic`) |
| Claude subscription | `claude-code` | `cli_login` (new) | **none** | our bridge provider `claude-code` |
| ChatGPT Plus/Pro | `openai-codex` | `oauth` | tokens | built-in (`PAS/adapt-credential.ts`) |
| OpenRouter, OpenAI, Groq, … | provider id | `api_key` | key | built-in |
| Copilot, Bedrock, Vertex | `github-copilot`, `amazon-bedrock`, `google-vertex` | `oauth`, `iam_credentials`, … | as today | built-in |
| Custom endpoint, Ollama | `custom` | `api_key_with_endpoint` or `none` | key or none | `registerProvider('custom-endpoint', …)` (`PAS/index.ts:507-535`) |

Import, once and idempotent:
- `anthropic` + `oauth` (`claude-max`) → `claude-code`, and its stored token secret is **deleted**.
- `anthropic` + `api_key` → `anthropic`.
- `pi` + `piAuthProvider` X → X.
- `pi_compat` → `custom`.

`agents.provider` names the same ids.

**What the Claude backend had, and whether Pi covers it:**

| Feature | Covered? |
|---|---|
| File and shell tools (Read/Edit/Write/Glob/Grep/Bash) | Yes: Pi's `read/write/edit/bash/grep/find/ls`, redirected into the box |
| WebSearch/WebFetch (Anthropic server tools) | Yes, our own `PAS/tools/search`, `web-fetch.ts` (quality differs, unverified) |
| Permission modes, safe/plan mode, "Always allow" | Yes: Otto's own gate (`pre_tool_use_request` → `runPreToolUseChecks`). Claude's `EnterPlanMode`/`ExitPlanMode` were already disallowed (`claude-agent.ts:1071`) |
| Skills | Yes: both use the `[skill:slug]` mention today (Claude's `Skill` tool was disallowed). Native Pi listing comes in M1 |
| MCP sources | Yes: pool proxy tools. Claude's tool search → Pi 1.0 `exposure: "deferred"` after P0d |
| Compaction | Yes: Pi compaction (`PAS/compaction-wait.ts`). The bridge turns Claude's own compaction off |
| Branching | Yes: Pi tree (`forkFrom` + `branch`). Claude turn anchors go |
| Bedrock / Vertex | Yes: Pi providers |
| Task subagents | Partly: Otto's `spawn_session` tool. Claude's in-turn `Task` agents are gone |
| TodoWrite | **Lost** (no Pi equivalent; add a tool only if missed) |
| Background shell and keep-alive persistent query (`backend/claude/persistent-input.ts`) | **Lost**; use `tmux` in the box |
| Opus fast mode and 1M-context betas through the interceptor | Unverified on Pi's `anthropic` provider |
| Claude Code's own prompt and prompt caching | Kept on the bridge route (preset plus append). Cache misses on each rebuild |

## 5. Doc and schema changes (to apply after "go"; this document edits nothing else)

| File:lines | Change |
|---|---|
| `final-plan.md:3, 8-13` | The picture: one Pi runtime, no `Harness.run`, no Claude adapter; `messages` without `source` |
| `final-plan.md:23, 27, 28` | Already-decided rows: "Harness" → "Pi only; Claude subscriptions via the `claude-code` Pi provider"; box holds no Claude login |
| `final-plan.md:35-40` (2.1) | Replace with: `PiAgent` used directly, `AgentBackend`/registry deleted, `Computer` kept; delete "harness per chat" |
| `final-plan.md:50` | Claude route: no secret; the human's `claude` login in their own container |
| `final-plan.md:57-59` | `messages` gains only `parent_id`; no `source`; delete the Claude `sessionStore` bullet |
| `final-plan.md:74, 77, 84-86` | `claude` leaves the `otto-agent` image and the plugin-dir delta; drop `CLAUDE_CONFIG_DIR` per uid; drop Claude `streamInput` and the "Claude: turn ends interrupted" row |
| `final-plan.md:88-125` (2.6) | One column (Pi): delete the Claude column of both tables, `settingSources`, plugin skills, `Skill` enabling |
| `final-plan.md:142` | `provider`: "which of the creator's connections pays" (drop "with it, the harness") |
| `final-plan.md:196, 197, 202, 207, 216, 222` | H0 → "Pi only (delete Claude backend)"; P3b(4) without `source`/`toDisplay` per harness; M1 Pi only; H3 → phases B1-B4 below; lanes and blocks updated |
| `final-plan.md:228-229, 241, 244, 250-255` | D1 becomes Claude via bridge (local now, hosted after the OK); D2 one store without `source`; D14/D17 Pi only; Claude risk rows replaced by the bridge rows of section 2 |
| `schema.md:9` | "`messages` gains `parent_id`" (no `source`) |
| `schema.md:50` | Example INSERT without `source` |
| `schema.md:112-114` | `connections.type` = Pi provider id; `auth_type` gains `cli_login`; `config.piAuthProvider` removed |
| `schema.md:178, 184` | Remove `harness` from `chats`; remove `sdkSessionId`, `sdkCwd` from `metadata` |
| `schema.md:187, 190` | `messages` without `source`. Rows are Pi entries verbatim plus Otto rows, told apart by `type` (Otto rows use Otto types such as `otto.info`) |
| `schema.md:239, 243, 297` | Drop "and so the harness" and "`CLAUDE_CONFIG_DIR`s" on the agent volume; drop "Claude SDK transcript files"; `+ source` → `+ parent_id` |
| `harness-plan.md:1-9` | Status line: superseded by this document for the seam, the store's `source` and the Claude route |
| `harness-plan.md:11-33, 35-76, 78-95` | (a) picture, (b) `Harness`/`Turn`/`toDisplay` seam, one store with `source`: mark superseded (keep `Computer`) |
| `harness-plan.md:127, 131-140, 147, 160, 163, 169-172, 177-178, 185-186` | Claude SDK evidence, H0/H1/H3 phases, `~/.claude/skills` symlink, per-uid Claude creds, swap-the-harness notes, E1/E2, Claude unverified items |
| Also | `AGENTS.md:39` (the gateway sentence, decision 5); `agent-computers.md:18-24, 32, 36`; `data-architecture.md:75, 289, 348, 395-396`; `messages-design.md:88-121` (Claude transcript and P7 blob gone) |

## 6. Migration (each phase ships alone)

| # | Phase | What | Size | Verify |
|---|---|---|---|---|
| B1 | Bridge spike | `PAS/claude-code-provider.ts` behind a flag; fake `claude` (below); one real run on the owner's own login | S-M | the checklist |
| B2 | Pi-only session path | New chats always use Pi; a `claude-code` connection resolves to the bridge provider; the connections import maps `type`. Existing Claude chats continue in Pi through `buildRecoveryContext` (their old messages stay readable) | M | an old Claude chat continues; a new chat on a Claude subscription streams, calls tools, aborts |
| B3 | Delete the Claude backend | The section 4 deletions; `AgentInstance = PiAgent`; `AgentBackend` and the registry out; Otto's Claude OAuth and its stored tokens out | M | typecheck; Pi agent tests; `grep -ri claude-agent` empty |
| B4 | UI and connection cleanup | Settings › Models: "Claude subscription": "uses your own Claude Code sign-in", shows sign-in status, `user:` scope only; onboarding strings; stop bundling the native binary; DESIGN.md entry | S-M | browser at 390/768/1440 |
| B5 | Hosted route | `otto-claude-<userId>` container, `spawnClaudeCodeProcess` → `docker exec`, web-terminal sign-in. **Flag stays off until Anthropic's written OK** | S-M | a Claude chat survives a container restart (rebuild from Pi rows) |

**1-day spike checklist (B1):**
1. A fake `claude` script set as `pathToClaudeCodeExecutable` that logs argv/env and speaks the SDK's stream-json; or inject `query` and yield scripted `SDKMessage`s. Assert `tools: []`, the preset plus append, the scrubbed env and `--strict-mcp-config`.
2. Round trip: a scripted `tool_use` for Pi's `read` → Pi runs it → the MCP handler resolves → the text continues on the next `streamSimple`.
3. Abort mid-stream and mid-tool (no orphan process); steer mid-turn; usage numbers reach Pi.
4. Divergence: compaction and branch → a fresh Claude session from a JSONL written from Pi entries (port eli's rules); confirm on Pi 0.87.1 and on 1.0.4 (fractaal #28).
5. Real `claude`, the owner's own login: send Otto's actual orchestrator instructions as the append. Record whether any `Third-party apps … extra usage` 400 appears, and check claude.ai usage for plan rather than extra usage.
6. `spawnClaudeCodeProcess` → `docker exec -i` into a test container: the in-process MCP frames cross stdio; measure RSS and cold start per turn.

## 7. Owner decisions ("go" = every DEFAULT)

| # | Decision | DEFAULT | Alternative |
|---|---|---|---|
| 1 | Bridge base | Our own provider in `pi-agent-server`, ported from eli (MIT, credited) | Depend on `pi-claude-bridge` (TUI peer deps, extension loading) |
| 2 | Where `claude` runs | Desktop: the user's installed `claude`. Hosted: one small container per human | Inside each agent's box with a Unix user per human (one sign-in per box) |
| 3 | Terms | Ship for desktop and self-hosted behind a setting now; hosted only after Anthropic's written OK; ask now | Ship hosted on the "unmodified binary" clause (high risk) |
| 4 | Existing Claude data | Delete Otto-held Claude OAuth tokens at import; old Claude chats continue in Pi through a recovery summary | Keep the Claude backend read-only until old chats age out |
| 5 | `AGENTS.md:39` ("gateway … never to Pi") | Reword: subscription bridges are Pi providers registered by `pi-agent-server`; accounts and sign-in stay in the `connections` domain | A separate gateway process exposing Claude as an HTTP API (more code; the terms call proxies intermediation) |

## 8. B1 as built (6 Oct 2026)

Built behind `OTTO_CLAUDE_CODE_PROVIDER=1` (off by default). Not committed. Ported from eli (npm `pi-claude-bridge` 0.9.1) and `cc-session-io` 0.4.0, both MIT and credited in the file header.

| File | What |
|---|---|
| `PAS/claude-code-provider.ts` (~380 code lines) | `registerClaudeCodeProvider(registry, options)`: provider `claude-code`, models copied from Pi's `anthropic` catalog, `streamSimple` driving `query()`. Options: `pathToClaudeCodeExecutable` (default: `claude` on PATH), `spawnClaudeCodeProcess`, `claudeConfigDir`, `cwd`, `query` (test seam) |
| `PAS/index.ts` | One line in the runtime build: register when the flag is `1` |
| `PAS/claude-code-provider.test.ts`, `PAS/test-fixtures/fake-claude` | 11 tests through Pi's real agent loop and the real Agent SDK against a fake `claude` that speaks stream-json (initialize, stream events, MCP control requests) and logs argv and env |

**How it differs from eli:**
- **Divergence by content, not events.** Every non-system Pi message is hashed. Claude's session is reused while its hashes are a prefix of Pi's history, plus at most Pi's copy of Claude's last reply, and the system prompt is unchanged. Anything else (compaction, branch, abort, error, a changed prompt) rebuilds. No compaction or tree hooks are needed, and the same rule discards a query parked at a tool boundary when Pi rewrote the history under it (the turn continues with eli's "continue" prompt).
- **A rebuild always takes a new session id.** It writes the JSONL from Pi's entries and deletes the old file, which was only a cache. eli's REUSE/REBUILD rules carry over: one user message holding a turn's results right after its assistant message, stubs for missing results, orphans dropped, only Claude's own signed thinking kept, and turns aborted before anything streamed dropped.
- **Permissions:** `tools: []`, `allowedTools: ['mcp__pi']` and `permissionMode: 'dontAsk'` instead of `bypassPermissions`. That also avoids the root refusal in containers.
- **Settings:** `settingSources: []` instead of `claudeMdExcludes`, so no user CLAUDE.md, hooks, plugins or MCP config. `strictMcpConfig`, `includeGitInstructions: false`, and the child env `agentEnv({ CLAUDE_CONFIG_DIR, ENABLE_CLAUDEAI_MCP_SERVERS: '0', DISABLE_AUTO_COMPACT: '1' })`.
- **The append is Pi's current system prompt, verbatim.** Nothing is stripped or added here (Otto's override already replaces Pi's preamble).
- **The MCP server is `createSdkMcpServer({ tools: [] })`** with a `fallbackRequestHandler` that serves Pi's JSON Schema verbatim and pairs calls by `claudecode/toolUseId`.
- **The SDK's `sessionStore` is not used.** Its resume path reads `~/.claude/.credentials.json` in the parent process.
- **Pi's summarizers** (`cacheRetention: 'none'`) run as one-shot queries with `persistSession: false`. They don't touch the chat's Claude session.

**Spike checklist:**

| # | Status |
|---|---|
| 1 | **Verified with the fake.** argv has `--tools ""`, `--allowedTools mcp__pi`, `--permission-mode dontAsk`, `--setting-sources=`, `--strict-mcp-config` and `--model`. `initialize.appendSystemPrompt` equals Pi's prompt. `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN` and `ENCRYPTION_KEY` are absent from the child env |
| 2 | **Verified with the fake.** A scripted `tool_use` for `read` runs Pi's real read tool, the result returns over MCP, and the text continues in the same CLI process. The non-streamed fallback message also works |
| 3 | **Verified with the fake.** Abort mid-stream and mid-tool: the turn ends `aborted` and the child pid is gone. The next turn rebuilds. A steer is written to stdin (`priority: 'next'`) before the tool result. Usage reaches Pi: input, output, cache read and write, total and cost. A follow-up resumes the same session. A crash without a result fails the turn |
| 4 | **Verified with the fake on Pi 0.87.1.** Compaction and branch each produce a new `--resume` id whose JSONL holds Pi's entries (`tool_use`/`tool_result` pairs, parentUuid chain). **Pi 1.0.4 not tested** (not installed) |
| 5 | **Unverified.** No real `claude` run. Billing (plan vs extra usage, the third-party 400) and account risk are untested |
| 6 | **Plumbing verified.** A fake spawner standing in for `docker exec -i` carries the turn and the MCP frames. **Docker, RSS and cold start not measured** |

**Open for B2 to B5:**
- **The flag doesn't reach the subprocess yet.** `agentEnv` does not pass `OTTO_CLAUDE_CODE_PROVIDER`, so B2 sets it through `envOverrides` or the init config, and adapts the provider check in `ensureSession`.
- **`pi-agent-server/package.json` doesn't declare the SDK.** `@anthropic-ai/claude-agent-sdk` resolves from the root (hoisted). Declaring it means a lockfile update.
- **Without `claude` on PATH, the SDK falls back to its bundled native binary.** That binary does not resolve inside `dist/index.js`. B4 should require the user's `claude`.
- **A `claude` signed in only through `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in the server env stops working.** These are scrubbed by design.
- **Session files are written locally under `CLAUDE_CONFIG_DIR`.** B5 must write the rebuilt JSONL inside the container.
- **Only checked against the SDK's code, not a real CLI:**
  - the `--thinking-display` flag
  - Pi's anthropic model ids as `--model`
  - the `dontAsk` plus `mcp__pi` rule
  - the JSONL record shape
  - what `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, set by the SDK, means for billing
- **Every ephemeral `queryLlm` session leaves its own small Claude session file.**
