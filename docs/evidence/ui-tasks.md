# Tasks UI wiring lane

Source thread: `thr_z6xu7ypham`; integrating root: `thr_ea3andz7st`.
Baseline: `f89d8128ec26726e17b954b15fe64ca71825c376`.
Scope: Tasks list, task detail, Activity identity resolution and cohesive task helpers. No backend, common router, manifests, packages/ui or DESIGN.md edits belong to this lane. The exact owned revision is the signed-off commit containing this inventory; its hash is returned in the handoff.

Coordinated dependency originals: `df84b44bf6368aa009cd3f0118db50c0094542a4`, `00bf8019a137410228da777c199101a926c88951`, `d0e93b23da0a66fd4d635dc60ca5bc844bde9bae`. Local dependency picks are `6c48c44`, `8e752d7`, `20d8937`; exclude them from lane integration. The root already owns their originals.

## Action inventory

Every RPC supplies the current `workspaceId`; query keys begin `["workspace", workspaceId, ...]`. Query reads use Hono types and `read`, with abort signals on lane-owned reads. Mutations show the actual failure, retain input and invalidate the workspace only after acknowledgement. Pending forms disable submission/dismissal; cancellation before submission writes nothing. No optimistic success or mock runtime values remain in owned screens. Shared identity/chat components are integration dependencies; their browser acceptance belongs to the root.

| Surface/action | Production operation and scope | Authority, state and recovery |
| --- | --- | --- |
| Task list Project picker | Directory `GET projects`, sealed cursor pages, 100 per request | Explicit selected Project in URL; no cross-Project Task RPC when absent. Directory loading/error/retry. More projects fetches the next authorized page. |
| Whole-word search | `GET tasks` with `projectId`, `query` | URL query, max 200 chars; the server matches title/notes. No substring client filtering. Search submit resets cursor. |
| Owner filter / Me | `GET tasks` `ownerId`; Project-member look map | Me uses authenticated `user.id`; human IDs preserve case. Unknown URL selections get an unavailable identity label, not a fixture name. |
| Mixed assignee filter / Me | `GET tasks` `assigneeUserId` or `assigneeAgentId` | URL uses `user:<id>` / `agent:<UUID>` to preserve actor kind. Me resolves to the current human. More Project members / agents load bounded picker pages. Unassigned option removed: no API predicate. |
| Status filter, chips, remove, clear | `GET tasks` `status=todo|doing|done` | Real lifecycle only. Clear keeps the explicit Project and resets other filters/cursor. |
| Sort/order | `GET tasks` `sort=title|createdAt|updatedAt|dueAt`, `order=asc|desc` | URL allowlist, SQL ordering before the limit; order requires a sort. Changing either resets `after`. |
| Archived filter | `GET tasks` `archived=true` / default false | URL selection; active/archived records are separate server pages. |
| First / next page | `GET tasks` `after`, `limit` | Opaque cursor, max 4096 chars; integer limit 1–100, default 100. No client-generated cursor. Groups/counts describe the returned page. |
| Status groups collapse | Existing ListGroup composition | Todo, In progress, Done; empty groups hidden, Done initially collapsed. No review state. |
| Task row open / context Open | `/tasks/<actual id>` | Real server ID; group spacing, actual dates and owner plus all assignees preserved. |
| Row context Ask about it | Shared `useAskAgent`, real Task mention | Opens the shared draft with actual Task identity; shared Chat/Run admission and account handling are root/Chat-lane acceptance. |
| Row/detail Copy link | Clipboard API, current-origin Task URL | Await clipboard acknowledgement; error toast on failure. No success toast before copying. |
| New task | `POST tasks`: required selected Project, human owner, title, notes, dueAt, recurrence, two assignee arrays | Current workspace/Project writer UI gate; current server authority is final. Empty title blocked; save/dismiss disabled pending. Success navigates to returned ID. Lost non-HTTP acknowledgement reports that persistence is unconfirmed and asks the person to check the list before resubmitting. |
| Detail fetch/not found | `GET tasks/:id` | Loading/error/retry; 404 explains unavailability. Read failures hide the detail rather than rendering cached mock/state data. |
| Edit title/properties | One allowlisted `PATCH tasks/:id` with original `editToken` | Dialog captures the original Task baseline. Only changed fields are sent; unchanged sub-minute due dates, notes and retained assignments keep their exact server values. Empty/no-change submit disabled. Conflict preserves draft and says to cancel/reopen against current state. |
| Description rich editor, formatting, Save / Cancel | Existing Markdown Editor; `PATCH tasks/:id` with notes and original `editToken` | Explicit Edit description enters the draft. Save keeps the captured token through refetches; cancel restores current server notes. Read-only without current writer access or during save. Formatting is local until Save. |
| Human owner transfer | Allowlisted Task PATCH `ownerId` | Current owner or workspace admin/owner, intersected with current Project writer access. Candidates are Project contributors; known workspace viewers excluded. Server checks current eligibility. No Agent owner option. |
| Mixed assignees / clear | Task PATCH `assigneeUserIds` / `assigneeAgentIds` | Independent 20-per-kind bounds. Project contributor humans and visible unbound/same-Project Agents; currently retained selections stay readable/removable. Unchanged kinds are omitted. Assignment gives no permission or automatic Run. |
| Due date / clear | Task PATCH `dueAt`, nullable offset ISO on wire | Browser-local datetime input. Unchanged input omits dueAt, preserving precision and ambiguous DST instants. Blank changed input clears. |
| RFC recurrence / clear | Task PATCH `recurrence`, nullable DTSTART+RRULE | Raw server-supported RFC form, max 400 characters with server byte/grammar enforcement. Placeholder is an RFC example, not submitted data. No fake presets or client recurrence evaluator. Errors retain the text. |
| Status radio + S/number shortcuts | `POST tasks/:id/status`, actual status plus `editToken` | Human session with current Project writer access. Pending renders actual read-only status. Backend enforces human Done, owner eligibility for reopen, recurrence and fencing. Errors are shown; Reload/Retry fetches current state. |
| Archive / Restore | `POST tasks/:id/archive` with boolean and `editToken` | Current human Project writer; caption follows real archived value. Pending disables actions. No Delete menu. |
| Project breadcrumb, details toggle | Actual Project link; existing DetailView panel | Project is immutable on Tasks; the old simulated Project reassignment menu is gone. Stock panel open/close remains. |
| Previous / next occurrence | Actual `predecessorId` / `successorId` links | Only server-returned occurrence relationships appear; no client-created successor. |
| Task floating chat | Shared FloatingChat with actual Task id, title and Project id | No local comment creation or fallback account/model; shared Chat lane/root must verify its actual execution/admission. |
| Activity timeline | Actual Task `createdAt`; ActivityEvent names from directory | Creation timestamp is shown without inventing a creator attribution. No manufactured audit events/comments. Explicit unavailable-history text replaces fixtures/composer/replies. |
| Links section read/page | `GET tasks/:id/links`, `sort=type`, 100 per request | Server authorizes each reference. Loading/error/retry/empty/more. Failed reads hide cached entries. Target labels are fetched through their owning authorized domain. |
| Link target open/retry | Authorized Document/Chat/File GET; HTTP(S) URL | Real titles; unavailable target does not show a stale title. Documents/Chats use their actual detail routes; Files use `/files?open=<id>` with the target’s actual Project when present. URLs open separately with noopener. Target retry available. |
| New link type/target/search/scope | `POST tasks/:id/links`; bounded owning-domain list of Documents, Chats or Files | Stock dialog for URL/Document/Chat/File. Defaults to the Task Project; Only this project can be cleared for other authorized workspace targets. Active/archived target toggle. Whole-word search, title sort, bounded cursor pages. Changing type/search/scope clears selected reference. No raw arbitrary internal ID entry. |
| Remove link | `DELETE tasks/:id/links/:linkId` | Current Task writer; pending disables removal; errors shown and workspace invalidated after ACK. No simulated upload/delete. |
| Manual time read/page/total | `GET timesheets` with Task id, `sort=createdAt`, descending, 100 per page | Task readers; load more via server cursor. Total covers loaded entries and is explicitly marked loaded when more remain. Empty/loading/error/retry. Failed reads hide cached entries. |
| Time entry row/hover | Actual duration, `createdBy`, immutable logging `createdAt`, notes | Whole-minute formatting; names resolve from directory. No Agent runtime, fabricated logging date or timer. |
| New time | `POST timesheets` with Task id, duration and nullable notes | Current human Task writer even on Done/archived Tasks. Positive whole minutes; server byte/upper bounds. Draft retained on failure. Non-HTTP lost ACK reports unconfirmed persistence before manual retry. |
| Edit own time | `PATCH timesheets/:id` duration/notes | Only the creator human with current Task writer access. Other people’s rows show hover information without editing; no admin bypass. No editToken invented. |
| Delete own time | `DELETE timesheets/:id` | Same creator/writer gate, including Done/archived Tasks; pending disables repeated removal. Errors remain visible; ACK invalidates. |
| Dialog cancellation/pending | Local transient state only | Explicit Cancel and stock close before a request; all fields/action controls and dismissal disabled while saving. No fake transient record added to lists. |

## UI decisions for the lead to integrate into DESIGN.md

- Keep Page, ListGroup, DetailView, right-panel Section, People, Markdown Editor and Timeline composition. Show the backend’s three statuses; omit unsupported review/priority/delete controls.
- Use compact stock dialogs for direct Task creation/allowlisted edits, mixed assignees, RFC recurrence, links and manual time while Agent setup is unavailable. Task-assignee checkboxes occupy a bounded scrolling FieldGroup so larger directories do not dominate the dialog. Shared searchable pickers and shared directory paging are reused.
- Description changes use an explicit Edit description / Save description / Cancel draft so persistence and stale edits are visible. The rich text composition stays intact.
- The former fake task-file upload becomes real Links (URL, Document, Chat, saved File). Binary upload/viewing remains the canonical Files screen’s responsibility.
- Remove simulated comments/replies/attachments and label unavailable activity history. Retain the real creation timestamp without inventing an author.
- Time entries are manually entered whole minutes and immutable logging time; use a stock correction dialog and creator-only delete. Loaded-page totals say loaded when incomplete.

## Observed checks

| Check | Actual result |
| --- | --- |
| Verified repository package name and `bun install --frozen-lockfile` in explicit assigned checkout | Verified: package name otto; frozen install exit 0; no manifest/lock changes. |
| `bun --bun biome check` over the six owned source files | Verified: six files, zero diagnostics after fixes. |
| Production `validateTasksSearch` input/output assertions | Verified: real UUID/actor-kind/status/sort/order/limit/query/cursor survive; human ID case survives; injected sort, review/priority, old unassigned filter, bogus Project, >4096 cursor and out-of-bound/fractional limits are removed; order without sort removed. |
| Production `taskDueInput` input/output assertions | Verified in UTC, Europe/Berlin and America/New_York: `2026-10-05T09:00:00.000Z` displays 09:00, 11:00 and 05:00 respectively, each yielding that same instant when interpreted locally. Null yields empty. This checks display/conversion only; unchanged-field preservation and persistence still need browser QA. |
| Serialized `flock /tmp/otto-ui-wiring-check.lock -c 'bun --bun run --cwd apps/web typecheck'` | Failed only on unowned `routes/project.tsx:268`, whose baseline caller still supplies mock Task[]. No owned-source diagnostic. Prior run also found Inbox’s old mock caller; the coordinated Inbox dependency removed it. |
| Serialized web build using the same lock | Failed at the same unowned Project caller’s TypeScript check; Vite build did not run. Root must verify integrated bytes. |
| `git diff --check` and staged-content inspection | Verified before signed-off commit; only owned source and this inventory staged. |
| Browser, persistence, permission/fencing, PostgreSQL/native suites, independent review | Unverified in this child by explicit assignment. Root coordinates actual integrated-server/browser checks and review. No screenshot, review verdict or UI-completion claim is made. |

Scratch assertions ran from thread storage against production exports with a controlled current-origin Window stub (no RPC); Bun emitted its `tsconfig-override` directory-mismatch warning, but each process exited 0 with the recorded outputs. These checks prove no persistence, native isolation, account qualification or billing.

## Pending items

1. Root/Project lane must replace the unowned mock Task[] caller before integrated type/build can pass. This lane exports `Task` from `@/lib/task-data`; TaskGroups/TaskRow consume that exact Hono response shape.
2. Backend has no Task priority, review status, deletion, comments/replies/comment attachments or audit-history API. Controls/fixtures are removed; history is explicitly unavailable. Product/API decisions are required to add those features.
3. Backend has no Task Project move, unassigned discovery predicate or Timesheet logging-date override. Project is a navigation row; the filter and mutable date controls are removed.
4. Shared page hotkeys may fire while a modal checkbox/button has focus because the common useHotkey typing guard does not check overlays. Tasks suppresses S during its metadata dialog; root has the source-observed concern and must verify/gate the common handler for link/time modals if reproduced.
5. The root must integrate the listed UI decisions into DESIGN.md, test the shared FloatingChat/Ask flow against exact configured accounts, run actual browser acceptance and obtain independent review on integrated bytes. The child did not select or fall back to an account, model, compute provider or billing channel.

## Numbered browser scenarios for integrated QA

1. Sign in to an actual workspace; open Tasks with no Project. Confirm no Task list RPC is sent. Select an authorized real Project; verify loading, empty state, retry after server error and real rows. Open an inaccessible/wrong-workspace Project URL and verify denial without fixture/cached rows.
2. Seed more than 100 Tasks via the actual API. Check all four sorts in both directions; use Next/First and confirm no duplicate/omitted IDs with stable data. Refresh/share the URL. Verify owner Me, human/Agent contains filters, status, whole-word query and archived selection. Change a filter after paging: after must reset. A substring-only query must not invent client matches.
3. With more than 100 accessible Projects, Agents and Project members, load the next picker pages. Check names are real, Task ID and Project scope stay correct, and human IDs retain case. Ensure the authenticated writer can become available after its membership page is loaded.
4. Create a Task before any Agent account is configured: required human owner, real title/notes, one eligible person and one visible compatible Agent if available. Cancel once and assert no POST. Submit once with a delayed real server ACK: duplicate submit and dismissal are disabled, no row appears before ACK. Reload and verify returned Task values persist.
5. Edit title/notes/owner/mixed selections; replace and clear each assignee kind independently. Test 20 selections per kind and inability to pick a 21st. Check stale/ineligible Project members, workspace viewers and an Agent bound to another Project are refused without side effects by the server. Non-owner/non-admin cannot transfer ownership; an eligible owner/admin can.
6. Save a due date, then clear it and reload. Start from a backend dueAt containing seconds/milliseconds or a repeated DST instant; edit only title and assert dueAt is byte-equivalent on the wire/response (PATCH must omit it). Verify browser-local input in supported viewports/time zones.
7. Enter a valid RFC DTSTART/TZID + RRULE, save and reload canonical recurrence. Submit unsupported rule parts, >400-byte Unicode input or an empty/no-occurrence rule: the server refusal must retain input. Clear recurrence. With a valid future repeat, complete the Task and verify exactly one actual successor, copied eligible assignees and the actual Next occurrence link. Reopen/recomplete and verify no second successor.
8. Change Todo → In progress → Done and reopen through radio/keyboard controls. Verify actual state remains while pending, errors visible, no review option and server-side human/permission enforcement. Use two tabs with one token: winner saves; loser gets conflict and retains its draft. Cancel/reopen to use the current version; no automatic token rebase.
9. Edit description with the rich editor (Markdown headings/list/link/table), save and reload. Cancel a changed draft and verify no PATCH. While one tab edits, mutate status/title elsewhere; description save must conflict with its original token, retain draft and tell the person to cancel/reopen. Test read-only behavior after writer access is revoked.
10. Archive from More, query archived list, Restore and query active list. Confirm true server booleans/tokens, pending disablement and actual failure recovery. Verify no Delete/priority/mock Project-reassignment action. Open actual Project link; check panel collapse and responsive sheet.
11. Add HTTP(S), Document, Chat and saved File links through real endpoints. Exercise whole-word target search, Project/workspace scope, active/archived target lists and >100 target cursor pages. Reject non-HTTP(S) URL and inaccessible target without fake success. Open each authorized target, including the `/files?open=<id>` viewer; inspect returned title and bytes where applicable. Revoke target access and verify title becomes unavailable, with retry; remove the link and reload.
12. Add positive whole-minute time with notes; reject zero/fraction/out-of-range duration and oversized byte payload. Reload and verify immutable creator/logging time, actual notes and duration. Edit/delete one’s own entry on active, Done and archived Tasks. Another human, including an admin, must have no edit/delete control and the server must deny forged requests.
13. Create >100 actual Timesheets, load next pages and confirm logged-time order, no duplicate IDs and correct sums of loaded durations; partial total must say loaded. Hover entries, correct one’s own duration/notes and confirm persistence. Trigger a read denial and verify cached entries are hidden, not presented as successful fallback data.
14. Simulate loss of acknowledgement after a real Task/Timesheet creation reaches the server. Verify the form says persistence is unconfirmed, retains input and tells the person to inspect the list before another create. No automatic retry or success toast. Retry read failures and test delayed mutation ACKs across dialogs.
15. Check Task row open/context Open/Ask/Copy and detail Copy (including denied Clipboard API), breadcrumb/occurrence links, Project navigation and panel toggles. Check Activity displays actual creation time without invented author/comments; FloatingChat must use actual Task/Project identifiers and the exact admitted account/model with no fallback. Test keyboard focus, labels, dismissal, narrow-screen layout and light/dark rendering; retain screenshots/interaction recordings on the integrated revision.

## Source SHA-256

| File | SHA-256 |
| --- | --- |
| `apps/web/src/routes/tasks.tsx` | `508b6071dfd3959567d2f4725ddd49af36ca7eab3fbdc4428a1bc866431f1514` |
| `apps/web/src/routes/task.tsx` | `78709d03551b5dccdd879b051ff463fadbfde13cbead32582b02970ac09cd699` |
| `apps/web/src/components/activity.tsx` | `52030dab5019d8ad887c648f725f6d58104c5d2140344967159a8355fa37ab7d` |
| `apps/web/src/lib/task-data.ts` | `53ed6e3b7dbfd7eeea0e8b4cb15a6060775fb8bdcb93fabe4449ba73da42270c` |
| `apps/web/src/components/tasks/task-form.tsx` | `0245026da050bc711924997350d6f265c27dd6a538f77942f2ea15a66955fdbe` |
| `apps/web/src/components/tasks/task-sections.tsx` | `604760549112beadaa4ec90fd84e56c68d528abba242ff36dd4f6c933a28cae4` |
