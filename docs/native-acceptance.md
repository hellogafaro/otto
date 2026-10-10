# Native pre-MVP acceptance

This is the single current operation, page and scenario checklist. Restored historical reports do not prove the current native runtime. A check is passed only for its recorded source and environment; affected checks must run again after changes.

## Scope and recovery

- Exact v1 anchor: `2a6e9a79be8b268b6cac583f68a68fa674be2fe9`.
- Native integration checkpoint: `fa912a635c5d38feb0948cf9611b7d1348f21036`. The corrected full-suite and live source manifests below also include the separately checkpointed durable launcher; its exact bytes are recorded in the startup evidence.
- Current-source recovery checkpoint: `c7f5b4e5eaab18efed20f689a6764bbab0e1f284`.
- The pre-integration anonymous-MCP/outcome-classification candidate over `004db99a9d5ad1c4d5682ddd954bc79e72c4526a` is preserved under `~/.capy/work/otto-pending-closure-20261010/integration/native-outcome-uncommitted/`. The subsequently authorized local commits and independently recoverable final checkpoint are recorded under `integration/native-outcome-final/` in that evidence root. Source recovery does not imply durable API activation.
- Historical chat-foundation source checkpoint: `193ccb84ebb5b56a54cad9816fd2ac15f43a908f`. Its 388 reviewed source/config/test hashes matched committed bytes; the retained incremental bundle and manifest are under `~/.capy/work/otto-pending-closure-20261010/integration/final-checkpoint-20261010/`.
- The read-marker correction qualifies `apps/web/src/routes/chats.tsx` at SHA-256 `0b17dca50c96feee79f475a622f39042feb3aedd0964163745a51229e0deaa99`, based on local main `0cecc9f669c584c45b4a8b4e1368b29b1ec0f568`. The final local revision, tracked-file parity and verified recovery bundle are recorded under `integration/read-marker-checkpoint/` in that same evidence root; earlier clean-checkpoint claims do not cover this correction.
- Exact forward restoration: `9b3a9a70342c72414a33c313f6ef07fd2301c1ba`, tree `a1c9dbda28baaaac5eb904216736eb9807d6f506`, identical to the anchor. An initial restoration commit retained 14 rename-source files; the next forward commit removed them before implementation.
- Local recovery evidence: `~/.capy/work/otto-v1-restoration/`. The 2,151-entry source archive and hashes were verified. Current login and Home source/assets are preserved separately. Saved app data has a consistent SQLite backup with integrity check plus 102 supporting files; Keychain entries remain untouched and were not exported. No saved app data was removed or converted.
- Isolated baseline work: `~/.capy/work/otto-v1-preflight-2a6e9a79/`. PostgreSQL 17 is a qualified local candidate, not a claim about all production versions.

## Evidence requirements

For each supported operation, record the natural-language request, native Mastra tool, authorized domain function, actor/membership, persisted result, UI or artifact observation, reload/cold-restart result, revision, evidence path and verdict. Direct API/domain checks complement but do not replace model-through-tool UI proof. Keep real-provider and deterministic-fixture results separate.

Use normal authenticated separate user/browser contexts. The finite multiplayer inventory must include one/two humans crossed with one/two agents, humans only, shared project across users, member/nonmember/cross-workspace denial, implicit/explicit/unavailable/revoked recipients, simultaneous sends, active ownership, queued messages, reconnect/reload/cold restart, approved/denied/duplicate/stale requests and leak/duplicate-effect checks.

## Current verdicts

### Lean task collaboration, flat replies and unified navigation

The implementation snapshot over `ed6e5b675b50eff101fa743c77e2080da38093c1` is sealed by 434 source/test/config hashes in `~/.capy/work/otto-resume-20261010/team-loop/verification-sources.json`, SHA-256 `0c639bcd5d926062d1eafa6a256cfb36a88b7fbd69daff03f49937589846fe5a`. This section supersedes earlier Task/tool-count and section-sidebar descriptions only for the implemented scope; it does not close the whole foundation.

| Operation or scenario | Verdict and evidence |
| --- | --- |
| Five Task stages and immutable review evidence | Passed isolated domain/browser checks: Backlog/Pending/In progress/In review/Completed retain the existing persisted values, owner/admin human review authority, exact historical receipt replay, immutable comments, recurrence and archived-source output. |
| `task_proposeCompletion` and `request_task_review` | Passed actual native-tool/authenticated-HTTP checks. Submission stores evidence once and mentions the owner without waking another Agent; approval stays human-only. Request changes saves the decision separately from its delivery. Native receipts omit private source Chat identity. |
| Same-Chat continuation and native history | Passed independent normal-auth HTTP and real native Mastra storage with controlled models. Exact retries admit one Run, reuse the same auto Session, retain the Task source and do not duplicate the Chat. The private server-only review association preserves the public prohibition on automatic/manual selection mixing. |
| Concurrent completion, archive and queued supersession | Original publication race failed; final callbacks recheck before reserve/publication/model preflight/admission. Persisted Task association and launch-only review token reject archive or supersession before queued execution, without invalidating authorized active output. Independent runtime proves no extra model calls in blocked cases. |
| Flat full/floating quoted replies and composer controls | Passed actual isolated browser/reload checks. Explicit Agent mentions take priority over the quoted contributor; removed recipients and frozen empty retry selections remain silent. Controls/context stay above the bottom editor, with compact working/Stop and visible approval/question failures. |
| Unified sidebar, Pins, Recents and Chats | Passed light/dark/mobile browser checks for one left sidebar, authorized mixed history, pin persistence, unread promotion, Settings replacement, real Chat list and navigation. Lists retain pagination. Exhaustive long-list and awaiting-question visual acceptance is not claimed. |
| Default Otto, native discovery and action prefills | Passed default protection/creator authority/explicit legacy repair tests. GET resolves the permanent default directly without scanning pages. `project_list` filters accepted audiences before limit and retains Project source authority; independent two-page `schedule_list` checks current-Chat scope. Registry contains 100 native tools and 51 exact approval action types. Descriptions explain execution, approval, scope and limitations; create prefills remain unsent human drafts. |
| Authorization and unavailable delivery after reload | Passed independent two-human authenticated viewer-denial, inaccessible source-Chat redaction, unchanged persisted comment counts, and durable exact-request retry checks. |
| Additive saved-schema preparation | Passed populated disposable rollback/preservation and column/index/constraint structural parity. SQL adds `tasks_reviews`, composite comment uniqueness and the superset status check; it does not reset data. PG18 Drizzle recreated equivalent foreign keys, so a zero-DDL parity claim is not made. Actual activation is recorded separately below when performed. |

Independent non-author review is `team-loop/independent/acceptance.md`, SHA-256 `5a6a992624bc35d8878a7db42a81181ad3c70182eadc540886d6755548ab89e6`. Six suites passed 113/113, alongside independent browser, lifecycle and scoped discovery probes. Its 58-file source manifest is `58a15f05b25e4ea2c0690c925138134f6507e84353a14d351f006a0bc1f9b366`; evidence manifest is `91f20e99ac763c794fa02027baa1d20600a32138810f5d86d1716d7f024d3756`. The final root snapshot also includes a formatting-only test change. Earlier failures (undefined attention query state, stale registry counts, publication race, auto/manual association conflict, nested test locks and incorrect dispatch-rejection expectation) remain retained, not counted as passes. `schema-proof-final.log` is `7838fda06a8793038f3b5ff9bbb91f7285b0bac5c9596fef1c3c85ee9ce6aa82`.

Canonical named-reviewer resolution remains unavailable from the live directory; this is independent technical acceptance, not a claim that that organizational gate was met. Paid-provider exact-answer/billing, RSS, SMTP, agent-browser and final merged-Library foundation gates remain unchanged. No additional paid inference, external email, remote push, deployment or production build was performed.

Final root integration check passed 149/149 tests across ten suites and 6/6 actual browser scenarios, plus root/web types, boundaries, consistency and DESIGN lint. `team-loop/final-integrated.log` SHA-256: `fa64c65bf9d5e540922b3c43425362f3707c84761eb8a08663e22de557c21f0e`. The 55-file scoped Biome check has no errors and one informational redundant-fragment finding. Inspected screenshots are in `team-loop/final-browser-results/`; the independent reviewer separately exercised authentication, authorization, persisted results and reload. The guarded activation script and additive SQL also passed independent review; actual saved-instance activation is not inferred from these checks.

The verified implementation is committed on local main at `907d73935691afd917b987e7e09ba4f703819d0f`. Guarded local activation reached `candidate-ready`, wrapper/API PIDs 89045/89046, with health/readiness/UI HTTP 200. Its 321-file runtime manifest SHA-256 is `5c0ccf04fcd7d7f795671bea6c6016d48af401dc1676d1efd0aae4efa636b467`; `team-loop/activation-receipt.json` is `6efcfbada173259b6ed23fe7baa90db3530a5e8bf38e9dad2fdbe0f7fda15565`. Repeated boundary snapshots showed zero unfinished Runs/operations/actions/uploads or enabled Schedules and unchanged user/session/saved-File counts of 1/1/2. Full Message row hashes, including frozen `replyAgentIds`, and native Message/thread, Run, Task and comment hashes matched before SQL, after SQL and after startup. Only the reviewed additive review SQL ran; PostgreSQL, Garage and Vite were not restarted. The five existing startup values stayed memory-only. These observations are not an admission-lock claim.

The saved legacy default was explicitly repaired through `ensureDefaultAgent` inside its creator's owner-authorized workspace transaction. The same Agent ID and configuration were retained, the title became Otto, empty instructions received the coordinator guidance and its edit token advanced once. No provider, grant, Skill or custom nonempty instruction was replaced. `team-loop/default-repair-receipt.json` SHA-256 is `80d512c0f9bcdc9fd63894da0a6e5548738fa11065166070063d99b295d09551`; the bounded repair script is `ddb6a1103a4da0a64051e2468ed4d88d2b4a3558b8a1eaf4c5b7f0fab63d70f8`.

The existing authenticated saved-instance browser rendered the new sidebar, saved Chats list and Otto composer. Browser interaction stopped when the person resumed using Chrome, before the planned saved-Chat reload; saved-instance reload is therefore unverified, separate from passed isolated authenticated reload tests. The final controlled `task-review-controls.png`, `navigation-chats-dark.png` and `requested-changes-after-reload.png` were directly inspected. Rollback source/import isolation and populated SQL rollback were reviewed, but the rollback application was not booted during this successful activation. No saved-instance inference or business mutation was used as a smoke test.

### Mention-driven multiplayer Chat

The message POST now owns reply routing: exactly one eligible human and one Agent
selects an automatic reply; other combinations require typed Agent mentions.
Workspace/Project viewers count in the actual audience. Multiple mentions dedupe
by canonical ID, never label. One persisted private `messages.replyAgentIds`
selection and deterministic per-message/Agent Run identities preserve exact retries,
including empty selections. Native message bytes and the existing request hash stay
unchanged. Agent publications never trigger replies, and model/account/authority
checks remain at current preparation and admission boundaries.

Full, new and floating composers have no recipient selector. Mention suggestions
filter participant IDs in SQL before LIMIT; contributor Agents only are offered.
The browser sends one message POST, never a second Run admission. Partial failures
acknowledge saved discussion and retain the original draft/request for Send or Enter
retry. Participant pagination continues past an already-found current user.

| Scope | Current bounded verdict |
| --- | --- |
| Routing, permissions, concurrency and reload | Passed 19 focused author cases, 33 existing regressions, then independent 21-case replay and a separate real-HTTP/Better Auth/private-PostgreSQL probe. Includes complete 100-participant selection, workspace/Project viewers, invalid/viewer/nonparticipant mentions, partial admission, concurrent queue dedupe, membership removal, frozen empty selections, native storage reload, unchanged model identity and no Agent loops. |
| Legacy oversized discussion | Corrected a regression found by the existing late-viewer browser test: unavailable complete automatic snapshots now freeze `[]` without blocking ordinary human discussion. Explicit contributor mentions persist first, then unchanged Run/audience caps return a safe refusal. Independent HTTP proves 103 retained participants, late viewer denial, and no reinterpretation of an empty retry after shrinking membership and rebuilding the app. No limits were raised. |
| Actual browser interactions | Passed the six one/two-human by zero/one/two-Agent combinations, explicit group/multiple/deduped mentions, lost message ACK, exact retry, second-human delivery and reload using a controlled native runtime. Late-viewer pagination/recovery, special-label human mention attention and keyboard retry, and full/new/floating composer checks also pass. The existing no-account admission and Chat lifecycle cases passed earlier in this integration. |
| Native approval retention | Passed real controlled native Connection proposal, deliberately lost approval ACK, exact payload/receipt readback, one persisted creation and reload. The fixture now observes the current nested step disclosures and holds reconciliation reads while asserting the unconfirmed state, avoiding a race with authoritative polling. |
| Additive schema preservation | Passed populated disposable metadata/native-message/Run equality and transactional DDL rollback. The only saved-schema change is `ALTER TABLE messages ADD COLUMN "replyAgentIds" jsonb NOT NULL DEFAULT '[]'::jsonb;`. Existing rows remain silent on exact retry. Application rollback must retain this column once new messages contain frozen selections. Actual guarded local activation is recorded below. |

The 422 implementation/test/config pins over `ee2f1eaf8c4b9ed9621490cba9d4703241c76570`
are in `~/.capy/work/otto-resume-20261010/multiplayer-ui/verification-sources.json`,
SHA-256 `f86902f55c111564bd4cbeb738544ea5600079d2e14f548a4dbf5883496ca33a`.
Root/web types, scoped Biome, boundaries, consistency, DESIGN lint and diff checks
pass. Key retained evidence under the same `otto-resume-20261010/` root:

- `multiplayer-backend/oversized-green.log`: `a8da65fca23366386b1c267f30f27223d3231e4516b1b77152d0afd48fc98267`; adjacent regressions: `11e2a7f86ea62e3094ed4698a7ff30734b93a9e8643ba9cd350a15df38f9af3e`.
- Amended independent `multiplayer-independent/REPORT.md`: `79c4dec54d1102bb48838ed923fc3122b3144e42d8842f4b706420dedabca064`. Original report/evidence remain retained; the amendment explicitly corrects its missed legacy-discussion regression. Fresh 21-case log: `a50ef29fdb5d8dcf8c19e8aa796e9883de0c4fffae34474c09de896917befc55`; independent HTTP probe: `92d4fe78627e778bba3d4a01af981aea700fc369260474aef823abd9da6169f7`.
- `multiplayer-ui/accepted-browser.log`: `ded55c0edb3888057da4963addcd491c0818afc11f4659b64efc573a49b0fe0e` records four passes and the superseded approval-fixture polling failure. Its corrected isolated rerun `approval-browser.log` passes, SHA-256 `16fd3afe3e11a328a19c63d2cf40d99a744808d439a27bc90c9c6760d56d8128`. Static checks: `b1f8c4a75464ac0a4c4b32028ab0893dfe561e1accc96595555a0163ca628be0`.
- Inspected settled screenshot: `multiplayer-ui/accepted-results/ui-chat-multiplayer-human--5fdaa-and-explicit-group-mentions/mention-driven-multiplayer.png`. Initial selector/type errors, missing default Chromium, keyboard-focus failure, legacy-discussion failure and obsolete receipt selectors remain in the earlier logs. The installed Chromium executable was selected explicitly; no production build or external provider was invoked.

This supersedes the sidebar checkpoint's unmigrated manual-Run-test limitation:
that case now exercises the real composer and preserved discussion with no account.
It is not a full browser-suite or whole-foundation pass. Real-provider exact-answer,
RSS, SMTP, agent-browser and final merged-Library acceptance gates remain unchanged.

The source is signed off on local main at `d82b99516e2ad2c0587ad4908a331195dca07639`.
Guarded local activation reached `candidate-ready`, wrapper/API PIDs 16075/16076,
with health `ok`, readiness `ready`, web HTTP 200 and the new reply-error code served
by the existing Vite process. PostgreSQL, Garage and Vite were not restarted.
At the guarded before/after boundary, saved users/sessions/files stayed 1/1/2 and
message metadata, native messages, native threads and Runs had identical fingerprints
before the additive SQL, after SQL and after startup. Later human app activity is
not covered by that unchanged-data snapshot. No model call was made by activation.
Approved startup values stayed memory-only; public settings and disabled policies
were preserved. No rollback, remote push, deployment or production build occurred.

Actual receipt: `settings-review/multiplayer-activation-receipt.json`, SHA-256
`96c26c7b6ac3ddd4866a014143e32d0e503b2350e44ec4ea20b9378f26f094c3`.
The 316-file runtime manifest is `settings-review/multiplayer-candidate-sources.json`,
SHA-256 `d5d61248c26982c10b28cb0ea79c4843b431902847f927db8554ddabf2c75e59`.
Guard source and reviewed plan hashes are respectively
`756088637764ae58546d198fffa56876820bc5c5d9eb00acb28ce912b03730df` and
`467677486f99b53462c8ced647793bf9baa9bf1dbefd38897a3f8adb01f0c1cc`.
Browser acceptance remains a normal-auth fictional/isolated instance, not a claim
that a fresh paid-provider reply was exercised in the saved human session.

### Simplified Chat sidebar

The right Chat sidebar now contains Participants and Library only. Participant
addition is collapsed until requested; existing owner-only role/removal controls
remain. Attached files retain normal authorized previews and an Open Library link.
Project, Visibility and the manual Run form are removed, including the unused
Session-discovery hook and its eager context queries. Normal composer send,
active Run controls, approvals and questions remain unchanged. Existing workspace
Chat visibility is not converted to participants-only by hiding its label.

Passed: web types, scoped Biome, DESIGN lint, the existing full/new/floating
composer scenario, and the new two-human sidebar scenario (6.2s), covering saved
attachment reload, viewer read-only controls, collapsed participant addition and
absence of Session discovery. Initial new-test failures were route-readiness and
counted-heading selector mistakes; their evidence is retained. The historical
manual-Run-form case in `ui-chat-actions.spec.ts` still targets the removed surface
and was not migrated or included; this is not a full browser-suite pass.

Evidence is in `~/.capy/work/otto-resume-20261010/chat-sidebar/`: source manifest
SHA-256 `3f6d9ff195204ccb24f759893950e81f18410903259f6d3775de1867a44e548b`,
`verified-browser.log` SHA-256
`1cc2ce2b5f632774e6911139848a46ea9999b5cc6cd5a488f9e8f066d683e58b`, and
the inspected `verified-results/**/chat-sidebar.png`. No backend restart,
data/access migration, external inference or remote push was needed.

### Library and lean interface integration

Implemented on local main over `88fe9b8e148e158e54ad4b9233cb88525fe019c9`.
The tested 415 source/test/config entries are pinned in
`~/.capy/work/otto-resume-20261010/library-ui/verification-sources.json`
(SHA-256 `387f768b3b65c8b5a22fbce83f0be753c3301d545a06e600575e16b729af2064`).
The local checkpoint and owned API activation are recorded separately below;
browser proof used an isolated authenticated instance, not the saved user session.

| Scope | Verdict and evidence |
| --- | --- |
| Library ownership and saved data | Passed source inspection: `@otto/library` replaces the Files/Documents packages and owns Documents, Files, Folders, Collections and storage. Physical schema declarations are byte-equivalent after import relocation; no saved-data migration or schema push. `library-backend/schema-declarations.json`, SHA-256 `e2fb6d4b93c1175758e3d99ac255832ad45f051dffce06cde9b0f311edcdfcf7`. |
| Bounded Library and retained Run context | Passed 15 focused cases and four adjacent existing cases: categories before SQL LIMIT, sealed caller/filter/category cursors, authorized Project roots, private/collection filters, missing Document callback fail-closed, retained snapshots and current revocation. `library-backend/focused.log`, SHA-256 `95d5f7fb03d6c67ecdd2ca677033de624a8824e67275c8436a555de08aeefa4b`; `adjacent.log`, SHA-256 `9c784d45fcbeeb8c90f9ec4604b4dc757edf0f5674d2dc8b1c7b9c1ac6f93666`. The adjacent selection skipped 41 unrelated cases. |
| Library UI and reload | Passed final authenticated browser case: one navigation destination, six 28px category tabs, actual uploads, cross-Project editable Documents, creation, canonical/legacy links and reload. Upload modal identity survives the empty-to-populated transition, preserving the acknowledged upload rather than resetting its request. |
| Home notifications and simplification | Passed two-human browser case: actual other-author comments on owned Tasks and explicit canonical user mentions; own human comments, unrelated discussions and inaccessible Projects excluded before pagination; cursor replay by another actor denied. Persisted results survive reload. Counts, inner card actions, empty titles, Project dropdown and All chats are removed. This is a recent-comment projection, not a read/dismiss notification queue. |
| Panel actions and spacing | Passed shared implementation and browser inspection: page-level actions occupy the top-right toolbar, Library folder breadcrumbs share that bar, both main/right headers have measured 8px padding, and the shared toggle uses `RiListCheck`. |
| Unified composer | Passed authenticated full/new/floating Chat case: one compact inline layout, 32px primary controls, 728px maximum content width, Participants/Project below, multiline typing/paste and human-only send/reload. Existing Project context and participant-management authority are preserved. |

The final three browser cases pass together in 18.2s. Evidence and inspected
screenshots are in `library-ui/final-results/`; `final-browser.log` has SHA-256
`a2aefc92a28e71ffa664b70253bda29bccdb664640b6f76b14897f1da7af7306`.
Final inspection additionally preserved direct document creation in an empty
Library without requiring an upload or a model. The two affected browser cases
pass again in 13.4s, including creation and reload of the first document;
`library-ui/empty-creation.log` has SHA-256
`4a06b2b2d73e959954f241eebfa5b961c1b40adbacffefe6947825d39ac9b886`.
Only the Library route and its test changed after the combined browser run.
Root/web types, scoped Biome, 17-package acyclic boundaries, consistency and
DESIGN lint passed. Earlier failed browser attempts remain in `library-ui/`;
they include selector/navigation timing corrections and the real upload-modal
reset corrected before the final pass.

Independent read-only inspection found no blocking notification authorization
or cursor issue. Noncanonical percent-encoded IDs in manually imported mention
text remain an unqualified edge; normal Otto serialization and escaped labels
are covered. Whole-foundation independent acceptance, real-provider exact-answer
qualification and the previously failed RSS gate remain open. No paid inference,
external email, remote push, deployment or production build was performed.

Local activation passed for signed-off source commit
`9557ac2dc6d3ecdb12a45b5180ea6ccf00fcae1a`. The 315 runtime source/config pins
in `settings-review/library-candidate-sources.json` have SHA-256
`1565c9f83c6392e442d899ee7ff9cc50c6d1be1f40fe38db409df425e3c1d94e`.
Fresh command/cwd/parent/start/listener identity and quiescence checks preceded
the owned API restart; wrapper/API PIDs are now 77363/77364. Health is `ok`,
readiness is `ready`, and the existing Vite UI responds HTTP 200. PostgreSQL,
Garage and Vite were not restarted. User/session/saved-file counts stayed 1/1/2,
public settings and disabled policies stayed unchanged, and approved startup
values were retained in memory only. This confirms retained session storage,
not a fresh exercise of the person's existing browser session.
The actual `settings-review/library-activation-receipt.json` has SHA-256
`5a5db9ff9d8c5631326eba9f0eb0f768c54263f4c364ea3ead2f7cb8fe999e0a`.
The pinned rollback was not invoked. Independent final acceptance of the merged
Library backend remains unverified; author-run tests are not independent acceptance.

### Composer-first Settings candidate

The local Settings checkpoint `f3803cff216e2737f76114a1b1cc62a8fe960528`
implements read-only Settings Skills/Connections, exact composer target/fence
handoff, MCP-only explicitly human-approved activation and human-only cached
details. Secure credential-reference and GitHub authentication completion remain
human-only; no implicit grants, discovery-on-read or broader Agent access.
Historical seven-case composer proof preceded general-form removal.

The initial browser migration's archived-only navigation failure and denied
export retry fallthrough remain retained as failed evidence. Both are corrected:
Archive → Archived → Restore stays reachable, failed export503 and pending Retry
keep private caches hidden, and Connection authorization recovery uses fresh
details metadata instead of the retained parent title/token. Replacement
`phase2-be85a5ad-070d-490e-a17a-3cc9fa5abd7b` passes15 exact native actions and17
UI/authority checks with300 unchanged product entries, seven exact owner pins
and joined owned cleanup. Report SHA256:
`8f96633e847d1dcdc0267084470e5dc71abcbfcedc266eebcd77bb646dbc995c`.
Owner-pin manifest SHA256:
`c06d4335cc3acb78e8877b30620e43aebb565aca87f0f5132c07a843b6c5abf5`.
Evidence: `settings-composer-ui-proof/` and `settings-composer-ui/` in the
existing `~/.capy/work/otto-pending-closure-20261010/` evidence root.

The retained owner run passed89 affected native/backend tests, root/web types,
scoped Biome, boundaries/consistency, DESIGN lint and diff checks. Final browser
run5 passed all six migrated cases without skips or flakes; its five screenshots
were inspected by the independent reviewer. The final acceptance report is
`settings-composer-ui-proof/final-independent-acceptance.md`, SHA256
`9898792c556bf146d61f812462ea018552f85954861c988d7dd12a89ebfc3865`.
On resumption, all304 source/test entries, seven owner pins and144 sealed evidence
artifacts matched the preserved candidate. This reconciliation is not a new test
run. The resumed owner independently reviewed the checkpoint and verified its
recovery bundle. Fresh Settings checks passed89 tests and root/web types.
The two Schedule failures were stale fixture assumptions: the repaired tests
preserve empty-state composer/no-write behavior, then seed one disabled Schedule
through authenticated HTTP to exercise the existing populated-list editor.
The scoped Settings/Schedule replay passed15/15, zero skipped/flaky, on260 stable
source pins; this is not the complete repository browser suite. Evidence:
`~/.capy/work/otto-resume-20261010/schedules/run4-results.json`, SHA256
`024520f99a2bdfed8f543ccea20e1e75975d9b1fee7e07a9c1cc18afed4b96e0`.

### Resumed local-main UI and memory work

Completed UI slices are integrated directly into the existing local main/HMR
checkout. Full and floating Chat use collapsed recorded approved-action steps,
preserving exact receipts, pending approvals, questions, Stop and meaningful
errors without conversation usage/session/log clutter. Native reads without a
public record are not counted; receipt authority and backend usage stay unchanged.
The authentic Otto mark replaces the first Inbox glyph with the Home accessible
name; navigation geometry/order remain unchanged. The palette project dropdown
is removed, retaining Projects results and the existing route/first-project task
scope. Worker evidence under `~/.capy/work/otto-resume-20261010/{chat,logo,palette}/`
records inspected isolated screenshots, typechecks and targeted interaction
checks. Chat additionally passed55 targeted tests and the native streaming browser
case with controlled providers. No live-provider success is inferred.

The unchanged300,000 KiB RSS cap still fails:50 MB roundtrip461,376 KiB,
100 MB501,552 KiB, concurrent80 MB upload/60 MB download570,896 KiB; native-loaded
idle281,328 KiB. Bounded chunks and a single native module graph provide no
demonstrated small fix; all temporary instrumentation was removed. Nine adjacent
integrity/authorization/cancellation cases passed. Sealed diagnosis:
`~/.capy/work/otto-resume-20261010/memory/result.md`, SHA256
`ba94dbe7622db2c2840f6cb695cd9761f1b31f6cd3ce0cef9723237b3c05516e`.
Larger native dependency/runtime memory changes require separate scope. Two paid
Skills/MCP attempts remain consumed failures; exact output, SMTP and confined
agent-browser qualification remain unresolved under their existing gates.
No remote push, deployment, production build or further inference occurred.

Local main checkpoint `1cdc4bbd668e97c4547661843389937d57ccc6bc` includes the
requested20px SVG with unchanged32px target. One final main integration pass
passed root/web types and the two changed Chat/rail interaction tests; the full
suite was not repeated. Existing Vite PID18753 continues HMR on5173. The owned
API was gracefully reloaded from main as PID36998 after zero-effect snapshots,
retaining only the five approved startup values in memory. Health/readiness and
311 source pins passed; user/session/saved-File counts remained1/1/2. No database,
storage or frontend restart occurred. Receipt:
`~/.capy/work/otto-resume-20261010/settings-review/activation-receipt.json`;
source-manifest SHA256:
`cfd8a9e50b110a23397c86b6a48434940d62cda2d9ddf111ed3153111d088d79`.
Existing-user authenticated reload was not exercised through the person's
browser; controlled authenticated UI/reload proof remains separate.

### Prior committed runtime checkpoint

The reviewed anonymous-MCP and outcome-classification changes were integrated
as signed-off local main commits `2a3bc68159e1bdea6bb240a197163bf6788ed4c2`
and `601df0f88628790608fe7a5614e1ed031cf0eda0`, without push or PR.
All642 disk/commit/recovered-bundle file bytes match. Fresh committed-source
checks pass154 affected tests, root/web types, boundaries and consistency.
The owned API was gracefully restarted after repeated zero unfinished
Run/operation/pending-action/upload checks and no enabled Schedule. These
are quiescent-window snapshots, not a newly implemented admission lock.
Exactly the five approved existing startup keys were read individually and
compared in memory to the old process before stopping it; no values were saved
or changed. Durable MCP (including anonymous opt-in) and mail remain disabled,
and provider/dictation/computer/storage/auth configuration remains unchanged.
Fresh API PID67141 is bound to its verified listener/launcher; health and ready
pass, UI returns200 and an isolated browser renders Sign in without page errors.
The account, session and saved File counts are unchanged. Launch evidence pins
all642 stable source files at `601df0f`; this establishes the fresh launch's
source identity, not an in-memory module-hash API or broad live requalification.
Evidence and independently verifiable recovery: `integration/native-outcome-final/`.

The Captain executed the sealed selected-Skill/public-MCP case exactly once;
it failed before any saved Connection operation or Agent publication. Run
`7924a28e-7edf-418e-ac2f-74ab1483a313` was interrupted with the generic
`stopped_or_authorization_revoked` outcome and one usage receipt (8178 input,
45 output tokens), which proves neither exact cause nor transport count.
The helper failed to retain native history on its failure path before private
database cleanup, so the actual model/tool/error trace is unavailable. Two
narrow controlled production-runtime fixtures reproduced the same coarse
outcome through different causes: provider error and participant revocation.
The actionable correction is bounded failed-path native readback before
cleanup, not an inferred product authorization change. Evidence is under
`live-failure-diagnosis/` and the actual result under
`live-skills-mcp-next/attempt-48256646-24c1-43d4-bf72-8aa258a54350/`.
Owner verified cleanup absence, all667 source pins and the original137-artifact
seal; both once markers remain. No retry or further credential access occurred.
That failure led to the separately reviewed diagnostic case below.

The diagnostic-only helper correction is now separately sealed under
`live-skills-mcp-diagnostic/`, preserving original helpers and markers. Exactly
the two retained provider-error/revocation fixtures pass with bounded native
failure histories and explicit withholding/incomplete flags. Types pass; owner
verified all668 source pins,75 artifacts and fixture cleanup. Manifest SHA-256:
`4a80019da4ae23ec00eccdd010a3c4d6a3e36a272ed1ff4168911cea779f65db`.
The active HTTP stop request's Origin header was corrected during review;
that wiring is source-reviewed, not exercised by another UI rehearsal.
The Captain subsequently consumed that second and last authorized Run. Both
live allowances are exhausted; no further inference or credential access is
authorized. Run `359e673d-fd12-48f3-8761-b481d56d25f9` retained the selected
`skill_read` result for `references/nonce.txt`, followed by the native error
`Agent stream finished with finishReason "other" (provider reported "error")
without producing any output`. It did not reach a saved Connection operation
or Agent publication. One usage receipt contains 8174 input/365 output tokens;
it is not an actual transport count or a complete billing record. Bounded
native capture reports complete/not withheld and joined execution; cleanup
records private PostgreSQL/spool removal and all acquired resources joined.
The owner independently checked the retained result and PostgreSQL-directory
and UI-listener absence. Result SHA-256 is
`66678a514fa0c8e84594b6938c9e69ea77201704ee93b65bc20d1f873328ee97`,
under `live-skills-mcp-diagnostic/attempt-83cb5504-75c2-408d-90a9-710b3124addf/`.

A narrow local outcome correction now separates native execution failure from
the abort used to clean up that failure. Prior cancellation, authority errors
and durable human stop retain their interruption semantics; unconfirmed
cleanup still overrides with `uncertain`. The sensitive regression failed
before the fix and passes afterward. All26 runtime and128 adjacent checks
pass, as do root types, boundaries and consistency. Independent review
reproduced the red baseline, passed26 runtime plus9 additional production-seam
cases, and found no required issue. Reviewed runtime SHA-256 is
`4add9bbf99758e459988b93a8a64e46fb3e71b268ce34f37c164e9486ff1f28c`;
test SHA-256 is
`facbea3488bd07a6a340dce0ed21a8c653df596857cd285516a8ad05bb1f10a1`.
Evidence: `runtime-outcome-fix/` and `runtime-outcome-review/`; independent
manifest SHA-256:
`40bd9902e29d9cb25df694f5adfefa0299110f2f0564a6496224f6844a593f69`.
This does not repair historical Run rows, prove the remote provider's reason,
or turn the failed live chain into a pass. Historical source seals remain
unchanged and intentionally predate these runtime/test edits.

Three nonpaid synthetic transport tests in `continuation-protocol-diagnosis/`
exercise the actual installed OpenAI adapter and Mastra continuation. A raw
`finish_reason: "error"` reproduces the exact retained error, while the same
serialized tool continuation succeeds with text and `stop`. Tool-call identity,
arguments and JSON/base64 result survive serialization. A malformed response
produces a distinct schema error. A mixed choices/error payload can lose its
additional error object during SDK parsing; the actual remote payload was not
retained, so neither its detailed reason nor that particular payload shape is
proved. No SDK continuation defect, billing/routing cause or provider-specific
field omission is established. This is controlled protocol evidence, not a
successful real-provider continuation or permission to retry.

The current required scope is the complete chat foundation: streaming, native
tools, multiple humans and Agents, attachments, Files, Folders, dictation, Skills,
HTTP MCP and confined Agent computers. This supersedes the earlier optional
computer classification. Home/page redesign is deferred. Ordinary authentication
and real Garage-backed Files persistence have passed; the three upload RSS caps
remain failed, not waived. Actual external reset/invitation mail is a separate
user-deferred integration, not a login gate.

The current continuation explicitly excludes item 5, Agent browser/desktop
capability work. Its proposal and failed sandbox evidence remain retained;
no image acquisition, policy/security change or new probe is authorized.

The bounded real-model selected-Skill/public-MCP exact-output case failed and
its two-Run allowance is exhausted; memory experiments have stopped with all
three caps still failed.
Johan subsequently deferred live SMTP setup
and delivery ("No smtp for now bro"); the provider/sender/recipient question is
withdrawn. No SMTP credential discovery, configuration or external email sends
are authorized now. Keep the email implementation and current login behavior.
The prior exact-output and three 300,000 KiB RSS failures remain failures. Public
Cloudflare documentation MCP discovery now passes the pinned 2025-11-25 protocol
without credentials; a remote tool call and live-model chain are not yet proved.
Explicit per-Connection anonymous authentication is a reviewed local change
based on `004db99a9d5ad1c4d5682ddd954bc79e72c4526a`; 49 connection/config tests
pass, including zero anonymous secret resolution/Authorization and retained
caller, grant, approval and authentication-change fences. The diff/source pins
and check logs are under `anonymous-mcp/` in the evidence root. Independent
backend review passed 49 focused and 11 additional negative checks with no
required finding; its evidence manifest SHA-256 is
`7afcf13b62bcdb6ba173a8fe04ad99efff5e37d17a983b5ff3959a4e98a69368`.
The isolated controlled UI rehearsal at
`live-skills-mcp-next/attempt-8f068138-596d-451d-99d4-0d496f7943f0/`
passed normal signup/sign-in, anonymous configuration save and authorized
storage/reload, supporting-File selection, Agent Skill selection, composer
admission, exact persisted native-answer/publication equality and unchanged
published-answer reload. Its model and MCP service
were fixtures, not live inference or external tool execution. The owner
inspected the results, preceding UI screenshots and joined-cleanup evidence. The
configuration dialog remains a blind replacement editor and defaults to bearer
when reopened; none-mode persistence was checked in authorized storage, not
inferred from that default. This is not a durable runtime configuration claim.

Current production reset/private-token invitation composition passed a fresh
capture-only SMTP replay: exact envelopes/templates, revoked reset sessions,
token replay and wrong-recipient denial, normal unverified authentication and
persisted accepted membership after restart. `email-next/evidence-sha256.txt`
has SHA-256 `1f123e7e7c1ac23cdc2fba4198459f49784d9a4c8b64074c7150dbad13f35b6a`;
all 16 retained artifacts verify. Its source manifest distinguishes the tested
uncommitted config hash from subsequent MCP-only formatting. No external email
was sent. External SMTP delivery is user-deferred, not blocked on approval and
not passed live; the captured proof remains valid. Vault inventory remains
unknown, not proven absent, and will not be investigated under this scope.

The authorized single Bun `--smol` A/B finished on unmodified frozen
`004db99a9d5ad1c4d5682ddd954bc79e72c4526a`; all 641 source files and the harness
stayed identical. Normal→smol RSS peaks were 456,512→451,776,
505,200→502,336 and 512,160→520,272 KiB: all three unchanged 300,000 KiB gates
failed in both variants. The largest case worsened; do not activate this flag as
a fix. Slowest unrelated-request latency was 66→91 ms, both under the unchanged
1,500 ms bound. Both variants passed authority revocation, abandoned downloads,
admitted incomplete-upload cancellation and real joined shutdown during an
incomplete upload (exit 0, no SIGKILL, about 10.02 seconds, unchanged File rows
and empty spool). One pair establishes no general latency claim. Evidence is
`memory-smol/`; manifest SHA-256
`989c14415188954bff93376dc2ed5c48be1c135d39d96e73dce6048fd276abc2`.
Owner verified its seal and both owned child processes/private temp resources
are absent. Memory remains an unresolved failed gate; no S3 prototype, runtime
mode or executor architecture was integrated, and further experiments stopped.

The following working acceptance map distinguishes completed proof from the
current implementation work after `2ea56febc104c0e808273bb3a7c0a7187d8b2e91`.
No aggregate all-green or computer/browser-complete claim is made.

| Requested behavior | Actual proof or remaining gap |
| --- | --- |
| Normal account and workspace access | Passed independently with the legitimate existing account, unchanged false email verification and owner membership. |
| Garage-backed Files upload/read/reload/restart | Passed on the same saved 67-byte synthetic private File, including normal HTTP and isolated browser download/reload after both Garage and API restarted; exact evidence follows below. |
| Native tools and multiple humans/Agents | Current controlled critical seams and normal-authentication two-human/one-Agent cases pass; one-human/two-Agent streaming isolation also passes. Reviewed request/token/retry ceilings are active. After the independently accepted bootstrap Environment repair, one separately sealed same-message continuation finished on the configured real provider. Its exact native File read, accepted account/model binding and durable publication pass; the model added synthetic decoding commentary, so the original exact-output gate remains failed. After the minimal read-marker correction, renewed-authority same-Chat initial and reload browser checks pass for the original answer/author/instruction/attachment/bytes, with eight own read-marker acknowledgements and no retry warning. V5 uses 34 browser-navigation API forwards within the unchanged 64 cap, plus five preflight API reads. |
| Incremental streaming | Actual native partial text reaches the sponsor before completion in full and floating Chat. Final budget-integrated independent acceptance passes private audience, actual realtime-only reconnect without page reload, Stop, current authority and publication deduplication/reload. Shared history still uses only authorized durable publication. |
| Chat attachments and Folders | Current frozen-source replay passes actual isolated Chrome upload, exact bytes/native context, participant access/revocation, Folder create/move/list/reload and nonempty archive denial. The accompanying 83-case affected regression run includes attachment/source/Folder authority and native custody. No live configured-user Folder write is claimed. |
| Dictation | The composed real STT → literal composer → self-only message → persistence/reload gate passed. Original helper policy failure remains intact; the separately sealed same-Chat readback passed with no new capture/STT/message/Run and exactly two acknowledged own read markers. Microphone, browser and helper-session cleanup passed. |
| Skills | Current 83-case affected regression run includes native Skill materialization and current authority revocation, including visibility change during actual byte I/O. The additional controlled Chat proof preserves accepted selected instructions through a later edit, reads exact immutable supporting File bytes and denies queued launch after Skill archive. The real-UI controlled proof below also passes Skill creation, supporting-File picker/save, Agent Skill selection, composer admission and native byte read. Live configured-user Skill use remains unverified; the saved Default is unchanged. |
| HTTP MCP | The ordinary index.ts startup composes one exact origin and workspace/Connection/reference credential bindings; independent controlled native request, approval, denial, revocation and restart pass. The additional selected-Skill/Chat chain proves exact approval before one HTTP peer write, current-grant revocation, saved output and inference-disabled readback. The real-UI controlled proof below passes exact Settings operation approval/confirmation, one loopback write, publication and page reload without replay. No real remote endpoint/account is configured; durable MCP remains disabled. |
| Confined Agent computer | Required and implemented as one bounded offline Mastra tool using Docker primitives. Independent review found and reproduced unsafe SDK pull/reconnect/late-create behavior; that lifecycle was removed. Direct-Docker race probes and both owner and independent thirteen-case real-container/native-HTTP runs pass. Independent Docker events confirm all eighteen created containers were destroyed, with no leftovers. Reviewed durable configuration is active; no real-model computer invocation is claimed. Browser and persistent desktop execution remain unsupported. |

The real-UI selected-Skills/MCP proof passed on source revision
`f7d1d715365ef6503b1dae303cac1b61ec4dfd9b`. Normal signup/sign-in, Skill
creation, supporting-File selection/save, Agent Skill checkbox/save, composer
target/send, exact approval and its confirmation in Settings → Connections →
Operations, publication and actual page reload all ran through the existing UI.
Fixture setup alone used the installation domain/API for workspace, provider,
Agent, uploaded File, Connection grant and empty Chat. Production server, queue,
native memory and domain tools produced one finished/completed Run, one succeeded
operation, one MCP write and two saved Messages. Exact supporting/generated
File bytes and unchanged reload readback passed; no page errors or replay were
observed. The deterministic model and loopback MCP/S3 peers do not prove real
inference, external account compatibility or Garage certification.

Evidence is `~/.capy/work/otto-pending-closure-20261010/skills-mcp-ui/`:
`attempt-2b259bf5-99d3-4239-9f93-b7022e2ed389/result.json` SHA-256
`dc6ce3b08a6dc1e594ea2e2841efd5cda5329d04c6f8e792b67e7b1ee5d259c4`;
complete `SHA256SUMS` digest
`506cdccfa7c000de0bfdd91059923c94a26c0db0e1fd7e597b40f4f82c96a4b5`.
Owner inspection verified the harness, persisted assertions, original screenshots,
seals and current source pins. Authority sources match the earlier negative
fixture below, so denial/revocation/archive cases were not repeated. Joined
owned browser/Vite/server/peer/PostgreSQL cleanup passed in the harness; owner
recheck found the fixture PID, API/UI listeners and owned spool absent. No product
fix was required; saved user data and the existing runtime were not changed.

The additional controlled Skills/MCP chain used source checkpoint
`0cecc9f669c584c45b4a8b4e1368b29b1ec0f568`, three disposable Runs, two
deterministic model resolutions and one approved HTTP MCP write. Anonymous,
viewer and stale-identity approvals were denied; revocation produced no second
write or final publication. Reopening Hono/native storage without a model
runtime preserved the exact Chat messages, native history, generated File bytes
and succeeded operation, without replay. This is not browser UI, external MCP,
Garage or real-model evidence. `skills-mcp-gap/result.json` under the pending
closure evidence root has SHA-256
`f9d6aff1a5f55de08b232ef70a6923743812a171d29d3d337f6594a5e9023a48`;
`cleanup.json` is
`1a47873842feaeb681e17b8ecbb156831b2b422ab56d56c5d667d9e519305f20`.
The private PostgreSQL/socket and spool were removed, all owned closures joined,
and saved user data/configuration was never accessed by this fixture.

The separately authorized cached-image Chromium feasibility probe failed under
the unchanged confinement profile with actual exit 1 and “No usable sandbox!”;
there was no DOM-render pass. The first collector failure is preserved rather
than relabeled as that browser result. The corrected replacement's result and
stderr are sealed in `browser-gap/replacement-probe-1/evidence.sha256`, with
`RESULT.md` SHA-256
`43fe7325d8a0492d38b3d1a85688bf91ff8d9f7108e303eada614720af9c2074`.
Exact container destruction, exact-ID 404 and empty owner/type query were proved
before device disconnection. Executed browser version remains unverified.
No further probe or security relaxation ran. A clean image using an unprivileged
user-namespace sandbox is only an unexecuted candidate: image acquisition/build
and any reviewed namespace-only seccomp delta require separate authority.
Installing the setuid helper alone is not proven sufficient with
no-new-privileges. Browser and persistent desktop support remain unavailable.

The capped live browser diagnostic (`agent-proof/ui-readback-v4/`, result
`faba6611-d42a-4088-a77d-44836ae690d0-result.json`, SHA-256
`dd2662975363db7861218cb9a1c24dbd9b952f0d3728faf5a5a1f09658802bcc`)
observed exactly two requested navigations, not an HMR navigation loop. The
initial load forwarded 53 API requests, including four read-marker POSTs and
five requests to each major Chat/directory endpoint; reload used the remaining
11 allowed API requests before the cap. A normal-authentication disposable
browser regression isolated the cause: holding four actual read responses kept
each directory endpoint at one request; releasing those responses increased
each to five. ReadReceipt now invalidates only this workspace's Inbox/floating
attention queries, leaving other mutation invalidation unchanged. The unchanged
regression passes after that correction, with persisted attention cleared and
no retry warning; root/web types and scoped Biome pass. Before/after logs are
`read-marker-owner/baseline.log` (SHA-256
`e34283fa3e07cdac8e9c454dbb0bdc04657eadb0ee97d438a25557f6a731cfd6`)
and `after.log` (SHA-256
`03ca4bdd2e27c0bff6f20a4af20760547616b419c8c98079b5d22bd7477206dc`).
The changed `apps/web/src/routes/chats.tsx` hash is
`0b17dca50c96feee79f475a622f39042feb3aedd0964163745a51229e0deaa99`.
The additional normal-authentication afterproof passes full/floating behavior:
four full-Chat ACKs and six held floating ACKs leave unrelated directory,
participant, Session and File queries at their pre-release counts. Both active
Inbox/floating attention consumers refetch and clear unread state. A valid
human-participant composer Message still refreshes required consumers; full
reload, floating minimize/reopen and reload/re-selection preserve history.
Forced authenticated production draft-WebSocket reconnect passes while floating;
forced full-page disconnect was not separately asserted. There was no Agent,
Run admission or inference. Result
`read-marker-refetch/6a43bfef-1847-4e54-a4f1-cee9092b0ed4/result.json` has SHA-256
`b11a2d6e8f27f19b906b02c259a92512a98a942ea9356d3d98ab082ab4ba5078`;
its complete evidence seal is
`4ac6fce1e2342275484a92e81138fd2e41041506abb407e2c4cae1bcf616a42f`.
Seven source pins matched before/after and at integrating-owner review. All three
scratch attempts' browser/Vite/relay/queue/fixture cleanup was joined and their
exact ports, PIDs and private PostgreSQL directories independently confirmed
absent. Two scratch harness failures and the original empty-With legacy failure
remain preserved; no product guard or existing test was weakened.
The Captain then executed the separately sealed v5 helper exactly once, without
another inference or Run admission. Result
`agent-proof/ui-readback-v5/ceb97da7-c694-40ef-b5d8-4169baa43b26-result.json`,
SHA-256 `68872e43998ee7616add10983df7e0f33ef763017ca9ab4cf4235b27a4af2a36`,
passes exact saved answer/author/instruction/attachment/File checks on initial
load and reload. Eight legitimate read ACKs passed, without a read-position
warning or policy failure; helper signout/session revocation, browser close and
temporary-profile removal passed. Two requested navigations forwarded 17 API
requests each, down from 53 on v4's initial navigation. Five preflight API reads
are separate from the unchanged 64-navigation-API cap. The 37 API-counter rows
are complete; the independent 32-row static-resource reserve truncated, so this
is not a complete resource inventory or authentication-network count.
The original exact-output gate remains false: the preserved 454-byte answer
still contains synthetic decoding commentary. `loadedApiRevisionVerified`
also remains false; on-disk source pins and an owned healthy process do not
attest the in-memory server revision. The helper seal remains unchanged at
`6288aa0bc41baeb25fd0931c67d4b7f955d9ce498aec7650132dd7c5c0ba6af3`.
Post-run owned API health/readiness and UI HTTP200 passed with zero unfinished
durable Runs, no helper Chrome process or temporary directory and no restart.
Fresh root/web types, scoped Biome, boundaries/consistency and the lasting
browser regression are recorded in `integration/read-marker-checkpoint/`.

The approved app default is OpenRouter at `https://openrouter.ai/api/v1`, explicit
`chat-completions`, model `google/gemini-2.5-flash-lite`; dictation separately uses
the official transcription route with `mistralai/voxtral-mini-transcribe`.
Only the existing exact `OPENROUTER_API_KEY` vault record may supply these calls.
Provider setup preserves conflicting user choices and terminal historical rows.

The normal authenticated provider setup completed without inference and without
changing the disconnected historical account. The exact safe Default/provider/File
collector also passed; its instruction hash is the empty default, with no selected
Skills or Project. Evidence under `~/.capy/work/otto-pending-closure-20261010/`:
`provider-helper/captain-configure-result.json` SHA-256
`9c2d01a6ef3576d233eff373c9be7f1433394370193cb117bc702b03f508163f`,
and `agent-proof/expected.json` SHA-256
`bf979f70f75eec1235fa4ef7d92e2aa953b39b05f1ebfe007bd87e1a63a11328`.
Neither file proves inference or native tool invocation. The configuration helper
explicitly does not claim atomic absence checks across provider/key creation.

The subsequent separately sealed continuation admitted exactly the original Chat,
Message and request and finished as Run `fb7dd36b-e145-40d1-8bbe-7fccd9f2d37d`.
Its actual acknowledgement hashes to
`26e24e171e277418148e6bf0ddb369aaf64f591ea9e0da3c23a660542daf586d`.
The read-only native receipt result, `agent-proof/native-receipt-result.json`,
SHA-256 `d2f544024926c8005a27f7acfcdecc9b0ed31f8bf1b99a2e686e38f6baa4460f`,
proves one exact `file_read` result with the saved 67-byte digest, the accepted
OpenRouter account/model/endpoint/credential binding and a new unreused Session.
Two persisted usage receipts are observed, not two measured network requests;
actual live transport count remains unverified.

The model published a 454-byte text answer containing decoding commentary and both
synthetic File lines, ending with the correct requested first-line answer instead
of returning only that answer. This is model format noncompliance, not a missing
tool result or publication. The original exact-output failure is retained.
The bounded published-text projection is
`agent-proof/publication-readback/publication.json`, SHA-256
`def820be0c0afcf49d879305f47eaa0faf59b89b4188c46a90fd600206b341bc`;
published message `cfd92801-bebf-4588-a369-1b9164bf0639`, cursor 25, has body digest
`c43fcf2a158d8c669323fc57c4ec50e3c04c2fcb5e91315f6c623baea7e00938`.
No further inference or admission is authorized by this readback.

The separately sealed UI readback stopped before Chrome when the normal messages
response no longer matched its exact two-message scope. Metadata-only diagnosis
found later human/Agent publications at cursors 29/33; their bodies were not
inspected. The messages API supports only a lower `after` cursor, so a helper-only
change cannot exclude those newer messages. This is a changed-content authority
boundary, not a malformed API or product failure. The failed helper and original
guard remain unchanged. That scope decision was subsequently resolved by explicit
authority for bounded newer same-Chat reads and normal own read markers; the
subsequent initial-browser and v5 reload passes are recorded above. Evidence
`agent-proof/ui-scope-change-metadata.json` hashes
to `c7618ae51a47c4a244cff60994b41c30d0ab420af5f06843bfcb8a69cf14e3ef`;
the failed result hashes to
`f45bb8d5c10355c1b4b44b915600384ddfafc3b2454c05aff20b722eaee4a72c`.

The final independent budget/streaming/MCP report is
`integration/independent-acceptance/FINAL-REPORT.md`, SHA-256
`b06c9db18b4a2806a68f9503c3c21d85bb160ae1dff710e33cf2c2b4503b5310`.
It proves serialized 8,192 output tokens across sixteen official-SDK steps,
exactly one transport attempt on retryable 503, request seventeen rejected before
authority/DNS/transmission, independent counters and deadline/cancellation cleanup.
Both model and Mastra processor retries are disabled through official APIs.
The reviewed runtime and offline computer were activated as PID 26937; source seal
`integration/final-head-20261010/activation-source.json` hashes to
`5be11a6b543de0da9d2eb67092aa63fc8fc16ff93ec143260d185ac34e455fe7`.
Startup records storage/transcription/computer enabled, mail absent and MCP disabled;
readiness and UI HTTP 200 passed. No unfinished Runs or offline containers existed
before/after startup, so no foreign computer was adopted or cleaned up.

The subsequent single live admission failure remains separate:
`bootstrap-repair/exact-reconciliation.json` records zero exact-request/Chat Runs
and zero Default Environment rows; `admission-404.jsonl` retains the sanitized
HTTP status. The original helper state is preserved unchanged. Initial bootstrap
called `ensureDefaultAgent` without `createEnvironment`, while normal Agent
creation performs both. The narrow owner-only initialization repair passed four
actual-CLI isolated cases and an independent four-case replay; there is no
missing-Environment fallback in Run admission. Independent report
`integration/independent-acceptance/bootstrap/REPORT.md` hashes to
`3b2556b8e52089e2a663a478e6829f9be864d325e3ea9238758925a7234e77a6`.
The reviewed CLI then repaired the exact saved Default with one generation-zero,
unavailable Environment and no provider/computer binding. Agent/provider/Chat/message
fingerprints and the original helper state remained unchanged; no Run was admitted.
`bootstrap-repair/live-repair-result.json` hashes to
`52af9d2bb3a0160477a41c818532cdc3311ad9819cfeb3b88dba5ed1270cdb6b`.
`activation-addendum.json` in that directory records the sole prior source-seal
delta (`scripts/bootstrap.ts`) and new test, while the loaded runtime, transport,
computer and UI bytes remain unchanged. No server restart was needed.

Voice/chat activation is recorded in `integration/voice-chat-activation-source.json`
and `integration/api-voice-chat-20261010.log`: storage and transcription are enabled,
computer is disabled, and the API is ready. The real dictation result is
`dictation-proof/live-result.json`, SHA-256
`6b5fef4253761b08fcc70866b63e30496fb3799e39d015686f9f7d833ad892a7`.
It preserves the policy failure while recording STT 200, one 69,937-byte capture,
one saved human message and successful reload/session revocation. Do not repeat
capture, transcription or message creation to repair that policy check. Controlled
dictation evidence separately passed eight server cases and three Chrome cases.
The independently executed same-Chat recovery is
`dictation-proof/readback-proof/readback-result.json`, SHA-256
`275b3f688998ff266ae2cf91aab142784e23d06c5fafe4a56c75d3b9e79c2736`.
Before/after HTTP and visible DOM match the original saved synthetic text hash
`432f2dadc22d8e757adf79caa918807b81ab0cf5f3fec4c5de5778f6ff5b8eaa`.
Its policy, self-only audience, zero Runs, bounded metadata scaffold, two exact
read-marker acknowledgements and session revocation passed. The original failed
live result remains in place and under `live-execution-v2/`; it was not rerun.

Current integration replay under `integration/final-head-20261010/` passed
83/83 tests across seven suites, including all thirteen actual Docker cases,
on 387 unchanged source/config/test files. Before/after manifests both hash to
`f75faf8079f67ca0e2936750e97d39db863e95f51362c35b82236e2d6f07dc91`;
the regression log hashes to
`bc56704b9d17dc12c4fe256595819ac96cb6143ec7307521a8430369d2399882`.
The separate actual Chrome attachment/Folder replay has no source drift or
browser errors; `attachments-browser/result.json` hashes to
`ca155a87cb8259101223f193ecab850dd9ad73fabc9351a86377edc754470efe`.
Root/web types, full Biome, boundaries, consistency and DESIGN lint passed.
These controlled models and storage peers are not real provider/Garage proof.

The direct-Docker owner's final thirteen-case log hashes to
`600560a1ffa720ce2bb7546870d3be77ba029a4642dd08382971797bbb25145a`.
`runtime-capabilities/independent-review/` retains both the original three failing
SDK control-plane probes and corrected direct-Docker probes. The first direct
suite's late-create fixture failed because client timeout propagated upstream EOF
and Docker returned 499; the corrected fixture retains upstream delivery and proves
uncertain cleanup until exact owned-identity reconciliation. This is not real-model,
browser or persistent-computer qualification. The independent full replay passed
13/13 with zero skips in 79.48 seconds, preserving all ten source/config/lock hashes.
Its report is `runtime-capabilities/independent-review/real-run-20261010T0951Z/ACCEPTANCE.md`,
SHA-256 `892b7ae5140860b68042e114e57ca084f67e3ddeef5f52eb08608c01f50fa3f0`;
the test log hashes to `af4fa18521256ae269d46b3575651edc37f817101de3e2c0f620616c457e5962`.
The reviewed computer source is `d633c342a21d4708236722386c381e419261191c6ec711087fc28da08bb46b58`.
The replay used current runtime source `4667c306d61dff856bb625baa13101d5d8c3caf009a4d04ba383350e8190c06e`;
provider-budget acceptance remains a separate gate. Its cleanup proof records all
eighteen create/destroy pairs and an empty owned-container list.

The 10 October bounded RSS rebaseline on `7a5a6d542b6bdc1873dbb3a9984ab4ac5db3c98d`
failed all three unchanged 300,000 KiB checks at 450,208 / 511,168 / 567,344 KiB.
Idle server RSS was 274,768 KiB; a fresh lifecycle import alone used 266,912 KiB.
Transfer bytes/digests and concurrent responsiveness passed before the cap
assertions, but later spool assertions were not reached. No safe small fix was
demonstrated, and no cap/metric change or forced garbage collection was used.
Exactly the three affected tests ran; 23 others in the file were skipped.
`~/.capy/work/otto-pending-closure-20261010/memory/diagnosis.md` records the bounded
investigation; test-log SHA-256 is
`12261b6459f38ed331dd5cfabca490d86edbc67cc1516a28c3d4f44bf396380f`.
Original failed proof remains unchanged. The final authorized phase investigation
also stopped without a demonstrated small fix: with native initialized, 50 MB
ingress reached 286,256 KiB, S3 PUT 329,424 KiB, and read-back verification
405,776 KiB. ArrayBuffers subsequently fell below 1 MB while RSS stayed about
407 MB. Two supported-transport scratch candidates still exceeded every cap and
were not shipped. `memory/phase/no-fix.md` records the stop point. No further
investigation or production memory edit is active; the Captain's earlier
local-testing exception does not constitute Johan's acceptance of all-done.

Garage is now provisioned with the three approved create-only Otto/dev root
records, one `otto-dev` bucket, and a key granting read/write but not owner or
bucket creation. Actual authenticated 4,480-byte content matched SHA-256
`5be5ee1e6e02f5dbff61106d59349db131ee1b44b62264bcf5b6f6fb1c700ade`
before and after restarting the same Garage v2.4.1 container; anonymous object
access returned 403. A retained owned SSH forward binds only 127.0.0.1:43900,
using Colima's existing configuration and the current internal container IP.
It preserves the internal-only Docker network; no outbound bridge, public
listener, new SSH credential or container replacement was introduced. The
forwarding launcher passed type/format checks and independent source/listener
review; the identified startup-documentation omission was corrected and checked.
Exact sanitized proof is
`~/.capy/work/otto-pending-closure-20261010/storage/storage-result.json`, SHA-256
`d95c526ffacd9053f8d807dd0b69286a68aa4947d1d885c9ca0bb31508859ed1`.
The owned Otto API was restarted with storage enabled and mail disabled; its
startup reported server ready, `/ready` returned `{"status":"ready"}`, and Vite
remained available on port 5173. PostgreSQL and Vite were not restarted; the
pre-restart unfinished-Run count was zero. This activation is not authenticated
Files proof by itself. Subsequent normal-account Files/browser proof passed:
one private 67-byte File `85c2ac65-d9d7-4ff1-9a04-3888a8bee890`, content SHA-256
`882f43d383778ebdc21684c7c67b0a1db897e894733fb0be1daba4889462f94b`, survived an
owned Garage restart and API restart. The final read-only recheck passed metadata,
exact bytes, actual isolated Chrome list/detail/reload/download, browser policy,
signout and helper-session revocation without another upload. Captain executed
the secure helper independently; the result and screenshot were inspected here.
Evidence under `~/.capy/work/otto-pending-closure-20261010/files-proof/` is
`recheck-61cfacc7-f0e1-44f2-9bb4-6260dfce0751-result.json`, SHA-256
`179ccb8ac7113303df35f642146279bd4545fcc749e9cbb60162db8b8b566287`.
The initial result's policy failure is retained unchanged: the helper refused
Vite's exact loopback HMR socket despite passing functional checks. The narrow
correction admits only the identified port/root/token shape; 18 controlled cases
and an actual unauthenticated Chrome reproduction qualify that policy fix.
Post-activation read-only checks
confirm the original unverified account, installation claim and Hello Gafaro owner
membership remain present: `storage/persisted-after-activation.json`, SHA-256
`3a762587271ceade853fc998f462414a1d67aba17c32d1397ada722261b45d3a`.

The corrected bounded **live** continuation proof passed all 14 checks in `real-provider-continuity-live-cdb3065e-9164-48d6-b030-6409288a13eb/result.json`, SHA-256 `272557ade3fcfd80a26833e91325c4a50d8cca4f843310bfd87fd09b8643ddc0`. It used eight SDK calls across three finished Runs on the same sponsor-private Session: one Task creation, one successful rename, one exact authenticated approval for 30 human minutes, and Run 3's own published title/ID/30 answer backed by its actual `task_get`/`time_list` results with zero new effects. Independent authenticated readback/reload and no-inference server restart passed; all 282 source hashes and harness `0d12ea896f5d9a7021d9effbb8186a0d13b63928ae5b7d1cbff6c7c2b718fc47` remained unchanged. The first `task_update` produced an output-error that the model recovered from; this is not an error-free-tool claim. Observed usage is 14,065 input and 638 output tokens, not billing qualification. No more live calls are needed for this bounded gate. Normal-account Files persistence and person-configured Default-agent execution remain unverified; ordinary account/workspace authentication has since passed as recorded below.

The 10 October continuation correction supersedes the earlier live-ready checkpoint. The bounded live attempt in `real-provider-continuity-live-10ad072d-8034-43f9-9732-5a1552272d0c/result.json` failed at SDK invocation 4 with HTTP404 after the first Task was created; the exact approval did not finish and no third Run existed. Cleanup interruption is not the cause. The failed evidence remains unchanged.

Controlled diagnosis found that Mastra omits `openai.store` on tool follow-ups. In the official SDK, omitted `store` enables stored-item references. The four-request controlled HTTPS regression captured `store:false / absent / false / absent` and two item references on request 4; the deliberately stateless peer returned HTTP404 there. This reproduces a failure mechanism, not proof of the live upstream's internal reason. The native Responses factory now enforces `store:false` for both SDK methods before serialization, without changing Anthropic/chat-completions, the selected account/model/endpoint, or current authorization. Factory SHA-256: `3616a41ccd87bef97ed11d21698f627bfd15ec940a1a5df358e82dd7a2691eb6`. Focused regression passes 110/110; root/web types, full Biome, boundaries and consistency pass. The 356-file manifest in `provider-404-diagnosis/source-current.json` hashes to `c16717bb96c6391548a123237522658692262d19b3b223071d10251d1ae797d6`. Independent review found no required findings and passed 52 tests plus differential SDK probes; report `independent-final-source-review/provider-stateless/report.md`, SHA-256 `b749126adadf8c349303f46dedd1226790faf672efa465ec57a2870ffd329a59`.

The stronger actual-AgentController/official-SDK fixture passed 15/15 checks over three turns and six calls: every serialized request carries `store:false`, zero item references, no previous-response ID and exact function-call/output pairing. It also proves the exact Run 3 native publication, current Task/time read results, zero new effects, authenticated approval/reload and no-inference restart. Evidence: `real-provider-continuity-fixture-531a04d9-8f77-417b-9a8a-355510092f51/result.json`, SHA-256 `e6ce34a66caf66e91b90422c3e24629dd8046187ac4efc6309ef80018886150a`. Its 282 source hashes remain stable, compact manifest digest `bed8d6bc618fc335e213f43270a4655ceed09631f903a259fca17861b2df2821`. The final scratch harness hashes to `0d12ea896f5d9a7021d9effbb8186a0d13b63928ae5b7d1cbff6c7c2b718fc47`. A separate unfixed negative control fails on its first tool follow-up. These controlled results released the corrected bounded live gate, which subsequently passed as recorded above; they do not change the failed original live result into a pass.

Reusable local startup is now integrated in `scripts/durable-dev.ts`, `ops/local-garage.toml` and `docs/local-dev.md`, with `/garage server` corrected in `ops/compose.yaml`. The historical pre-enrollment PostgreSQL reuse/restart check preserved cluster identity, all 55 table counts and queue v43 at its then-zero-user snapshot. The current installation now has its legitimate account and workspace. Fifteen controlled launcher groups, root types, scoped Biome and Compose syntax pass. These results do not qualify the still-unexecuted Garage/S3/API/auth branches or authorize token capture, new vault writes or mail. Exact evidence: `durable-dev-handoff/integrated-report.md` and `integrated-files.json`.

| Slice | Verdict | Evidence and limitation |
| --- | --- | --- |
| Recoverable source and saved data | Passed | Hash-verified source archive and SQLite integrity backup; `restored-tree-proof.json` proves exact v1 source tree. |
| Preserved login/Home references | Authenticated bounded proof passed | `home-reference/authenticated/result.json` records seven grouped production-fixture checks, normal browser sign-in, saved records, desktop/mobile light/dark, reload and actual Project membership revocation returning 403 without cached Task disclosure. Twenty-eight applicable hashes stayed stable. Earlier fictional HTTP-fixture screenshots remain visual-only evidence. |
| Exact v1 isolated boot/auth/domains | Baseline passed; final native checks separate | Isolated PostgreSQL 17 production-entrypoint baseline retained under the restoration evidence directory. This is not evidence for subsequent native changes. |
| Exact v1 large-history WebSocket | Fixed at `329b5a76`; final revision rerun pending | The separate committed fix treats Bun `send() === 0` as dropped and `-1` as accepted/backpressured. Original failure evidence and dedicated regressions remain separate from native integration. |
| Native Mastra integration | Corrected native checkpoint: 529 passed, three unresolved cap failures | The single corrected-source run passed 529/532 cases across 59 files, with zero skips. Only unchanged 300,000 KiB RSS assertions failed at 435,856 / 454,816 / 559,840 KiB; The Captain allowed continued local testing, but Johan has not accepted these failures as completed pre-MVP requirements. Root/web TypeScript, full Biome, boundaries and consistency pass. All 356 code/config/test hashes stayed stable: before/after manifest SHA-256 `c16717bb96c6391548a123237522658692262d19b3b223071d10251d1ae797d6`, full test log `cef6f4cbe0bdc78d52de81a78f3f4b23e1754bb3c83e271894ba5aaf99d0ef37`, in `native-final-corrected/`. The older 528/531 raw verifier logs were accidentally overwritten by the copied runner's unchanged output path. Its previously recorded full-log hash `7ce5c02cb6e18a6be9e670e5bb4044e5963146097eb19e7b4064c8d6cb4b3d80` is historical metadata, not recoverable raw proof. Exact old manifests were recovered from the independent review; neither live result changed. `native-final-corrected/evidence-provenance.json` records the loss and separation. |
| Supported domain-tool inventory | All 96 registrations have controlled workflow checkpoints | The actual factory exposes 49 canonical registrations plus 47 `request_` registrations, with no name overlap. Task update/status still use exact-human approval for privileged payloads. The operation matrix below reconciles every name against actual browser/native/result/persistence/reload evidence, including the focused final message-create and completion-proposal probes. This does not qualify every variant, final independent acceptance or real-provider reasoning. Declarations occupy 77,427 UTF-8 bytes, SHA-256 `022c76e3b3eb35d0fd2ff852d082948d86da5e597eaf2cca0b694b98a25ad427`; no verified tokenizer count is claimed. Prior registration artifacts remain preserved. |
| Native production entrypoint, normal auth and persistence | Checkpoint passed; independent final matrix also passed | `native-fixture-production-proof.log` and `native-fixture-proof.json`: ten grouped checks with independent normal-auth browser contexts, current role denial, native-backed WebSocket replay, real S3 adapter against a loopback peer, cold server restart and cleanup. No model inference in this proof. |
| Provider settings and credentials | Scoped controlled proof passed; live provider unverified | Provider lane reports 60 tests plus authenticated desktop/mobile create/edit/key replacement/default-Agent selection/reload. `provider-browser-final.log` independently confirms seven settings browser tests passed. Controlled protocol peers do not prove live provider authorization or billing. |
| Human-only action delegation | Scoped controlled proof passed; full workflow coverage pending | Thirty-two normal-auth PostgreSQL tests cover operation families, exact digests, racing approval, denial, stale target/attempt, revocation, transaction rollback and attachment-source reauthorization. Independent action/domain-tool verification passed 39 cases on stable hashes. Browser/model-through-tool acceptance for every exposed operation remains separate. |
| Real model-through-tool UI effects | Narrow Task workflow passed; remaining operations unverified | The confirmed custom OpenAI-compatible Responses endpoint with `gpt-6.1-sol` completed two SDK invocations, one native Task creation/receipt, independent authenticated two-human UI/readback/reload, and separate-process restart with inference disabled. All seven checks and recorded source hashes passed in `real-provider-live-0db8e514-6995-4f6e-a99e-7fad645877a8/result.json`; screenshots show the persisted Task and Chat after restart. This proves the bounded Task workflow, not all tools, provider billing or later revisions. The earlier wrong-endpoint attempt is retained separately and is not product-failure evidence. The first three-turn live attempt failed at invocation 4 with HTTP404. After the independently reviewed correction, all 14 bounded live checks passed with eight SDK calls across three turns, as recorded above. |
| Connection operation denial | Controlled backend and browser proof passed | `otto-native-domain-proof/denial-final-tests.log` records 54 passing cases across seven relevant suites on stable source hashes. `connection-denial-ui-evidence/result.json` records six browser groups: exact sponsor/identity, persisted denial, reload/filter and zero connector writes. Selected-attachment audience revocation denies approve, deny and execute through actual server routes. Native action denial and Connection operation denial remain distinct records. |
| Upload resource limits and spool cleanup | Three absolute caps remain failed after bounded rebaseline | The 41-case transfer checkpoint passed 38 with zero skips; only three unchanged 300,000 KiB resident caps failed (441,328 / 498,064 / 567,904 KiB in that run). The Captain allowed local testing to continue; that is not Johan's acceptance of all-done. The three caps remain unresolved requirements. Live-owner protection and paired drain/error listener cleanup are corrected; `spool-cleanup-final.log` passes 5/5. The eight-cycle failure is preserved: settled RSS rose 476,080→557,408 KiB, final 560,560 KiB; it is not rewritten as a pass. The authorized 24-cycle follow-up reached a 500,432 KiB high-water at cycle 9 that remained unchanged through cycle 24 and 60 seconds idle. Current RSS at 8/16/24/final was 499,152/402,048/419,552/423,632 KiB. All exact bytes, readiness, settled spool/FD and cleanup checks passed on identical backend manifests. Captain accepted this bounded observed plateau as closing the separate local trend blocker, not as indefinite-soak or no-leak proof. Evidence: `memory-diagnosis/repeat-24-result.md`, `repeat-24.jsonl`; raw log SHA-256 `6668c64f1028ddf9897a89ce257a18d2b221445d7d032a7fbe14a096114c6e7b`, aggregate source SHA-256 `a6cf5c36bc228e20dd9d2b453db1ec67a634b142341acd2a3ffe6d60adb55db9`. The later closure direction reopens one bounded rebaseline/small-cause investigation without weakening caps or forcing garbage collection; the original failed proof remains intact. |
| Automatic normal-Chat continuity | Independent and corrected bounded live proofs passed | Normal sends use auto mode; dispatch binds only the newest exact workspace/Chat/Agent/human Session. `native-chat-continuity-ui/evidence/result.json` proves the same private Session and previous native reply on follow-up, separate human ownership, truthful persisted reset after configuration change, reload/mobile behavior and preserved explicit Advanced selection. The Task workflow recorded 24 continued, two new and three justified reset Runs. Typed sources are reauthorized before Memory and on model/tool/approval/publication boundaries; independent multiplayer/source-fence acceptance and the corrected bounded live continuation proof have passed at their recorded checkpoints. |
| Cold Project/Folder links | Original URL and reload passed | The original cold URL exposed a missing directory option dereference in shared FilterBar. The null-safe fix preserves the selected query and removal controls with an unresolved-option label. `resource-native-workflows/second/` retains the failure; the `frozen-sixth` checkpoint replays the original Project+Folder URL and reload successfully, without a folder-only workaround. |
| Authenticated multiplayer finite matrix | Final 20 grouped cases passed | Independent normal-auth browser proof covers humans-only and all four human/Agent combinations, simultaneous sends, separate automatic private continuation, Stop/queue release, recipient revocation, cross-workspace denial, exact persisted foreign-Session denial, private selected Document isolation and reconnect/reload. A stopped Session explicitly resets; the healthy resulting Session then continues after server PID 53314→56241 with its previous native reply restored. PostgreSQL stayed running, so this is not database-crash proof. `independent-native-acceptance/final-current-matrix-third/result.json` SHA-256 `7bd3026f9f0e6389193dbcfd6166cb7d8f49d2e4648db497e82aca7dd77e01bd`; zero browser errors and zero 365-file source drift. Earlier scratch-assumption failures remain retained. |
| Final independent acceptance | Controlled behavioral and source-security gates passed | Fresh source reviewer found no required defects after tracing exact Session families, serialized dispatch, current source/provider/audience checks, approval/publication, provenance, deduplication and absent host fallback. Six independently rerun scoped suites passed 98/98; all 355 source hashes and 25 assets match the final checkpoint. Report SHA-256 `e36ce91d918d49c73b8cd2fd1e4d5fb8ea3268a52f9ee1062c08878187c2527e` in `independent-final-source-review/report.md`. Separate actual-app final matrix passed 20/20 as above. The corrected bounded live continuation proof subsequently passed as recorded above. Durable user-facing installation remains unverified; these gates do not establish overall readiness. |
| Durable user-facing localhost installation | Existing-account login and first-workspace access passed; provider/storage remain unconfigured | The normal API and Vite at `http://localhost:5173` retain socket-only durable PostgreSQL, existing process-only auth/encryption injection and saved account. Under the superseding ordinary-password policy, Captain independently inspected and executed the sign-in-only helper: real existing-account sign-in, repeated persisted session reads, unchanged `emailVerified:false` and helper-session revocation passed before and after normal operator bootstrap. `scripts/bootstrap.ts` claimed the previously unclaimed installation once as **Hello Gafaro**, granted the existing authenticated identity owner membership and created the standard Default agent. Authenticated workspace membership then passed. No password reset, verification fabrication, raw permission seeding or provider key copy occurred. At that checkpoint the Default agent model was `unconfigured`; Johan subsequently began provider setup. Do not overwrite his choices or treat this historical snapshot as current configuration. Garage/S3 persistence, configured provider execution and next-day browser use are separate unverified gates. Evidence: `password-auth-20261010/captain-login-proof.json` and `bootstrap-proof.json`. Earlier zero-user/login-only evidence remains historical. |

## SMTP replacement qualification (10 October)

The verification-required authentication results below describe checkpoint `8682b79edaa2143faa027ef88f95dbbca3552a43`, not the superseding product policy. Ordinary email/password signup and sign-in now work without SMTP or mandatory verification, including the saved unverified account. The temporary Mailpit service and SMTP startup overrides were stopped, and its verification helper was retired without execution. No local bypass flag, auth framework or database migration was added. SMTP remains only for password resets and invitations; absent mail is explicit unavailability for those operations.

Invitation IDs and matching email do not confer authority. Acceptance requires the privately emailed authenticated token, using the existing seal/open primitive with a distinct invitation context. The proof binds the invitation, workspace, exact recipient, role, expiry and issuing human. Current recipient identity, issuer membership/role, expiry, revocation and single acceptance are checked atomically. Tokens never enter ordinary invitation metadata. The following current-policy proof is retained under `~/.capy/work/otto-v1-restoration/password-auth-20261010/`; the earlier SMTP tests are not relabeled as current-policy proof.

| Ordinary-password scenario | Result | Source-bound evidence and limits |
| --- | --- | --- |
| Focused auth, runtime, invitation, membership, content and task-comment regression | Passed | `final-focused.log`: 101/101 tests across ten files, zero skips, Bun 1.4.2 and Vitest 5.0.3; SHA-256 `fa75b0bf38cb68d824afcb4b08e8d42a276e4c2afa066a2d7f3d9a53a0ebd5c6`. Root/web types, full Biome, boundaries, consistency and DESIGN lint also pass. No extra full native suite was run. |
| Independent production auth and invitation security | Passed; no required findings | Separate reviewer: `independent/verdict.md`, 11/11 independently authored tests. Actual no-mail `startServer` signup/signin, unchanged unverified password/account after restart, duplicate/wrong/short-password denial, expired sessions/reset tokens, reset session revocation/replay, normal operator bootstrap/no implicit grants, SMTP-only token delivery, denial cases, concurrent acceptance and lock-ordered issuer demotion/removal/revocation. Log SHA-256 `2a2c6fe63360141302d033d6751f4e84f8b6f306fe46391e7c3a686f08717980`. All seven frozen application hashes and fourteen reviewed seams remained unchanged; application manifest SHA-256 `e7059c22c2fcc69f5fd383255ac491034fe9331dec20ad8dcc4f0b7d9ec6736d`. This is the source-hashed correction on parent `8682b79edaa2143faa027ef88f95dbbca3552a43`; its local checkpoint is recorded in `checkpoint.json`. |
| Independent browser and invitation forms | Passed controlled | Actual isolated Chrome signup → authenticated no-workspace state → SMTP-token acceptance → reload preserves membership and false verification. Both token fields are masked with autocomplete off; screenshots were inspected. Three additional focused browser scenarios passed under `~/.capy/work/otto-invitation-token-tests/verification.md`. Neither lane used the real account, external email, production storage or provider inference. |
| Earlier fixture/restart failures | Retained; not current-source failures | Worker initially selected unsupported Homebrew Bun 1.3.3, whose exact restart reproducer returned 503. The same graceful/forced reproducer returns 200 under qualified 1.4.2; its fresh five-suite rerun passes 62/62. No lifecycle workaround was added. Missing default Chromium and independent fixture setup/throttling failures remain in their original logs; final passing browser runs explicitly selected installed Chrome/Chromium. |

Provider setup is **Settings → Models → Add provider → Set API key**, then **Settings → Agents → Default agent → Edit agent → Account / Model**. The saved Default agent remains explicitly unconfigured; no provider key was copied or persisted. Current durable-account login is Captain-reported execution of the independently inspected helper; independent fixture/browser acceptance is separate evidence, not a claim of next-day durable browser or Garage qualification.

SMTP is now the only mail backend, using Nodemailer 10.1.0 with the unchanged `Mail.send` interface; current templates cover reset and invitations. Configure `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` and paired `SMTP_USER`/`SMTP_PASSWORD` for authenticated submission. TLS and STARTTLS require valid certificates; plaintext is restricted to unauthenticated loopback sinks. A stable hashed Message-ID is not an SMTP idempotency guarantee. See [the exact contract](operations.md#smtp-mail).

Evidence lives under `~/.capy/work/otto-v1-restoration/smtp-20261010/`, based on local checkpoint `9ca30e489174624f9d66f84917308a77dbb2cd60`. The adapter SHA-256 is `9e47c7c3323268bfb138125e08f7160ce4dd3a1536a96e31a378809916f46571`; exact affected source hashes and test logs are retained in the helper and independent manifests.

| SMTP scenario | Result | Evidence and limits |
| --- | --- | --- |
| Normal signup, verification, sign-in, reset/session revocation, invitations and native-runtime regression | Passed controlled | `helper/accepted-tests.log`: 49/49 across five suites, zero skips. The tests exchange real SMTP/MIME and use normal Better Auth with private disposable PostgreSQL; existing authorization assertions are preserved. |
| TLS/STARTTLS, configuration and bounded failure handling | Passed controlled | Trusted and rejected certificates, hostname mismatch, missing STARTTLS/AUTH, rejected authentication, redacted errors and ten-second pre-/post-TLS deadlines pass. The final fixture explicitly closes only its owned raw sockets after rejected STARTTLS; it does not patch library code. Initial implementation and fixture failures remain in separate logs. |
| Independent production composition and socket cleanup | Passed controlled; no required findings | `independent/independent-final.log`: 13/13 independently authored groups, including all 64 config-field subsets, actual `startServer(readConfig(...))` signup → unverified denial → captured-link verification → persisted sign-in → server restart and existing-session restoration, mail-disabled signup denial/verified login, and raw-peer socket closure before client process exit. Log SHA-256 `ea04722db99cd45f8ad60084c44cf3bc46da98d8741b335b094ad0ef3a1dbb8c`. The strengthened replay in `composition-process-final.log` also restores the session through a fresh production executable. No sender injection or manual verified-row edit. The final review report SHA-256 is `2cbb0b746959236b689c8259ee1f23eff0313afe09d2cd0f6db482fa0fb8b38e`; all 28 captured source files match. |
| Static checks | Passed | Full server/web types, Biome, private-schema boundaries and consistency. No production build. The prior complete native suite remains the separately qualified 529/3/0 result; this focused mail change does not relabel the three legacy RSS failures. |
| Real SMTP provider/account, recipient and inbox delivery | Unverified | No real account or recipient is approved/configured. No external email was sent. Controlled SMTP acceptance is not deliverability, billing or production qualification. |

## Visual acceptance boundary

Preserve v1 routes, sidebar, components and general layout. Explicit additions are current login appearance, current Home backgrounds and real information presentation, main panel/top toolbar, and necessary provider/connection settings. Page-by-page visual refinement is deferred, not an excuse for broken navigation or responsive layout.

## External capabilities

Real model inference is required with an authorized configured API provider. Computer/cloud isolation, remote MCP services and external binary storage must be described by their actual exercised capabilities. A local S3 protocol fixture is not production Garage certification. No host computer fallback, external email/invites, business effects or subscription execution is authorized by test acceptance.

## Current execution boundaries

Native Sessions belong to their sponsoring human. Shared Chat membership does not expose another human's Session picker or private tool transcript. Public assistant messages select native text parts only; Otto stores publication references rather than a second message-body history.

Selected Documents remain immutable accepted content snapshots and are reauthorized throughout execution. Explicit document tools may read a currently authorized unselected Document only within the accepted Chat Project and accepted human audience; private, cross-Project, cross-workspace and revoked sources remain denied. This intentionally extends the old selected-only tool surface rather than asserting unchanged legacy behavior.

Selected Message attachments are bounded to twenty files and 8 MiB total per native input. Bytes are integrity-checked outside mutation transactions, and current File/Project/source-Run audience is checked before and after I/O and during native execution/tool/output boundaries. A private custodial Chat attachment uses its explicit Chat sharing permission, not general File visibility. Accepted Skill supporting-file materialization remains a separate narrowly scoped input read; it does not grant general human-origin tools.

Confined computer execution, script Runs, remote process leases and interactive steer are unavailable. Tests specific to removed Pi RPC/gateway/computer migration are recorded as retired capability, never counted as native passes. Current authorization, queue, cancellation, storage, restart and nonleak guarantees remain required.

The unused legacy model-settings/device-login/NDJSON-stream source chain and its eight device-authentication tests are removed. The original sources remain in the recoverable `329b5a76` history. Those cases tested the retired Codex device-code protocol, not current API-key enrollment, and are not counted as native passes. Current replacement evidence is the native provider protocol/security suites, authenticated settings tests and encrypted-key non-disclosure checks; this does not claim device-login support.

## Native operation workflow matrix

All 96 current registrations have a controlled-model workflow checkpoint: normal authenticated browser input, actual native call/result, persisted effect or read, and reload. This is not proof of every schema variant, independent final acceptance, real-provider reasoning, billing or external storage certification. `task_update` and `task_status` cover direct and exact-human branches without duplicate request registrations.

These checkpoints have their own exact source manifests. The five-file formatting/import-order checkpoint has its recorded historical 528/531 result, completed independent source review and actual-app matrix. The current corrected source has the recoverable 529/532 full-suite evidence above; the older overwritten raw full log is not recoverable proof. The later stateless Responses correction has separate focused and independent qualification recorded above. The formatted-source resource core and 14-case tail passed with identical source, including exact binary upload/download, native 8 MiB refusal, corruption recovery and retained Document/File reset without old body/base64 disclosure. Those controls remain distinct from the 22 operation types and from real-provider continuity.

Evidence paths below are relative to `~/.capy/work/otto-v1-restoration/`. Each artifact contains operation inputs, Run/receipt identities and source provenance or refers to its adjacent manifests. The reconciled machine-readable index is `native-operation-workflow-matrix.json`.

| Evidence | Scope | Artifact and SHA-256 |
| --- | --- | --- |
| T | Task, links, comments, time, proposals and Schedules | `native-action-browser-1791581150364/operations.json`; `e1727b4c6b6398b9427945861ed3f2c29ebda533a21482a39b520cb20bca89c2` |
| C | Agent and Skill configuration | `configuration-native-workflows/attempt-1791581384072/native-calls.json`; `e9b75517b52a8844c73992c8419f1af379487768ab51c9314a933c0efe5cd5cf` |
| P | Project, Chat, Run, questions and peer collaboration | `collaboration-native-workflows/FINAL-matrix.json`; `6a587842f11271d0103cc3e502be855bcbc8a12e945b823f06d01ba9e4e70004` |
| R | Documents, Collections, Files and Folders | `resource-native-workflows/frozen-sixth/progress.json`; `14c1564d775c365808be513a813b170f65b8ba604ec85b88ffd6e4e65af74a14` |
| N | Connection actions and controlled external operations | `connection-native-workflows/evidence/result.json`; `e917f8a063c924add8f25061f7e2b47c04024e6f9ff9428b2b1dc4975755a8b2` |
| M | Native message metadata and completion proposal | `native-message-completion-browser-1791582171216/operations.json`; `1cd0766098e17836dc676c2a056d6211c24f388c617958fff5f35bf154e9e5ea` |

| Native registration | Verdict | Evidence |
| --- | --- | --- |
| `agent_request` | Passed controlled checkpoint | P |
| `chat_get` | Passed controlled checkpoint | P |
| `chat_participants` | Passed controlled checkpoint | P |
| `chat_read` | Passed controlled checkpoint | P |
| `collection_get` | Passed controlled checkpoint | R |
| `collection_list` | Passed controlled checkpoint | R |
| `connection_get` | Passed controlled checkpoint | N |
| `connection_list` | Passed controlled checkpoint | N |
| `connection_request` | Passed controlled checkpoint | N |
| `document_get` | Passed controlled checkpoint | R |
| `document_list` | Passed controlled checkpoint | R |
| `document_proposeChange` | Passed controlled checkpoint | R, T |
| `file_create` | Passed controlled checkpoint | R |
| `file_get` | Passed controlled checkpoint | R |
| `file_list` | Passed controlled checkpoint | R |
| `file_read` | Passed controlled checkpoint | R |
| `human_ask` | Passed controlled checkpoint | P |
| `message_create` | Passed controlled checkpoint | M |
| `message_get` | Passed controlled checkpoint | P |
| `project_get` | Passed controlled checkpoint | P |
| `project_members` | Passed controlled checkpoint | P |
| `request_agent_archive` | Passed controlled checkpoint | C |
| `request_agent_create` | Passed controlled checkpoint | C |
| `request_agent_update` | Passed controlled checkpoint | C |
| `request_chat_archive` | Passed controlled checkpoint | P |
| `request_chat_create` | Passed controlled checkpoint | P |
| `request_chat_participant_create` | Passed controlled checkpoint | P |
| `request_chat_participant_delete` | Passed controlled checkpoint | P |
| `request_chat_participant_update` | Passed controlled checkpoint | P |
| `request_chat_update` | Passed controlled checkpoint | P |
| `request_collection_archive` | Passed controlled checkpoint | R |
| `request_collection_create` | Passed controlled checkpoint | R |
| `request_collection_update` | Passed controlled checkpoint | R |
| `request_connection_create` | Passed controlled checkpoint | N |
| `request_connection_disconnect` | Passed controlled checkpoint | N |
| `request_connection_grant` | Passed controlled checkpoint | N |
| `request_connection_revoke` | Passed controlled checkpoint | N |
| `request_connection_update` | Passed controlled checkpoint | N |
| `request_document_archive` | Passed controlled checkpoint | R |
| `request_document_attachments` | Passed controlled checkpoint | R |
| `request_document_collection` | Passed controlled checkpoint | R |
| `request_document_create` | Passed controlled checkpoint | R, T |
| `request_document_proposal_resolve` | Passed controlled checkpoint | T |
| `request_document_update` | Passed controlled checkpoint | R |
| `request_file_archive` | Passed controlled checkpoint | R |
| `request_file_update` | Passed controlled checkpoint | R |
| `request_folder_archive` | Passed controlled checkpoint | R |
| `request_folder_create` | Passed controlled checkpoint | R |
| `request_folder_update` | Passed controlled checkpoint | R |
| `request_project_archive` | Passed controlled checkpoint | P |
| `request_project_create` | Passed controlled checkpoint | P |
| `request_project_member_delete` | Passed controlled checkpoint | P |
| `request_project_member_update` | Passed controlled checkpoint | P |
| `request_project_member_upsert` | Passed controlled checkpoint | P |
| `request_project_update` | Passed controlled checkpoint | P |
| `request_schedule_create` | Passed controlled checkpoint | T |
| `request_schedule_run` | Passed controlled checkpoint | T |
| `request_schedule_update` | Passed controlled checkpoint | T |
| `request_skill_archive` | Passed controlled checkpoint | C |
| `request_skill_create` | Passed controlled checkpoint | C, T |
| `request_skill_files` | Passed controlled checkpoint | C |
| `request_skill_import` | Passed controlled checkpoint | C |
| `request_skill_proposal_resolve` | Passed controlled checkpoint | T |
| `request_skill_update` | Passed controlled checkpoint | C |
| `request_task_archive` | Passed controlled checkpoint | T |
| `request_timesheet_create` | Passed controlled checkpoint | T |
| `request_timesheet_delete` | Passed controlled checkpoint | T |
| `request_timesheet_update` | Passed controlled checkpoint | T |
| `run_activity` | Passed controlled checkpoint | P |
| `run_get` | Passed controlled checkpoint | P |
| `run_list` | Passed controlled checkpoint | P |
| `run_usage` | Passed controlled checkpoint | P |
| `schedule_get` | Passed controlled checkpoint | T |
| `schedule_history` | Passed controlled checkpoint | T |
| `skill_export` | Passed controlled checkpoint | C |
| `skill_get` | Passed controlled checkpoint | C |
| `skill_list` | Passed controlled checkpoint | C |
| `skill_proposeChange` | Passed controlled checkpoint | T |
| `skill_read` | Passed controlled checkpoint | C |
| `task_capture` | Passed controlled checkpoint | T |
| `task_comment_create` | Passed controlled checkpoint | T |
| `task_comment_delete` | Passed controlled checkpoint | T |
| `task_comment_get` | Passed controlled checkpoint | T |
| `task_comment_list` | Passed controlled checkpoint | T |
| `task_comment_update` | Passed controlled checkpoint | T |
| `task_create` | Passed controlled checkpoint | T |
| `task_get` | Passed controlled checkpoint | T |
| `task_link_create` | Passed controlled checkpoint | T |
| `task_link_delete` | Passed controlled checkpoint | T |
| `task_links` | Passed controlled checkpoint | T |
| `task_list` | Passed controlled checkpoint | T |
| `task_proposeCompletion` | Passed controlled checkpoint | M |
| `task_status` | Passed controlled checkpoint | T |
| `task_update` | Passed controlled checkpoint | T |
| `time_get` | Passed controlled checkpoint | T |
| `time_list` | Passed controlled checkpoint | T |
