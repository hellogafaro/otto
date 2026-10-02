# Otto implementation references

Reviewed 30 September 2026; server-owned workspace and Garage references added 1 October 2026. This is a lookup guide for future design and implementation questions. The observations below come from official product documentation and repository documentation. They are not runtime verification or a decision to adopt a framework. Recommendations for Otto are our design judgments.

The [foundation research](foundation-research.md) compares the candidates and recommends a small Otto app with an ACP bridge in its server runtime around existing coding harnesses. Multi-agent operation is a first-release requirement. The recommendation still needs the real-workflow proof recorded there.

## When stuck, start here

| Question | First reference | What to inspect |
| --- | --- | --- |
| How should people configure, share, and maintain an agent? | Notion Custom Agents | Instructions, Tools & Access, agent permissions, configuration history |
| How should a connection manage credentials and serve agent tools? | Eve and Vercel Connect | Connection authentication, account identity, runtime credentials, refresh, approval and revocation |
| How should an agent use skills, memory, and an isolated computer? | Mastra | Skills, memory scopes, sandbox filesystem, durable run controls |
| How should coding sessions handle provider differences, Git, and reconnects? | T3 Code | Provider adapters, workspace ownership, durable commands, source-control UI |
| How should environments start, fail, recover, and retire? | BB / getbb | Environment provisioning, server and host ownership, thread lifecycle |
| How should skills and MCP capabilities fit without another object model? | Agent Skills and MCP official specifications | Portable instruction bundles, optional resources, server capabilities and transports |
| How should subscriptions, connection setup, skills, and remote sessions fit together? | Craft Agents and official provider authentication docs | Provider selection, native versus embedded harnesses, user-owned login, quotas, and headless session hosting |
| How should the server bridge several native coding harnesses? | ACP adapters and T3 Code | Capability negotiation, provider correlation, steering, cancellation, resume, and approval |
| How could we embed our own harness across model providers? | Pi | Coding-agent SDK, explicit resource loading, session storage, tools, and containment boundary |
| How should operators keep terminal processes visible and controllable? | Herdr | Agent identity, terminal persistence, prompt submission, and ambiguous timeout behavior |

Use the smallest relevant section. Follow its links into the implementation if needed. Record the source revision and the pattern chosen in the work's existing task or document. A reference is a way to answer a concrete question, not a requirement to import its complete architecture.

## Notion Custom Agents

**Observed:** Custom Agents combine instructions, explicit tool and content access, background triggers, and reviewable activity. Access granted to an agent is distinct from who can interact with that agent. Notion warns that an agent's answers can expose information beyond the triggering person's own access. See [Custom Agents](https://www.notion.com/help/custom-agents) and [sharing and permissions](https://www.notion.com/help/custom-agents-sharing-and-permissions).

**Check when:** designing agent setup, access management, shared maintenance, or a future trigger feature. Its [MCP connections guide](https://www.notion.com/help/mcp-connections-for-custom-agents) describes tool enablement, authentication, execution confirmation, and disconnect.

**Otto decision:** one agent configuration with instructions, skills, assigned connections, and an environment. Keep access explicit and callers appropriately scoped. Notion requires separate MCP connections per agent; Otto deliberately uses a reusable connected account with separate agent grants. Manual and cron triggers now belong in the first release; connection-event trigger patterns remain references for later.

## Vercel Eve and Connect

**Observed:** [Eve](https://vercel.com/eve) separates instructions and skills, tools, connections, channels, and sandbox setup. Connections authenticate external tools. Its [connection documentation](https://eve.dev/docs/connections) describes app and user credential ownership, token resolution outside model history, and checking connection identity when an approved action resumes.

**Check when:** implementing connection setup, service-account versus delegated-user access, account selection, token refresh, reconnect, or delayed approval. [Vercel Connect](https://vercel.com/docs/connect) documents team-level connections reused by authorized projects, runtime credentials, scopes, refresh, revocation, and operation visibility.

**Otto decision:** connect once, assign to agents, and let Connections manage authentication and execution policy. Provider identities stay stable through retries and approvals. Sandbox and credential-management patterns can be reused without making Vercel deployment or Eve's workflow machinery mandatory.

## Mastra

**Observed:** [Mastra](https://mastra.ai/docs) is a TypeScript agent framework. Its [harness guide](https://mastra.ai/docs/harness/overview) separates durable runs, steering, stop controls, and background execution. [Skills](https://mastra.ai/docs/skills) can be loaded from files or resolved dynamically. [Memory](https://mastra.ai/docs/memory/overview) has explicit thread and resource scope. [Sandboxes](https://mastra.ai/docs/sandbox/overview) separate execution from mounted storage and describe application-owned cleanup for dynamically resolved environments.

**Check when:** choosing a small runtime component, pinning skill context, isolating memory, recovering runs, persisting files, or implementing computer tools. Its [connections overview](https://mastra.ai/docs/connections/overview) distinguishes MCP tools, ACP coding processes, external A2A agents, and provider SDK runtimes.

**Otto decision:** preserve one shared conversation while each agent run retains separate model context and a scoped environment. Use one adapter and backend first. Internal agent messages need no external A2A service. Durable runtime state must not become a second authoritative copy of Otto tasks or conversations.

## T3 Code

**Observed:** [T3 Code](https://t3.codes/) is a control surface for existing coding harnesses, with Git diff and PR workflows. Repository documentation puts provider behavior behind adapters and records accepted commands before performing external effects. It distinguishes a committed request from completed work. See the [repository](https://github.com/pingdotgg/t3code).

**Reviewed source:** `38969148a23e7a422045be023627c7fbbddf7503` on 30 September 2026. Starting points:

- [Architecture and durable intent](https://github.com/pingdotgg/t3code/blob/38969148a23e7a422045be023627c7fbbddf7503/docs/internals/overview.md).
- [Provider constraints and process isolation](https://github.com/pingdotgg/t3code/blob/38969148a23e7a422045be023627c7fbbddf7503/docs/internals/providers.md).
- [Source control and connected accounts](https://github.com/pingdotgg/t3code/blob/38969148a23e7a422045be023627c7fbbddf7503/docs/user/source-control.md).

**Check when:** provider events diverge, a run cannot reconnect, a command retry repeats an effect, workspace and provider state disagree, or the Git UI needs a reference.

**Otto decision:** reuse clear provider boundaries, visible diffs, and durable intent. Keep Otto's relational records and history; a full event-sourced orchestration engine is not required. A separate branch or worktree protects edits but does not provide the computer isolation Otto requires.

## BB / getbb

**Observed:** [BB](https://getbb.app/) provides live, steerable agent threads. Its repository separates central state from host execution. Environment provisioning has persisted lifecycle state, cancellation, failure handling, and recovery after restart. BB environments may be shared by multiple threads. See the [repository](https://github.com/get-bb/bb).

**Reviewed source:** `0e7b518f135d43005dae201ef34ebb3001607eb4` on 30 September 2026. Starting points:

- [System overview and lifecycle ownership](https://github.com/get-bb/bb/blob/0e7b518f135d43005dae201ef34ebb3001607eb4/docs/system-overview.md).
- [Environment provisioning and startup recovery](https://github.com/get-bb/bb/blob/0e7b518f135d43005dae201ef34ebb3001607eb4/docs/environment-provisioning.md).
- [Configuration, agent instructions, and skills](https://github.com/get-bb/bb/blob/0e7b518f135d43005dae201ef34ebb3001607eb4/docs/configuration.md).

**Check when:** selecting the first execution backend, starting or cancelling an environment, reconciling after host loss, preserving thread history, or keeping adapter and host responsibilities clear.

**Otto decision:** reuse existing environment lifecycle and execution transports from the server rather than adding another Otto execution app. Keep shared history durable and startup recoverable. Otto's conversation can contain several human and agent participants; BB thread ownership is not its schema. Preserve Otto's dedicated agent computer requirement rather than copying a shared-directory environment as an isolation boundary.

## Skills and MCP specifications

**Observed:** The [Agent Skills specification](https://agentskills.io/specification) defines a `SKILL.md` entry point with metadata and instructions plus optional scripts, references, and assets. Skills can load instructions and supporting resources as needed. The [MCP architecture guide](https://modelcontextprotocol.io/docs/learn/architecture) defines server capabilities including tools, resources, and prompts, with local and remote transports.

**Check when:** importing or exporting skills, handing skill context to a coding harness, discovering external capabilities, or implementing a Connection adapter.

**Otto decision:** current skill Documents and their supporting files supply portable bundles; Runs retain the exact inputs they received. MCP is one Connection adapter. Neither defines Otto task ownership, grants additional permissions, or requires a separate skill registry or MCP profile. Manual and cron Automations use their own thin domain and existing Runs through pg-boss inside the server.

## ACP and native coding harnesses

**Observed:** ACP defines [session setup](https://agentclientprotocol.com/protocol/session-setup), prompts, progress, permissions, and [cancellation](https://agentclientprotocol.com/protocol/prompt-turn). Session loading is an advertised capability, not a guarantee of every implementation. The maintained [Codex adapter](https://github.com/agentclientprotocol/codex-acp) wraps Codex App Server. The [Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp) wraps the official Claude Agent SDK. Their inspected source heads expose a steering extension; negotiate and test it on selected releases.

**Reviewed source:** Codex adapter `ba7b21636190a95626631c9a9226298d41d19325`; Claude adapter `bdb50ad984336e62dde1d41339f04071f6617085`. The old `zed-industries/codex-acp` README points new installs to the maintained adapter. Do not use the old package name for a new integration.

**Check when:** integrating launch, resume, tool permissions, stream correlation, or native controls. The [ACP agent directory](https://agentclientprotocol.com/get-started/agents) lists several native implementations and adapters, including Pi. [Initialization](https://agentclientprotocol.com/protocol/initialization) negotiates protocol versions, capabilities, and authentication. The [Pi ACP adapter](https://github.com/svkozak/pi-acp) bridges Pi RPC and describes itself as an MVP with limitations; it is a reference, not an adopted dependency. The [Codex App Server guide](https://developers.openai.com/codex/app-server/) documents its direct protocol and version-specific schemas. The [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) distinguishes a coding harness from a model API and explains authentication constraints for third-party products.

**Otto decision:** one trusted ACP client, configurable compatible agent executables, and several independent agents and computers. Presets and bring-your-own agents use the same configuration and Run boundary; advanced capabilities remain explicitly negotiated. ACP is the first transport; a direct native adapter is a fallback within the same boundary. Otto owns accepted requests, Run outcomes, access, schedules, peer messaging, and durable artifacts. Protocol permission prompts are not a substitute for containment or connection policy. Subscription use is required: Codex native ChatGPT login is the first proof candidate; the Claude SDK-based path remains conditional on permitted subscription integration. Follow [Codex authentication](https://developers.openai.com/codex/auth/) and [Claude hosting and credential conditions](https://code.claude.com/docs/en/legal-and-compliance), rather than assuming an adapter determines billing or permits token brokering.

## Pi

**Observed:** [Pi](https://pi.dev/) is an extensible coding harness with SDK and subprocess integration. Its [SDK guide](https://github.com/earendil-works/pi/blob/955cc6665ee3986c6a033db52200779310d10dfd/packages/coding-agent/docs/sdk.md) describes persistent sessions, resource loaders, selected tools, skills, and lifecycle controls. Current CLI MCP support is built in through extensions; SDK sessions load those explicitly. The [security policy](https://github.com/earendil-works/pi/blob/955cc6665ee3986c6a033db52200779310d10dfd/SECURITY.md) leaves sandboxing to the caller.

**Reviewed source:** `955cc6665ee3986c6a033db52200779310d10dfd`, with coding-agent source version 0.99.2. This is a source snapshot, not an installed or verified release.

**Check when:** embedding a different harness, replacing default skill discovery with pinned Otto resources, customizing tools, or distinguishing a settled session from an agent-loop end.

**Otto decision:** strongest SDK alternative if owning our own harness becomes intentional. Using an OpenAI or Anthropic model through Pi does not mean using the native Codex or Claude harness. Preserve Otto's lifecycle and grant rules whichever harness executes.

## Herdr

**Observed:** [Herdr](https://herdr.dev/docs/) manages terminal locations and coding-agent processes. Its [automation guide](https://herdr.dev/docs/agent-automation/) says prompt waits do not track individual turns, and a timeout does not prove that input was not sent. Its README distinguishes surviving a client disconnect from restoring supported sessions after a server or machine restart.

**Reviewed source:** `347f9c99bc95672e5ebcb26753648e85801d3c71` in the [repository](https://github.com/herdrdev/herdr).

**Check when:** giving operators a terminal control surface, keeping processes alive after SSH loss, or handling a prompt whose submission outcome is uncertain.

**Otto decision:** optional operations tool. A terminal pane is not the durable Run record, permanent agent identity, or computer isolation boundary.

## Buzz

**Observed:** Local source at `084250a` implements a Nostr-first relay, channel authorization, artifact heads and revisions, an ACP harness, and workflows. `crates/buzz-core/src/artifact.rs` treats artifact payloads as client-defined. `crates/buzz-acp/TASKS.md` documents task-mode session isolation but delegates deduplication and result persistence to the caller. `crates/buzz-backend-kubernetes/src/pod.rs` uses `emptyDir` for its workspace.

**Check when:** studying multiplayer delivery, channel access, CAS artifact updates, bounded ACP execution, or workflow waits. Start with the [repository](https://github.com/block/buzz), its product visions, and the relevant crate documentation.

**Otto decision:** selective reuse and implementation reference. Buzz's channel access and event protocol remain its product contract. Otto's internal relational domains are a separate product architecture; do not replace Buzz's contract in place.

## Craft Agents

**Observed:** [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss) combines reusable skills, MCP/API/local sources, session organization, multiple model connections, and a headless server with remote clients. Its README advertises Claude subscription OAuth and ChatGPT subscription OAuth. These are implementation claims, not independent verification or provider approval.

**Reviewed source:** `73bd9c2a3573158bea880984eb8d5fdb41e0cac2`, Apache-2.0. Read the pinned [README](https://github.com/craft-ai-agents/craft-agents-oss/blob/73bd9c2a3573158bea880984eb8d5fdb41e0cac2/README.md), [backend factory](https://github.com/craft-ai-agents/craft-agents-oss/blob/73bd9c2a3573158bea880984eb8d5fdb41e0cac2/packages/shared/src/agent/backend/factory.ts), and [Pi credential adapter](https://github.com/craft-ai-agents/craft-agents-oss/blob/73bd9c2a3573158bea880984eb8d5fdb41e0cac2/packages/pi-agent-server/src/adapt-credential.ts). The backends are Claude Agent SDK and Pi. ChatGPT OAuth routes through Pi's `openai-codex` model provider rather than native Codex CLI execution. Its standalone `craft-cli run` entry point is documented with API-key authentication; do not assume every entry point uses a subscription.

**Check when:** designing connection selection, skill discovery, source setup, session persistence, or a remote thin client. Trace the chosen backend, authentication mode, token storage, and tool boundary separately.

**Otto decision:** keep this as a product and implementation reference. Preserve Otto's flat tasks, human ownership, shared conversations, isolated computers, and subscription requirement. Reuse specific patterns after checking provider conditions. Another application's OAuth support does not authorize Otto to collect or intermediate subscription credentials.

## Huly / Platform-Collective

**Observed:** per its own README, [hcengineering/platform](https://github.com/hcengineering/platform) is frozen, pointing to [Platform-Collective/platform](https://github.com/Platform-Collective/platform) as the current, independent-fork development line. Huly is a broad all-in-one suite (PM, chat, docs, plus CRM/HR), not a lean coding-agent boilerplate. The fork's own [architecture overview](https://raw.githubusercontent.com/Platform-Collective/platform/develop/ARCHITECTURE_OVERVIEW.md) describes 30+ microservices, a transactor WebSocket plus separate account/workspace/collaborator services, and CRDT-based document editing. Its README targets Node 20 and Rush/`svelte-check` — a different toolchain from Otto's selected Bun/React/Vite/Hono stack. [hcengineering/huly-selfhost's `compose.yml`](https://github.com/hcengineering/huly-selfhost/blob/main/compose.yml) on `main` currently enables 14 services by default, including CockroachDB, Redpanda, Elasticsearch, and a MinIO-compatible storage image; Mongo/Redis are optional in that default compose (the file's own comments name more than one optional add-on, including a calendar service). A documented AI chatbot/translation add-on needs Mongo plus an OpenAI API key; it does not demonstrate ACP-based native subscription login, per-agent isolated computers, or an Otto-shaped Session/Run model — their absence is not independently verified either, since no runtime was exercised. The self-host README states a 2 vCPU/8 GB minimum and 4 vCPU/16 GB recommended footprint.

**Check when:** a future contributor asks whether to fork or adopt Huly/Platform-Collective as Otto's starting point.

**Otto assessment, not a selected foundation:** adopting it would gain existing chat/tasks/docs collaboration functionality already built, at the cost of accepting Huly's own all-in-one platform and operational footprint, or a substantial migration off it — not a lean Bun/Hono/Drizzle boilerplate. A reference and recommendation for future consideration, not a human-selected direction.

## Server-owned workspaces and Garage

**Observed:** Mastra's [sandboxes](https://mastra.ai/docs/sandbox/overview) and [filesystems](https://mastra.ai/docs/sandbox/filesystem) compose execution and working files through a Workspace. LocalSandbox runs on the application host by default; native isolation must be enabled or an isolated backend selected. Filesystem path checks do not contain shell commands. Persistence, computer capabilities, mounting, and recovery depend on the selected backend.

**Otto decision:** separate apps/web and apps/server. The server owns agent execution through the Environment and Run domains: assign the workspace, start the native agent inside isolation, attach ACP, persist progress, stop, and reconcile. Use the backend's existing execution transport. Do not add apps/runner or require an Otto daemon in each agent computer. Domain packages export their own browser-safe types and validation; no catch-all contracts package is needed. Mastra is a composition reference, not an adopted model runtime.

**Observed:** [Garage](https://garagehq.deuxfleurs.fr/) is self-contained S3-compatible storage with CLI and administration API management. Its [release list](https://garagehq.deuxfleurs.fr/_releases.html) includes v2.4.0 on 6 September 2026. Its [S3 compatibility guide](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/) documents object operations, multipart uploads, and presigned URLs, but no bucket versioning or AWS-style bucket policies. The [single-node quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/) warns about missing redundancy; example temporary directories are not a persistent production layout.

**Otto decision:** Garage holds artifact bytes in private buckets with persistent data and metadata volumes. Otto owns Artifact metadata, access, and revocable delivery. Each Artifact is one immutable saved output, with no revision history. No dashboard is required. Qualify write durability and restore before deployment. The one-host profile is non-redundant; use replicated Garage or an external S3 store when redundancy is required. Do not infer durability or high availability from the presence of a Docker image.

**Check when:** implementing workspace preparation, interactive native-agent I/O, process cleanup after server loss, artifact delivery, or self-hosted backups. Compare the exact selected backend and storage release against the proof in the plan. The server runtime's Bun compatibility remains unverified; native agents keep their own runtime dependencies.

## Evidence and limits

Official documentation and the listed repository files were read. The two source revisions were resolved from GitHub's repository API and their referenced files were fetched at those revisions. No referenced product was installed, benchmarked, or exercised as part of this pass.

The foundation research adds further pinned source inspections and an existing Codex CLI help check. It records those separately from integration proof. All newly inspected repository heads were resolved through GitHub's API. No ACP adapter or framework was launched.

Eve's docs were returned as Markdown and were read directly when the browsing renderer could not display them. Public documentation changes independently of source pins. Recheck the relevant page and implementation revision when using a pattern later.

These references complement [the plan](plan.md). Buzz's vision remains the contract for any changes made inside this checkout; the proposed Otto app is a separate product design.

## Conversations, Sessions, and web authentication

**Observed locally:** Buzz stores channels with a channel_type discriminator and participant membership separately. Its ACP harness selects provider sessions by channel scope by default; optional thread policy scopes channel work to individual threads while DMs remain conversation-scoped. The agent's session map is separate from shared channel messages. Sessions can share that agent's workspace while retaining independent model context. See schema/schema.sql, crates/buzz-acp/src/scope.rs, pool.rs, and session_model_thread.md in this checkout. This is source inspection, not exercised runtime evidence.

**Otto decision:** Conversation has no type field and stores shared discussion and membership rows. Session is a distinct runtime record for one agent's continuing harness context in one Conversation and environment scope. Run is one attempt; prompt Runs reference Session, script Runs do not require one. Do not merge provider history into public/shared content or reuse retained context after its access scope becomes invalid. The agent owns its Environment; starting another Session does not create another computer.

**Frontend and human login:** [shadcn's Vite guide](https://ui.shadcn.com/docs/installation/vite) documents React/TypeScript with the Tailwind Vite plugin and editable components. [Better Auth's Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) supports PostgreSQL. Mount authentication inside Otto's server and preserve domain authorization. Auth login accounts/sessions are separate from Otto Connections/Sessions. Record no claim of Bun compatibility or a working sign-in flow until exercised.

**Later clients:** Better Auth documents [Electron](https://better-auth.com/docs/integrations/electron) with system-browser authentication and controlled main/renderer bridges, and [Expo](https://better-auth.com/docs/integrations/expo) with native session storage and callback handling. Expo documents [react-native-webview](https://docs.expo.dev/versions/latest/sdk/webview/) for displaying web content. An Expo WebView does not automatically share the native auth client's session; cookie/session handoff needs a real proof. Electron and Expo remain outside the web MVP.

**Reuse decision:** BB's local packages/provider-bridge-acp/package.json depends on BB's domain and provider-bridge-protocol packages; packages/process-utils/package.json is narrower. Its docs/system-overview.md describes a server, enrolled host daemon, agent Threads, and shared Environments. Use these as source-inspected reuse candidates and recovery references, not evidence that a whole-app refactor or package extraction fits Otto unchanged.

## PostgreSQL jobs and durable workflows

**Check when:** implementing manual dispatch, dynamic cron, transaction-safe admission, duplicate delivery, or crash recovery.

**Observed:** [pg-boss](https://github.com/timgit/pg-boss/tree/8bbcf58153578b1bb7e5bed206d7603187de6af8) is a PostgreSQL-backed job library. Source snapshot `8bbcf58153578b1bb7e5bed206d7603187de6af8` reports version 12.35.1. Its [transaction adapters](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/api/adapters.md) include Drizzle; [cron scheduling](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/api/scheduling.md) supports timezones and skips missed ticks by default. [DBOS](https://docs.dbos.dev/architecture) is also embedded and uses PostgreSQL; it checkpoints workflow steps and recovers them on replay. Its [workflow rules](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) require deterministic orchestration and retry-safe operations.

**Otto decision:** pg-boss covers today's one-launch Automations with less workflow structure. Use the same server and database, atomically enqueue with Run admission, and retain native execution reconciliation independently. DBOS becomes worth reconsidering for demonstrated multi-step durability. Neither prevents duplicate external effects by itself. No library was installed or exercised; pin and prove the actual release before adoption.
