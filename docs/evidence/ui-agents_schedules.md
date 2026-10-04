# Agents and Schedules wiring handoff

Source: BB `thr_ea3andz7st`; implementation lane `thr_mer3i67uu5`, isolated branch `hg/otto-ui-lane-agents-schedules-thr_mer3i67uu5`. Baseline `f89d8128ec26726e17b954b15fe64ca71825c376`. Only the two owned routes and three new domain UI helpers are delivered here. Root owns integrated browser proof and fresh independent review; neither has run for this lane. This is an implementation inventory, not an acceptance report.

## Design decisions for lead integration

- Preserve Agent Profile/Instructions/Model/Skills/Connections groups and Schedule status groups, row composition, detail breadcrumb/right panel/timeline/floating chat. Real configuration has no Agent description/mascot/color, Schedule mock activity or calculated next-run date; remove those mock controls/content. Show the immutable Agent Project and exact Schedule cron/timezone or Manual only.
- Use compact stock New Agent/New Skill/New Schedule dialogs for required setup. Create has no preselected Agent/account/model/output Chat. New Agent scope is workspace or an explicit Project; account models come exclusively from the selected account's gateway.
- Agent's multi-field account/model/Skills configuration and Schedule configuration use explicit fenced Save/Cancel dialogs. One captured opening edit token protects an atomic configuration update, including account/model changes. Skill content and supporting-file mappings save independently, each adopting the acknowledged new token. Ordinary settings outside this lane retain the shared acknowledged autosave design. Lead must record this narrow exception to DESIGN.md's settings-autosave wording.
- Mutations disable controls during pending work; configuration dialogs block Escape/backdrop/close dismissal during writes. Closing without saving cancels local input. Responses acknowledge persisted changes before success toasts/workspace invalidation. Conflicts retain input and instruct closing/reopening to load the latest token.
- Connections are owned server policy, presented through a real link to Connections settings. There is no fake checkbox claiming a grant. The settings lane supplies exact Agent/resource/action/audience grants and revocation.
- Shared `DetailView.more` preserves the existing detail composition with this lane's actual menu. No changes to shared UI tokens/components are included in the lane commit.

## Action inventory

All RPCs below are workspace-scoped `/api/workspaces/:workspaceId`; response/request types infer from Hono. Lists use server sort and sealed `after`, `limit=100`, with explicit Load more. No browser credential, storage key, fixed Agent ID, mock read/write or RRULE conversion is present.

| Surface / action | Actual operation and permission | State/fence and integration proof |
| --- | --- | --- |
| Agent detail / current profile, instructions, Project, selected Skills, lifecycle | `GET agents/:id`; current visibility and Project authority | Loading/error/retry; unavailable Project label without inventing data. QA 1–3 |
| Agent Account title/status | `GET subscriptions/:id`; readable exact account | Loading/error/retry, no account fallback. QA 3 |
| Agent Edit / title, instructions, visibility, account, model, skill selection | `PATCH agents/:id`; creator/current workspace writer, server validates account/Skills | Opening `editToken`; captured snapshot does not refresh under an open draft. Unchanged Skills omitted so an archived selection does not block unrelated edits. Pending/error/reopen on conflict; success after ACK. QA 2–5 |
| Agent skill selection / remove selected inaccessible/archived item | Active `GET skills` and Agent PATCH `skillIds`, maximum 50 | Paged selection; unloaded selections retained until explicitly removed; no automatic sharing or replacements. QA 4 |
| Agent account picker / more accounts / models / Retry | `GET subscriptions`, `GET subscriptions/:id/models` | Enabled accounts plus exact current saved account; real IDs only; explicit model selection after account changes. An unchanged saved configuration may still be edited during gateway outage; changing model requires live availability. QA 3 |
| Agent Project picker / more Projects (creation only) | `GET projects`; `POST agents` validates Project writer | Paged; no project reassignment API exposed. QA 5 |
| New Agent / Save / Cancel | `POST agents`, which creates Environment; human workspace writer | Required title and explicit configured model/account, optional bounded Skills; no fixed default ID. `AgentCreateDialog` exported for settings lane. No automatic mutation retry. QA 5 |
| Agent More / archive / restore | `POST agents/:id/archive`; creator/current writer | Actual boolean transition, ACK then invalidate. Endpoint owns token increment, accepts no client edit token. No Delete action or protected fixed Agent exception. QA 2 |
| Agent Connections / All agents | Real navigation to `/settings/connections` / `/settings/agents` | Settings lane owns grants; no fake Connections list. QA 6 |
| Skills search / active-archived / more / empty / retry / open | `GET skills`, `GET skills/:id`; current readable visibility/Project | Whole-word query, server title sort, active/archived exact boolean; detail contains real instructions. Search is local to the Agent's Skill management widget. QA 7 |
| New Skill / import SKILL.md / Cancel | `POST skills` / `POST skills/import`; human writer/current Project writer | Explicit visibility; scoped to Agent Project; server parses format metadata; response selects actual new detail. QA 7 |
| Skill edit title/instructions/when-to-use/visibility | `PATCH skills/:id`; creator/current writer/Project writer | Latest locally acknowledged Skill token, current File audience checked on visibility change; retained input after failure. QA 7–8 |
| Skill archive / restore | `POST skills/:id/archive`; creator/current writer | Explicit `archived` and `editToken`; accepted Run snapshots are not rewritten. QA 8 |
| Skill supporting Files / search / more / select / path / add / remove / save | `GET files`, `GET files/:id`, `PUT skills/:id/files`; Skill creator/current writer | Same Project, saved upload, aggregate 8 MiB and 30 mapping bounds; source-Run Files explicitly unavailable; server validates audience, exact File identity and scripts/references/assets paths. Add/remove is local until Save supporting files; replace path by remove/re-add. PUT sends only path/File ID with current Skill token. QA 9 |
| Supporting File open | Navigation `/files?open=<fileId>&project=<projectId>` | Real saved File ID; no storage URLs/keys. File lane performs authorized preview. QA 9 |
| Skill Export SKILL.md | `GET skills/:id/export`; current reader | Actual `skillMd` shown read-only; no locally fabricated export. QA 10 |
| Skill propose / submit / Cancel | `POST skills/:id/proposals`; current writer/current readable Skill | Uses current Skill edit token; proposal is not applied automatically. QA 10 |
| Skill proposals / more / accept / reject | `GET skills/:id/proposals`, `POST .../:proposalId/resolve`; creator/current writer for resolution | Server stale-source acceptance; reject removes only selected proposal. ACK/read updated Skill before success; no invented proposal status. QA 10 |
| Schedule list / groups / search / filters / clear / sort / order / more | `GET schedules`; current output Chat reader | URL `type` prompt/script, `agent`, `owner` (Me maps to signed-in human), `status`, whole-word `query`, typed `sort/order/after`; bounded next-page cursor. Unknown/stale selected identities have safe labels. Enabled/disabled/archived are actual statuses. QA 11–12 |
| Schedule + / empty state New / create / Cancel | `POST schedules`; human writer, current output Chat writer/readable Agent | Required title/body/Agent/Chat/type; output Project derives from Chat; no new-Chat-each-run mock choice. Stock dialog. QA 13 |
| Schedule Agent/Chat search / more / pick | `GET agents`, `GET chats`, `GET chats/:id` | Whole-word server searches/title sort; no default Agent/Chat. Readable lists do not promise writer or Agent participation; server admission remains authoritative. QA 13–14 |
| Optional associated Task / more / replace | Project-scoped `GET tasks`, Schedule PATCH | Requires actual selected output Chat Project; preserved existing Task; no unsupported nullable clear. QA 14 |
| Schedule row / Open / Ask / Copy link | Detail navigation / shared real floating Chat / clipboard | Real Schedule ID; copy toast only after clipboard ACK; shared Chat lane owns sending. QA 11 |
| Schedule row Archive / Restore disabled | `PATCH schedules/:id`; owner/current writer | Current `editToken`; restored archived configuration is disabled. Real mutation pending/error/ACK. QA 15 |
| Schedule detail / prompt-script body / identities / properties / Chat | `GET schedules/:id`, directory, `GET chats/:id` | Loading/error/retry; body actual; metadata `updatedAt` never treated as Chat activity. Output Chat link uses real ID. QA 14 |
| Schedule Edit properties / title/body/type/Agent/Chat/Task/owner/trigger/cron/timezone/state / Save / Cancel | `PATCH schedules/:id`; owner/current writer; transfer requires eligible human and Chat writer | Captured opening `editToken`; owner list paged. Five-field cron and IANA timezone checked in UI; server performs exact cron validation. Manual clears cron with actual empty string accepted by domain. Archived cannot directly enable. QA 14–16 |
| Detail More / Edit / Copy / Archive / Restore disabled / Enable / Disable | Clipboard or Schedule PATCH | Menu checks owner/workspace role, blocks duplicate pending clicks. Active Run is not stopped by status changes. QA 15–16 |
| Run now / Retry Run | `POST schedules/:id/run`; owner/current Run admission authority | Disabled can run manually, archived cannot. Request UUID retained across failure until ACK to deduplicate uncertain admission. Success says Run admitted, never Ran/finished. Gateway/compute errors surfaced with no account/model fallback. QA 17 |
| Acknowledged manual Run / current state / outcome / Stop / output Chat | `GET runs/:id`, `POST runs/:id/stop`; current reader / actual Run control authority | Poll while queued/launching/running; only acknowledged state/outcome. Stop ACK does not claim remote cleanup completion. Server denies revoked/sponsor-mismatched controls. QA 17–18 |
| Delivery history / real outcome/time / Run state / output / more / retry | `GET schedules/:id/history`, Run GET/Stop | Server receivedAt descending; no fabricated activity/cards/next run. Manual admissions are not recorded by this endpoint. QA 18 |
| Detail panel toggle / parent breadcrumb / floating Chat | Existing shared UI controls/navigation | Uses incoming shared DetailView implementation; root verifies mobile/desktop visual behavior. QA 19 |

## Checks and pending items

- Verified: frozen Bun install after checking root package name `otto`; lane Biome check; `git diff --check`; web TypeScript after shared dependencies. Production build is running under the shared flock and will be reported with its exact result in handoff.
- Failed earlier checks: expected lead-owned Inbox mock Schedule prop mismatch; resolved by the coordinated dependency `d0e93b23da0a66fd4d635dc60ca5bc844bde9bae`. Other intermediate authoring errors were fixed before delivery.
- Unverified: browser behavior/visible design, integrated permissions and stale-token HTTP scenarios, PostgreSQL/native/external gateway/compute, independent review. No browser/PG/native suite was started by this lane.
- Required integration: settings lane mounts exported `AgentCreateDialog`; lead integrates the explicit multi-field Save/Cancel design exception. Connections settings owns Agent grants. Lead reruns checks and fresh browser/review on the combined revision.
- Unsupported Agent fields: description, mascot, color, Project reassignment and deletion have no Agent API. Removed their mutable mock controls. Smallest decision if needed: add deliberate backend fields/update semantics first; no cosmetic local persistence.
- Comprehensive manual Schedule Run history is unavailable: manual `runSchedule` does not add `schedule_history`, public Run projection has no schedule ID, and list schema cannot filter Schedule. Current admitted Run is shown in the page and output is durable in its Chat. Smallest seam: expose a bounded Schedule-scoped Run getter/projection.
- Next-run timestamp is not returned by Schedule API. Show exact cron/timezone, never guess a next date. Smallest seam if wanted: server-calculated next scheduled event.
- Existing optional Task association cannot clear: PATCH schema is UUID-only with no nullable form. Replace/preserve is supported. Smallest seam: nullable Task clear with domain semantics.
- Create Agent/Skill/Schedule endpoints do not accept idempotency identity. No automatic mutation retry; a lost response requires checking the current list before intentionally creating again. Manual Run does have the request fence and uses it.
- Real gateway/account/model and compute qualification remains external root work. Backend failure is shown; script/prompt control does not fabricate successful execution.

## Numbered integration browser scenarios

Use the integrated server and disposable fixture workspace; test actual HTTP persistence after reload. Browser evidence remains unverified until root runs these.

1. Open real Agent settings by ID. Check loading/failure/retry, saved Profile/Instructions/Project/account/Skills, unknown-ID refusal, and workspace switching without cross-workspace data.
2. As creator/writer, edit title/instructions/visibility, save, reload; archive/restore and reload. As another reader/viewer, ensure edit/archive unavailable and direct forged requests are denied.
3. Select exact enabled account; wait for real model IDs; switch accounts and verify model clears and requires explicit selection. Make models unavailable and confirm error/Retry with no fallback. Preserve unchanged saved model when saving only title during outage.
4. Select/deselect current Skills, page beyond 100, reach 50 selection limit, remove archived/inaccessible saved selection; reload Agent. Open two editors and save stale snapshot: 409 retains input and reopens with latest token.
5. Settings New mounts AgentCreateDialog. Create workspace and Project Agents with explicit title/instructions/model/account/Skills; cancel before Save creates nothing; pending dialog cannot dismiss; check created ID/environment, no default Agent ID.
6. Follow Connections to settings, grant exact Agent/resources/actions/audience as connection owner, revoke that same Agent; verify no Agent checkbox suggests a nonexistent grant.
7. Search/paginate real Skills (whole words, title order); create/import with user/workspace visibility and correct Project; read/edit actual content and when-to-use, reload after ACK; test empty/error/Retry and Cancel.
8. As creator, change Skill visibility against supporting File audiences, verify widening denial; stale edit-token denial without changes; archive/restore and selection behavior. As noncreator, edits/archive absent.
9. Attach same-Project saved upload at valid scripts/references/assets path, save, reload; remove/replace a path and File; open exact File preview. Try wrong scope, duplicate/path traversal, 31 files and aggregate >8 MiB; observe authoritative denial. Run-output File has explicit unavailable message. Cancel local mappings without a save.
10. Export actual SKILL.md; as eligible noncreator propose changed title/instructions, then creator accepts/rejects actual proposal. Stale acceptance fails; proposal never self-applies; reload content/proposal list.
11. Schedule rows and states come from server. Right-click Open/Ask/Copy, verify actual ID and clipboard; URL type/agent/owner/status/query filters round-trip, unknown selected identity cannot crash a filter chip.
12. Create >100 Schedules fixture; server title/createdAt/updatedAt asc/desc pagination and strict sealed cursor work; change filter/sort resets cursor. Check whole-word query, no-results/Clear, empty creation, loading/error/Retry.
13. Create manual Prompt and Script Schedules with explicit Agent/output Chat/body. Search/page >100 choices. Confirm no fixed Agent, RRULE conversion, fake new-Chat mode, or implicit account/model change.
14. Edit title/body/type/Agent/output Chat, Project-scoped optional Task and owner. Confirm backend Chat writer/Agent/current owner checks and persistence. Change two concurrent snapshots: stale save fails and retains input. Verify Project derives from actual Chat; owner transfer requires recipient access.
15. Archive via row and detail; manual Run disappears/denies; restore is disabled and only then enable. Reload each transition. Viewer/nonowner controls absent and forged control denied.
16. Configure exact valid five-field cron/timezone; invalid expression/timezone rejected without success. Switch to Manual only and confirm cron clears and no ticks. Disable cron and confirm active admitted Run is not implicitly stopped.
17. Disabled Schedule Run now admits real Run; success says admitted. Simulate lost ACK and retry same request ID to prove no duplicate. Show unavailable account/model/compute failures without fallback; poll real states and open output Chat.
18. Stop actual admitted Run, inspect acknowledged/uncertain/terminal states; revoke current access and observe denial. Delivery history pages actual receivedAt/outcome/Run IDs. Verify empty history has no mock activity and manual Run is not falsely added to delivery history.
19. Inspect desktop and mobile Schedule detail breadcrumb/people/body/panel/timeline/floating chat, panel toggle and all dialogs. Capture fresh screenshot/flow recordings on integrated bytes and compare composition to existing design.

## Exact source hashes

SHA-256 for delivered source bytes follows. Evidence file hash and lane commit are returned in the handoff to avoid self-reference.
71ec30c2061886541ed67b88c3103cef1fc264b28817e0339f76f90a7a300e87  apps/web/src/routes/agent-settings.tsx
dce9791c73f93841b92370a0ec600dca6b9ab267c4ed8676d9f72509c1b13b8e  apps/web/src/routes/schedules.tsx
e56d665e326149cde9dd67f5c0c4014c62552759326311c19b0a508ef0f0b60a  apps/web/src/components/agents-configuration-choice.tsx
957a7efc581040a83471dc7c724fa9f7b9f12b6462ee7a12f0b7d1a9e51afe9a  apps/web/src/components/agents-skills.tsx
022bcdfb7a7a2dba83fc7f64fbee30f64fcaa82d0eb56e8810fb8bfe5bcc9d55  apps/web/src/components/schedules-editor.tsx
