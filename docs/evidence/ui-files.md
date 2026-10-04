# Files lane handoff

Source: BB `thr_ea3andz7st`; implementation child `thr_2p4abcmvyp`. Assigned isolated checkout baseline `f89d8128ec26726e17b954b15fe64ca71825c376`. No main-checkout/otto-ui changes, remote push, deployment, Notion, task-state/time writes, native suites or browser work.

Signed owned commits in order: helper `23d30f5bfb0ed0314e2cfc03980bcc8878c054cd`; primary UI/public-share source `14dc5c63a3e1e96cf0d3f8f49008ec01482e0250`; inferred live presentation types `ce1a431e0e4a31fbda35fcdce10eb5dc7673341d`. Final source revision is `ce1a431e0e4a31fbda35fcdce10eb5dc7673341d`. Dependency picks are lead work and must not be integrated again: original `df84b44bf6368aa009cd3f0118db50c0094542a4`, `00bf8019a137410228da777c199101a926c88951`, `d0e93b23da0a66fd4d635dc60ca5bc844bde9bae`, `3b5d1e07664d427a4e42bbae61f46eda97ddb7fa`.

## Actions and state

All production IDs come from validated URL state, authenticated Hono responses or the workspace directory. Upload `requestId` is a new UUID kept with the exact native File and frozen metadata through retries. No mock runtime values, browser storage, object keys, credentials, invented completion or progress. FilePresentation derives the inferred live File response; no owned mock runtime or type imports remain. Named `fileResource`, `FileItems`, `FileGallery`, and `Lightbox` exports remain available. FileGallery's old onDelete prop remains accepted for callers, but no delete action is exposed.

| Surface/action | Supported seam and permission | State/proof |
| --- | --- | --- |
| Mixed gallery | GET library, current human reader; workspace or selected Project root, direct folder only | Bounded 100 per page; folders then Files then Documents; cursor passed unchanged; typed discriminated lead projection |
| Folder navigation/breadcrumbs | Library folder.path, readable ancestors only | URL folder/project; invalid or revoked location reports server error; retry; no mock ID validation |
| Whole-word search | Library query <=200 | URL query; per-folder search; new query resets cursor via query key |
| Project and label filter menu/chips | Directory Projects; library projectId/label | Live options, manual exact label entry; clear; Project change returns to root; More projects pages directory |
| Sort/reverse | Library title/createdAt/updatedAt and asc/desc | SQL sorting within kind; visible hint avoids suggesting a global recent list |
| Archive view | Library archived | URL toggle; archived Files/folders can restore |
| Load more/empty/retry | Library next | Empty page with continuation does not claim folder is empty; query/page failures have retry |
| Upload picker | Native File input, no local publication | Selects real File objects; starts explicit dialog; workspace/Project/folder captured |
| Visibility before upload | user/workspace | Defaults user; private folder disables workspace choice; selections freeze once any request starts |
| Upload / Retry exact upload | Binary PUT files/requestId/content, current writer/Project authority | Native File is request body, no base64/arrayBuffer; <=100,000,000; no Saved until ACK; identical request, bytes and metadata on retry |
| Abort / Close / Done | AbortSignal; local UI | Abort explicitly reports uncertain outcome; spinner only; pending Close blocked; exact retry retained while dialog stays open; unmount aborts |
| New folder | POST folders; current writer with placement authority | Stock dialog title/visibility, current folder/Project; input retained on failure; Cancel; pending locked; depth 8 action disabled |
| Folder Edit / rename / move / visibility | GET/PATCH folders; creator/current writer | One allowlisted partial update; bounded destination picker, fixed Project, parentId null for root; server checks cycles, depth and privacy atomically |
| Folder empty archive / restore | POST folders/id/archive; creator/current writer | No recursive delete; hidden/archived children still block server archive; actual error retained; ACK then invalidate |
| Folder Open / Ask / Copy link | Navigation, shared floating chat, native clipboard | Real folder title/ID; Ask is text context, not an access grant; clipboard errors surfaced |
| Document gallery item | Real library document id -> document detail | Editable content/labels/visibility/move/archive and Document editToken stay with Document lane; no duplicate document model/editor |
| File tile/menu Open | GET files/id | Viewer works for URL open id beyond loaded pages; actual metadata hydrates; pending/error/retry, Close |
| File menu Download / Copy link | Authenticated HEAD then browser attachment GET; clipboard | Uses verified-spool download route; streams to native browser download, no large Blob; no success claim about native completion; menu failure toast after actual error |
| Viewer Previous/Next/keyboard | Loaded readable File IDs | Wraps loaded Files only; no stepping for unlisted deep link; media/input/editor keys retained; controls blocked during mutation/dialog |
| Viewer/menu Ask / task backlink | Shared floating chat; originating real task prop | Actual file id/title; task link retained only from caller context; file mention discriminator from the lead’s common dependency |
| Viewer details/widgets | GET file/folder; directory actorOf/Projects | Readable path, visibility, real creator/custodian/Agent, date, byte size and labels; folder/Project/label links; no task/chat mocks or fabricated counts |
| Workspace writer gate | Authoritative useWorkspace().workspace.role | Add/folder actions, viewer Share/custodian Edit and tile Ask never depend on first-page directory members; obsolete More people role-discovery action removed |
| Edit File title/labels/visibility/folder | PATCH files/id; custodian/current writer | One atomic allowlisted update, no editToken; fixed Project; same bounded folder picker; cancel/pending/error retains draft; no byte replacement |
| Archive/restore File | POST files/id/archive; custodian/current writer | Pending fenced controls; ACK then workspace invalidation; no delete |
| Preview image/video/audio/PDF/Markdown/HTML | Authenticated verified file GET | In-memory consumer max 8 MiB, actual streamed length checked; truncation/oversize fail; abort and object URL release; larger files explain download |
| HTML preview | Bounded bytes -> srcDoc | Empty iframe sandbox, no-referrer, CSP forbids network/scripts/forms/base changes; only inline styles/data/blob images |
| File share choose bytes / preview | POST shares/preview selection file/targetId/includeFile; current human writer | Metadata-only default; actual frozen preview reviewed before publishing; no automatic publication |
| Publish to internet | POST shares/id/publish with exact preview editToken; publisher | Explicit separate button with public-link warning; source change/conflict fails; ACK precedes published-link display |
| Existing shares / more / refresh selection | GET shares type=file; POST preview existing id/editToken | Bounded publisher-owned pages; select target file locally; refresh recaptures current authorized selection before explicit republish; stale token fails |
| Share Copy / Revoke / Close preview | Native clipboard; POST revoke; local close | No clipboard success before ACK; revoke closes published gate only; closing preview does not delete the saved draft; dialogs hold pending operations |
| Public frozen selection | GET public shares/id, anonymous credentials omitted | Exported PublicSharePage, no WorkspaceBoundary/session assumption; frozen metadata/Document selection/Chat entries only; metadata-only selections expose no byte link; 404 unavailable state, loading/retry/Refresh |
| Public bytes / HTML | Verified public shares/id/file | Explicit native byte-download link; HTML only on explicit Preview HTML, credentials omitted, bounded exact-length body <=8 MiB, same empty sandbox/CSP; Close preview; root registers /shares/$shareId outside Shell |

## Design decisions for lead to integrate into DESIGN.md

- Preserve four-column gallery tiles and full-screen lightbox with the existing details panel. Folders precede Files and Documents follow Files. Use real title/type tiles instead of fabricated previews/counts.
- Compact stock dialogs provide folder creation/editing, upload visibility/retry, custodian File metadata and selected frozen shares before Agent setup. Shared component looks are untouched; instance classes are layout only.
- Uploads show an activity spinner and a verified ACK state, never guessed percentages. Abort does not claim server cancellation; explicit retry reconciles the exact request.
- Public selections use a standalone read-only Page, with no floating chat, private navigation or sign-in requirement; public data and HTML fetches omit credentials. The page shows only the frozen server selection and explicit download/HTML actions.
- File uploads default to Only me. Folder placement never silently widens a File. Readable public sharing requires explicit preview then Publish to internet, with metadata-only default.
- Preview consumers stay <=8 MiB; larger media uses native verified downloads. HTML is shown in an empty sandbox with restricted CSP. Native download completion belongs to the browser.
- Sorting is within folder/File/Document kinds and search is whole-word/direct-folder. Existing mock recursive/type/madeBy controls are removed because the mixed library endpoint cannot provide them.

## Checks

- Verified frozen Bun install after package.json name `otto` check in the explicit assigned cwd.
- Verified scoped Biome on all eight owned source files and git diff --check. Final typecheck and build both pass on `ce1a431e0e4a31fbda35fcdce10eb5dc7673341d`, serialized with `/tmp/otto-ui-wiring-check.lock`. Build retains the existing >500 kB bundle warning; it is not a failed check.
- Real helper input/output harness exercises Hono client PUT transport: same raw File/requestId/metadata on lost-ACK retry, abort signal and credentials forwarded, ACK-to-FileRef mapping, refusal above 100,000,000 before transport, 403 refusal, authenticated bounded preview, and truncated/oversize refusal. Five evidence lines pass; this is controlled transport proof, not browser/storage certification.
- Verified controlled server render of the actual PublicSharePage with QueryClientProvider and no WorkspaceBoundary: metadata-only snapshot shows no byte link/sign-in; selected bytes show the exact public verified-download URL and explicit HTML action; the actual component queryFn uses only the public endpoint with credentials omitted; a 404 hides cached content/title and exposes retry. Four evidence lines pass. No browser behavior is claimed by this render.
- Browser, native/PostgreSQL suites, storage/gateway qualification and independent review: UNVERIFIED in this child; root owns integrated verification and acceptance.

## Pending items and integration boundaries

- Mixed library has no type, author, recursive-subtree or total-count filter. Those mock controls/counts are removed. A future API/product decision is required to reintroduce them correctly.
- Folder download-as-archive and File/Folder permanent Delete have no API; those actions are removed. Empty-only archive/restore is implemented.
- Upload exact retry lives in the open dialog/Composer selection. Reload/navigation discards the native File and request selection; the UI warns when closing. Durable browser restart recovery needs a deliberate supported product/backend flow; no browser storage is introduced.
- Native download completion cannot be acknowledged by the app without buffering or a separate platform API. The browser owns download progress/failure; the app claims no completion.
- Private share drafts cannot be deleted through the current API; Close preview hides local preview, and Revoke closes the public gate. Refresh selection and explicit republish use the existing editToken fence.
- PublicSharePage is implemented and exported from components/public-share.tsx. The lead must register /shares/$shareId outside Shell/WorkspaceBoundary; share-copy URLs already use that path. This routing integration is authorized, not an unsupported endpoint.
- Shared MentionType=file dependency has been picked, and both owned callers now use file. No legacy production mention discriminator remains in the lane.
- Live storage configuration is external and failures remain errors; no fixture success or mock preview/upload fallback. No per-File/Document ACLs, versions, replacement bytes or provider credential access are invented.

## Numbered integrated browser scenarios (all unverified here)

1. Seed >100 readable mixed rows plus hidden private rows. Open Files as reader, load to completion; verify server within-kind sort/cursor, no missing/duplicate rows, URL search/label/project/archive, clear/back navigation, correct empty/denied/retry states and More projects beyond page one. With >100 members and the current writer absent from the loaded directory page, Add/Share/own custodian Edit/Ask remain available from workspace.role; a workspace viewer remains denied and a different File custodian cannot edit.
2. Create a private folder, child folders through depth 8; reject a ninth level and cycle/cross-Project move. Rename, move and visibility-edit as creator; another member cannot manage. Move shared/other-owner content into private folder and verify rejection without partial metadata change.
3. Attempt archive of a folder holding File, Document, hidden child and archived child. Each refusal must leave all items intact. Move contents out, archive empty folder, view archived root and restore; verify parent/archive constraints.
4. Upload 0-byte, small image/Markdown/HTML, 50 MB and 100,000,000-byte Files; reject 100,000,001. Inspect binary PUT (not JSON), chosen scope/visibility and Saved only after ACK. Lose ACK/abort/storage-unavailable, retry same requestId/bytes/metadata and confirm one saved File; inspect no fabricated progress. Close/navigation warning and cleanup.
5. Open File deep link not on loaded gallery page. Edit title/labels/folder/visibility as custodian, refresh to prove persistence; another reader sees no edit/archive controls. Test private-folder widening, stale/revoked current authority, and archive/restore. Task backlink from a real originating Task remains correct.
6. Use Previous/Next and arrow keys across loaded Files on desktop/mobile; seek media and edit text without unintended stepping. Preview supported types <=8 MiB, reject larger preview, test truncated stream/error/retry and close cleanup. HTML scripts, external image/fetch/forms/top navigation must remain blocked.
7. Download small and 100 MB Files through native browser attachment flow. Confirm authenticated HEAD, verified GET and server storage corruption/revocation failure behavior; no large JavaScript Blob or false success toast. Copy links and simulate clipboard denial.
8. Preview a file share metadata-only then with selected bytes; cancel without publication. Publish explicitly, open /shares/<id> while signed out and in another workspace; inspect frozen metadata/Document selections/Chat entries plus explicit file/HTML actions, modify source metadata and prove frozen selection persists; refresh existing selection and republish with exact editToken. Change source between preview/publish -> conflict; revoke -> public gate closes. Page beyond 100 shares.

## Source and evidence hashes

The integrating root must record the integrated revision, fresh browser artifacts and reviewer verdict separately. This source has no independent review verdict yet. Evidence is local controlled input/output and render proof, not live backend/browser acceptance.

SHA-256 of final owned source at `ce1a431e0e4a31fbda35fcdce10eb5dc7673341d`:

| File | SHA-256 |
| --- | --- |
| `apps/web/src/routes/files.tsx` | `3d3d000639b26f7225c9c229af4c6ae06e98578a1ef8c4eef0079b38240fbd75` |
| `apps/web/src/components/files.tsx` | `0cd9052233dff4b27f71ca3eec2f73e8df3bd080b0c8a846409d2daa16e11de2` |
| `apps/web/src/components/file-edit.tsx` | `92f1a0ce133361029048185378e3f49832efd54ee12833fe6d29b22ee643e096` |
| `apps/web/src/components/file-uploads.tsx` | `7c7a3b9a1f09b6e4ffd36c06aca24664e65e334c293afdf793de20dfaa258f6a` |
| `apps/web/src/components/file-shares.tsx` | `3556efb0cf79207335555b6a34e1f0f0c15c9947cd9e417d59bfed140b28c607` |
| `apps/web/src/components/public-share.tsx` | `ae69b1ed3a90278b026b022d1be28031f8563b57b35b2c3b801f3831e3d2ada3` |
| `apps/web/src/lib/file-library.ts` | `21d6a885a984997c0e42d999ce3b683056f15dc62dacff5cd6f014845fbd0c49` |
| `apps/web/src/lib/file-upload.ts` | `8df0e7bd5d007c88c2ae412261b7e06164734bbe9ad3007d4ceec20591578bfb` |

Controlled check artifacts in `/home/g4f4r0/.bb/thread-storage/thr_2p4abcmvyp`:

| Artifact | SHA-256 |
| --- | --- |
| `file-lane-contract-check.ts` | `db8f74af460f1d717176846011e70143fb45bedddc5a9cee3395906faaa7f087` |
| `file-lane-contract-check.log` | `6f7b87599ae29e504e6e0518f25f202639dcd3e1573cbada2ab482f6df965658` |
| `file-public-render-check.tsx` | `93897ed30217c1810ae3abb4348d335817b24e657a733e70b66d4b347d1a79b3` |
| `file-public-render-check.log` | `c0e228aaed2ee5ae463f1a72d9e3ac51e501def64e85b177e1ee28cd69147dc3` |
| `file-lane-typecheck.log` | `3b6b08eb3eb1fe8e6d9ea6f267f898c4a838755784548447107b2900bf98a453` |
| `file-lane-build.log` | `8735fa5aaf04ad775eee1cdb1eb812cb9e29c652b8e5850a4585246192843d9d` |

## Independent finding F1 correction

Source commit `3ad03bd02152c0741c09fbdcfd20a2cb6b35ef52` fixes directory-pagination-dependent writer gates in FilesPage, Lightbox and FileMenu. All three use `useWorkspace().workspace.role`; File custodian `ownerId === user.id`, folder creator checks, pending fences and server authority remain intact. The extra More people buttons existed solely to discover the current workspace role and are removed. Directory identity/Project presentation still uses live directory data.

Verified: scoped Biome on the two changed sources, serialized web typecheck and staged diff-check. Build/browser/PG/native suites were not rerun for this followup while root combined suites were active; fresh browser acceptance and independent re-review remain UNVERIFIED. The optional root `76e6fbe` dependency pick conflicted in unowned DESIGN.md and was aborted; no dependency/common source changes remain in this checkout.

Final followup source and typecheck SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| `apps/web/src/routes/files.tsx` | `6e7962c85a0349b29b1376340f3874c977db827d78770bad1e69b96487ea41df` |
| `apps/web/src/components/files.tsx` | `baa99c259e33763e5b12bac8de04dc11f99a6c0ab3cd84abd0021f27b4ffd955` |
| `/home/g4f4r0/.bb/thread-storage/thr_2p4abcmvyp/file-lane-F1-typecheck.log` | `3b6b08eb3eb1fe8e6d9ea6f267f898c4a838755784548447107b2900bf98a453` |
