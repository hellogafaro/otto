# Documents lane implementation handoff

Source: Cody UI Temp root `thr_ea3andz7st`; child `thr_btebyc86ac`.
Baseline: `f89d8128ec26726e17b954b15fe64ca71825c376`.
Scope: `routes/documents.tsx`, `routes/document.tsx`, new cohesive Document helpers, this record. The lane implementation changes no manifests, common router/editor, UI primitives, backend, DESIGN.md, main checkout, otto-ui, secrets, Notion, task state or tracked time. Three coordinated common commits were cherry-picked into this isolated lane solely as local check dependencies: df84b44bf6368aa009cd3f0118db50c0094542a4, 00bf8019a137410228da777c199101a926c88951 and d0e93b23da0a66fd4d635dc60ca5bc844bde9bae; exclude those commits from the owned handoff.

This is implementation evidence and an integration handoff. Fresh browser use and independent acceptance are **unverified** and owned by the root. The controlled input checks below do not prove permissions, database transactions, browser behavior, storage, accounts or native execution.

## Action inventory

All requests use the shared typed Hono client and authenticated workspace param. Query keys start `["workspace", workspaceId, ...]`. Mutations await HTTP acknowledgement and then invalidate the workspace. The backend remains the authority for current permissions, destination scope and attachment audience. No optimistic writes or production mock fallback remain in these routes/helpers.

| Surface / action | Production operation | Permission / fence | Loading, error, pending, cancel and proof status |
| --- | --- | --- | --- |
| Documents gallery / title / opening text | `GET /documents`, per-tile `GET /documents/:id` | Current readable rows only; real IDs; 24 tiles by default | Skeleton/error/Retry for list; tile displays loading/error and hides retained body after a failed read. No mock covers/excerpts. Browser unverified |
| Search | `GET /documents?query=` | Whole words, max 200 characters | Explicit submit, URL-backed; search draft resyncs on URL navigation. Browser unverified |
| Created-by filter / Me | `createdBy=` | Me resolves authenticated human ID; Documents are human-created, Agent identity appears in proposals | Cursor-paged live human directory with Load more people; selected missing identity has an unavailable label, never a fabricated person. Browser unverified |
| Project filter | `projectId=` | Valid UUID/current authorized Project | Cursor-paged live directory with Load more projects; project display title is not an ID alias. Browser unverified |
| Label filter | `label=` | Exact case-sensitive label, max 200 characters | Options from live visible page plus current selected label; a stock exact-label input and validated URL support arbitrary label filters. Browser unverified |
| Visibility filter | `visibility=user|workspace` | Existing one-field visibility model | Only me / Workspace; invalid aliases are rejected by URL validation. Controlled validation verified; browser unverified |
| Collection filter | `collectionId=` plus `GET /collections` | Valid UUID/current readable Collection | Cursor-paged filter options with Load more; unavailable current selection retained safely. Browser unverified |
| Active / Archived filter | `archived=true|false` | Read rules remain in backend | URL-backed, resets cursor. Browser unverified |
| Sort / order / page size | `sort=title|createdAt|updatedAt`, `order=asc|desc`, `limit=1..100` | Backend SQL ordering before limit | Default last-edited descending, explicit sort without order uses ascending; page size 24/50/100 plus valid URL size. Controlled bounds verified; browser unverified |
| Next / First page / Clear / remove filter | `after=<opaque next>` | Cursor forwarded unchanged with same query | Changing filters/sort/size clears cursor; Next disabled during fetch; end uses `next`, not item count. Browser unverified |
| New document icon / dialog | `POST /documents` | Human workspace writer, Project contributor if selected; server derives creator | Title/body/labels/visibility/Project/folder; cursor-paged Project selection; default user visibility; local UTF-8/label/title limits; pending blocks duplicate submit/close; errors retain input; Cancel before submit. ACK then navigate to returned ID. Browser unverified |
| Open tile / context-menu Open | `/documents/$documentId` | Actual returned document ID | Full GET reports inaccessible/not-found with Retry. Browser unverified |
| Context-menu Ask about it | Shared `useAskAgent`, prompt with real document path | Shared Chat/Run admission remains root-owned | No fabricated response or success. Browser unverified |
| Context-menu Copy link (C) / detail More Copy link | Browser clipboard | Actual route ID; no backend grant implied | Await clipboard before success; failure reported. Shared More implementation is lead-owned. Browser unverified |
| Context-menu Archive / Restore (A) | `POST /documents/:id/archive` | Creator + workspace writer + Project contributor; current editToken | Pending disables repeat; success after ACK; cache receives returned document; error toast. Browser unverified |
| Breadcrumb / Project link / panel toggle | Existing detail and real Project routes | Project fixed at creation | Existing DetailView composition retained; Project is a link or No project. Panel toggle/More shared with lead. Browser unverified |
| Author/avatar | Document `createdBy`, `useDirectory.actorOf`, shared ActorAvatar | Immutable server identity | Real directory; unavailable identity is explicit. Shared avatar wiring is lead-owned. Browser unverified |
| Title editor / Tiptap body editor | `PATCH /documents/:id` | Creator writer + Project contributor; draft's original editToken | Explicit Save/Cancel; pending locks editor and fields; local validation; failed saves retain draft; background change never replaces dirty draft; clean drafts follow refreshed data; stale drafts require Cancel/reload. Browser unverified |
| Visibility / labels editor | Same allowlisted `PATCH` with body/title/folder | Same original editToken; attached File audience rechecked by backend on visibility edits | Labels are trimmed nonempty lines (max 30, max 200 each); widening inside private folder can fail truthfully; no ACL aliases. Browser unverified |
| Folder placement / top level | Same `PATCH {folderId,editToken}`; `GET /folders` | Same Project; readable writable destination; private Folder only creator's user items | Cursor-paged eligible options; top level sends null; pending/load/error states; immutable Project is not changed. Browser unverified |
| Read-only folder property | `GET /folders/:id`, Files folder link | Current readable ancestors | Actual authorized path, error/Retry; top level explicit. Browser unverified |
| Save document / Cancel / unsaved marker / navigation guard | One atomic PATCH / local reset | Original source editToken; no edit-history model | Unsaved status; browser history/leave guard; Cancel remounts Tiptap to latest acknowledged/read body; conflict Retry fetches without reapplying the draft. Browser unverified |
| Detail Archive / Restore | Same archive API | Creator writer; current token | Disabled during pending or unsaved main document edits; returned record resets editor after ACK. Browser unverified |
| Attachments read / open | Document `fileIds`, `GET /files/:id`, `/files?open=<id>&project=<id>` when scoped | Current File read rules | Bounded saved set (max 30); title/read loading/error/Retry; viewer/download owned by File lane. Browser unverified |
| Attach saved File dialog | `GET /files`, `PUT /documents/:id/attachments` | Creator writer; editToken; full Document audience checked for every File | Paged saved-file selector; duplicate IDs excluded; 30 max; pending/Cancel/error retain selection; ACK then close. File upload remains Files flow. Browser unverified |
| Remove attachment | Same PUT with bounded replacement IDs | Same creator/current token/audience | Disabled during pending or dirty main document draft; no byte deletion. Browser unverified |
| Browse active / archived Collections | `GET /collections?archived=` | Current readable same-Project Collection | Paged options; selectable archive state exposes restore/manage; current Collection fetched directly even archived. Browser unverified |
| Assign Collection / edit properties / Save / Cancel | `POST /documents/:id/collection` | Creator writer; Collection same Project and active; property draft's captured editToken | All field types: text/number/date/checkbox/select/human/agent/document; cursor-paged live identity/Document selectors; numeric finite check; bounded strings; stale property draft retained and blocked; Cancel uses current document. Browser unverified |
| Document reference field | `GET /documents?query=&sort=title` | Authorized Documents, actual IDs | Cursor pages and whole-word discovery; unavailable current reference is explicit, never synthetic. Browser unverified |
| New Collection dialog | `POST /collections` | Human workspace writer + Project contributor | Same current document Project, title + max 50 fields; supported 8 field types; stable generated field UUIDs; max 100 choices; pending/Cancel/error retain draft. Browser unverified |
| Manage Collection title / view / fields | `PATCH /collections/:id` | Human workspace writer + Project contributor; modal's original Collection editToken | Existing field types frozen, existing choice removal refused by backend; field titles/options and new fields editable; view table/list persisted; Cancel retains server record. Browser unverified |
| Collection archive / restore | `POST /collections/:id/archive` | Same writer + original token | Pending disabled; disabled while metadata draft dirty; archive/restore separate from metadata edit. Browser unverified |
| Proposals list / author / proposed body / Load more | `GET /documents/:id/proposals` | Current document reader | Title ordering, bounded 100 per request, cursor; author uses agentId when present else proposerId; read-only Tiptap body; loading/error/Retry/empty. Browser unverified |
| Propose a change dialog | `POST /documents/:id/proposals` | Workspace writer with current Document read access (Project viewer can propose); captured document editToken | Title/body validation; original source frozen through refetch; pending/Cancel/error retain draft; no body change until accepted. Browser unverified |
| Accept proposal | `POST /documents/:id/proposals/:proposalId/resolve {accept:true}` | Creator writer + Project contributor; backend checks proposal token | Disabled for stale proposal or dirty main draft; after ACK fetch resulting Document then reset/cache/invalidate. Browser unverified |
| Reject proposal | Same resolve `{accept:false}` | Creator writer + Project contributor | Stale proposal can be rejected; backend ACK/invalidate; errors explicit. Browser unverified |
| Floating chat | Existing FloatingChat with actual Project ID | Root-owned Chat/Run authority, account and admission | No account/model/run fallback introduced. Browser unverified |

## IDs and unavailable flows

No hardcoded entity IDs remain. The only picker sentinels are empty string for no selection/top level and `me` translated to the session user. Document/Project/Collection/Folder/File/proposal IDs come from authorized RPC responses or strict URL input. Collection field IDs are newly generated UUIDs and remain stable. DOM input IDs identify fields, not backend entities.

| Removed or unavailable action | Concrete reason / pending decision |
| --- | --- |
| Delete document | No hard-delete endpoint; Archive/Restore implemented instead |
| Change an existing Document's Project | PATCH has no Project field; Project is selected during creation and fixed by domain scope |
| Document cover/image metadata | No image/cover field in Document API; gallery uses actual body excerpt and detail has no fabricated cover |
| Remove Document's Collection association | Collection association endpoint requires collectionId; no null/detach operation. Existing association has no misleading None action |
| Existing Collection field deletion/type change or removal of old select choices | Backend intentionally preserves existing saved-property compatibility; field type/removal UI restricted, incompatible choices report backend conflict |
| Collection table/list rendering | API view persists; these owned Document routes retain gallery/detail composition. No standalone Collection router/page exists in lane scope; decide/add a Collection route through lead if the product needs database browsing |
| Direct attachment upload here | Document attachments select saved Files; upload/download/viewer are Files lane and require configured storage, not an invented Document upload endpoint |
| Per-user ACLs, realtime document coediting, version history | Deliberately absent in current model; no fake controls added |
| Native account/model execution | Shared chat admission depends on qualified exact account/compute; root-owned, no fallback |

## Design decisions for lead to integrate into DESIGN.md

1. Preserve 4:5 Document body-excerpt gallery and shared DetailView author/editor/Properties composition. Backend has no Document cover metadata.
2. New Document uses a compact stock Dialog with FieldGroup/Input/Textarea and live Project/visibility/folder choices. This permits supported authoring before Agent setup.
3. Document content and metadata form one explicit Save/Cancel transaction under editToken. Show an unsaved marker, preserve failed/stale drafts and warn on leaving. Remount Tiptap on acknowledged resets/lock changes because shared Editor does not apply a new initial value/editable flag automatically.
4. Existing Project is read-only. Creator-only visibility/labels/folder edit choices appear in Properties; current author and read-only users use real directory/metadata.
5. Attachments, Collection and proposals are compact body sections below the editor. Collection/proposal creation/management uses stock dialogs; native field kinds retain their backend meanings. No new shared look or token was changed.
6. Stock dialogs cap their height and scroll within small viewports; shared directory selectors expose Load more people/agents/projects.
7. Document menus archive/restore and await acknowledgement; no Delete. Shared detail More remains copy-only with a visible archive/restore action in its header.
8. Discovery has URL-backed whole-word search, typed filters, explicit sort/direction/page size, and server cursor navigation. Mixed Files library semantics are untouched.

## Initial lane checks

| Check | Status | Observed evidence |
| --- | --- | --- |
| Repository identity + frozen Bun install | Verified | package.json name `otto`; `bun install --frozen-lockfile --cwd <assigned checkout>` exit 0; no package/lock diff |
| Scoped Biome check | Verified | Owned routes/helpers formatted and linted; final check exit 0 |
| Web typecheck, serialized | Verified | `flock /tmp/otto-ui-wiring-check.lock -c 'bun --bun run --cwd apps/web typecheck'`, exit 0; earlier inference/import/narrowing findings fixed |
| Web production build, serialized | Verified | Same flock with web build; tsc + Vite exit 0; existing broad bundle exceeds Vite's 500 kB warning threshold |
| Controlled production input helpers | Verified | Six real helper input-to-output checks below; minimal window import shim only, no app/browser/backend claim |
| Whitespace/staged-content check | Verified before commit | `git diff --check` and staged diff inspection |
| Browser flows, mobile/desktop, history and keyboard | Unverified | Reserved for root on integrated bytes |
| Real HTTP/DB permissions/folder/audience/concurrency | Unverified | Heavy private PostgreSQL/native suites explicitly reserved for root; backend source inspected, not runtime-qualified here |
| Independent acceptance | Unverified | Root must review integrated current revision in a fresh independent thread |

Controlled helper results:

| Input | Output observed |
| --- | --- |
| Valid scoped UUIDs, 100 limit, opaque cursor, sort/order, whole words | All preserved by production validateDocumentsSearch |
| Mock Project p1, body sort, private visibility, limit 101, 4097-character cursor, direction without valid sort | All invalid values omitted by production URL validator |
| ` Design ` + blank line + `Spec` | `Design` and `Spec` labels |
| 50,001 UTF-8 `é` characters | Byte-limit error |
| 50,000 UTF-8 `é` characters | Accepted exactly 100,000 bytes |
| Empty title / 31 labels | Validation errors |

The first plain Bun route import failed because the shared Composer reads window at module evaluation. The successful controlled input checks supplied a minimal `window.location` shim before importing real production helpers. This is a Node/Bun import constraint, not a browser-flow pass.

## Numbered integration browser scenarios

1. Sign in as contributor, select workspace, open Documents with no rows. Confirm empty state and direct New dialog; create user-visible document without Project and reload returned route. No fixture labels/images or fake success.
2. Create workspace document in a real Project and eligible nested Folder. Verify body/title/labels/visibility/project/folder persisted after refresh; creator identity is signed-in human.
3. As workspace viewer, confirm no create/direct edit/archive/proposal controls. As noncreator writer, confirm document is read-only but proposing is available. As Project viewer + workspace writer, confirm proposing remains available, direct edits/archive/Collection management unavailable.
4. With at least 130 permitted Documents, use 24/50/100 page sizes; walk Next to next=null, First, both orders and each sort; latest/title ordering agrees with backend before limit. Reload URL and browser Back/Forward restores filters/search.
5. Combine creator Me/person, Project, exact label, visibility, Collection, archive and whole-word query; verify requests use correct names and IDs, scopes remain constant over opaque cursor, and any filter/sort/page change clears after.
6. Open malformed URL input p1/private/body-sort/101 limit/oversized cursor; verify safe validated values and no bad backend params. Tamper a valid sealed cursor and confirm actual request error with Retry, no mock fallback.
7. Open document title/body editor; use Tiptap headings/lists/table/link/checklist and save. Reload verifies Markdown persisted; Save disabled during request and clean afterwards.
8. Edit body/title/labels; cancel restores actual server bytes and Tiptap. Leave via link/history/refresh with dirty draft; discard warning appears; cancel warning retains draft.
9. In a second tab edit the same document while first has dirty draft. Refetch first: draft stays, Save blocked as stale; Cancel loads latest. If unseen concurrent update arrives on PATCH, backend 409 appears without draft loss; Retry fetches and never silently retries PATCH with a new token.
10. Visibility and folder placement: move to top level, nested same-Project folder, switch user/workspace. Reject cross-Project/private-folder widening; actual error persists draft. Read-only reader sees authorized Folder path/link.
11. Archive in detail and gallery menu; active list excludes it, archived filter lists it, restore persists. Verify creator permission denials/current tokens and no Delete menu. Copy uses actual URL and clipboard errors do not show success; Ask includes real Document link.
12. Attach readable saved File; reload attachment title and open /files viewer with correct Project scope. Try File that cannot serve Document audience; backend denial keeps selector/draft, no fake attach. Remove attachment without deleting bytes; verify max 30/dedup and paged File selector.
13. Create Collection for current Project with all eight field types and select choices; choose it, fill properties via real human/agent/Document IDs, save, reload. Check finite numeric/date validation and author-only property editing.
14. Edit property draft while second tab modifies Document; property token remains original, stale property save disabled, draft preserved, Cancel resyncs latest. Dirty main document blocks relation mutations and acceptance.
15. Manage Collection title/field titles/view/new fields; Save persists. Existing type/removal stays unavailable; removing old select choice returns conflict with retained modal input. Concurrent Collection edit returns conflict, never adopts fresh token silently.
16. Archive Collection, browse archived options, manage/restore, reselect/save properties. Association cannot be falsely removed by choosing None. Verify same-Project rule and contributor/viewer restrictions.
17. Submit proposal as noncreator writer; Document body remains unchanged. Creator sees actual author and full proposed body; Accept updates title/body and consumes proposal; Reject consumes proposal without changing body.
18. Advance Document editToken after proposal creation; Accept disabled with stale explanation, Reject allowed. Test 409 race after accept click and confirm no fake success; paged proposal reads and Retry work.
19. Disconnect network during read/mutation and restore it. Read errors use Retry; pending submit cannot be doubled; save/property/attachment/proposal drafts remain; refresh to reconcile uncertain create/control outcome before retrying.
20. Repeat principal flows at narrow mobile and desktop widths; inspect stock dialogs, long labels/title wrapping, Project/folder picker pagination, panel toggle, Tiptap reset, keyboard Copy/Archive and real shared FloatingChat. Capture fresh root-owned screenshots and interaction recording.

## Followup correction on root `76e6fbe`

The followup uses root revision `76e6fbe` only as its local check dependency. The signed correction contains only owned Document routes/helpers and this evidence. Project membership paging/authority (`useDocumentWriter`, reviewer F1) remains root-owned and unchanged; the only `document-data.tsx` edit disables the entire DocumentChoice combobox and ignores late selection events while disabled.

| Reachable finding | Correction / action state | Proof |
| --- | --- | --- |
| Attachment/property/Accept requests locked only child controls; main title/body remained editable and their ACK reset discarded newly typed text | One synchronous per-Document operation lock covers body/metadata/archive and relation mutations through acknowledgement and invalidation; main Tiptap/fields and relation actions disable during flight. Original editTokens remain captured | Production helper refuses a concurrent action before it executes, releases after ACK and actual shared read 409. Browser interaction unverified |
| A transient Document refetch error unmounted the draft | Keep the same DocumentView mounted only for fetch TypeError/network or HTTP 5xx; show Retry and lock writes. Invalid JSON/unknown/nontransient errors hide detail | Actual QueryClient cached-refetch failure checks exercise 400/401/403/404/409/500/503; cached rows remain present, production error classifier distinguishes permitted lifetime |
| Reviewer F4: failed Collection reads still rendered cached field titles/properties and enabled property writes | Denied/nontransient Collection reads hide title/schema/property readbacks and the captured management dialog; every Collection read failure locks property save/edit and management, including an already-open dialog. 5xx/network retains local property/modal drafts with disabled edits. Denied list/proposal/File/reference reads hide cached titles/bodies/options; affected write selectors/resolution lock on errors | Same actual QueryClient + real shared read checks verify retained sensitive data is excluded for denied reads and retained only for transient reads. React/browser authority transitions unverified |
| Properties guard skipped when blocked by stale/main-read/main-pending state | Main guard accounts for both main and property dirtiness independent of blocked state; all Document writes prevent navigation while pending. Explicit property Cancel resets from current Document | Source inspection; root scenario 23 required |
| Create, Collection and proposal dialogs could lose drafts on route/history/unload | Each modal guards dirty navigation and pending requests. Explicit Cancel remains available before a request. Create bypasses its guard only after ACK, before navigating to the actual returned Document ID | Source inspection; root scenarios 24–25 required |
| An already-open combobox could dispatch selection after pending/authority disabled only its input | Disable Combobox itself and ignore disabled onValueChange | Source inspection; root scenario 26 required |

Followup checks: repository name `otto` verified before explicit frozen install (exit 0, no manifest/lock changes). Scoped Bun Biome check passes. Serialized web typecheck and production build pass (exit 0); build retains the existing >500 kB chunk warning. The first typecheck against the root dependency failed before the workspace install refreshed `@otto/server` linkage; frozen install resolved it, with no source workaround. `git diff --check` and staged-content inspection are required before the signed commit. PostgreSQL/native/browser suites and independent acceptance remain **unverified** here by root coordination.

The four controlled production checks use the real `read`/`ApiError`, `runDocumentOperation`, `canKeepDocumentDraft` and QueryClient. No mock runtime data, alternate API client, browser credentials or backend edits are introduced. The minimal import fixture supplies only window.location. Observed outputs:

```text
PASS synchronous pending lock refuses concurrent mutation and releases after ACK
PASS production read conflict releases fence for deliberate retry
PASS real QueryClient retains cached data after failure; denied readbacks are hidden, 500/503 survive
PASS only network TypeError or server 5xx preserve draft; malformed/unknown errors do not
```

Additional numbered real browser scenarios for root:

21. Delay an attachment add/remove, property save, and proposal acceptance response. Attempt title/body/labels/visibility/folder edits and another Document write during flight: every covered control must lock, navigation must remain blocked, and ACK must preserve the acknowledged content without dropping local keystrokes.
22. With dirty main and property drafts, force Document GET and Collection GET to 503/network failure separately. Drafts remain, fields and writes lock, Retry recovers the same drafts and original tokens. Then return 401/403/404: Document detail disappears, or Collection title/schema/property readbacks and its management dialog disappear; no write becomes enabled from cached data. Also force denied proposal/File/reference/list reads and verify cached titles/bodies/options disappear.
23. With only property changes, trigger an external editToken advance, a main refetch failure and a pending relation operation. Back/breadcrumb/link/unload must warn or stay blocked even though relation blocked is true. Cancel properties restores current authoritative values after successful read.
24. Edit an unsaved new Document and attempt Back/link/unload; refusal retains input. During delayed create, close/navigation are blocked. After successful ACK, its own returned-ID navigation proceeds without a discard prompt.
25. Edit Collection/proposal dialogs and attempt route/history/unload, then delayed submit, conflict and network error. Refusal/error retains inputs and original fences; pending blocks close/navigation; explicit Cancel before pending discards locally. During a Collection refetch 503, an already-open management dialog stays but Save/edit locks; denied read hides the captured dialog.
26. Open Collection/File/visibility/property combobox, then start a covered request or cause an authority/read-error transition. Choosing an already-visible option cannot dispatch a change while disabled. Keyboard and narrow-mobile behavior require fresh inspected root evidence.

Pending items remain those above: unsupported backend actions have no invented success, Collection table/list browsing needs a separately owned route if required, and fresh integrated browser/permission/review acceptance belongs to root. This correction introduces no new Project membership implementation or common-editor changes.

## Retry caller correction on root `6254e91`

Root's actual combined browser run passed Document creation/body/metadata/Cancel/409 (4.8 s), attachment add/remove/shared pending lock (4.0 s), Collection schema/property/archive/restore (7.1 s) and noncreator proposal/accept/stale reject (6.2 s). The fifth case confirmed dirty main/property drafts survive 503, then failed after recovery: detail Retry also called the disabled Project-member query for a Document with no Project. The real request returned 400 and created a new generic alert. This is a caller bug; the zero-alert assertion remains intact. Observed root artifacts: `browser-combined-current.log` and `browser-combined-pass1-results` under root thread storage. Credential headers must be redacted before inspecting/reporting error output.

The user authorized exactly the two owned Retry guards: detail calls `members.refetch()` only when `document.projectId` exists, creation only when `projectId` exists. Workspace directory refresh and detail reload still execute. Project membership hooks, authority, router, API and backend remain unchanged. The existing fifth browser regression additionally records Project-member reads and requires none for its unscoped Document; it still requires both read alerts to clear and dirty drafts to remain.

Focused production-source checks execute each actual Retry arrow extracted from its TSX AST. Null, undefined and empty Project values cause zero member reads; a real UUID causes exactly one. Both callers still refresh all three directory lists; detail still reloads once. A real QueryObserver with `enabled:false` executes its query function on manual `refetch()`, reproducing why the guard belongs in these callers. All three focused check groups passed. Private scratch evidence: child thread storage `documents-retry/check-retry.ts` and `check-retry.log`; no browser/DB runtime started by child.

Scoped Bun Biome, serialized root TypeScript/web typecheck/production build and staged diff checks are recorded with this correction. The corrected fifth browser case and its 403/404 denial phase remain **unverified** until root reruns integrated bytes. No new UI composition or backend behavior is introduced, and no unsupported action is made available.

## Source hashes

The exact signed lane commit identifies the implementation source; independent acceptance is still unverified. Dependency commits are excluded from root's lane cherry-pick list.

| Owned source | SHA-256 |
| --- | --- |
| `apps/web/src/routes/documents.tsx` | `b05a2fb4ef26d66702d3cab8f6e13d0a656511e6dbee9de0f3d0236fe433a5fa` |
| `apps/web/src/routes/document.tsx` | `5aa7d51544931958c3111e5adc0a29c8d51c9c290312e03ee345e5e6148aaac9` |
| `apps/web/src/components/documents/collection-manager.tsx` | `16de26b40f3fa079f39f9463d93888580ee072e531ce15c128182959c6560b44` |
| `apps/web/src/components/documents/document-data.tsx` | `d76cb74e177da13768c916ef6e88b7c4325b5ad84a6d51f67507f8e507500755` |
| `apps/web/src/components/documents/document-menu.tsx` | `fd60c77c1dc66558d16be9187d23d9ac6e0c163ac87fdc167967213a5978c1ae` |
| `apps/web/src/components/documents/document-reference-choice.tsx` | `ac77fc1828747242177d5b70d672605e64777739c51e0870b9bac76e77071e02` |
| `apps/web/src/components/documents/document-relations.tsx` | `ed618a4efb19e883b164d18ed4e23ab44abf6c7040626cb61ba52df242cca70d` |
| `apps/web/src/components/documents/document-operation.ts` | `ca51a430c1c49291523cc157e65bf22081b8a0fd4ea73e75bbd55cb682883dbe` |
| `tests/browser/ui-document-actions.spec.ts` | `bf57a10d0829539dee405ef462e8a9cd82fda2755fbe00dde5a0ad9b42f110e4` |
