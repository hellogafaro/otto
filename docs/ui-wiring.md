# Whole-UI wiring

Source: BB `thr_ea3andz7st`, Johan's 4 October 2026 request; source brief `thr_g6sbbikxpg`. Execution owner: temporary UI engineering owner. Baseline: `3450a1fa0fd8bc5e3000a50872486da91846f1dd`. Work stays in the assigned worktree. No Notion, remote push, deployment, shared schema mutation, or agent-runtime time entries.

Accepted outcome: every reachable screen and action uses authorized backend data where supported; mutations persist; unsupported flows explain their real blocker; final integrated browser verification and independent review precede Johan's walkthrough.

## Coverage ownership

| Surface | Backend seams / actions | Owner | Evidence |
| --- | --- | --- | --- |
| Session, workspace boundary, profile menu | Better Auth session/sign-in/sign-out; bounded workspace listing/switch | Lead | Pending fresh browser proof |
| Tasks, task detail, activity | Project-scoped list/filter/sort/page; create/edit/status/archive; assignees/recurrence; links/timesheets | Task lane | Pending |
| Projects, project detail/tabs | List/create/title/repository/archive; project membership; Tasks/Documents/Files tabs | Project lane | Pending |
| Documents, document detail | List/filter/page; create/editToken/body/labels/visibility/folder/archive; Collections/proposals/attachments where exposed | Document lane | Pending |
| Files, viewer, folders | Mixed library paging; nested folders; binary upload/retry/abort; custodian metadata/archive; verified download; selected shares | File lane | Pending |
| Chats, new chat, sidebar, floating chat | Create/read/messages/read cursor/participants/archive; private Sessions; Run admission/status/control/questions/usage | Chat lane | Pending |
| Schedules/detail | List/create/allowlisted fenced edits/history/manual Run/archive; cron/timezone and output Chat | Schedule lane | Pending |
| Settings/account/members | Human profile; workspace members/invitations; Connections policy/grants/approvals; Subscriptions authentication/models | Settings lane | Pending |
| Agent settings/Skills | Agent fenced configuration, visibility, account/model, skill selection and Connection grants; Skills lifecycle | Agent lane | Pending |
| Inbox, global search, mentions/shared widgets | Attention; compact per-domain typed searches; real identities; navigation/errors/empty/loading | Lead | Pending |

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

Further items must name their actual API/external/product blocker. Final evidence records exact integrated revision and source/evidence hashes.
