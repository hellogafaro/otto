# Lean Mastra pre-MVP

Canonical migration plan, 7 October 2026. This supersedes runtime recommendations in
`harness-plan.md`, `pi-only-plan.md` and `final-plan.md`, not their verified domain work.
Pi remains the working default until the replacement slice passes. No push or deployment
is authorized. Preserve `LICENSE`, `NOTICE`, `UPSTREAM.md` and applicable upstream notices.
The follow-up owner instruction now requires native Mastra as the final default and
complete Pi retirement, including its packages, bridges, subprocess/build plumbing,
labels and obsolete controls. The current opt-in checkpoint is temporary proof, not
the final architecture. Do not keep a permanent dual runtime or flag.

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
Owner now approves clean official Mastra schemas in the same physical `otto.db`.
The earlier separate-file proposal is rejected. Use exact vendor ownership protections
and official narrow domain composition, not a fork. Common app UUID alignment is an
current authorized cutover goal; use direct `crypto.randomUUID`, remove NanoID and ID
utilities, update concrete validators/references and test old-ID conversion on disposable
data. Real persisted-ID conversion still requires a reviewed backup/procedure and approval.
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

## UI capability map and retirement inventory

| Existing UI capability | Native mapping and current state |
| --- | --- |
| Chat stream, author, history, usage | `Agent.stream`, fullStream → current events, existing rows replayed. Verified fixtures/browser for completed messages; live inference unverified. Final storage must have one runtime-history authority. |
| Work tools/results/errors | Six native tools call Library/task/project domain functions. Document/task work verified in the scoped second slice; tool events map to existing cards. Files/shell disabled until isolation proof. |
| Permission modes and approvals | Native Session permission/approval gate bridges existing UI; old Promise gate removed for native turns. Explore/Ask/Guarded/Execute remain explicit. Approval restart is not yet durable. |
| Steering, queue, Stop | Same-agent follow-ups use native tracked `Session.followUp`; Stop cancels prepared and queued native input and releases approvals. Other-agent routing remains host admission only. Abort-then-send steering is not claimed uninterrupted. |
| Delegation and named-agent routing | Existing mention routing serializes named agents. Native constrained delegation/result proof is later in migration, not implemented by this work-tool slice. |
| Skills | Native per-request inline skills resolve from authorized workspace rows and the selected agent ID/slug allowlist. Core supplies `skill`, `skill_search`, `skill_read`; only instruction bodies are included, not scripts/references or host instructions. Progressive activation is fixture verified; live behavior is unverified. |
| MCP sources, discovery, invocation and auth | Authorized remote MCP discovery/invocation uses existing source creds/pool and native schema tools with execution access checks. Bearer stays server-side; missing auth is explicit. API/local connector replacement remains required before retirement. |
| Model and connection settings | One supported OpenAI API-key provider reads exact existing connection scope. Catalog/testing/settings remain Pi-dependent and must migrate before deletion. Subscription setup/success UI must disappear at API-key-only cutover; private records remain untouched. |
| Computer/browser/files | Existing views remain, execution not granted by this slice. Per-task isolation, permissions, stop and visible browser behavior need native replacement/proof before enabling. |
| Routines and webhook runs | Existing trigger domain stays; native prompt routine fixture preserves creator key/agent attribution. Unattended Ask denies instead of hanging. API/local/routine script parity remains unverified. |
| Branch, compact, retry, plan controls | Pi-specific branch anchors/compaction cannot be called native support. Replace with supported Mastra behavior or remove exposed obsolete controls, locales and handlers before default cutover. |

Delete only after replacement checks: `packages/pi-agent-server`, shared `agent/pi-agent.ts`
and `backend/pi`, Pi factory/type assumptions and journals/anchors, `@earendil-works/pi-*`
dependencies/imports/model/OAuth registries, Claude provider bridge, Pi subprocess protocol,
build scripts/package commands/interceptors used only there, Pi-specific IPC/actions/UI
labels/config/tests/docs and temporary `OTTO_MASTRA_CHAT`. Keep useful domain tools,
permission components, source/skill/credential ownership and original license notices.
Search each deletion for remaining consumers; do not leave dormant handlers or locales.

## Supported adapter evaluation

Preferred official candidate is `@mastra/libsql@1.25.1`, a local file adapter using
`@libsql/client`, not a DB service. Its shipped schemas use `mastra_messages`,
`mastra_threads`, `mastra_harness_sessions` and workflow tables with camelCase fields
such as `createdAt`, `resourceId`, `ownerId`, mixed with fields such as `thread_id`.
Some library-owned records generate UUIDs internally; the configured Mastra ID generator
can cover run/message IDs but is not a blanket override for every adapter record.
These conflict with AGENTS' all-row `createId`, snake_case, workspace_id and domain-schema
rules. No exception has been silently applied.

Without exact ownership protection, `db/push.ts` would consider vendor tables unmanaged
drop candidates. Approved solution is the same physical `otto.db`, with the seven pinned
runtime tables excluded by exact name from Drizzle's introspection, not a prefix.
The official adapter owns those schemas/IDs. Drizzle keeps users/members,
agents, connections/secrets, tasks/projects/Library/routines; Mastra owns runtime sessions,
checkpoints and conversation memory/history. Do not keep another independent copy of
agent history or build a synchronization system. Existing human/chat facts and UI reads
need an explicit compatibility/import plan before choosing exact ownership or deletion.
Adapter tests use new disposable files only, never the user's database or `--force`.
Owner approved the narrow exception on 8 October. Same-file disposable probes show
official Memory/Workflows/Harness/ThreadState composition uses 7 tables/10 indexes;
full store init uses 44/87. Exact ownership exclusion preserves forced app push while
unrelated data loss still refuses. Native-flag boot now runs app push then official
domain initialization and verifies WAL/FULL/5000ms on the LibSQL connection before
traffic; shutdown closes it. Extra unapproved vendor tables fail before initialization.
The current chat slice still reads its existing app history only; the native memory
store is not mirrored into it. Conversation-authority conversion/import is the next
functional cutover, not claimed by storage initialization alone.

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

The scoped work follow-up exposes only Library documents and tasks in existing projects.
Created documents/tasks record the selected agent actor; task updates write existing
activity events under that actor. Document edits retain the existing creator and guarded
updatedAt contract, with the editing agent's call recorded in chat tool history. There is
no new document audit schema. Tools accept no model-supplied workspace, human or agent
identity. Workspace/chat access is rechecked before calls and after approval.

Production-build diagnostic `vite build --minify false --sourcemap false` transformed
5,819 modules and reached chunk rendering before the machine restarted under memory
pressure. Thus disabling minification did not avoid the capacity failure. Do not retry
bundling on this 4 GB machine or treat diagnostic output as a production pass.
Serial per-file checks remain required: combined Bun suites can contaminate global
ENCRYPTION_KEY/module-store fixtures, as documented in the initial baseline.

## Reviewed Pro checkpoint

Implementation moved to an isolated Pro worktree at
`/Users/jg/.capy/worktrees/jam_01M4BZMD6M2Y9EEVA8SX8BXFS1/otto`; personal checkout,
`~/.otto` and login material are untouched. Dependencies were recreated with frozen
Bun install. Native proof executes on Bun 1.3.3/Node 24.18.0 here.

Independent Sol 6.1 High review found and then rechecked four P2 fixes: stale run catch
cannot discard a newer generation; completed/error work outcomes replay chronologically
from existing rows after failure/Stop; commentary is stored/emitted before tools and
separated from final text; result-only rows safely serialize absent tool input as `{}`.
No required finding remains within that bounded review. This is not a full runtime
migration/security certification or live provider check.

Final native stream proof passes 6 tests/18 assertions, scoped session proof 1/17,
work/reconstruction/Stop proof 1/48; unchanged routing 22 tests and RPC guards 48 tests
also pass serially. Server-core typecheck and diff check pass. Replay uses bounded
attributed historical outcome summaries, not a second message store or effect guarantee.
The delayed-abort test simulates generation ownership change, and reconstruction uses
loaded stored messages rather than full server boot recovery.

Production `NODE_OPTIONS=--max-old-space-size=8192 bun run webui:build` passed on the
24 GB Pro in 20 seconds with unchanged config, including minification and sourcemaps.
Large-chunk warnings remain, but the cloud memory-capacity build gate is resolved.
Earlier text/browser proof remains valid; the work-tool production-browser proof on Pro
is separately blocked by thread-specific desktop permission. A request card already
exists for OTTO-75 to control applications on Pro. Browser automation has no attached
Chrome runtime on this device. Do not duplicate the request or restart inspection until
granted. The disposable loopback fixture server was stopped with confirmed cancellation.

## Capability-conditioned context checkpoint

The native run no longer reuses Pi's computer/source-oriented turn prompt. A small
`mastra-context.ts` assembles existing workspace then selected-agent instructions with
general coding/nontechnical work rules and the actual Library/task capabilities.
Explore advertises reads only and omits mutation tools; other modes retain per-call
approval. It advertises no shell, arbitrary files, browser, MCP or native delegation.
User-authored instructions and skills are context, never authority to grant tools.

Skills use Mastra 1.75.0's actual `skills` resolver and inline `createSkill`, not a custom
activation engine. The resolver checks run access and filters existing workspace rows
by the current agent's IDs or slugs before returning instruction bodies. An empty list
means all skills in that workspace, matching existing domain behavior. No other user's
workspace, host-home context, scripts, bundle references, storage or queue was added.
Missing materialized skill bodies are not advertised. Existing workspace then agent/run
instruction precedence stays; no project/global instruction layer was invented.

The fixture proves selected-ID allowlisting, workspace/agent instruction scope,
progressive native activation, exclusion of private text, changed selection and access
removal. The work HTTP fixture proves Explore sends reads but no mutations. Prior
reviewed ownership/outcome/step regressions still pass serially.

Pro desktop permission subsequently arrived for OTTO-75 and its subagents. No action
ran as a consequence of the grant; work-tool visual proof still needs a new disposable
loopback fixture. Vendor-schema permission and real-key inference remain separate gates.

The work-tool visual proof subsequently passed on Pro using the production-built
renderer and disposable loopback data: populated per-call approvals, Library brief and
linked task, Scout creator/activity, task link opens the document, direct human edit
survives reload. Responses explicitly label controlled fixtures, not live inference.
The owned server was stopped. Transient approvals set `canRemember:false`, so no fake
session grant appears in the existing permission UI.

Independent review found stricter native metadata could otherwise block inference on
an Otto-valid skill. Native validation now excludes only incompatible selected skills
and sends chat-scoped warnings naming each; stored names/domain rules are unchanged.
Access failures still throw, not get swallowed as metadata warnings. Tests cover
consecutive/trailing hyphens and a 1,025-character description alongside usable skills.
Final read-only re-review has no required finding. Context 1 test/24 assertions,
work 1/67, session 1/17, stream 6/18 and server-core typecheck pass serially. No host
context, paid inference, storage exception or further runtime rollout was introduced.

## Native OpenAI account checkpoint

Under the native flag, OpenAI catalog setup/refresh uses account `/models`, not Pi's
bundled catalog. Model IDs are bare; old `pi/` IDs normalize on native request and
explicit refresh. Model-list access does not prove inference support or token/context
capabilities; validation waits for a completed native Responses call. Provider error
bodies and credentials are never echoed, and discovery refuses redirects. New scoped
setup cannot borrow an install key. Flag-off Pi paths/catalog stay unchanged until
default cutover, including the legacy renderer fallback needed by unmigrated consumers.

Settings marks preserved subscriptions/other providers unavailable in the native slice,
hides reconnect/default actions, and offers OpenAI/API key setup only. Stored account
records are not converted. The old provider-discovery IPC name is temporary compatibility
plumbing to delete with Pi retirement, not a new registry. Independent review corrected
new-scope key fallback and native behavior leaking into the default Pi path. Account
candidate discovery, completed validation, safe errors and scopes are fixture verified;
real account inference remains unverified.

## Same-file official storage checkpoint

Pinned official core/libsql/client versions are 1.75.0/1.25.1/0.18.0. The supported
composite uses Memory, Workflows, Harness and ThreadState domains only. The exact set
and attached indexes are protected from normal and forced app schema push; unrelated
unknown tables still trigger data-loss refusal. Test both boot orders, repeated init,
vendor/domain data preservation and unknown vendor rejection on disposable files.
No prefix-wide ignore, adapter fork or second database is used.
Independent review caught pooled connection pragmas not covering all handles. The
runtime client is now deliberately single-handle, domains initialize sequentially,
composite auto-init is disabled, then final pragmas are verified. Pinned client rejects
an operation overlapping a retained transaction with `TRANSACTION_ACTIVE` instead of
opening an unconfigured handle. Fixture verifies that behavior and concurrent native
memory writes; multi-run retained-transaction compatibility remains a gate before
runtime-memory ownership cutover. Final storage re-review has no required finding.

Core's default ID generator is `crypto.randomUUID`, while official storage also has
composite/internal keys. App-wide UUID conversion is now current authorized work,
not deferred. The next slice removes `@otto/shared/id` and NanoID after direct call sites,
untrusted-boundary validators, mentions, Library keys/paths and disposable old-ID
reference mapping are verified. Existing user data is not automatically rekeyed at boot.

UUID implementation now calls the platform directly across app domains and removes
NanoID, `@otto/shared/id`, and message/workspace wrappers. Untrusted typed references,
mentions, avatars and Library file keys understand UUID v4; temporary short-ID reads
preserve unconverted records. `docs/uuid-conversion.md` defines the bounded offline-copy
procedure, with explicit reference/cipher mapping and hard refusal for remote/outside
roots or populated vendor state. No real install was converted. Common generation is
implemented; live persisted-data migration remains an explicit execution step.

## Canonical native transcript checkpoint

New native-flag chats now have one transcript/tool-history in official `mastra_messages`,
scoped by workspace resource and chat thread. The UI projects attributed message fields
and ordered tool metadata from those rows; the existing app chat row owns membership,
status, usage totals and routing, not a second transcript. The current app write queue
calls the official writer then writes metadata only. Model history reads that same
projection; runtime auto-memory is not a second writer. Paging, list preview/count,
search audience and completed tool outcomes use the native table for these chats.

Verified legacy importer is explicit and tested on disposable data only after UUID and
secret mapping. It refuses tree/unknown entries or conflicting native history, verifies
all projected rows, then deletes app message/search rows. Boot/lazy load refuses legacy
rows unchanged rather than auto-converting a real install. Enabling Pi after native
threads exist also refuses before reads/new writes; no silent empty-history fallback.

Control remains minimal: new input queues, Stop aborts cooperative work, per-call
approval is transient. Restart closes pending/queued work without automatic replay,
preserves completed effects and marks uncertain running tools as possibly executed.
This is interrupted-run recovery, not beta durable checkpoints or exactly-once effects.
Deleting a chat invalidates/removes the accepting run before awaiting persistence,
drains its final writer, then removes native history. Unsupported native branching is
hidden by the existing capability flag and refused server-side.

History fixtures cover import after UUID/secret mapping, attribution, paging/search,
concurrent separate-chat writes, storage-only failure retry, flag-off refusal and old/
new-run deletion races. Production browser created approved work, reloaded its native
transcript/tool cards and showed no branch action; disposable DB had zero app messages
and six official rows. Server was stopped. Final scoped independent review reports no
required findings after authority/deletion fixes. Actual live inference, full old-data
executor, SDK session steering/durable approval and remaining Pi consumers are next.

## Native Session and remote-source checkpoint

Actual native turns now run through installed AgentController/Session, scoped by
workspace resource and chat `scope`, without automatic Memory. Official transcript
projection stays the only writer. Controller builtin tasks/plan/subagent tools, workspace,
browser and shell are disabled. Public machinery keeps eight steps, single tool
concurrency and OpenAI `store:false`. Native event/tool/usage output maps into existing UI.

Same-agent follow-ups use native cancellation-aware `followUp`, not a second execution
queue. Queue owner grouping delegates to the same runtime Agent with supported owner
metadata; Stop cancels that exact queue, tracked preparation and parked approval.
History resolves afresh after prior events drain, preserving request/answer/effect IDs
once. Admission captures run/stop ownership across ack persistence; ended-run fallback
uses existing admission and Stop/deletion cannot commit late. Old finally cannot clear
newer control handles. Cross-agent routing still uses the existing serial admission
policy, not a duplicate same-agent FIFO.

Authorized remote MCP tools are built from actual source schema and invoked through
existing scoped source credentials/pool. Active agent/source membership and existing
permissions recheck before execution; Explore exposes only approved read calls.
Credentials remain server-side. Local/stdin and API connector parity is explicitly not
claimed. Native prompt routines run with creator keys and named-agent authors, and
native title refresh/transfer-summary paths no longer construct Pi runtimes. The old
native Promise approval gate/unused hook parameter are removed. Remaining default-Pi
constructors are temporary legacy consumers to delete at complete cutover.

Native search now projects at most the recent 2,000 authorized messages. A 2,100-row
fixture measured about 3.5 ms on Pro and proves the cap/privacy. Older matches outside
that window are absent; this is not FTS prefix parity and remains a known cutover limit,
not an unbounded scan or silently advertised full-history search.

## Native API-source checkpoint

Authorized API sources now expose native tools directly through the existing request/auth
executor, not the Claude SDK MCP wrapper. The source guide is bounded reference context.
Each call specifies method/path, rechecks current workspace/agent/source access, resolves
fresh source credentials server-side and pins the original endpoint/configuration. Paths
cannot leave the base URL; redirects and query-auth overrides are refused. Thirty-second
cancellation and streamed 64 KiB bounds apply. Only text/JSON results are returned;
non-success bodies, network failures and known authentication echoes (including JSON
escaping) are withheld. This is not arbitrary binary download parity or general DLP.

Existing native per-call approvals show actual API arguments. Explore evaluates the actual
method/path before execution. Changing mode stops the active native turn and its queued
work, so stale Execute grants cannot survive a switch to Explore or Ask. The next message
starts under fresh mode grants. This also covers work/MCP tools through the common run guard.

Serial disposable fixtures prove endpoint confinement, credential rotation/revocation,
safe errors/echoes, output limits, cancellation, actual Session approval before one POST,
and actual SessionManager Execute-to-Explore/Ask cancellation with zero late POST. Independent
bounded re-review cleared mode and escaped-echo findings after regression fixes. Production
browser proof shows full approval arguments and reloaded named-agent API card/response;
the same fixture stores three official transcript rows and zero app messages, with no source
credential in history. No live provider/source, paid inference or real database was used.

The next essential parity boundary is attachments through workspace-scoped Library IDs/blob
reads rather than renderer-supplied host paths. Image/PDF/text context bounds and Office
conversion references must be proved, then useful current-session/source configuration
tools need their existing scoped callbacks under native execution. Binary API downloads,
local/stdin sources, computer/browser isolation and constrained delegation remain open.
Full-history search, old-data execution and remaining decision/routine callers also still
gate default cutover and complete Pi package/transport/catalog/control deletion. No permanent
flag or dual runtime is accepted; this bounded API checkpoint is not the finished pre-MVP.

## Native attachment checkpoint

Native admission resolves uploaded IDs against existing workspace Library rows and replaces
client paths/type/name/size with server metadata. Raw client content is not model input.
Existing chat membership guards and current run authorization apply before blobs are read.
New Office conversions bind their original Library ID and version on the derivative row;
client derivative IDs must match that relation. Editing derivative content clears its
binding, and original changes/deletion invalidate it. Nullable additions preserve existing
Library rows. Legacy Office references stay visible but need reattachment if no verified
conversion exists; no guessed filename/path linking or history boot refusal is introduced.

The native upload path preserves original image bytes and MIME rather than overwriting them
with the legacy resized image. Unsupported originals fail during native preparation, not
silently convert or substitute content. Model input supports UTF-8 text/JSON, verified Office
Markdown, single PNG/JPEG/WebP/GIF images and inline PDF through pinned Session/OpenAI Responses.
Limits are four attachments per message, 32 KiB per text/conversion, 5 MiB per image/PDF,
2048 pixels per image edge, four PDF pages, 8 MiB per turn and a conservative 32K attachment
allowance (UTF-8 bytes for text plus 8192 per image/PDF page and extracted PDF text bytes).
This allowance is not a provider tokenizer or a guarantee of the model's full context fit.
Explicit text-only catalog hints refuse image/PDF. Live account multimodal support remains
unverified. There are no arbitrary URLs, host paths or external provider file uploads.

History stores Library references/versions, not another binary transcript. Reload rebuilds
bounded input from those references. Current attachments reserve allowance first; failed
historical sets consume none and give an explicit unavailable/reattach marker while keeping
their existing message/chip. Blob reads stream through the existing disk/S3 store with
size/version checks and cancellation; S3 bounded reads do not materialize an unbounded cache.
Native model input does not mutate originals or direct-edit Library document behavior.

Actual boot/browser PDF testing exposed drizzle-kit/api's enumerable Array prototype
extension. Schema push now runs unchanged in an isolated Bun worker, which closes its DB
and returns before official storage initializes; failures/data-loss refusal stop boot.
No prototype deletion or PDF.js patch is used. Desktop builds ship an explicit sibling
schema worker and complete external PDF.js/canvas runtime packages. Mac arm64 isolated
packaged-layout proof is not a full installer/Windows/Linux validation.

Disposable tests/browser prove upload of text, a real Office conversion, image and PDF,
inline wire parts, reload/history, foreign/forged/missing/deleted/stale references, original
preservation, edited derivative invalidation, limits and cancellation. The model fixture
proves provider request construction, not actual paid multimodal reasoning. Essential
session/source callbacks are next; binary API downloads/local sources, isolated computers
and constrained delegation, full-history search and remaining decision/routine consumers
still gate actual native default and complete Pi deletion.
