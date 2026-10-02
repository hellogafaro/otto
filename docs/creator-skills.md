# Creator, skills and account simplification

Current follow-up to reviewed commit `306bd2d4cbdda76c5d91f5d50763390865fe33ce`, 2026-10-02. Prior verdicts and evidence describe their captured source, not this change. Independent affected review is pending.

Agents, Conversations, Documents and external Connections use server-derived `createdBy`. Subscriptions use the same identity. Task and Automation `ownerId` remains transferable human responsibility; Artifact `ownerId` is its human custodian/sponsor, alongside actual `creatorAgentId` authorship.

Reusable skills persist once in `agent_skills`: `(agentId, skillId)` primary identity and workspace-safe Agent/Document foreign keys. Create/update accepts at most 50 unique canonical UUIDs; projection sorts by ID because selection has no priority semantics. Atomic replacement shares the Agent edit fence and transaction. Accepted Run skill text/files remain immutable JSON evidence and are never rewritten.

Connections are GitHub/MCP accounts with existing many-to-many scoped grants. Subscriptions represent native AI account metadata, with `user | workspace` visibility and `needs_auth | enabled | disabled` status. They have no accountRef, mode column, editToken, credential or billing management. Human creators may disable or request reauthentication; only an exact trusted Computer report enables them. Creator authorization also runs before an already-enabled return. Agent, accepted Run, private Session and retained computer scope use one `subscriptionId`; native mode and no-fallback checks remain at the trusted computer boundary. Harness installation/configuration and model IDs are separate; no model catalog or provisioning is added.

Documents (including skills) and Artifacts now use one nonnullable `user | workspace` audience. Direct edits remain creator/custodian-only, with current workspace/Project authority. Fine-grained Document/Artifact reader/writer ACLs and their endpoints are removed and deferred. Public internet publication remains explicit human frozen selection. Collections/properties, skill format metadata, supporting immutable file references, attachments and proposals remain because existing behavior uses them. Selected Run content, Agent tool reads, current recipients and retained source reuse continue to reauthorize.

Project, Conversation and Artifact metadata/archive changes no longer carry edit counters; current writer/admin gates and replay cursors remain. Subscription display/status/visibility updates use current creator authorization under the workspace lock, without client CAS; status never asserts browser qualification. Connection title-only updates preserve the policy token, grants and exact approvals. Config/credential/visibility edits retain their token and revoke stale grants. Retained tokens protect Document/skill bytes and proposals, Task owner/Done, Agent configuration/selection, Automation queued/scheduled authority, Collection typed content and explicit frozen shares. Attempt, lease and generation fences are unchanged.

Qualification uses real HTTP/Better Auth, private PostgreSQL/native schema push and pg-boss. Computer, storage and external service peers are controlled fixtures, not proof of native login, billing, physical isolation or Garage durability. Current check results and exact source identity accompany the final evidence handoff.

Fresh disposable schema bootstrap and repeat synchronization are in scope. Older databases need an operator-reviewed transfer for renamed creator columns, Agent JSON skills, native model Connections, retired Document/Artifact ACLs and removed counters. No automatic data conversion, destructive push, old snapshot reinterpretation or populated-installation upgrade is certified. Missing/legacy native snapshot bindings fail closed. Actual human work time is unknown.

Observed production seams in the earlier creator follow-up 224-test Bun run; the Artifact cleanup below still requires the final combined recheck:

| Input | Observed output | Regression |
|---|---|---|
| Forged creator / another maintainer's update | HTTP 400 / 403; creator unchanged | `visibility.test.ts`: creator derivation |
| Duplicate or cross-workspace skill, concurrent stale replacement | Denial; relation and Agent token roll back; 50 selections hydrate deterministically | `visibility.test.ts`: skill relations |
| Browser enable, wrong reported Subscription, disable during inspection, already-enabled foreign creator bind | 400 / 403; no unauthorized qualification/binding | `visibility.test.ts`: trusted qualification |
| Selected native account changes or audience/member revocation during execution | Interrupted or denied; no account fallback | `execution-authority.test.ts`, `visibility.test.ts` |
| Connection display rename after exact approval | Grant snapshot unchanged; one controlled provider write succeeds | `connections.test.ts`: title-only update |
| Token-free Project/Conversation edits or viewer mutation | Creator/admin edits succeed; viewer 403 leaves content unchanged | `content-transport.test.ts`: metadata |
| Document workspace-to-user change, stale edit or noncreator write | Current read/WS/Run access denied; stale body 409, noncreator 403 | `visibility.test.ts`, `content-transport.test.ts`, `execution-authority.test.ts` |
| Fresh plus repeated native schema push with selected skill/native account and pending queue job | Constraints, data and queue objects/job preserved; invalid human/workspace/status writes rejected | `schema.test.ts` |

Exact commands, intermediate failures, final source hash and raw-log references are in [validation](evidence/creator-subscriptions-validation.txt) and [source manifest](evidence/creator-subscriptions-source.json). The native push repeats may emit composite-FK DDL because of pinned Drizzle introspection; the observed guarantee is semantic stability, not a no-op command. Independent verdict remains pending for this follow-up.

Artifact cleanup supersedes the earlier 84654208 freeze for current acceptance; that manifest, validation and archive remain historical unchanged. Artifact metadata/visibility updates use the authorized public projection, not a duplicate private-row lookup. Storage key/request remain private. Original upload visibility belongs to immutable request evidence; later metadata visibility changes neither rewrite it nor invalidate an exact retry. Agent creation keeps a bounded original receipt. Live direct reads, attachment recipients and supporting files retain current+saved source checks; public selected publication remains explicit.

Complete `editToken` schema inventory after cleanup:

| Retained field | Actual consumer and protected race |
|---|---|
| `documents.editToken` | `updateDocument`, supporting files/attachments/Collection assignment and proposed content: stale body/selected-byte replacement fails |
| `document_proposals.editToken` | `resolveDocumentProposal` applies only to the accepted unchanged Document; it is a saved reference, not another revision counter |
| `collections.editToken` | `updateCollection`: typed field/choice structure and concurrent property configuration remain compatible |
| `tasks.editToken` | `updateTask`, `setTaskStatus`, assignment: stale human owner/content/Done transitions fail |
| `agents.editToken` | Atomic skill/config replacement and accepted `agentEditToken`: queued stale configuration cannot launch |
| `automations.editToken` | Update, scheduler reconciliation/delivery and accepted automation reference: stale schedule/owner/config work cannot launch |
| `connections.editToken` | Config/credential/visibility update, pre/post discovery and canonical operation identity/current Run grant equality; title-only edits do not advance it |
| `content_shares.editToken` | Exact selected preview publication and asynchronous file revoke checks |

Run JSON skill/Document tokens are accepted proposal/source references; grant tokens are compared against the current complete grant snapshot. Removed: Project, Conversation and Artifact counters, plus write-only `connection_operations.editToken` and `grantGeneration` duplicates. The operation digest still hashes the live Connection token and live grant generation and is checked at request/approval/pre/post execution. Subscriptions have no token. Distinct Run attempt/launch, Environment generation/lease and grant generation fences remain numeric and unchanged. There is no generic version framework.

## Consolidated domain cleanup

The root-inspected cuts cover all backend domains; the UI remains unchanged. This pass removes duplication without replacing native mechanisms or authorization boundaries.

| Domain | Removed/consolidated | Retained behavior and proof |
|---|---|---|
| Workspaces/Projects/Tasks | Unused DB package dependencies; duplicate human/admin check; one open-owner Task guard with optional Project filter | Current Project writer/admin, owner eligibility and archived open Tasks still block removal/demotion (`membership-transport`, `content-transport`) |
| Conversations | Read-row UUID replaced by `(conversationId,userId)` PK; duplicate Message FK/unique removed | Composite workspace FK, request uniqueness, numeric replay and monotonic read attention (`schema`, `content-transport`, `transport`) |
| Documents/skills/Collections | Duplicate imported name/description metadata; reuse authorized Collection and same-call Document audience | Byte-identical skill export, optional frontmatter, typed properties, archived selection/current audiences (`content-transport`, `visibility`) |
| Artifacts | ACL/token plumbing and duplicate metadata reads | Custodial visibility updates preserve immutable upload request, byte digest and source-Run saved/current cap (`artifact-immutability`, `agent-content`, `content-transport`) |
| Agents/Sessions | Candidate discovery selects IDs; one private Session lookup; unused DB package declarations | Junction hydration, filtered candidate continuation and exact private native binding (`pagination`, `visibility`, `runtime`) |
| Environments/Runs | Orphan outcome/release/uncertainty APIs, write-only Environment scope and unproduced activity labels; queued failure helper reused | Actual runtime and `settleEnvironment` stale-generation/attempt checks; complete retained executionScope; duplicate terminal delivery leaves cursor unchanged (`runs`, `environment-binding`, `execution-authority`, `runtime`) |
| Automations | Duplicate Project storage/dependency | Project derives from current output Conversation at admission; writer/archive/Task scope and scheduled-token checks remain (`runs`, `runtime`) |
| Connections | Unused externalRef and duplicate operation token columns; single fenced recovery UPDATE; same-transaction authorized Connection reused | Live grant/Connection policy digest, pre/post-I/O checks and removed-sponsor/race recovery (`connections`, `runtime`) |
| Subscriptions | No new cut: immutable account identity and narrow state transitions already minimal | Exact trusted report, shared/current visibility and creator-controlled qualification/revocation (`visibility`, `execution-authority`) |
| DB/shared/server | Share publication derived from nonnull frozen snapshot; duplicate transport guards/App alias removed; common attention limit forwarded | Preview never replaces publication implicitly; revocation clears snapshot; filtered pages advance from candidates; native push integrity and private queue ownership (`pagination`, `schema`, `content-transport`) |

The attention regression first observed two Runs for `limit=1`; corrected composition returns one Run and one question with continuation, including empty denied pages. Old 84654208 evidence stays unchanged. The final current validation/source manifest is separately named `domain-cleanup-*`; independent review remains pending until that exact source is checked. No legacy data transfer, live compute, native account/billing or physical Garage qualification is claimed.

The final Conversation cut replaces `access: inherited | restricted` with `visibility: workspace | participants` without widening the audience. Server-derived `createdBy` is the sole metadata/archive/participant maintainer; current writer/Project checks still apply. Discussion and Run controls remain available to eligible contributors, with explicit viewer ceilings and required Agent membership. A real HTTP regression first observed a noncreator contributor changing the title (200); the corrected management path denies it (403). Legacy Conversation schema/data needs explicit operator transfer; no creator is fabricated from present members. Native auth access tokens/provider access-key names and explicit rejected legacy-input tests are unaffected.

Current final author check: **227/227 tests in 24 files passed under Bun (257.46s)**, after the Conversation creator/visibility cut. Frozen-lock install, Biome, types, 16-package boundaries, 115-route consistency, build and diff checks pass. No implementation/schema changes occurred during that final run. See [current validation](evidence/domain-cleanup-validation.txt) and [current source manifest](evidence/domain-cleanup-source.json). The earlier 225-test run is intermediate; historical846 evidence is unchanged. Independent review of this replacement source is pending.

## Display title follow-up

The current amendment standardizes Otto display labels on `title` for Workspaces, Projects, Agents, Automations, Connections, Subscriptions and Collection fields. Scalar properties map to the existing SQL `name` columns; no column/data rename is performed. Old Collection JSON field labels are projected from stored `name` to public `title` by the owning domain, without rewriting persisted bytes or altering field IDs/types/options. New writes use `title` only. Human names, tools' operation identifiers, native MCP/ACP/GitHub/SKILL.md fields and package/constraint names remain unchanged.

The actual HTTP regression creates, edits and reads the five editable resource titles, reads the Workspace title and human member names, checks physical scalar storage, and reads legacy Collection JSON while asserting the stored JSON stays unchanged. The initial title request returned 400 before the rename. Prior `domain-cleanup-*` acceptance records remain scoped to their old source. This amendment has its own `title-consistency-*` validation and source manifest; independent affected review is pending. No UI, provider adapter, model, authorization or permission change is included.
