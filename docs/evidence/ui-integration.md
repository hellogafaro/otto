# Whole-UI integration evidence

Baseline: `3450a1fa0fd8bc5e3000a50872486da91846f1dd`. Tested production revision: `ce794fd81db2ecbe9fd33b9a032f8c5717edced1`. Later evidence-only commits preserve those source bytes. [SHA-256 manifest](ui-integration-manifest.json) records the source files, screenshots and retained private artifacts.

The application uses the existing typed Hono operations, Better Auth sessions and workspace-scoped TanStack data. Production routes have no mock-data imports. The seven domain inventories linked from [the coverage record](../ui-wiring.md) enumerate their sheets, dialogs, menus, supported operations, permission gates and pending capabilities.

## Observed checks

| Check | Result | Evidence |
| --- | --- | --- |
| Real-browser action scenarios | Verified: all 37 scenarios passed across serialized runs; these were not one uninterrupted 37-case run | `tests/browser/*.spec.ts`; private `browser-combined-current.log`, `browser-final-remainder.log` and earlier accepted domain logs |
| Final affected Document/Task/workflow run | Verified: 12/12 passed together, 67.1 s on the tested revision | Private `browser-rechecked-fixes.log` |
| Route, theme and viewport coverage | Verified: 56 desktop/mobile, light/dark captures; readable settled states, no alert or horizontal overflow | Private `browser-domains-pass4.log`; repository `ui-<route>-<viewport>-<theme>.png` |
| Native Pi integration | Verified: 19/19 passed in 90.08 s on the identical reviewed Pi source bytes; real native requests, cancellation, authority, usage and joined cleanup | [Native evidence](ui-native-diagnostic.md) |
| Final combined backend suite | Verified: 48/48 files and 421/421 tests passed together in 609.35 s, exit 0, on unchanged source. The preceding run had one private schema-startup failure; its exact recheck passed and the failure did not recur in this fully serialized run | Private `combined-accepted-revision.log`, `lists-lock-recheck.log`, `combined-final-serial.log` |
| Types, formatting, boundaries, consistency, DESIGN and production build | Verified on the final source: Biome 335 files; boundaries 17 packages; consistency 86 backend files/139 routes; DESIGN 0 errors/warnings; build passes | Private `final-{types,check,boundaries,consistency,design,build}.log` |
| Independent review | Source findings corrected and affected browser checks accepted; final verdict awaits the combined suite | Separate review thread `thr_9yr7shde7v`, private `independent-review.md` |

Each real-browser scenario owns a fresh private PostgreSQL/socket/data directory, queue, real Hono/Better Auth server and a controlled disk S3 peer through the actual storage adapter. Delayed acknowledgements continue the original request; fault scenarios deliberately inject a missing response or read failure and then verify actual persisted state. No production credentials or shared database were used. Controlled native/provider/storage results establish only the exercised contracts, not external account authorization, isolation, billing or storage certification. The production build retains its existing large-chunk warning.

## Behavior demonstrated

| Flow | Observed outcome |
| --- | --- |
| Session change and workspace switching | Same-tab user-private Document bytes disappear before a different principal can render; direct denied read remains 403. Workspace switching hides prior workspace data. |
| Authority after the first 100 rows | With 105 Project members, the current contributor can still edit authorized Tasks/Documents. With 103 Chat participants, pending/failed continuation denies writes; retry resolves the late viewer, and actual promotion enables discussion. |
| Task work | Project-scoped discovery, acknowledged create/edit/status/archive/restore, preserved 409 drafts, all four link kinds and creator-only whole-minute time persist after refresh. S/3 on a modal button cannot trigger a hidden page action. |
| Documents and Collections | Body/title/labels/visibility, saved File relations, four property types and human proposal accept/reject persist. Relation writes lock the main draft. A transient read retains dirty drafts; Retry issues no empty Project-member request; denied reads hide private content. |
| Files, folders and frozen publication | Real binary upload, exact retry identity, folder organization, changed-field metadata, verified downloads and anonymous frozen selected shares work. Visibility revocation removes retained metadata, bytes and controls. |
| Chats and attention | Messages persist without invented Agent replies. First and later mentions of `Alice ] Doe` retain chip/title/user identity and recipient attention; an interrupted send retains the draft and exact request identity. |
| Agents, Skills and Schedules | Fenced configuration, Skills instructions/files/export/proposals, cron/lifecycle/history and manual admission are wired. Participant revocation hides cached Schedule content. Missing runtime/account setup produces actual unavailable errors. |
| Settings and external setup | Member roles/removal, known-ID invitation flows, real account/Connection setup and configuration fences work. Unknown creation acknowledgements block immediate duplicate POSTs; unavailable gateway/connector services report their actual errors. |

## Inspected visual evidence

Representative settled frames and the affected permission/editing frames were opened and inspected. The screenshots below come from actual persisted UI states; the complete route/theme/viewport set is listed in the manifest.

- [Tasks, desktop light](ui-tasks-desktop-light.png) and [mobile light](ui-tasks-mobile-light.png): an unselected Project shows its designed choice state without an ErrorBoundary.
- [Documents, desktop dark](ui-documents-desktop-dark.png), [Files, mobile dark](ui-files-mobile-dark.png), [Chats, desktop dark](ui-chats-desktop-dark.png), and [Schedules, mobile light](ui-schedules-mobile-light.png): real bounded discovery in both themes and viewports.
- [Contributor beyond page one](ui-authority-after100.png), [viewer denied](ui-viewer-projects.png), and [workspace isolation](ui-workspace-isolation.png): permission-aware controls and scoped content.
- [Frozen public share](ui-public-share.png) and [share dialog](ui-file-share-dialog.png): the published selection and verified byte-download control.
- [Settings members, mobile dark](ui-settings-members-mobile-dark.png), [Connections, desktop dark](ui-settings-connections-desktop-dark.png), and [profile, mobile dark](ui-settings-profile-mobile-dark.png): real settings and deliberately unavailable setup states.

Short real-flow recordings are retained privately at `/home/g4f4r0/.bb/thread-storage/thr_ea3andz7st/recordings/`: `files-upload-share.webm`, `document-edit-conflict.webm` and `task-modal-keyboard.webm`. Frames from each were decoded and inspected; the recordings include normal loading/pending transitions. Their hashes are in the manifest.

The complete pending product decisions, missing API operations and external qualification prerequisites remain in [the pending register](../ui-wiring.md#pending-register); they are not treated as passing functional flows.
