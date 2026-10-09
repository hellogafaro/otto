# Project UI lane

Source request: BB `thr_ea3andz7st`; implementation child `thr_dkqcji8u57`. Baseline `f89d8128ec26726e17b954b15fe64ca71825c376`. This is an implementation handoff, not browser acceptance or an independent review.

Owned files: `apps/web/src/routes/projects.tsx`, `apps/web/src/routes/project.tsx`, new `apps/web/src/components/project-controls.tsx`, this evidence file. Main checkout and `otto-ui` were untouched. The lead-authorized shared commits `df84b44bf6368aa009cd3f0118db50c0094542a4` and `00bf8019a137410228da777c199101a926c88951` were picked only as check dependencies; integrate only the lane commit.

## Action inventory

All workspace requests supply the current `workspaceId`. Project detail/subresources supply the actual Project UUID from the route. Query keys start `['workspace', workspaceId, ...]`. Mutation success invalidates the workspace after ACK; failures keep input and refresh archive/member reads to reconcile a possible lost ACK. No optimistic writes, fabricated success, browser credentials, object storage keys, mock IDs or runtime mock-record imports were added. Project metadata and membership have no edit token in the backend and no client token was invented.

| Surface / action | Supported seam and permission | State and behavior | Proof status |
| --- | --- | --- | --- |
| Project gallery | `GET /projects`, current readable memberships, active by default | Three-column gallery; real title/ID; loading skeleton, empty/no-match, error/Retry | Typed/build verified; browser unverified |
| Whole-word search, clear, sort, order | `GET /projects?query&sort&order`; title/createdAt/updatedAt allowlist | Validated URL fields, query ≤200 chars; changing a filter clears cursor | Parser input/output verified below; browser unverified |
| Active/archived toggle | `GET /projects?archived=true|false` | URL filter; clears cursor; archived records open for authorized reads | Typed/build verified; browser unverified |
| First/next Project page | `GET /projects?after&limit=100` | Opaque next preserved; First page remains available on cursor errors; no false totals | Typed/build verified; browser unverified |
| New project button / dialog | `POST /projects {title, repositoryUrl?}`, workspace owner/admin | Stock Dialog/Field/Input, required trimmed title ≤200, URL ≤2048; pending disables edits/close, Cancel before submission, retained input/error, navigate to acknowledged UUID; ambiguous transport/5xx outcome blocks repeat POST and offers Check projects; acknowledged UUID survives a navigation failure | Typed/build verified; browser unverified |
| Check projects / Close after ambiguous create | Refreshed `GET /projects` with active title search; no second POST | Explicit uncertain outcome, frozen submitted fields, disabled Save, Check projects or Close; matching titles never imply success | Typed/build verified; browser unverified |
| Open project after acknowledged create/navigation failure | Actual acknowledged Project UUID | Navigation retry uses retained UUID; no repeated creation | Typed/build verified; browser unverified |
| Gallery Open / tile | `/projects/$projectId` | Actual Project UUID; keyboard-operable link | Typed/build verified; browser unverified |
| Gallery Ask about it | Shared `useAskAgent`, actual Project mention and title | Delegates to the shared live chat flow owned by chat/lead lanes | Cross-lane browser unverified |
| Gallery and detail Copy link | Native clipboard, actual Project URL | Toast only after clipboard ACK; error on rejection | Code inspected; browser unverified |
| Project detail / breadcrumb | `GET /projects/:id`; current Project membership | DetailView composition; missing/denied/error uses QueryState and Retry; breadcrumb returns to Projects | Typed/build verified; browser unverified |
| Detail More / Edit project | `PATCH /projects/:id {title?, repositoryUrl?}`; workspace owner/admin AND Project contributor | Only changed metadata fields sent, empty URL clears with null, no-change closes without mutation; original dialog values retained during background refresh; no edit token | Typed/build verified; browser unverified |
| Repository link | Current `repositoryUrl` | HTTP(S) only becomes a clickable link, `noreferrer`; other server-valid schemes remain plain text | Code inspected; browser unverified |
| Detail Archive / Restore | `POST /projects/:id/archive {archived}`; same admin+contributor restriction | Pending disabled; real error retained; success toast only after ACK; archived state comes from server | Typed/build verified; browser unverified |
| Header members / member list | `GET /projects/:id/members?sort=name&after&limit=100` | Infinite bounded pages, More members pending/error/Retry; at most eight visible avatars; displayed loaded count has `+` while continuation exists; no fake empty count while pending/error | Typed/build verified; browser unverified |
| Current Project role | Paged `GET /projects/:id/members`, find current user | Independent lookup so the current user beyond the first 100 members still gets accurate controls; role error hides writes, Retry available | Typed/build verified; browser unverified |
| Add member dialog search / picker / pages | `GET /members?query&sort=name&after&limit=100`; current workspace human directory | Whole-word search, dropdown radio selection, Viewer default, name-sorted pages; search/page change clears selection; loading/empty/error/Retry | Typed/build verified; browser unverified |
| Add member Save / Cancel | `POST /projects/:id/members {userId, role}`; admin+Project contributor | Existing membership detected across pages and directed to Manage; pending disables edits/close; failure retains selection/role and refreshes memberships without claiming success; ACK closes | Typed/build verified; browser unverified |
| Manage member role | `PATCH /projects/:id/members/:userId {role}`; admin+Project contributor | Viewer/Contributor choices; current actor omitted; pending disables Manage; server checks open Task ownership before demotion; error explains transfer requirement | Typed/build verified; browser unverified |
| Remove member | `DELETE /projects/:id/members/:userId`; same permission | Current actor omitted; server task-owner checks remain authoritative; no optimistic removal; fresh reads reconcile the actual outcome | Typed/build verified; browser unverified |
| Tabs Overview / Tasks / Documents / Files | Validated `tab` URL parameter | Tabs preserve gallery/detail pattern; tab change clears tab-specific filters and cursor; no guessed global counts | Typed/build verified; browser unverified |
| Tasks tab / task row | `GET /tasks?projectId=<UUID>&query&sort&order&after&limit=100`; backend reader rules | Only enabled while selected; group current page by actual todo/doing/done; real owner via useDirectory; row opens actual Task UUID | Typed/build verified; browser unverified |
| Documents tab / tile | `GET /documents?projectId=<UUID>&query&sort&order&after&limit=100`; backend visibility/Project reader rules | Real-title gallery; opens actual Document UUID; no body-preview fetch or mock thumbnails | Typed/build verified; browser unverified |
| Files tab / tile | `GET /files?projectId=<UUID>&query&sort&order&after&limit=100`; current backend File/source audience rules | Includes actual Project Files, including nested-folder placements; opens `/files?project=<UUID>&open=<fileId>`; no task-derived fake association or download URL | Typed/build verified; cross-lane browser unverified |
| Tab search / clear / sort / order / first / next | Owning Tasks/Documents/Files list, explicit Project UUID | URL-scoped query, shared supported title/createdAt/updatedAt sorts; opaque after, 100 max; error/Retry and cursor reset recovery | Parser/typed/build verified; browser unverified |
| Chats panel / row / More chats | `GET /chats?projectId=<UUID>&sort=title&after&limit=100`; current readable Chat audience | Real title/ID navigation, bounded pages, pending/empty/error/Retry; no fake channel, urgency or activity timestamp | Typed/build verified; browser unverified |
| New chat panel row | `/chats/new?project=<UUID>` | Only current workspace nonviewer + Project contributor on unarchived Project; chat lane owns acknowledged creation | Cross-lane browser unverified |
| Detail floating chat | Shared FloatingChat with current Project ID/subject | Chat lane owns messages/Run admission and failures; no account/model fallback introduced | Cross-lane browser unverified |
| Panel toggle / section collapse | Shared DetailView/Section local presentation | Existing desktop/mobile sidebar behavior retained | Browser unverified |

## Removed mock controls and design decisions for lead

1. Keep the Project gallery/detail/tabs. Covers, description editor, transferable owner, status and priority controls are removed: the Project backend has no such fields. Gallery covers stay empty muted tiles; Overview shows the repository and real members.
2. Use one compact stock metadata dialog for New/Edit Project. This supports creation before Agent setup. Metadata updates are last-write-wins and send only changed allowlisted fields.
3. Place supported Archive/Restore in the detail More menu after the current Project role is loaded; gallery context menu has Open, Ask about it and Copy link. There is no Project delete endpoint.
4. Member management lives in Overview with stock role menus and an Add member dialog. Preserve backend ownership constraints and never expose self-removal/self-demotion.
5. Omit tab totals because bounded APIs return no exact totals. Header member count describes loaded entries, suffixed `+` when more exist. Chats sort by title; metadata `updatedAt` is never presented as recent message activity.
6. Tab gallery/rows open domain detail pages for edits, uploads and downloads. Files are filtered by their actual `projectId`, including folder placement, rather than inferred from mock Task references. Mixed library sorting remains within each kind in the File lane; this tab reads the File domain directly.

Lead must integrate these decisions into `DESIGN.md`; that file is outside lane ownership.

## Checks and observed input/output

- Frozen Bun install: verified, after checking root package name `otto` and using this checkout explicitly. No lockfile/manifest change.
- Scoped `bun --bun biome check`: verified on all three source files.
- Serialized web typecheck: verified after correcting New Chat search shape and File viewer's `open` key.
- Serialized web build: verified; Vite emits the existing large-bundle warning. The check does not establish browser correctness.
- `git diff --check`: verified.
- Production `validateProjectFilters` imported under Bun: valid `{query:'alpha beta', sort:'updatedAt', order:'desc', after:'opaque_cursor-1'}` remains identical; a 250-character query becomes 200 characters, injected sort and order become title/asc, unsafe cursor disappears; a 4097-character cursor disappears. These exercise URL parsing only, not backend authorization.
- PostgreSQL/native/browser suites: unverified, intentionally deferred to the integrating root. No fixture/provider/isolation/billing claims.
- Independent review: unverified; root must obtain review on integrated bytes.

Source SHA-256:

```text
7dc1989ca68f715afd0ea9abb564539f9d8006979d8fcbe9efc91375681d7049  apps/web/src/routes/projects.tsx
899ade52c18639b2e4fd237309aa0fce40498724acdde4320e6c6578d39d60fe  apps/web/src/routes/project.tsx
e7f7a89333ea2463bb139d8b181af6558e401db1b0f41cc993a0bbc8048b6712  apps/web/src/components/project-controls.tsx
```

## Pending integration items

- Root router integration is present in `76e6fbe`: `validateProjectsSearch` is applied and route search is passed to `ProjectsPage` (source inspected during this followup). The child checkout remains on its original lane baseline.
- Shared identity/chat browser behavior remains root acceptance work. The root `76e6fbe` ActorAvatar consumes the live directory (source inspected); this lane passes real IDs and avoids shared mock record helpers.
- Unsupported Project description/cover/status/priority/owner and delete stay removed. Product would need an explicit backend/model decision to add them.
- Fresh browser proof, permission fixtures and independent acceptance remain root work. No backend seam correction was needed for this lane.

## Numbered browser scenarios for integrated QA

1. As workspace owner/admin, create a Project from an empty gallery; cancel another draft; reject empty title/invalid URL; simulate a definitive 4xx rejection and retry retained values; refresh and confirm the acknowledged title/repository persist.
2. Edit only title while another session edits repository; ensure PATCH contains only title. Clear repository, reload, verify null/no link. Save unchanged form and confirm no mutation.
3. Archive, inspect archived gallery, reopen Project, confirm read-only content remains accessible and New chat is absent; Restore and confirm active list and current server state.
4. As workspace contributor/viewer and as admin with Project viewer role, verify metadata/archive/membership writes are absent. Revoke Project membership during an open page and verify errors do not show cached rows as current records.
5. Add Viewer and Contributor humans; search/paginate beyond 100 workspace members; cancel safely; retry failure with retained selection. Selecting an existing member must direct to Manage without changing a role.
6. Change a member role and remove a member; verify self has no Manage control. With an open Task owned by that member, demote/remove and confirm server refusal leaves membership unchanged; transfer Task ownership and retry successfully. Drop a successful member mutation response and verify fresh reads reconcile the actual role/member before retry.
7. With more than 100 Project members and current actor beyond page one, verify accurate write controls, eight-avatar preview, `100+` loaded count and More members; exercise membership error/Retry.
8. Load Tasks/Documents/Files in two Projects; confirm requests always include the selected Project UUID and backend visibility excludes inaccessible records. Click actual IDs to each domain detail/viewer; Files include nested-folder Files with that Project ID.
9. Whole-word search, sort asc/desc, Next and First page, direct URL reload and browser Back for gallery and each tab. Verify changed query/sort/tab resets after; inject malformed/foreign cursor, see actual error, then First page recovers.
10. Open readable Project Chats and create a Project-scoped Chat; paginate more than 100; verify no assumed channel or recency timestamps. Exercise floating chat/Ask after root chat integration without account/model fallback.
11. Copy links with clipboard allowed/denied; ensure success appears only after ACK. Test safe HTTP(S) repository opening and a server-stored nonweb URL remaining plain text.
12. Verify mobile and desktop gallery/detail/tab/sidebar behavior, keyboard menu/dialog focus, pending-disabled close/buttons, all empty/loading/error/Retry states, and no mock Project fields.

13. Drop the response after Project create commits, or return a 5xx outcome: the retained dialog explains uncertainty, fields and Save are disabled, and Check projects opens a refreshed active title search. Repeated Enter/Save must not send another POST. No automatic matching/opening of a same-title record occurs.
14. After a successful create response, force navigation failure. The acknowledged UUID stays in the dialog; Open project retries navigation without sending another create. Try rapid repeated submission while the first request is pending: only one request may be in flight.

## Followup self-inspection

The lead requested a narrow retry/permission/pagination audit during combined-suite execution. Source inspection confirmed that `createProject` inserts a new Project on every POST and has no request identity. The original UI could resend after a lost response, or after navigation failed following an acknowledged create. Creation now retains acknowledged UUIDs, blocks retries of ambiguous transport/5xx outcomes, and gives the person an explicit refreshed-list recovery path. The form has a synchronous in-flight guard as well as pending controls. Archive/member failures invalidate readable state to reconcile a possible committed mutation without claiming success.

Title-only metadata PATCH still sends only the changed title; repository links still permit HTTP(S) only; backend archive and Task-owner membership guards remain authoritative. Tab filter changes still clear cursors, error recovery retains First page, and each owning list request includes its actual Project UUID. The ProjectView current-actor membership block and its imports were deliberately untouched while the lead replaces that block with shared `useProjectMembership`.

Focused scoped Biome, serialized web typecheck/build, URL-parser input/output checks and `git diff --check` are verified for this followup. New lost-ACK UI behaviors in scenarios 13–14 remain browser-unverified until the root runs them. No PostgreSQL/native/browser suite ran in the child. Backend create idempotency is still unavailable: the UI makes uncertainty explicit rather than inventing a request identity or deducing success from a nonunique title.
