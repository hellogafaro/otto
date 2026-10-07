# CLAUDE.md — `@otto/shared`

## Purpose
Core business logic package for Otto:
- The Pi agent (`PiAgent`, the only harness) and session-scoped tools
- Sources, credentials, sessions, and config
- Permission modes and validation

## Key folders
- `src/agent/` — `pi-agent.ts`, `base-agent.ts`, `backend/pi/` (event adapter), tools, permissions
- `src/sources/`, `src/skills/` — DB rows (`schema.ts`, `store.ts`) with their files on the S3 file store; secrets in `secrets`
- `src/sessions/` — chats and messages on the database (`chats.ts`, `import.ts` reads the old JSONL once)
- `src/automations/` — routines (DB rows, `routines.ts`), their runner and the event side (`AutomationSystem`)
- `src/projects/`, `src/tasks/` — DB-backed projects, tasks and timesheets (docs/projects-tasks.md); sessions bind to a project via `projectId`
- `src/config/` — config/preferences/theme/watcher
- `src/credentials/` — encrypted credential management
- `src/decisions/` — opt-in decision layer (Jev / TypeSafe System One): client, settings, records, `decide` tool callbacks

## Commands
From repo root:
```bash
cd packages/shared && bun run tsc --noEmit
```

## Hard rules
- Permission modes are fixed: `safe`, `ask`, `guarded` (decision layer), `allow-all`.
- Source types are fixed: `mcp`, `api`, `local`.
- Keep credential handling in `src/credentials/` pathways (no ad-hoc secret storage).
- Never join `homedir()` with `.otto`. Import `CONFIG_DIR` (or `resolveConfigDir()` when the value must follow a runtime env change) from `config/paths.ts`, `@otto/shared/config/paths` outside the package; `OTTO_CONFIG_DIR` must switch every path at once (OSS #1062). Exceptions that re-derive it from the env: `interceptor-common.ts` (standalone preload) and session-tools-core `config-validate.ts` (no dependency on shared).
- API source credentials go on the wire through one assembly: `@otto/session-tools-core/api-auth` (`parseStoredApiCredential` → `buildApiAuthHeaders`/`appendQueryAuth`). `sources/api-tools.ts:buildHeaders` and `SourceCredentialManager.getApiCredential` wrap it, and `source_test` uses the same functions, so a passing test means the `api_<source>` tools authenticate too (OSS #1067). Stored shape: bare string for a single header/bearer/query, `{"username","password"}` for basic, `{header: value}` map for multi-header; a single header equal to `headerName` is stored bare (`serializeHeaderCredential`). Never build auth headers by hand.
- Keep user-facing tool contracts backward-compatible where possible.

## Notes
- `allowedWritePaths` (workspace rules in the database, a source's permissions.json) is honored by Explore mode (`agent/mode-manager.ts:shouldAllowToolInMode`) and Ask mode (`agent/core/pre-tool-use.ts:shouldPromptInAskMode`) through the single exported `matchesAllowedWritePath`; keep both on that matcher (OSS #1065).
- Ask-mode "Always Allow": the key is computed next to the whitelist check in `shouldPromptInAskMode` (`agent/core/permission-remember.ts`) and travels as `PromptInfo.remember`; agents apply it with `PermissionManager.remember()` and must never derive keys from prompt text (first-word keys once let `git commit` approve `git push`). Bash keys: leading words for CLIs with subcommands, name for single-purpose commands, exact argv otherwise (incl. interpreters/runners); no key for dangerous/destructive/wrapper/chained commands; file writes are keyed by folder. Explore argument checks (`find`, awk, `sed`, `sort`, `gh api`) live in `bash-validator.ts` `ARGUMENT_INSPECTORS`, in code because an installed `default.json` only gains patterns on upgrade; default MCP read verbs are whole-word matches with a write-verb veto (`agent/mcp-tool-names.ts`). `spawn_session` modes are clamped to the parent's (`clampPermissionMode`).
- `PiAgent` (`src/agent/pi-agent.ts`) is the only agent class.
- **Single label-filter predicate.** `matchesLabelFilter` (`labels/filter.ts`, browser-safe) is the only implementation of "session matches a label filter" (descendants, `__all__`, optional `projectId` scope). The session list, AppShell filtered set, and NavigationContext auto-select all route through it — do not hand-roll label matching in feature code.
- MCP proxy tool names are built ONLY via `proxyToolName(slug, name)` (`mcp/proxy-tool-name.ts`), which sanitizes characters outside `[a-zA-Z0-9_-]` (e.g. dots) so OpenAI/Codex accept them. The name is an opaque exact-match key in `McpClientPool.proxyTools`, so build (`registerClient`), emit (`getProxyToolDefs`), and Pi registration must ALL use this one builder or the dispatch key drifts (#864, regression of #498). Post-sanitization collisions keep the FIRST tool and `console.warn` the skipped one (a silently vanishing tool must leave a trail); deterministic disambiguation is a known possible follow-up.
- **Decision layer** (`src/decisions/`, gated only by `StoredConfig.decisionLayer.enabled`, default **off** — no environment flag): one HTTP client (`SystemOneClient`) for every provider that speaks TypeSafe's System One wire format (TypeSafe direct, OpenRouter, Vercel AI Gateway, self-hosted) — it is NOT an `LlmConnection` (the Pi SDK has no System One adapter and Jev cannot chat). Keys live in the vault as `decision_api_key::{provider}` or are reused from an OpenRouter / Vercel AI Gateway connection (`connectionSlug` → `getLlmApiKey`). Provider presets (`decisions/providers.ts`) include `laya` — the Apache-2.0 Jev-compatible model served locally by `laya-serve` on `127.0.0.1:8000`, keyless, `model: auto` — marked `local` so the Settings card shows a `GET /health` probe (`decisions/health.ts`, RPC `decisions:probeServer`) and an install hint instead of a key hint; presets may carry a tighter `maxStateBytes` (laya-serve rejects >50k chars). Invariants: a decision never grants authority (no permission prompt may become an allow because of an answer); fail closed (`getDecisionClient()` → `null` = behave as before); the state is never logged — `records.ts` writes only sha256 + bytes to `~/.otto/logs/decisions.jsonl`; model ids are pinned per provider (never `jev-latest`) and the reported model is recorded. Surfaces: `decide` session tool (session-tools-core `handlers/decide.ts`, registry, read-only, hidden unless `getSessionToolDefs({ includeDecide })` — `PiAgent` passes `isDecisionFeatureActive('decideTool')`; server-core `decisions/tool-callbacks.ts` is wired per session next to `pages`), Settings > AI card via `RPC_CHANNELS.decisions.*` (server-core `rpc/decisions.ts`). Agent guide: `apps/electron/resources/docs/decisions.md`; system-prompt row/section in `prompts/system.ts` appear only while the tool is active. One more zero-authority surface, behind its own `features` toggle: **semantic auto-label rules** (`labels/types.ts` `SemanticAutoLabelRule` = `{ semantic, threshold?, value? }` next to regex rules; `labels/auto/evaluator.ts` `evaluateSemanticAutoLabels` batches one `noul` per rule; `server-core/decisions/semantic-labels.ts` is called fire-and-forget from `SessionManager.applySemanticAutoLabels`, matches merge through the shared `applyAutoLabelMatches`) — inert without the layer, default threshold 0.9 because LabelAdd automations fire.
- **Decision points (host side)**: every harness feature that asks the model goes through `server-core/decisions/decision-point.ts` `openDecisionPoint({ feature, record })` (toggle gate, background deadline, record, `null` on failure); do not copy the resolve/record glue again. After applying its thresholds, every point calls `recordDecisionOutcome(result, { action, changed, detail? })` once per answer, which appends an outcome line (`kind: 'outcome'`, `decisionId` = the decision record's `id`) — `changed` means behaviour differs from running without the layer; what only turns out later goes in a follow-up line via `recordDecisionFollowUp(result, { result, detail? })` (`kind: 'followup'`, any number per decision); `decisions/usage.ts` joins all three (`bun run decisions:report`, follow-ups listed under the table). Pass `sessionId` wherever the point has one (the large-result gate gets it from `sessionPath`/the Pi agent, automation conditions from the event's session plus `matcherId` in meta). Under `bun test` the default recorder writes to a temp file (`defaultDecisionsLogPath`), never the user's log. Caller aborts fail as `cancelled`, not `timeout`. Toggles live in `decisions/settings.ts` `DecisionLayerFeatureToggles`: invoked features (`decideTool`, `semanticLabels`) default on, harness features default off; each needs a row (label, description, tooltip) in a group of the AiSettingsPage `decisionFeatureGroups` (rendered under the card's collapsed **Advanced settings**) and in the docs-site decision-layer Features table. Features: `turnOutcome` (`decisions/turn-outcome.ts`: SessionManager `applyTurnOutcome` moves open sessions to needs-review); `guardedMode` (offers the **Guarded** permission mode, `PermissionMode` `'guarded'`, between `ask` and `allow-all` in `PERMISSION_MODE_ORDER`: permission checks treat it as Execute via `isAutonomousPermissionMode`, and only Guarded sessions are risk-checked, so **Execute never asks the model**. `agent/core/guarded-mode.ts`: `PiAgent` calls the sync `needsGuardedModeCheck` (Guarded-mode allow + `GuardedModeCheck.isActive()`) before awaiting `applyGuardedModeCheck`, which judges `ctx.input` (not an input rewrite), may only turn an allow into a prompt, re-runs `runPreToolUseChecks` if the mode changed during the wait and blocks if the turn's abort signal fired; Pi applies it after source activation; SessionManager installs `decisions/guarded-mode.ts` with `isAttendedSession`, which excludes automation/hidden/mini/`unattended` sessions at call time (`otto run` creates its session `unattended`, and `onSpawnSession` passes it on to children of unattended sessions, not to subtasks a user adds); its prompts carry no `remember`, and `PermissionRequest.canRemember: false` hides "Always Allow". Without an answer in time the call runs as in Execute (tighten-only, capped at `FOREGROUND_MAX_DEADLINE_MS`); but while the check cannot run at all (feature or layer off) `resolveEffectivePermissionMode` turns Guarded into Ask (host-installed `setGuardedModeActiveResolver`, default Ask), used by `runPreToolUseChecks` and the PermissionManager bash checks. Coverage: Bash, MCP mutations incl. session tools Explore blocks (not status/labels bookkeeping), non-GET API calls; file writes outside the working dir and plans/data folders always prompt without a model call (`alwaysAsk`). `planExecutionMode` returns an approved plan from Explore to Guarded when the session came from it (server `acceptPlan` and the renderer). UI: pickers list modes from `availablePermissionModes` (renderer `useAvailablePermissionModes` + `guardedModeAvailableAtom`, refreshed by AppShell from `getDecisionLayerStatus` and the `otto:decision-settings-changed` event), default cycle and cyclable fallbacks use `DEFAULT_PERMISSION_MODES`; automations and `spawn_session` do not accept `guarded`, but `clampPermissionMode` keeps a Guarded parent's children at most Guarded; the RPC rejects unknown modes); `riskBadges` (`decisions/permission-risks.ts`: SessionManager awaits badges before emitting a non-admin `permission_request` and drops the prompt if, meanwhile, the request was answered, the session was stopped (`stopEpoch`) or deleted, or the agent was rebuilt, denying it on the agent side; core `PermissionRequest.risks`); `automationConditions` (matcher `semanticCondition` → `PendingPrompt.semanticCondition/event/eventPayload`; SessionManager `shouldRunPromptAutomation` gates `onPromptsReady`, skipped runs get history `skipped`, inert without the layer); automation loop guard (`SessionManager.automationLoopGuard`, runs before the condition): prompt actions never run for an event about a session the same automation created (`triggeredBy.automationId`, name fallback for older sessions), and chains of automation-created sessions stop at `MAX_AUTOMATION_CHAIN_DEPTH` (3; `triggeredBy.depth`); `smartTitles` (`decisions/smart-titles.ts`: SessionManager `generateTitleUnlessSmallTalk` defers the first title, `refreshTitleIfDrifted` every 3 user messages; `ManagedSession.autoTitle` marks app-set titles so user renames are never overwritten, which also stops a late AI title from clobbering a rename); `adaptiveThinking` (`decisions/adaptive-thinking.ts` → `ChatOptions.thinkingOverride`, Pi sends `set_thinking_level` before the prompt and restores the session level in `finally`; skipped for slash commands); `midTurnMessages` (`decisions/mid-turn-messages.ts`: a text message sent during a turn is recorded as queued at once (send order kept, the queue stays the single source of truth), and `steerQueuedIfDecided` moves it into the running turn when the model (or, without an answer, the connection's `midStreamBehavior`) says steer, only while it is still queued, the same turn runs and `agent.canSteerNow()` (so `redirect()` never takes its abort fallback); queued continuations get `mergeWith` (a reference to the earlier entry) in the background and `processNextQueuedMessage` replays them in one turn, recording the merged bubble IDs for the auth retry; `steerQueuedIfDecided` awaits the entry's `continuationCheck` and never steers either half of a continued message (`isInQueuedContinuation`), since steering only the second half of "when you create the event later," / "call it X" read as "create it now"); `largeResults` (`decisions/large-results.ts` → shared `setLargeResultSummaryGate`, installed process-wide in `SessionManager.initialize()`; `handleLargeResponse` asks it before the summarization call and skips the summary only on `false`; the Pi subprocess installs `pi-agent-server/src/large-result-gate.ts`, which asks the main process over JSONL: `PiAgent.handleLargeResultGateRequest` → `askLargeResultSummaryGate`); `suggestions` (`decisions/suggestions.ts`: SessionManager `startPreTurnDecisions` runs it next to `adaptiveThinking` while the agent is set up and passes the hint as `ChatOptions.turnContext`; hint at confidence ≥ `SUGGESTION_MIN_CONFIDENCE` (0.75). The answer is kept as `ManagedSession.suggestionTrace` for the whole request, across activation re-sends; tool calls and activations add the candidates they use (`candidatesUsedBy`: the source's tools, source_* session tools, its activation, a skill's SKILL.md or the Skill tool), and when the request is over (`onProcessingStopped` without a pending re-send, or the next request's start) `suggestionFollowUp` writes `hint_used`/`hint_unused`, `held_back_used`/`held_back_unused` (a pick below the threshold) or `none_used`/`none_unused`, the data for tuning the threshold). Source-activation auto-retries (`buildActivationRetryMessage`) are sent `hidden` and recognised through `pendingActivationResend`: they carry the corrections steered into the turn (`turnSteers`) after the original request, keep the turn's adaptive-thinking level (`turnThinkingOverride`), and run no per-message decision point (no suggestions, no label rules, not counted for title drift); hidden messages never run label rules. Semantic label rules whose entry the session already has are not asked (`existingEntries` → evaluator `skipEntries`). `turnContext` is the channel for transient per-turn guidance: `BaseAgent.chat` appends it after mention parsing and outside `getCurrentTurnUserMessage()`, so it never registers a skill, never reaches the stored message and is not resent after a source activation (the interruption notice uses it too). Per-turn/per-prompt points check the toggle synchronously first (`SessionManager.decisionFeatureActive`, a test seam over `isDecisionFeatureActive`) so the path gains no await when it is off; points something waits on (turn start, message ack) pass `maxDeadlineMs: FOREGROUND_MAX_DEADLINE_MS` (3 s).
- Route new model vendors through Pi (a connection whose `type` is the Pi provider id); Pi is the only harness. The Pi provider catalog and display metadata live in `src/config/models-pi.ts`.
- Custom endpoint model capabilities must preserve explicit per-model overrides end-to-end. In particular, `supportsImages: true` enables image input for one model and `supportsImages: false` must remain available to override a global endpoint image default. Active Pi custom-endpoint sessions refresh runtime capabilities via `updateRuntimeConfig`; capability changes are pushed proactively from the `llmConnections.SAVE` handler through `SessionManager.refreshConnectionRuntime`, with the lazy `getOrCreateAgent` path acting as a backstop. The session layer still gates image attachments at send time so disabled images are not sent even if a subprocess refresh fails.
- `update_runtime_config` IPC carries `model, authType, baseUrl, customEndpoint, customModels` only — the connection's `type` (its Pi provider), `slug`, and the broader credential/provider routing state cannot be re-routed inside a live Pi subprocess. `runtime-config.ts:buildRestartRequiredSignature` hashes those fields separately from the in-place-safe ones; when the restart signature drifts, `tryRefreshAgentRuntime` skips the in-place attempt and goes straight to dispose + recreate so the new auth/provider state actually takes effect.
- Session lifecycle distinguishes **hard aborts** from **UI handoff interrupts**:
  - use hard aborts for true cancellation/teardown (`UserStop`, redirect fallback)
  - use handoff interrupts for pause points where control moves to the UI (`AuthRequest`, `PlanSubmitted`)
- Remote workspace handoff summaries are injected as one-shot hidden context on the destination session's first turn.
- Source OAuth uses a stable relay redirect URI (`<OTTO_OAUTH_RELAY_URL>/auth/callback`) only when `OTTO_OAUTH_RELAY_URL` is set; the deployment-specific callback target is carried in a relay-owned outer `state` envelope. With it unset there is no relay: the local or server callback is the provider redirect URI directly (`getOAuthRelayCallbackUrl()` is undefined).
- **Routines are database rows** (`automations/schema.ts`, `routines.ts`; `config` is the matcher/action JSON, `paused_at` null = active). `automations.json` is no longer read: `routines-import.ts` imports an old one once at boot. Schedule routines fire from the scheduler in `routine-runner.ts`; event routines through `AutomationSystem` (one per workspace, reads the table at every event). Matching goes through the canonical adapters in `automations/utils.ts` (`matcherMatches*`); do not hand-roll primitive matcher checks.
- **Automation actions are a STRICT discriminated union** (`prompt` | `webhook` | `script`): unknown action types fail validation. The `script` action (`automations/script-executor.ts` + `handlers/script-handler.ts`) argv-spawns a workspace-local script via `resolveScriptRuntime` (never a shell), with a OTTO_*-only child env (`buildScriptEnv`), symlink-aware workspace containment, SIGTERM→SIGKILL timeout, and a per-matcher concurrency lock. Adding an action type touches: `types.ts`, `schemas.ts`, a handler, `name-utils.ts`, `validation.ts`, and server-core `rpc/routines.ts`.
- Automation matchers may declare an optional `telegramTopic?: string` to route spawned sessions into a Telegram forum topic in the workspace's paired supergroup. The field is plumbed through `PendingPrompt` and `ExecutePromptAutomationInput`; runtime resolution and topic creation live in `@otto/messaging-gateway`'s `TopicRegistry` and `MessagingGatewayRegistry.bindAutomationSession`. SessionManager picks up the resolution via the optional `setAutomationBinder` hook installed by the messaging-gateway bootstrap.
- The OpenAI Chat Completions strip stream (`unified-network-interceptor.ts:createOpenAiSseStrippingStream`) emits **one consolidated SSE event per logical tool call** with `id + name + cleanArgs` together — never split across init + args-only deltas. Some downstream SDKs (Pi SDK) treat args-only deltas as new tool_calls instead of merging by index, which produces duplicate empty-id entries on parallel-tool turns from DeepSeek and other relays. `sanitizeOpenAiHistoryInPlace` recovers sessions whose history was persisted by the pre-fix split-emit version. A present-but-empty `tool_calls: []` delta is NOT a tool-call delta (the guard requires `length > 0`), so terminal `finish_reason` chunks that also carry `tool_calls: []` are no longer dropped — that dropping made custom OpenAI-compatible endpoints fail validation with "Stream ended without finish_reason" (#995). Forwarded chunks additionally get the empty `tool_calls` key stripped (re-serialized) so the Pi SDK never sees it at all.
- `LlmConnection.midStreamBehavior` controls whether mid-stream user sends try to steer the in-flight turn or hold for the next turn. Default is `'steer'` via `defaultMidStreamBehavior()`. **Read everywhere via `resolveMidStreamBehavior(connection)`** — never branch on the connection's `type` for this decision; legacy connections without the field rely on the resolver's fallback. New connections persist the explicit default at `createConnectionForSetup` time so the Settings → AI editor shows the right choice on first load. The decision is made in `SessionManager.sendMessage`'s mid-stream branch only — `'queue'` mode skips `agent.redirect()` entirely and lets the current turn finish before replay; Pi enables SDK `steeringMode: 'all'` so a burst drains at the next steer boundary. Two correctness invariants live in this branch: (1) `managed.wasInterrupted` is set **only** on the steer path (where an actual `forceAbort` happened) — pure `'queue'` mode must NOT set it, otherwise the replayed turn injects the "previous response was interrupted and may be incomplete" reminder for a turn that actually completed, confusing the model. (2) The mid-stream user message is created with a queue-time timestamp (mid-stream, i.e. *before* the in-flight assistant reply is finalized at `text_complete`); `processNextQueuedMessage` **re-stamps** it via `this.monotonic()` on replay so it sorts after the prior turn's finalized reply — `groupMessagesByTurn` (`@otto/ui`) orders by timestamp. The emitted `user_message` event with `status: 'processing'` is the live-renderer reconciliation point: `handleUserMessage` must copy that canonical timestamp onto the already-mounted optimistic message while preserving its optimistic ID. Persisting the re-stamp server-side alone fixes reload order but leaves the live transcript wrong.
- **Context occupancy is not billable token usage.** `AgentEvent.context_usage` carries `ContextUsageSnapshot` (`core/src/types/context-usage.ts`): `usedTokens` may be `null` after a compact when no fresh estimate exists, `limitKind` distinguishes compaction-window vs hard context-window denominators, and percentages are intentionally unclamped. Do not derive current occupancy from cumulative `complete.usage` after a compact, and do not invent Pi reserves; use `agent/context-usage.ts` normalizers and preserve explicit unknown/stale snapshots through host/UI merges.
- **A manual Pi compaction owns the turn.** `PiAgent.isCompactionInFlight()` (a pending compact RPC) makes `SessionManager.sendMessage` queue mid-stream text (`shouldAttemptMidStreamSteer`) instead of steering: a steer sent during `/compact` has no agent loop to consume it and vanished (OSS #1058). `PiAgent.redirect` refuses (returns false, no abort) in that state as a second guard. The host compact deadline (`compactTimeoutMs`, 300 s) bumps the epoch and sends `abort` so the child cancels the summarization (OSS #1060); the child waits at most `MANUAL_COMPACT_WAIT_MS` (120 s, `pi-agent-server/src/compaction-wait.ts`) for a prior compaction before `session.compact()`, which itself aborts a stale one.
- The network interceptor (`unified-network-interceptor.ts`) is **Pi-only**: it preloads into the Pi subprocess via Bun `--preload`. In dev / monorepo runs it preloads from the .ts source so changes propagate without a rebuild; packaged builds use `apps/electron/dist/interceptor.cjs`. See `agent/backend/internal/runtime-resolver.ts:resolveInterceptorBundlePath`.
- Interceptor debug log (`interceptor-common.ts`, dev builds with `--debug`/`OTTO_DEBUG=1` only): `~/.otto/logs/interceptor.log` is size-bounded (32 MiB active + one `.prev`, 4 MiB per entry, oversized file truncated at startup) and request bodies are replaced by a size placeholder unless `OTTO_DEBUG_FULL_BODIES=1` (OSS #1033). Log through `debugLog`/`appendLogEntry`; never `appendFileSync` the log directly.
- **Pi turn completion is adapter-driven** (`agent/backend/pi/event-adapter.ts`). `PiEventAdapter` runs two recovery state machines that hold the Otto event queue open across SDK flows that continue *after* an `agent_end`: context-overflow compaction (`_runAutoCompaction("overflow") → agent.continue()`) and the SDK's auto-retry of transient provider/transport errors (`agent_end { willRetry: true } → auto_retry_start → backoff → agent.continue()`). `PiAgent.handleSubprocessEvent` completes the queue only when `adapter.shouldCompleteQueue()` says so; hard aborts and subprocess teardown call `adapter.resetRecoveryState()`. Retryable errors (classified by pi-ai's `isRetryableAssistantError`, the same function the SDK uses) are parked, shown as a "Retrying…" status, and surfaced as one typed error only when retries are disabled/exhausted/cancelled — never yield them from `message_end` directly. Failed assistant streams emit identity-scoped `text_discard` before backoff (SessionManager cancels the pending batch; consumers remove only unfinished text); sub-turn IDs stay unique across SDK retries. Explicit `retry` backoff/active/end events own transient progress — never infer recovery from output. The retry policy lives in `packages/pi-agent-server/src/session-settings.ts` (`SettingsManager.inMemory`): main chats use 4 agent-level + 2 provider-level retries, `steeringMode: 'all'`, and the SDK's canonical context-usage snapshot plus real compaction settings are forwarded separately from billable usage; utility sessions use a smaller policy and one 115-second execution deadline inside the host's 120-second RPC timeout. `EphemeralQueryCoordinator` aborts only the matching utility session, including on host `cancel_ephemeral_query`; pending host entries own their timer handles and utility errors carry request IDs for concurrency isolation. The subprocess must never fall back to the SDK default `SettingsManager.create(cwd, agentDir)`, which merges `<cwd>/.pi/settings.json` from the user's working directory.
- **Pi's prompt comes from Otto per turn, through Pi's own prompt options, never through SDK internals.** `packages/pi-agent-server/src/turn-prompt.ts` registers a hidden inline `before_agent_start` extension on the session's `DefaultResourceLoader` (`createOttoResourceLoader`: no skills, context files, SYSTEM.md or APPEND_SYSTEM.md read from the server's disk) that sets `systemPromptOptions.customPrompt` to the prompt `PiAgent` built and `skills` to the chat agent's skills (`AgentTurn.skills`, sent on each `prompt` message). Pi renders the structured prompt itself, so its native skill list (`<available_skills>`) stays; returning `{ systemPrompt }` would force a whole prompt and drop it. Ephemeral queries pass their fixed prompt as the loader's `systemPrompt`. `agent.state.systemPrompt` is read-only since pi 0.87 and the old `_baseSystemPrompt` string internals are gone — writing them throws inside the bundled subprocess (caught by `bundle-smoke.test.ts`).
- Per-message context is split into **volatile** vs **stable** blocks (`PromptBuilder.buildVolatileContextParts()` / `buildStableContextParts()`, composed by `buildContextParts()`). Volatile = date/time, `session_state`, `sources` (change per turn); stable = workspace capabilities, working directory (invariant per session). **Pi** folds only stable blocks into the system prefix and routes volatile blocks to the user tail — otherwise a per-minute re-stamp invalidates pi-ai's cached system prefix and all downstream history (#862). `buildVolatileContextParts` consumes the one-shot mode-change signal (`consumeModeChangeUserSignal`), so call it **exactly once per turn** — never re-invoke a builder to compute a cache-debug hash (hash the produced string instead).

## i18n (Internationalization)

Translations live in `src/i18n/locales/{lang}.json`. All user-facing strings must use `t()` (React) or `i18n.t()` (non-React).

### Locale registry (single source of truth)

All locale metadata lives in **`src/i18n/registry.ts`**. To add a new locale:

1. Create `src/i18n/locales/{code}.json` with all keys (copy from `en.json`)
2. Import the messages and `date-fns` locale in `registry.ts`
3. Add one entry to `LOCALE_REGISTRY`

**That's it.** `SUPPORTED_LANGUAGE_CODES`, `LANGUAGES`, i18n resources, and `getDateLocale()` are all derived automatically. No other file needs to change.

### Key naming convention

Keys use **flat dot-notation** with a category prefix:

| Prefix | Scope | Example |
|--------|-------|---------|
| `common.*` | Shared labels (Cancel, Save, Close, Edit, Loading...) | `common.cancel` |
| `menu.*` | App menu items (File, Edit, View, Window) | `menu.newChat` |
| `sidebar.*` | Left sidebar navigation items | `sidebar.allSessions` |
| `sidebarMenu.*` | Sidebar context menu actions | `sidebarMenu.addSource` |
| `sessionMenu.*` | Session context menu actions | `sessionMenu.archive` |
| `settings.*` | Settings pages — nested by page ID | `settings.ai.connections` |
| `chat.*` | Chat input, session viewer, inline UI | `chat.attachFiles` |
| `toast.*` | Toast/notification messages | `toast.failedToShare` |
| `errors.*` | Error screens | `errors.sessionNotFound` |
| `onboarding.*` | Onboarding flow — nested by step | `onboarding.welcome.title` |
| `dialog.*` | Modal dialogs | `dialog.reset.title` |
| `apiSetup.*` | Model search in connection setup | `apiSetup.searchModels` |
| `workspace.*` | Workspace creation/management | `workspace.createNew` |
| `sourceInfo.*` | Source detail page | `sourceInfo.connection` |
| `skillInfo.*` | Skill detail page | `skillInfo.metadata` |
| `sourcesList.*` | Sources list panel | `sourcesList.noSourcesConfigured` |
| `skillsList.*` | Skills list panel | `skillsList.addSkill` |
| `status.*` | Session status names (by status ID) | `status.needs-review` |
| `mode.*` | Permission mode names (by mode ID) | `mode.safe` |
| `hints.*` | Empty state workflow suggestions | `hints.summarizeGmail` |
| `table.*` | Data table column headers | `table.access` |
| `time.*` | Relative time strings | `time.minutesAgo_other` |
| `session.*` | Session list UI | `session.noSessionsYet` |
| `shortcuts.*` | Keyboard shortcuts descriptions | `shortcuts.sendMessage` |
| `sendToWorkspace.*` | Send to workspace dialog | `sendToWorkspace.title` |
| `webui.*` | WebUI-specific strings | `webui.connectionFailed` |
| `auth.*` | Auth banner/prompts | `auth.connectionRequired` |
| `browser.*` | Browser empty state | `browser.readyTitle` |

### Rules

1. **Never call `i18n.t()` at module level** — store `labelKey` strings and resolve in components/functions.
2. **Use i18next pluralization** (`_one`/`_other`), never manual `count === 1 ?` logic.
3. **Keep brand names in English**: Otto, Agents, Workspace, Claude, Anthropic, OpenAI, MCP, API, SDK.
4. **Include `...` in the translation value** if the UI needs an ellipsis — don't append it in JSX.
5. **Use `<Trans>` component** for translations containing HTML tags (e.g. `<strong>`).
6. **Use `i18n.resolvedLanguage`** (not `i18n.language`) when comparing against supported language codes.
7. **Keys must exist in every locale file** in `src/i18n/locales/` (not just `en.json` — `lint:i18n:parity` enforces this across the full set). Keep alphabetically sorted.
8. **Watch translation length for constrained UI elements.** Translations can be 20-100%+ longer than English. For buttons, badges, tab labels, and dropdown items, keep translations concise — use shorter synonyms if needed. High-risk areas:
   - Permission mode badges (3-5 characters max)
   - Settings tab labels (≤10 characters ideal)
   - Button labels (avoid exceeding 2x the English length)
   - Menu items (flexible, but avoid 3x+ growth)

### Validation

Three checks gate i18n correctness, all run by `validate:ci`:

| Script | Catches |
|--------|---------|
| `lint:i18n:sorted` | locale keys not alphabetical |
| `lint:i18n:parity` | non-EN locale missing keys present in `en.json`, or vice versa |
| `lint:i18n:coverage` | `t('...')` callsite referencing a key that doesn't exist in `en.json` |

`parity` alone is insufficient — it can't detect symmetric losses across all locales (a merge that drops the same 50 keys from every locale file passes parity but breaks the UI). `coverage` closes that gap by verifying every literal `t(...)` / `i18n.t(...)` / `<Trans i18nKey>` reference resolves against `en.json`. Dynamic keys (`t(\`status.${id}\`)`) are skipped — those surface via i18next's runtime missing-key warnings.

When resolving locale merge conflicts, run `bun run validate:ci` and trust the result — no manual key auditing needed if all three pass.

### Adding a new translated string

1. Add the key + English value to `en.json` (alphabetical order)
2. Add the key + translated value to **every other** `src/i18n/locales/*.json` file (run `bun run lint:i18n:parity` to confirm none were missed)
3. Use `t("your.key")` in the component (add `useTranslation()` hook if not present)
4. For non-React code, use `i18n.t("your.key")` — but only inside functions, never at module level

### Adding a new locale

1. Create `src/i18n/locales/{code}.json` with all keys from `en.json`
2. Add the entry to `LOCALE_REGISTRY` in `src/i18n/registry.ts` (messages + date-fns locale + native name)
3. Run tests — the registry tests will catch any missing wiring

### Cross-process language persistence

The main-process i18n instance has **no detection plugin** (no `localStorage` in Node) and would otherwise reset to `fallbackLng: 'en'` on every restart. To keep main + renderer in sync across launches:

- **Renderer** uses `i18next-browser-languagedetector` → `localStorage` (`i18nextLng`). Survives restart.
- **Main** hydrates on startup, once the local user exists, from that user's `uiLanguage` setting (`settings`, `user:<id>`). Maintained only by the `i18n:changeLanguage` IPC handler in `apps/electron/src/main/index.ts`.
- **Renderer → main sync** happens on every Appearance change AND once at renderer startup (so a freshly-installed app immediately learns the persisted language).
- The IPC handler validates the incoming code against `SUPPORTED_LANGUAGE_CODES` and `setPersistedUiLanguage()` no-ops if the value is unchanged — startup pushes don't churn the database.

`uiLanguage` is **not** user-editable through `update_user_preferences`. The Appearance dropdown is the only writer.

**Session-title language** resolves from this same persisted `uiLanguage` via `resolveTitleLanguageName()` (`config/preferences.ts`), **not** `i18n.resolvedLanguage`. The main-process i18n value hydrates asynchronously at startup and can still read the `'en'` fallback when an early title generates, which forced English titles for non-English chats (#885). When no language is persisted the helper returns `undefined`, so the title prompt auto-detects the conversation language instead of defaulting to English. Used at both `SessionManager` title sites (`generateTitle`, `refreshTitle`).

## Token refresh for API sources

API sources can auto-refresh tokens via two paths:
- **OAuth** — Google, Slack, Microsoft, or generic OAuth (`authType: 'oauth'`)
- **Renew endpoint** — custom bearer-token APIs with `api.renewEndpoint` in config.json

For renew-endpoint sources, the current access token is sent to the configured endpoint and a new token is extracted from the response. No separate refresh token is needed (MVP scope).

Key integration points:
- `isRefreshableSource()` in `types.ts` — single guard for "can this source auto-refresh?"
- `SourceCredentialManager.refreshApiRenew()` — calls the renew endpoint
- `TokenRefreshManager` — treats renew-endpoint sources as refreshable even without `refreshToken`
- `server-builder.ts` — passes a token getter (not static credential) for renew-endpoint sources

## `queryLlm` backend contract

`PiAgent.queryLlm(request: LLMQueryRequest)` MUST:
- honor `request.model` (with backend-specific fallback only when the model is
  unresolvable/unsupported; always report the *effective* model in
  `LLMQueryResult.model`)
- honor `request.systemPrompt`

SHOULD:
- honor `request.outputSchema` (at minimum via prompt injection — see
  `buildCallLlmRequest` in `agent/llm-tool.ts`, which already handles this
  pre-backend)

MAY:
- honor `request.maxTokens` and `request.temperature` if the underlying SDK
  supports passing these to its generation call

MUST NOT:
- return a fabricated `LLMQueryResult.model` that doesn't match what was actually
  used — downstream UI treats this as authoritative

The IPC envelope between the main process and the Pi subprocess MUST carry the full `LLMQueryRequest`, not a subset.
A narrower envelope is guaranteed to drift over time
(see #596). The round-trip invariant is guarded by
`packages/shared/src/agent/__tests__/pi-query-llm.test.ts`.

## Source of truth
- Package exports: `packages/shared/src/index.ts` and subpath export entries.
- Agent exports: `packages/shared/src/agent/index.ts`
