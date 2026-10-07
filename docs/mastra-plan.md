# Lean Mastra pre-MVP

Canonical migration plan, 7 October 2026. This supersedes runtime recommendations in
`harness-plan.md`, `pi-only-plan.md` and `final-plan.md`, not their verified domain work.
Pi remains the working default until the replacement slice passes. No push or deployment
is authorized. Preserve `LICENSE`, `NOTICE`, `UPSTREAM.md` and applicable upstream notices.

## Product and scope

Otto combines conversations, direct-edit documents, work views and shared files for N
humans working with N named agents. Coding and nontechnical projects use the same domain
functions. Chats initiate and steer work; existing useful views show and edit its results.
This is not a request to install integrations or reproduce Capy, Notion, Slack or Drive.

The MVP is API-key-only, explicitly approved after the provider precheck. Subscription
login parity no longer gates migration. Keep existing connection records and credentials
untouched. Do not silently convert an OAuth or CLI connection into an API-key connection.
When the default runtime cuts over, remove exposed subscription setup/success paths and
clearly report that old subscription records cannot run in MVP. No proxy dependency.
Public sharing of chats, documents and other artifacts is later, opt-in work. Preserve
current privacy; future public access must not follow implicitly from workspace access.

## What exists and stays

| Reachable view/action | Boundary and authority |
| --- | --- |
| Sign-in, owner setup, invitations, workspace selection | `users`, `workspaces` and Better Auth; HTTP handler and WS handshake supply identity. |
| Chat create/send/stop/approval/members | `handlers/rpc/sessions.ts` and `session-guard.ts` enforce chat membership; `SessionManager` persists user input before ack, routes mentions and serializes named-agent turns. |
| Tasks, projects, timesheets | Existing task/project RPC handlers call their domain functions, with authenticated workspace and actor. |
| Library documents, files, folders, direct editing | Library domain owns metadata and disk/S3 bytes; do not replace it with runtime filesystem storage. |
| Comments, notifications, home work views | Existing domains and recipient/member-scoped RPC reads. |
| Agents, skills, sources, connections, members | Existing settings and domain functions; connection credentials remain encrypted server-side in `secrets`. |
| Routines and webhooks | Existing routine domain and creator/caller identity rules; migrate execution after interactive chat. |

Source map: `apps/electron/src/renderer/router/route-tree.ts`,
`components/app-shell/main-content-panel.tsx`, `apps/webui/src/app.tsx`,
`packages/server-core/src/handlers/rpc/index.ts`, `sessions/session-manager.ts` and
`packages/shared/src/db/push.ts`. The renderer is shared with WebUI. There is already
multiplayer routing, a per-agent cursor, chat membership and a four-run computer cap.
An old unchecked roadmap entry is not evidence that its UI or domain is missing.

## Runtime and storage decisions

Keep the Bun HTTP/WS server, auth guards, Drizzle domains and one existing SQLite domain
database. Start with native `Agent.stream()` inside that server, without Mastra's generated
HTTP server, SDK-agent wrapper, gateway registry, vector database or extra memory service.
Otto owns identity, membership, creator-scoped connection lookup and transport delivery.
Mastra owns each model/tool loop. Do not let Pi and Mastra own the same execution.

The first text-only slice replays persisted Otto messages and disables Mastra memory.
It adds no second conversation store and no new persistent schema. Select it only through
a temporary server-side migration switch on disposable data. It is deliberately not the
default and cannot claim tool, skill, source, attachment or compaction parity. Existing
guarded RPC actions and named-agent routing are reused, not implemented again.
The slice is enabled only with `OTTO_MASTRA_CHAT=1`; use disposable config data.
It checks that the creator still belongs to the workspace and chat and that the selected
agent belongs to both before reading that creator's exact scoped key. The requesting
human must pass the existing chat RPC guard. Being a conversation creator is not a
universal account authorization. Shared-chat members using the creator's plan remains
the existing product policy, not permission to borrow another chat or person's key.
OpenAI requests set `store:false`; persisted Otto history is replayed explicitly.

For later session/approval/delegation proof, evaluate native `AgentController`/`Session`
before adding custom queues. Its live session state is not a durable checkpoint.
`createDurableAgent` is beta: running checkpoint/recovery and persistent event cache must
be configured explicitly; replay can repeat model and tool calls. Use a single recovery
owner and domain idempotency for effects. Do not promise exactly-once execution.

Published contracts checked from npm on 7 October: `@mastra/core` **1.75.0**,
`@mastra/memory` **1.36.0**, `@mastra/libsql` **1.25.1**, `@ai-sdk/openai` **4.0.87**.
Core accepts AI SDK V2/V3/V4 model instances and Zod 3.25/4 schemas. Its declared engine
is Node >=22.13; Bun support must be proved by executable imports/streams/tools, not
inferred from Bun install examples. `AgentController` is the current export;
`@mastra/core/harness` is a deprecated compatibility export in the actual tarball.
LibSQL is a separate SQLite-compatible driver, not `bun:sqlite` or existing Drizzle
storage. Do not install it in the first slice. If durable snapshots require it later,
prove storage ownership and schema compatibility first. Custom `MemoryStorage` is a
large abstract contract, not a reason to build a repository framework.

## Sources and adoption

| User source | Decision |
| --- | --- |
| [Code mode](https://mastra.ai/docs/agents/code-mode) | Defer. No demonstrated need for a second model-authored execution engine. |
| [Skills](https://mastra.ai/docs/skills) | Reuse existing skill domains; adopt native per-request skill loading when tool execution migrates. |
| [Sandboxes](https://mastra.ai/docs/sandbox/overview) | Reuse existing computers for now. Evaluate native workspace against actual computer/isolation needs before replacement; LocalSandbox is not a security boundary. |
| [Browser](https://mastra.ai/docs/browser) | Reuse existing browser/computer behavior; no new provider or image dependency. |
| [Connections](https://mastra.ai/docs/connections/overview) | Reuse Otto connections and source ownership; defer A2A/ACP/optional integrations. |
| [Storage](https://mastra.ai/docs/storage) | Keep Drizzle and existing history authoritative in slice 1; defer runtime snapshot store until durable proof. |
| [Server](https://mastra.ai/docs/server/overview) | Reuse Bun HTTP/WS. Call SDK directly; no second server. |
| [Custom gateways](https://mastra.ai/models/gateways/custom-gateways) | Defer. One standard request-scoped provider instance needs no gateway. |
| [SDK agents](https://mastra.ai/docs/connections/sdk-agents) | Defer. Vendor wrappers retain their own loop; native Mastra is the target. |
| [SDK subagents blog](https://mastra.ai/blog/introducing-sdk-subagents) | Defer. The OpenAI example wraps `@openai/agents`, not the Codex SDK or subscription endpoint. |
| [Controller/sessions](https://mastra.ai/docs/harness/overview) | Evaluate native controller for steering/approval/delegation in slice 2, without overlapping host queues. |
| [Durable agents](https://mastra.ai/docs/harness/durable-agents) | Evaluate configurable beta checkpoints/replay in slice 3, with deduplicated effects. |

## Provider precheck, now deferred for MVP

OpenAI's [OSS/local SIWC overview](https://developers.openai.com/siwc/token-sharing-open-source)
says: "These docs explain ChatGPT plan usage for open-source and locally hosted apps."
Paid/remotely hosted apps are directed to an interest form. It explicitly includes personal
self-hosted VMs. That does not classify every Otto deployment as hosted SaaS.
Its [registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
requires issued client IDs, stable host ID, validated ID tokens and granted plan scopes.
[Inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
says: "do not point it at ChatGPT's `backend-api` endpoints."
[Preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
require streaming, `store:false`, full local history, restricted fields and namespaced tools.
Current Otto uses a fixed Codex client in `shared/src/auth/chatgpt-oauth-config.ts`, device
flow in `auth/chatgpt-oauth.ts`, and Pi 0.87.1's `openai-codex` backend-api provider. That
transport is not the Codex runtime. No current login was invalidated or declared unlawful;
the documented SIWC contract is different and has not been implemented or live-tested.

Anthropic's [SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) says:
"Unless previously approved, Anthropic does not allow third party developers to offer
claude.ai login or rate limits for their products, including agents built on the Claude
Agent SDK." Its [legal page](https://code.claude.com/docs/en/legal-and-compliance) separately
permits platforms to host the unmodified Claude Code binary when each end user personally
authenticates and usage is not resold/intermediated. That is not a blanket hosted ban.
Otto's `pi-agent-server/src/claude-code-provider.ts` disables Claude tools, uses `dontAsk`,
exposes Pi tools through MCP and reconstructs CLI journal files. This exact SDK-backed
provider shim is not proved covered by the hosting allowance. CLI status only checks
`claude --version`, not live authentication. Existing fake-CLI tests prove mechanics only.
`@mastra/claude` and a custom gateway do not grant provider permission.

Stop investigating these routes for MVP. API-key-only is now authorized. Start with
OpenAI Responses and a key supplied through the existing personal connection setup.
Never use subscription OAuth as an API-key fallback. No real key or login was inspected.

## Ordered slices and acceptance

1. **Precheck and text chat.** Pin core and one standard provider. Prove native stream,
   tool contracts and cancellation under Bun with controlled fixtures. Run an opt-in,
   text-only Mastra chat through existing membership guards, named-agent routing,
   event delivery and persisted history. Reconnect and restart must reproduce completed
   messages. Browse the rendered chat. Live model success requires a real key and is
   reported separately. Pi stays the default until this passes.
2. **Existing work tools and control.** Native approvals, steering and bounded delegation
   using existing domain tools. Two humans and two named agents must attribute messages,
   refuse non-members, preserve creator-scoped keys, authorize stop/approval, isolate
   writes and return one delegation result. Include a non-code brief saved in Library,
   linked to a task and directly edited in its document view. No new integration.
3. **Recovery.** Reconnect stream cursor, restart suspended approval and running task,
   explicitly configured checkpoints/event cache, one recovery owner. Replay the same
   effect key and prove one domain side effect. Abort stops cooperative work but cannot
   undo completed effects. Test a crash around the external-effect boundary.
4. **Cutover and deletion.** Default to the proven native runtime, remove temporary
   selection and obsolete Pi loop/process/state/handlers/tests/dependencies together.
   Remove exposed subscription success/setup paths without deleting private records.
   Change only AGENTS.md's Pi-only rule when actual default ownership cuts over. Run
   focused typechecks/tests and inspect all affected existing UI flows before release.

Baseline gaps to address before claiming full isolation/control: the current Docker
computer runs all chats as one Unix user; chat folders alone do not isolate private
writes. Aborting `docker exec` may leave its inner command running. Chat members can
answer ordinary approvals; credential-response ownership needs a bounded audit. WS
membership is rechecked, but session revocation after handshake needs verification.
These are explicit acceptance gaps, not authorization to rebuild every domain.

## Pre-edit baseline

At `cebe004e3661581f2b93a3cbbf59e741af2c792c`, `bun install --frozen-lockfile` passed.
Serial per-file Bun checks passed **92 tests, 0 failures** across adapt-credential,
claude-code-provider, model-resolution, multiplayer, private-chats, pi-session-durability,
sendmessage-durability, sendmessage-oauth-refresh and run-tokens. A combined-file run
had four missing-ENCRYPTION_KEY failures; each unchanged file passes independently,
so this is cross-file fixture environment contamination, not live-login failure.
`NODE_OPTIONS=--max-old-space-size=2300 bun run typecheck:shared`,
`bun run --cwd packages/server-core typecheck` and
`bun run --cwd packages/pi-agent-server typecheck` passed serially with that memory cap.
Initial concurrent build/check runs timed out under memory pressure and prove nothing.
The requested preview was cancelled before a server started or a port was exposed.

## First slice verification

`OTTO_MASTRA_CHAT=1` now selects a native, OpenAI API-key text stream within the existing
SessionManager. Pi remains the default. No subscription setup or credentials changed.
The controlled native model tests verify streaming, usage, schema-validated tools,
continuation, failed-output discard and abort. The disposable HTTP integration verifies
the actual OpenAI provider request, `store:false`, authenticated chat guard, shared-chat
member request attribution, exact creator-scoped key despite a same-named second user's
connection, creator/agent membership checks, pre-inference cancellation, persisted ack
and assistant rows, and explicit history replay after a reconstructed SessionManager.
These are fixtures, not real provider success or durable checkpoint recovery.

Serial final checks passed 104 tests across the native proof, isolated session integration,
multiplayer, private-chats, sendmessage-durability, pi-session-durability,
sendmessage-oauth-refresh, session-guard and Claude bridge fixture files. Shared,
server-core and server typechecks passed with a 2300 MB Node heap cap. Pi's existing
subprocess build passed. Frozen Bun install passed after refreshing the added provider
dependency lock. `git diff --check` passed.

Browser inspection used a loopback-only disposable install and Vite. The real sign-in,
existing composer, authenticated WebSocket send, named Scout response and completed
message reload rendered correctly. The response explicitly identified itself as a
controlled fixture. No console errors on reload. Both owned processes were stopped;
no public preview was exposed. Production `webui:build` failed with Node heap exhaustion
at 2300 MB on this machine, so production bundling remains unverified. Do not infer a
browser build success from Vite inspection. The existing startup token print was removed
after local inspection revealed it; no server credential belongs in boot logs.

Next live requirement is one OpenAI API key in the existing personal connection under
Settings → AI, with an account-supported model. Keep it encrypted in the existing
connections/secrets path; never paste it in chat. The first slice still lacks work tools,
approval/steering parity, attachments, compaction and mid-run recovery. Subsequent work
can proceed with fixtures while live verification waits for that connection.
