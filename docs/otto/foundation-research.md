# Otto foundation decision

Researched 30 September 2026; architecture revised 1 October 2026. Recommendation from documentation and source inspection. Runtime adoption remains subject to the proof below.

Argus passed the simplification, Bun/Vitest and schema-control clarifications, and stack comparison with no blockers (9/10 across all criteria). Remaining candidate choices are not adopted dependencies. This is a design verdict. Permitted provider integration, subscription authentication, sandbox lifecycle, storage durability, and runtime behavior remain unverified.

## Choose a small Otto app with an ACP server bridge

Build Otto's product domains in the planned TypeScript/Bun monorepo. Use **an ACP client in the server-used Runs domain**, connecting to established coding harnesses inside each agent's isolated computer. Prove the maintained Codex ACP adapter first with native ChatGPT subscription login. Evaluate Claude alongside it only after qualifying a permitted subscription path. A working SDK API-key integration does not meet the requirement. Keep PostgreSQL authoritative for Otto's records, accepted requests, automation occurrences, and Run outcomes. The server assigns a workspace and starts the native process through one existing sandbox backend. Garage holds durable artifact bytes. Web and server are separate apps; there is no separate Otto execution service.

This best fits the current brief: project management and shared documents around a capable coding agent, with simple relationships and little process. UI reuse has little weight in this decision. The main value to reuse is the coding harness. We do not need to reproduce its model loop, coding tools, context compaction, and session controls.

This is a recommendation for the first implementation, not a claim that a protocol supplies the entire product or that the adapters have passed Otto's workflow checks. **Multi-agent is required from day one.** Multiple agents run concurrently on separate computers, retain separate context, receive targeted controls, and exchange directed messages through one shared Conversation model. A second provider is recommended for the first proof so the bridge does not accidentally depend on one harness. Multiple agents and multiple providers are separate requirements.

T3 Code is the closest architectural reference: a server normalizes different coding harnesses. Otto should own that small bridge and its domain data. ACP supplies the first common transport underneath it. Users can choose a preset or configure their own compatible ACP executable inside an isolated agent computer. Runtime selection belongs in the existing Agent configuration, not a separate profile or plugin framework. Negotiate features and enforce the same Run, access, and subscription rules. Pi can participate through its ACP adapter rather than becoming a required Otto harness. We do not need to fork T3's complete application or wrap another supervisor agent around every coding request.

## What the candidates actually give us

| Candidate | Useful capability | Work or mismatch for Otto | Decision |
| --- | --- | --- | --- |
| ACP plus maintained harness adapters | Common session, prompt, update, permission, and cancellation protocol around Codex App Server and Claude Agent SDK | Provider capabilities and extensions differ. Otto still owns the durable ledger, identity, grants, and containment. | **First bridge integration** |
| Codex App Server directly | Native coding harness with structured turns, streaming, steering, interruption, and stored thread resume | A direct adapter means maintaining provider-specific protocol mapping. Protocol version changes require checks. | Native fallback behind the same bridge |
| Pi | Embeddable TypeScript coding harness, customizable resources and tools, persistent sessions, SDK and subprocess modes | This is Pi's own harness, not the native Codex or Claude harness. We still need supervision, authorization, isolation, and the durable Run ledger. | Best alternative for an Otto-owned harness across model providers |
| Mastra | TypeScript agents, controller, memory, tools, schedules, workflow recovery, and ACP delegation | Adds framework execution and memory concepts to reconcile with Otto. Durable-agent API is beta; recovery can replay tool effects. ACP does not contain the launched process. | Strong option if broader workflow execution becomes an actual requirement |
| Eve | Filesystem-authored agents, skills, connections, durable execution, schedules, and sandbox providers | Self-hosting works. It still adds Nitro, Workflow worlds, callback routing, and agent authoring/runtime concepts to integrate. Native Codex control is not established by this research. | Connection and sandbox reference; evaluate for a model-driven assistant product |
| T3 Code | Working control application for native coding harnesses, with provider adapters and durable command acceptance | A full application with its own orchestration state and event log. Extracting adapters requires tracing their dependencies. | Best implementation reference for our adapter |
| Craft Agents | Connections, skills, session organization, a headless server, Claude SDK and Pi backends | Its ChatGPT subscription path uses Pi rather than native Codex. Advertised OAuth support does not establish permission for Otto to intermediate provider credentials. | Product and connection reference; selective reuse |
| Herdr | Persistent terminal server and explicit controls for agent processes | Terminal lifecycle is not individual turn identity. Its docs warn that prompt waits can complete for an already-active turn and timeouts can follow submitted input. | Optional operator tool |
| Buzz | Shared human/agent conversations, relay authorization, artifacts, workflows, and ACP harness | Its Nostr-first, channel-scoped product contract differs from Otto's internal relational domains. Task payloads are opaque records, and the inspected Kubernetes workspace is temporary. | Reference and selective reuse |
| BB | Existing host execution, steerable threads, adapters, and environment lifecycle management | Otto needs its own multi-participant Conversation model and dedicated agent computers. Reusing the whole app would require reconciling its ownership and environment model. | Provisioning and execution reference |

These are integration judgments, not performance measurements. A larger repository is not evidence of bloat. The relevant cost is how many state, permission, and lifecycle boundaries we must reconcile.

## Evidence that affects the choice

**ACP adapters:** The current [Codex adapter](https://github.com/agentclientprotocol/codex-acp) starts Codex App Server and translates its requests and events. The older Zed adapter explicitly points new installs to this maintained project. The [Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp) uses the official Claude Agent SDK. Both inspected source revisions implement session loading and a steering extension. Source-head support is not proof that a selected released version supports every feature. Negotiate capabilities and pin compatible adapter, SDK, and harness versions.

**Protocol:** ACP specifies [session setup and optional history loading](https://agentclientprotocol.com/protocol/session-setup) plus [prompt completion and cancellation](https://agentclientprotocol.com/protocol/prompt-turn). Live steering is not established by the base v1 prompt contract; the inspected adapters advertise it through an extension. Otto must confirm that extension at initialization and test its semantics. Do not turn an unsupported steer into a silently queued request. Use a native fallback when necessary, with unsupported operations reported explicitly. ACP is communication, not a sandbox, durable job scheduler, or internal agent-to-agent messaging model.

**Codex:** The [official integration guide](https://developers.openai.com/codex/app-server/) documents `thread/start`, `thread/resume`, `thread/read`, `turn/start`, `turn/steer`, `turn/interrupt`, and structured completion events. It supports version-specific TypeScript schema generation. Use stdio internally. TCP WebSocket transport is explicitly experimental and unsupported. Dynamic tools are experimental too; the first integration should use configured MCP tools instead. The installed CLI, version 0.159.2, advertises app-server and its schema tooling but labels the command experimental. Pin a release and validate the supported methods; documentation alone is not a stability guarantee.

**Pi:** Its [SDK guide](https://github.com/earendil-works/pi/blob/955cc6665ee3986c6a033db52200779310d10dfd/packages/coding-agent/docs/sdk.md) exposes session creation, resource loaders, skills, tool selection, steering, abort, and persisted context. A settled run is distinct from a low-level agent end. Current Pi includes MCP extensions; SDK sessions must load them explicitly. Its [security policy](https://github.com/earendil-works/pi/blob/955cc6665ee3986c6a033db52200779310d10dfd/SECURITY.md) places containment with the caller. Pi session persistence does not supply an Otto occurrence ledger or prove exactly-once effects. It is the cleanest SDK option here when owning a separate harness is intentional.

**Mastra:** The [durable-agent guide](https://mastra.ai/docs/harness/durable-agents) marks the API beta. Default stream cache is in memory, crash recovery is off by default, and recovery can repeat tool calls. Configured storage and recovery can address much of this, but they do not remove uncertainty around external side effects. Its [ACP guide](https://mastra.ai/docs/connections/acp) explicitly says workspace-mediated file requests do not sandbox the process or its shell. Mastra is a credible framework, not automatic containment or exactly-once execution.

**Eve:** Its [self-hosting guide](https://github.com/vercel/eve/blob/d09e3819b1a1334fea8741c7c9fce5457ae66460/docs/guides/deployment/self-hosting.md) documents a Node service, persistent local workflow data, custom Workflow worlds, and Docker or microsandbox providers. It currently requires compatibility with the Workflow 5.0.0-beta line and routing both runtime and workflow callbacks. [Dynamic capabilities](https://github.com/vercel/eve/blob/d09e3819b1a1334fea8741c7c9fce5457ae66460/docs/guides/dynamic-capabilities.md) can resolve tools, skills, and connections at runtime, so agents are not restricted to completely static definitions. Its [sandbox guide](https://eve.dev/docs/sandbox) describes session-owned state; reusing one computer across different sessions requires an explicit custom provider. Eve's channels are transport integrations, not Otto's shared Conversation records.

**T3 Code:** Its [provider guide](https://github.com/pingdotgg/t3code/blob/35be904f2fc40aa6d7a42778b6895e8274f3097f/docs/internals/providers.md) puts native differences behind adapters. Its [architecture guide](https://github.com/pingdotgg/t3code/blob/35be904f2fc40aa6d7a42778b6895e8274f3097f/docs/internals/overview.md) distinguishes committed command acceptance from completed provider work. Borrow those boundaries. Do not assume its internal adapter code is a standalone supported SDK.

**Herdr:** Its [automation contract](https://herdr.dev/docs/agent-automation/) explicitly says it does not track individual turns. This makes it useful for terminals and human supervision, while Otto still needs structured provider correlation and durable accepted requests.

**Subscription requirement:** ACP does not choose billing. [Codex authentication](https://developers.openai.com/codex/auth/) distinguishes ChatGPT subscription login from API-key usage and documents device login for remote computers. The inspected Codex ACP adapter supports both modes. Otto must verify the selected account and subscription mode before launch, reject unexpected API authentication, and stop on limits or expired login without switching billing or accounts. Parallel agents share the relevant account limits; bounded account-level admission complements environment leases.

**Claude runtime:** The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) restricts third-party subscription login without approval. The [hosting and credential conditions](https://code.claude.com/docs/en/legal-and-compliance) separately allow end users to sign into an unmodified hosted Claude Code binary with their own subscription under the stated conditions. Hosting requires Commercial Terms, preserving native authentication options, and direct end-user authentication and billing. Otto must not collect or intermediate Claude subscription tokens. The inspected ACP adapter technically offers subscription login, but its SDK-based product path is not established as qualified by this research. A direct adapter does not automatically resolve this. Qualify the integration before adoption; Codex can support the initial multi-agent proof while this remains open.

**Craft Agents:** At the [reviewed source revision](https://github.com/craft-ai-agents/craft-agents-oss/tree/73bd9c2a3573158bea880984eb8d5fdb41e0cac2), the README describes skills, MCP/API/local sources, subscription connections, and remote server sessions. The [backend factory](https://github.com/craft-ai-agents/craft-agents-oss/blob/73bd9c2a3573158bea880984eb8d5fdb41e0cac2/packages/shared/src/agent/backend/factory.ts) selects Claude Agent SDK or Pi. The [Pi credential adapter](https://github.com/craft-ai-agents/craft-agents-oss/blob/73bd9c2a3573158bea880984eb8d5fdb41e0cac2/packages/pi-agent-server/src/adapt-credential.ts) explicitly handles ChatGPT's OAuth-only `openai-codex` provider. This uses Codex models through Pi, not the native Codex CLI harness. Borrow connection setup, skill discovery, and remote session boundaries. Do not infer provider approval from another app's OAuth implementation or adopt its credential handling blindly.

**Buzz:** The local vision makes signed Nostr events and channel membership central. The inspected artifact payload is client-defined, and `buzz-acp run --task` delegates retry and task-result persistence to its caller. The Kubernetes pod uses `emptyDir`. These are specific integration gaps, not a verdict that the whole project is poorly designed. See the [Buzz reference notes](references.md#buzz).

## Keep the flow simple

```text
Person or automation
        |
        v
Otto domain command -> authorize -> persist request + Run in PostgreSQL
        |
        v
Server runtime -> claim environment lease -> assign workspace -> launch in sandbox
        |
        +-- Prompt -> ACP bridge -> selected harness in agent's computer
        |
        +-- Script -> bounded process -> same agent's computer
        |
        v
Progress and outcome -> Run history
Selected shareable output -> Conversation
Saved files -> Artifact -> Library view
```

Connections remain an Otto domain. The agent computer calls an authenticated tool bridge. The trusted connection executor checks the current agent grant, human sponsor, selected account, and action policy, then resolves credentials and executes the operation. Check the audience before putting private results into shared conversation context or publishing output. Connections also record the model account, human association, selected authentication mode, and runtime reference. Native subscription credentials stay in provider-managed private storage when required; Otto does not turn Claude OAuth into a centrally stored credential. Authentication must be permitted and proven with each selected harness release. Do not hand unrestricted external write credentials to the shell.

The tool bridge may expose an internal MCP transport. It is not a second public CRUD API or a separate product model. Otto Sessions are distinct runtime records holding private harness context and a provider reference. Each binds one agent, Conversation, and environment scope; prompt Runs reference a Session, while scripts do not require one. Conversation owns participant memberships and selected shared messages without a type field. Recheck permission and retained-context scope before continuation; create fresh authorized context when reuse is no longer permitted. Sessions do not replace shared Conversation history or membership. One conversation can supervise several independent agent contexts. The server runtime must dispatch independent environments concurrently; one lease per environment must not become a global single-agent lock. Two people can observe and steer one agent without opening competing provider sessions.

Agents address peers through an Otto conversation command carrying sender, recipient, and a request correlation ID. The recipient gets its own Run and scoped context. Replies do not wake every participant; bound exchanges and require a directed request for automatic execution. User-created peer agents are not ACP's draft nested-subagent sessions. No hierarchical task model, mandatory supervisor, or orchestration graph is needed.

Manual and cron automations launch the same Run path. A script does not need an LLM or a Codex turn. pg-boss owns cron and job delivery in the existing PostgreSQL database; Run admission deduplicates its request identity. One environment lease allows one active run initially. Server loss must leave an interrupted or uncertain outcome that can be reconciled, not trigger a blind replay of external writes. Persisted model context supports continuation; it does not prove what happened during an interrupted operation.

## Server-owned workspace and execution

The server composes the agents, environments, sessions, runs, connections, and automations domains. Environment owns workspace assignment and compute lifecycle; Runs own attempt state, ACP/process controls, and recovery; Automations integrate pg-boss scheduling. The server invokes these functions directly and starts the native executable inside the selected sandbox through its existing input/output transport. There is no separate Otto runner application or required agent-side Otto daemon. A persistent working directory and a sandbox are different responsibilities: the directory holds files; the backend supplies the isolated execution boundary and process lifecycle.

[Mastra's sandbox documentation](https://mastra.ai/docs/sandbox/overview) separates execution from files and supports backend-specific process controls. Default LocalSandbox is unisolated; native isolation or an isolated backend is necessary. Its [filesystem documentation](https://mastra.ai/docs/sandbox/filesystem) distinguishes file-tool path containment from shell containment. Neither importing Workspace nor mounting S3 automatically contains a native coding process. Reuse the pattern or a specific component after proving interactive ACP input/output, persistent agent homes, separate browser and credential state, and targeted process-tree cleanup.

Persist a launch key and environment generation before dispatch, then the backend execution reference before reporting launch success. If launch acknowledgement is lost, find the execution by its launch key rather than starting a duplicate. If the backend cannot resolve that key, stop and confirm the environment's active processes before retrying; otherwise retain an uncertain outcome. A backend must enforce a bounded execution deadline after server loss. Server recovery reconciles or stops the old process before launching a replacement; a database lease alone cannot stop an old shell or external write. These controls belong in the server-used Run and Environment functions and backend adapter.

Garage is selected for saved artifact bytes, with PostgreSQL remaining authoritative for metadata and access. Keep working volumes separate from published artifact storage. Garage's [single-node guide](https://garagehq.deuxfleurs.fr/documentation/quick-start/) warns that an unreplicated setup is unsuitable for production redundancy requirements. Verify the chosen deployment's write durability and backup restore; use replicated Garage or an existing external S3 store when redundancy is required. This source-based choice is not a runtime certification.

## What we build and what we reuse

Start a fresh Otto monorepo and selectively reuse compatible libraries or code after checking dependencies. Refactoring BB would also require changing its thread ownership, shared-environment assumptions, and daemon transport to meet Otto's model. Its internal ACP package depends on BB domain and protocol packages; extraction is not presumed complete. Use thin, granular packages for projects, tasks, conversations, documents, artifacts, agents, environments, sessions, runs, connections, and automations. Keep Collections and skills with Documents because they reuse that content model. These packages compose inside one server and share PostgreSQL; they are not services. Their value is human ownership, flat task organization, shared context, controlled tools, documents, artifacts, and simple automation. Reuse coding harnesses, maintained ACP adapters, an existing isolated sandbox or computer backend, an established editor, provider SDKs, and durable file storage. Start with one bridge implementation, one environment backend, and one GitHub connection. Reuse pg-boss for durable jobs and cron rather than writing a scheduler. Keep current Document content, one output per Artifact, and inline Automation prompt/script bodies. Preserve exact Run inputs and public share selections without adding product revision histories.

The bridge needs launch, attach or read, steer, stop, approval response, and normalized events, with explicit capability checks. Keep provider session, turn, and item IDs behind it. Runtime-specific state is stored as an execution reference, not another user-facing object model. No universal plugin system is needed for the initial provider pair.

## PostgreSQL jobs: pg-boss before DBOS

**Recommendation:** use pg-boss as a server library for manual dispatch and cron, with the existing PostgreSQL database. Automation is one saved prompt/script launch; Run is its execution record. DBOS is a reasonable alternative when durable multi-step workflows or long waits become a demonstrated requirement.

| Choice | What it gives | Fit now |
| --- | --- | --- |
| pg-boss | PostgreSQL-backed jobs, cron, retries, and transactional enqueue | Directly covers one launch and schedule; no extra service |
| DBOS | Embedded PostgreSQL workflow checkpoints, durable queues and schedules, step recovery | Adds value for multi-step orchestration; replay and code-upgrade rules need deliberate handling |
| Custom queue/cron | Tables, polling, locking, and recovery written by us | More code to maintain than the library; avoid |

[DBOS architecture](https://docs.dbos.dev/architecture) requires no separate orchestration server. Single-node startup can recover incomplete workflows. Its replay requires deterministic step ordering and retry-safe steps; changing step sequences requires compatible code updates. Its [workflow cancellation](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) preempts at the next step, so an executing native process still needs explicit backend termination. These are useful guarantees for the right workflow, not a substitute for Otto's isolation and uncertain-operation rules.

**Reviewed pg-boss source:** `8bbcf58153578b1bb7e5bed206d7603187de6af8`, package version 12.35.1, a source snapshot rather than an adopted release. Its [Drizzle adapter](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/api/adapters.md) puts job creation in the application's transaction, including rollback. Its [scheduling guide](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/api/scheduling.md) describes named timezones, minute-level evaluation, and skipped missed ticks by default. Its [Bun driver documentation](https://github.com/timgit/pg-boss/blob/8bbcf58153578b1bb7e5bed206d7603187de6af8/docs/database-backends.md#bun-driver) describes Bun.SQL integration; Otto selects Bun for its own runtime and still needs a selected-release compatibility proof. Vitest remains mandatory, with Bun-forced execution; the small local worker/API smoke is recorded in the stack options.

Save Run inputs and dispatch job atomically. A cron job admits one Run using its stable identity and current Automation configuration token. Dispatch jobs carry only the Run ID; redelivery launches or reconciles the same execution. Acknowledge only after saving the backend execution reference. On startup also reconcile nonterminal Runs whose dispatch jobs already completed. Queue retry/expiry is not permission to repeat an external write. Verify selected-release schedule/job transaction support; where not atomic, retain durable schedule reconciliation and reject stale tokens. No ACP event-stream checkpoint workflow, Redis, worker app, or custom command bus is required.

## Proof before adoption

Start with the small server execution proof in the plan: two concurrent subscription-backed Codex agents on separate computers. Add a second ACP implementation or a controlled fixture to falsify provider-specific assumptions in configuration, routing, and capability handling. Fixtures do not prove billing or real-agent compatibility. Supported launch agents need the full control and recovery proof; custom agents advertise any reduced feature set explicitly.

Implement and exercise one slice before treating the recommendation as an adopted dependency:

1. Establish permitted subscription use for the selected releases, verify the native account and mode, and exercise manual and cron prompts. Check unexpected API authentication, expiry, and quota exhaustion: no billing or account fallback is allowed. Then start two independent agents concurrently, preferably one Codex and one qualified Claude, with two people in one conversation. Edit files, run a test, stream progress, steer one agent, and stop it during a tool call while the other continues. Exchange one directed request and reply without extra wakeups. Confirm provider identity, authorship, context separation, and completion semantics.
2. Disconnect the UI and restart the server. Recover accepted requests and stored context without claiming an interrupted tool succeeded or issuing a duplicate external write. Persist and reconcile provider correlation across a lost launch response.
3. Supply saved skill inputs and an MCP tool through the adapter. Enforce revoked grants, account identity, model authentication, output audience, and a shell that cannot bypass protected external writes. Prove process cleanup and per-agent computer isolation. Kill the server while a shell is running; verify the backend-enforced deadline and reconciliation prevent concurrent replacement execution.
4. Run manual and cron prompts, then scripts without model calls. Deliver a schedule occurrence twice, overlap requests, and replace compute. Files and saved artifacts must follow the plan's persistence rules. Restore PostgreSQL and Garage together and read the saved artifact bytes.

If an ACP adapter cannot satisfy subscription authentication or expose a required control or authorization boundary on its pinned release, evaluate a direct native adapter behind the same bridge. Do not defer required multi-agent behavior. Evaluate Pi if we deliberately decide to own a different harness across model providers. If durable multi-step orchestration becomes essential, reopen Mastra or Eve against that concrete requirement. These are decision triggers, not additional launch dependencies.

## Source record and limits

| Project | Reviewed revision | License record inspected |
| --- | --- | --- |
| Codex | `60947e234156ac12bdb7fba2477d3965f166bd34` | Apache-2.0 |
| Codex ACP adapter | `ba7b21636190a95626631c9a9226298d41d19325` | Apache-2.0 in LICENSE |
| Claude ACP adapter | `bdb50ad984336e62dde1d41339f04071f6617085` | Apache-2.0; underlying SDK has separate terms |
| Pi | `955cc6665ee3986c6a033db52200779310d10dfd` | MIT |
| Mastra | `af7e837cf6274f98c35c1dcda345188df8891932` | Core Apache-2.0; enterprise and other component exceptions need separate checks |
| Eve | `d09e3819b1a1334fea8741c7c9fce5457ae66460` | Apache-2.0 |
| T3 Code | `35be904f2fc40aa6d7a42778b6895e8274f3097f` | MIT |
| Craft Agents | `73bd9c2a3573158bea880984eb8d5fdb41e0cac2` | Apache-2.0; provider and SDK terms remain separate |
| Herdr | `347f9c99bc95672e5ebcb26753648e85801d3c71` | Apache-2.0 |

Repository heads were resolved through GitHub's API and selected files fetched at those revisions. The local Buzz source was inspected at `084250a`; BB's previously reviewed revision is recorded in the reference guide. A source pin is an evidence snapshot, not the release we have selected to install. Public docs can change independently.

No candidate was installed or benchmarked for this research. The existing Codex CLI help was exercised; no new model run, framework integration, isolation backend, automation, connection, or sharing flow was tested. The proof above remains required. Repository license records are evidence for package selection, not a conclusion about every dependency's terms.

The base product contract remains [the plan](plan.md). [The references](references.md) provide entry points for implementation questions.

## Web first and human authentication

The web MVP uses React, TypeScript, Vite, Tailwind CSS v4, and shadcn/ui. Better Auth runs inside apps/server with its PostgreSQL Drizzle adapter. Otto still enforces workspace/project membership, Conversation access, and agent grants; human login does not authenticate native model subscriptions or replace Connections. Better Auth login sessions and Otto Sessions have different schemas and purposes. Electron and Expo WebView clients are later objectives, with separate authentication, deep-link, and session-handoff proof. These selections are not implemented or runtime-qualified. See the primary references in the plan and reference guide.
