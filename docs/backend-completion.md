# Backend completion checkpoint

The HTTP mail fixture below is historical. Current signup/sign-in are mail-independent; reset and invitations use standard SMTP; see [configuration](operations.md#smtp-mail) and [current acceptance](native-acceptance.md).

Current managed Pi/CLIProxyAPI implementation and qualification: [checkpoint](pi-implementation.md) and [source map](pi-gateway-plan.md). The earlier checkpoints and ACP/native-computer observations below are historical; they do not qualify the replacement.

Current integrated source extends reviewed baseline `03192913bfc93a733e721d270b5cd1c98c0a2c34`. Otto owns this backend integration. All author components were inspected and authorized by root; fresh combined Otto review is still required before staging or a final commit. No product UI work, Notion, deployment, remote or push.

## Acceptance and evidence

The canonical baseline audit identified 23 gates. “Verified” below means the stated production seam was exercised, with external fixtures identified; it never means a selected VM or live service was qualified. Full commands/results and exact source manifest are linked in [current validation](evidence/backend-review-validation.txt).

| Gate | Implemented and exercised boundary | Evidence / remaining qualification |
| --- | --- | --- |
| Human auth, owner, membership, invitations | Verified signup/email/login/reset/session revocation; closed bootstrap; verified invitation accept/retry/revoke; role and eligible ownership guards; revoked invitation update | operations, membership-transport, collaboration suites; mail uses local HTTP sink |
| Project roles/metadata/repository | Current members and writer roles including archive, metadata/repository references, lifecycle and bounded discovery | content-transport; repository execution/checkout belongs to a future computer adapter |
| Flat Tasks, human owners, multiple assignees, completion recurrence, links | Separate ownership/assignee sets, one successor per completed recurring Task, human-only Done, atomic owner/metadata edits, eligible-owner reopen and demotion prevention | collaboration, content-transport, membership-transport, task-assignees, task-recurrence |
| Conversations, history, replies, attachments | Explicit viewer ceiling for inherited humans/executing Agents, shared saved history and separately authorized attached content | content-transport, transport, runtime |
| Read/unread, mentions, attention | Read positions/mentions plus bounded current Runs, human questions and owned/sponsored approval pages | content-transport, runtime, Connections pagination |
| Scoped agent tools | Trusted Run proof derives Agent; current sponsor/attempt/launch/Environment/audience checks, message/content/task/tool operations | runtime ACP requests, including revocation and policy-loosening denial |
| Agent config/custom harness | Trusted configured harness version/argv, no browser installation pin, capability/model/ACP negotiation and bounded streams | controlled computer only; no real native harness installation/login proof |
| Environment lifecycle/scope | Isolated-computer capability boundary, single lease/generation, scope binding, uncertain state and release | environment-binding concurrent uniqueness/writer tests; runtime duplicate/busy/recovery scenarios; real compute is deliberately deferred |
| Session privacy/context | Exact binding, one-time opaque native reference, accepted context and private history suppression | runtime continuation; opaque context is provider-specific |
| Run dispatch/recovery | Atomic Run/Session/queue admission, immutable request/input/audience, launch-before-I/O, lost-ack fencing and recovery | Runs, authorization, runtime; provider reconciliation is controlled |
| Directed peers/steer/answer/Stop | Two-Agent routing and targeted controls; bounded peer admission; persisted human questions and authorized exact answers | runtime; remote process-tree behavior remains provider-unqualified |
| Native subscription/account integrity | Exact declared account/mode/model checks; no account/API fallback; unavailable by default | fixture protocol checks only; live credentials, quota and billing unverified |
| Documents/restricted roles | Effective current Project/workspace recipient intersections, ordinary collaborator rules, skill visibility, direct restricted agent denial and proposals | authorization, content-transport, agent-content |
| Collections/typed fields | Stable field IDs, typed values, partial token-checked view edits, archive/restore | content-transport |
| Skill files/import/export | User/workspace import/export, bounded immutable Artifact refs and accepted reads with pre/post-I/O recipient checks | content-transport plus HTTP -> queue -> runtime materialization |
| Artifacts/library/reuse | Intent/digest immutability, exact retry, private source audience cap, trusted agent creation before/after I/O | content, authorization, agent-content, runtime; named storage fixtures |
| Frozen public shares | Explicit human selection/publication, frozen preview, public metadata/file/sandbox, revoke/current-source recheck | content-transport browser/HTTP and runtime Artifact share/revoke |
| Archive/restore/search | Archived source blocks new launches; active output/steer/Stop and saved reads remain authorized; search/pages filter current records | runtime active Project/Task/Conversation/skill archive + Automation pause; content lifecycle |
| GitHub/MCP Connections | Concrete pinned HTTP protocols, explicit allowlist/account/target/audience, exact approval, accepted/live grant equality, uncertain writes | Connections + actual HTTP/ACP approval and result publication; live credentials/external writes unverified |
| Prompt/script Automations | Manual and actual minute clock dispatch through real pg-boss/runtime; status/config fences, disabled manual execution, native delivery dedup and partial owner update/history | Runs and runtime; DST calculation checked, live DST/outage qualification absent |
| Realtime/reconnect | Authenticated bounded saved message/Run/activity replay and current-record refresh after gap/revocation | transport, content-transport and runtime HTTP/WS |
| Startup/schema/storage/restore | Production startup/readiness/cleanup; native push/constraints/queue preservation; legacy queue refusal and removed-sponsor backlog/minute recovery/restart | schema, operations, runtime, S3 protocol fixture; prior upgrades historical, Garage durability/restore unverified |
| Bounded resources/fair progress | 17 concurrent preparations limited to 16, one Environment lease, bounded output/files/requests; two-Agent Stop under 32 readers | runtime measured fixture profile in validation; no production speed guarantee |

## Normalization and error review

All ordinary discovery getters use `{items,next:null|cursor}`. Shared primitives have no Hono/Drizzle/provider imports. Queries use limit+1; permission filtering keeps scanned continuation. Actual PG tests cover empty, exact 100, 101, an invisible first page, human-ID paging, limits and complete audience snapshots. Transport queries share bounded validators; singular getters still return a record. Numeric replay, byte reads, controls and complete authorization snapshots are intentionally different contracts.

Reviewed every production catch/rejection site in packages, server and scripts. Boundary parsers translate malformed input/provider responses; optional readiness reports unavailable; public shares hide only missing/forbidden content. Runtime/queue failures retain terminal, retry or uncertain state. Detached errors feed runtime readiness/shutdown; ACP observes rejection before asynchronous writes and still returns the rejecting original promise. Cleanup aggregates original failures rather than overwriting them. Bootstrap/entrypoint failures exit nonzero with redacted logs. The consistency scan checks names, shared dependency freedom and unique route paths; its catch inventory does not replace this semantic review.

Concrete regressions found and corrected during integration: concurrent preparation exceeded the 16-execution cap; active archive/skill archive blocked accepted controls/output; temporary public storage unavailability became a false 404; cleanup failures were swallowed, hid the original error, or skipped remaining computer handles; older discovery responses disagreed on page shape/end semantics. Historical failing logs remain separate from current passing evidence.

## Provenance and remaining decisions

Root-approved components: operations `cfe87cb` and invitation helper `119cfd0`; content `3cb0819`, archive correction `687c796`, agent content `a1e96a5`; Connections `8d5fd96`, audience/launch identity `29e8177`, recovery `acf61f7`, attention `17476c5`. The withdrawn `a70e12a` callback widening is absent: final callback accepts narrow RunProof and returns Agent plus audience. Main normalization modifies these integrated components under root's explicit cross-cutting authorization; author-lane test totals are historical component evidence, not the combined verdict.

The latest user policy retires numbered app migrations before MVP. Native Drizzle push uses owning domain table declarations plus schema-only lazy FKs and one composition entry. Physical schema cycles are permitted; runtime domain operations remain acyclic. Old migration sources and populated-upgrade proofs remain in immutable historical archives, not the current bootstrap.

This phase qualifies the provider-independent backend and typed computer boundary with controlled fixtures. Real compute/native login/billing/isolation and VM recovery are deliberately deferred to provider discussion; live external service qualification separately needs the verified Otto Infisical scope. Required computer interface and capabilities are in packages/environments/src/computer.ts; trusted runtime composition is apps/server/src/lifecycle.ts. No host-local execution substitutes for that decision. Garage/backup restore and live external permissions remain unverified. Actual human work time is unknown. Final integrated review and root authorization must precede a main commit.

## Historical simplified freeze, 2 October 2026 (REQUEST CHANGES)

The user superseded the historical 81ece1 freeze before its semantic review completed. That frozen source passed **153 tests across 19 files** under Bun/Vitest, including actual HTTP/PG Task ownership, stale edits and forged-agent denial; shared cursor/query/auth/public-route behavior; ordinary partial edits; trusted harness admission; populated saved bindings and approved digest upgrade/replay; and real runtime closure while readiness is blocked on PostgreSQL. Biome, types, package boundaries, consistency, web build and frozen-lock install pass. The generated UI and historical evidence are unchanged.

One API entry owns authentication, origin checks, dependencies, presence and workspace transactions. Static collaboration/content/execution/Connections modules keep cohesive routes and full inferred RPC; only frozen public shares precede auth. Shared primitive schemas replace the repeated route validators. Ordinary Task ownership, Project metadata, Collection view and Document whenToUse changes use their allowlisted edit-token update. Distinct association/audience checks and lifecycle controls remain explicit.

Otto fields now consistently use type, editToken, connectionId and harnessVersion. Agent records/forms no longer duplicate the trusted installation pin; accepted Run/Session bindings preserve it. Connection type determines its private service/native mode. Migration and authorization tests preserve original snapshots/approvals, reject newly widened live grants, and leave unsupported/native capabilities unavailable.

The new [source manifest](evidence/backend-simplification-source.json) identifies this exact uncommitted checkpoint. [Validation](evidence/backend-simplification-validation.txt) records commands, versions, reproduced defects and the controlled two-Agent/32-reader measurement. The historical 149-test freeze remains untouched; Independent Otto review subsequently returned REQUEST CHANGES F1–F6. No staging or final commit is claimed.

## Historical 04c provider-independent freeze, 2 October 2026 (REQUEST CHANGES)

Author validation is **209/209 tests across 24 files, 263.62 seconds**, after all behavior changes. Biome, strict server/web types, boundaries, consistency, frozen-lock install and generated web build pass. [Current test summary](evidence/backend-current-tests.txt), [correction observations](evidence/backend-current-regressions.txt) and [exact source manifest](evidence/backend-current-source.json) identify this checkpoint. Historical153/198c9b remains a failed semantic-review capture. Fresh independent Otto recheck of F1–F6, the latest settled user model, all concrete sweeps and introduced defects is **pending**.

All reproduced final sweep findings are corrected: C1 explicit inherited Conversation viewer ceiling; C2 eligible owner on Task reopening; C3 Project writer authority on archive; CONTENT-1 effective current restricted audiences; E1 pending/lost launch fencing; E2 durable unjoined-tool shutdown uncertainty; E3 unique provider/computer binding; E4 executing Agent contributor authorization; E5 accepted Task content; E6 writer-only binding. Fixtures exercise both denied and permitted paths, concurrent binding, rollback/no queued side effects, late Stop and fresh-runtime recovery. The inspected Environment component is byte-identical on integration.

The user/workspace visibility suite checks creator/configuration identity, filtered pages, private dependencies, shared use, accepted native account changes, live membership/visibility revocation and skill-file audience recheck after I/O. Disabled Automations permit explicit manual owner execution and suppress scheduled delivery. No extra Agent context arrays or Automation capabilities remain. Root AGENTS records these settled rules and the deferred real-compute boundary.

No staging, final commit, remote, push, deployment or Notion actions. The current source is an author-qualified provider-independent checkpoint for independent review, not a live compute/storage/billing or full product UI certification.

## Current R1–R3 correction freeze

Author validation passes **214/214 tests across24 files in264.11 seconds**, plus formatting/types/boundaries/consistency. Only Run recovery and effective source-Run audience code changed, with production-seam regressions: fresh-runtime pending launch and transient inspection retain the lease until stopped proof; removed recipients cannot receive new private attachments/grants, while restored original recipients work and late invitations remain capped. Existing explicit human public selection tests still pass.

The previous04c independent review requested exactly these three corrections. [New validation](evidence/backend-review-validation.txt) records red/green observations and exact review provenance; [new source manifest](evidence/backend-review-source.json) identifies the revision for both reviewers' affected-change rechecks. Historical evidence remains untouched. No independent PASS, staging or commit yet.
