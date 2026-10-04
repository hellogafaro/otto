# Whole-UI wiring

Source: BB `thr_ea3andz7st`, Johan's 4 October 2026 request; source brief `thr_g6sbbikxpg`. Execution owner: temporary UI engineering owner. Baseline: `3450a1fa0fd8bc5e3000a50872486da91846f1dd`. Work stays in the assigned worktree. No Notion, remote push, deployment, shared schema mutation, or agent-runtime time entries.

Accepted outcome: every reachable screen and action uses authorized backend data where supported; mutations persist; unsupported flows explain their real blocker; final integrated browser verification and independent review precede Johan's walkthrough.

## Coverage ownership

| Surface | Backend seams / actions | Owner | Evidence |
| --- | --- | --- | --- |
| Session, workspace boundary, profile menu | Better Auth session/sign-in/sign-out/reset; known invitation acceptance; bounded workspace listing/switch | Lead | Actual signup/profile/persistence/switch/viewer/nonmember browser checks; independent session-transition correction under recheck |
| Tasks, task detail, activity | Project-scoped list/filter/sort/page; create/edit/status/archive; assignees/recurrence; links/timesheets | Task lane | [Action inventory](evidence/ui-tasks.md); actual create/read/refresh browser proof; expanded action QA in progress |
| Projects, project detail/tabs | List/create/title/repository/archive; project membership; Tasks/Documents/Files tabs | Project lane | [Action inventory](evidence/ui-projects.md); actual create/refresh/add-viewer/denial checks |
| Documents, document detail | List/filter/page; create/editToken/body/labels/visibility/folder/archive; Collections/proposals/attachments | Document lane | [Action inventory](evidence/ui-documents.md); actual create/refresh and HTTP stale-token rejection; expanded action QA in progress |
| Files, viewer, folders/public shares | Mixed library paging; binary upload/retry/abort; custodian metadata/archive; verified download; frozen shares | File lane | [Action inventory](evidence/ui-files.md); actual folder/upload/download/edit/share/anonymous view checks; revoked-cache correction under recheck |
| Chats, new chat, sidebar, floating chat | Create/read/messages/read cursor/participants/archive; private Sessions; Run admission/status/control/questions/usage | Chat lane | [Action inventory](evidence/ui-chats.md); actual send/refresh/reply/error-preserved draft/retry; expanded participant/mention QA in progress |
| Schedules/detail | List/create/fenced edits/history/manual Run/archive; cron/timezone/output Chat | Schedule lane | [Action inventory](evidence/ui-agents_schedules.md); route/theme/mobile browser reads; expanded lifecycle QA in progress |
| Settings/account/members | Profile; members/invitations; Connections policy/grants/operations; Subscriptions authentication/models | Settings lane | [Action inventory](evidence/ui-settings.md); all section/theme/mobile reads and profile/member checks; expanded setup QA in progress |
| Agent settings/Skills | Agent fenced account/model/skill configuration; Skills lifecycle/files/proposals | Agent lane | [Action inventory](evidence/ui-agents_schedules.md); expanded lifecycle QA in progress |
| Inbox, global search, mentions/shared widgets | Attention; compact typed searches; actual identities; navigation/loading/errors | Lead | Route/theme/mobile checks and production grammar tests; independent review in progress |

Workers inventory their owned menus, dialogs and controls in `docs/evidence/ui-<lane>.md`, including API, current permission, evidence and exact pending items. The final integrating owner joins the inventory and verifies the actual artifact. This document is the brief/ownership record, not a substitute for closure by the closing agent.

## Shared implementation convention

`@/lib/api`: `client` is Hono `hc<RpcApp>` rooted at `/api`; `workspaceApi` is its `workspaces[":workspaceId"]`; `read(await api.<route>.$get(...))` checks status before decoding. No duplicate client or DTO framework.

`useWorkspace()` returns `{ api, workspaceId, workspace, workspaces, user, selectWorkspace, invalidate }`. Every workspace RPC supplies `param: { workspaceId, ... }`. Query keys start `["workspace", workspaceId, ...]`; TanStack Query owns server data. Mutation success calls `invalidate()` (coarse workspace invalidation initially); failure retains input and uses the actual error. No success toast before the server acknowledges. Use `QueryState` for pending/error/retry; use existing page/empty/shared UI composition. Dates cross HTTP as strings; domain schemas/types are the authority.

Lead exclusively owns router, manifests/lockfile, API/auth/workspace common modules, task-meta/mentions/search/profile/inbox and DESIGN.md integration. Lanes may add their own cohesive helpers without editing common files. No worker edits `packages/ui` or backend without coordination. Request necessary common interfaces through BB. No heavy PG/native/browser suites until coordinated; each worker runs formatting and relevant web type/build checks, then hands browser scenarios to the lead for serialized real-app verification.

## Confirmed API/design differences to respect

Tasks require `projectId`; query is whole-word search. Task statuses are todo/doing/done; mock review/priority is unsupported. Project has title/repository/archive/membership, no priority/status/description/cover. Chat `updatedAt` is metadata time. Pin/done/snooze and notification preferences have no persisted backend seam. Folders exist with maximum depth 8 and empty-only archive; mixed library sorts within kind. Workspace bootstrap is operator-only `claimInstallation`, not a browser create API. Account/computer/storage fixtures prove only exercised contracts, not live isolation, billing or Garage durability.

## Pending register

| Blocker | Flow | What works | Smallest decision/configuration |
| --- | --- | --- | --- |
| No browser workspace-create/update operation | Workspace creation/general title edit | Authenticated workspace list/switch, membership/invitations | Decide whether owner workspace creation belongs in MVP; existing installation remains operator-only |
| Compute/provider provisioning and real account qualification deferred | Real Agent execution | Run API/queue/admission/control available for controlled qualification | Select and qualify compute plus exact Codex account gateway; no silent fallback |
| No workspace-delete or persisted preferences API | Workspace deletion, notifications/default model | Existing workspace reads/membership, Agent account/model configuration | Product chooses whether to add each persisted setting; define owner-authorized operations |
| Missing account transport/content references | Email change/account deletion/photo upload | Name and public HTTPS photo URL autosave | Enable deliberate Better Auth flows and uploaded-photo reference semantics |
| No bounded invitation list/get | Persistent invitation management; lost creation receipt | Known-ID create/resend/revoke/accept, including zero-workspace entry | Add current-owner readable invitation status/list if required |
| No Task fields/operations | Priority/review/delete/comments/audit, Project move, unassigned filter, logging-date override | Three real statuses, occurrence/links, fenced content/metadata, creator-only whole-minute time | Choose specific domain extensions; removed controls do not simulate persistence |
| No Project cosmetic fields/delete | Description/cover/status/priority/owner/permanent deletion | Title/repository/archive/membership/scoped tabs | Choose explicit fields and permissions if required |
| No Document cover/delete/Project-update/Collection-detach | Those mutable controls; standalone Collection destination | Content/metadata/folders/labels/attachments/Collections/proposals | Product chooses standalone Collection route and any domain extensions |
| No File/Folder delete/ZIP/type/author/recursive/count API | Permanent deletion, archive downloads and unsupported discovery filters | Bounded direct-folder library, max-depth-eight organization, empty-folder archive | Choose specific backend operations; no invented recursive Drive domain |
| Native File retry identity is transient | Resume an upload after reload/navigation | Same native File/request retry and abort in open dialog | Decide durable resumable-upload contract; native File bytes are not put in browser storage |
| Download completion belongs to browser | App-level completion/progress reporting | Verified authenticated server download and browser-native transfer | Keep native reporting, or explicitly design platform completion support |
| No public-share draft deletion | Removing unused frozen drafts | Preview/refresh/publish/revoke and anonymous frozen page | Decide whether an authorized draft-delete seam is needed |
| No Chat pin/done/snooze/type/Project-or-visibility edit/thread/structured-choice contract | Those exposed mock concepts | Metadata discovery, messages/replies/mentions/read cursor, participants/archive, explicit Run controls | Choose individual persisted capabilities; no fabricated activity or replies |
| No idempotency identity on ordinary creates | Project/Chat/Agent/Skill/Schedule/account/Connection/invitation/Folder/share-preview/time creation after lost ACK | Acknowledged IDs persist; unknown outcomes are explained and forms guard immediate repeat where implemented | Add narrow domain request identities for safe reload/reopen reconciliation; invitation list is also required |
| No Schedule-scoped manual Run list/nextAt/nullable Task clear | Comprehensive manual history, next-run caption, clearing association | Current acknowledged Run status/Stop/output Chat, real delivery history, cron/timezone, Task replace | Add bounded Schedule Run projection and explicit nullable clear/server next event if selected |
| No Agent cosmetic or Project-reassignment/delete API | Description/mascot/color/reassignment/delete | Fenced title/instructions/account/model/Skills and archive | Choose specific domain fields/transitions; existing sprite is display only |
| SKILL.md export requires a machine-compatible title | Exporting a Skill whose ordinary title contains spaces, uppercase letters or exceeds 64 characters | Instructions, supporting Files and export with a valid lowercase hyphenated title | Choose a separate export name or an explicit title conversion; ordinary saved titles remain valid |
| Safe Connection config/grant/isWrite projections missing | Reading saved binding/grants; predicting failed-read retry eligibility | Explicit configuration/grant replacement, real discovery/operations, server-authorized retry | Add owner-authorized safe projections; never expose credentials |
| Grant creation has no editToken | Atomic grant fence to exact viewed discovery-policy revision | Server rechecks current discovery, authorization and membership; stale UI discovery is hidden | Add a domain-owned atomic fence only if exact viewed-policy retention is required |
| No explicit external-operation reconciliation update | Resolving uncertain protected external writes | Actual operation state/identity/approval/execute and failed-read retry | Define external verification and server reconciliation semantics; do not replay writes |
| Exact deployment binding/allowlist/gateway authentication absent in private preview | Live GitHub/MCP/Codex setup and model/compute/billing qualification | Real local creation/configuration/status and truthful unavailable errors; controlled fixtures | Configure approved endpoint origins, credential bindings and exact Infisical-backed account; qualify isolation/billing separately |
| Production email delivery unqualified | Verification/reset/invitation mail | Real auth and invitation requests; disposable fixture accounts | Configure and qualify actual mail delivery; fixture signup is not production email proof |
| Controlled disk S3 peer is not certified storage | Production Garage durability/credentials and large-transfer qualification | Real AWS adapter, binary upload, verified download and frozen byte share tested locally | Qualify exact production storage transport, limits and durability |
| BB browser worker uses full shared /tmp | BB live browser preview control | Direct Playwright Chromium real-browser evidence works with private disk scratch | BB runtime owner adds short per-session disk temp support; no unowned host cleanup performed |

Further items must name their actual API/external/product blocker. Final evidence records exact integrated revision and source/evidence hashes.
