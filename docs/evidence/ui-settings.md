# Settings wiring lane

Implementation child of Cody UI Temp for BB `thr_ea3andz7st`, assigned checkout `thr_6rdnpuiic8`. Baseline `f89d8128ec26726e17b954b15fe64ca71825c376`. Changes are limited to `apps/web/src/routes/settings.tsx`, new cohesive helpers in `apps/web/src/features/settings/`, and this evidence record. Main checkout and `otto-ui` were untouched. No browser, PostgreSQL, native runtime, live credential lookup, deployment, remote push, Notion or task/time writes were performed.

Browser behavior and independent acceptance are **unverified** until the integrating root runs its checks against the integrated revision. This is an implementation handoff, not acceptance.

## Action inventory

Every workspace RPC supplies the selected workspace ID. Query keys begin `["workspace", workspaceId, ...]`. Lists use bounded 100-row pages, per-domain allowlisted sort/order and server-issued cursors. Shared search uses whole words; list filters and cursor are URL state, with filters resetting the cursor. Grant directory and operation subpanels retain their own temporary query/paging state. All mutations wait for server acknowledgment before success feedback and workspace invalidation. No production mock imports, records, identities, account statuses or model names remain in owned source. The strings `none` and `all` are UI selection/filter sentinels, never record IDs.

| Surface/action | Authoritative operation | Permission/fence and states | Integration QA |
| --- | --- | --- | --- |
| Seven sidebar sections; active Agents detail section | Existing typed route links | Known section keys only, inherited workspace/session boundary | 1 |
| Profile name | Better Auth `useSession` / `updateUser({name})` | Current signed-in human; name required; serialized 800ms autosave, blur/unmount flush; ACK-only toast, inline pending/error/retry, retained draft | 2 |
| Profile photo | Current session image / `updateUser({image})` | Public HTTPS URL without credentials/query/fragment; blank removes photo; actual image + initials fallback; same autosave | 2 |
| Profile email / deletion | Current session email; no configured change-email/delete-user API | Read-only email and explicit unavailable account deletion; no simulated destructive success | 1 |
| Notifications: mentions, questions/reviews, failures, assignments/shares | No preference persistence API | Explicit unavailable rows; removed fake switches/local settings storage | 1 |
| Workspace name, role, deletion | Authenticated workspace title/role | Read-only title/role; no workspace edit/delete API | 1 |
| Agent directory, search, sort/order, current/archive, next/first; detail links | `GET agents`, live `useDirectory` identities | Server-readable records only; title/createdAt/updatedAt; archived flag; pending/empty/error/retry; exact returned Agent ID in detail URL | 3 |
| New Agent | Agent lane's `AgentCreateDialog` integration | Agent lane owns create fields, exact account/model/skill fences and errors; settings mounts its export | 3 |
| Members search, role filter, order, next/first | `GET members` | Names/userIds/roles only, no fabricated emails; name sort; loading/empty/error/retry | 4 |
| Member role menu | `POST members/:userId/role` | Owner/admin, owner immutable; only owner may manage/promote admins. Real admin/contributor/viewer roles. Confirmation; pending/error retains server role. Server refuses viewer demotion with open Tasks/Schedules. Self-change refreshes workspace memberships | 4 |
| Remove member | `DELETE members/:userId` | Same current authorization, owner cannot be removed; confirmation; server Task/Schedule ownership checks; ACK invalidation, self-removal refreshes workspace list | 4 |
| Invite dialog: email, role, create/cancel, creation receipt | `POST invitations` | Owner/admin; only owner invites admins; recipient-bound verified email; pending disables cancel and duplicate submit; ACK receipt shows actual ID/email/delivery; unavailable/uncertain mail never becomes “sent” | 5 |
| Resend known invitation ID | `POST invitations/:id/send` | UUID selector, server current invitation/admin checks; actual delivery returned; explicitly warns uncertain delivery can already have sent mail | 5 |
| Revoke known invitation ID | `PATCH invitations/:id {status:"revoked"}` | UUID selector, current admin checks, confirmation/pending/error/ACK | 5 |
| Accept invitation ID | Global `POST invitations/:id/accept` | Signed-in verified recipient email, expiry/revocation enforced by server; refresh workspaces then select returned workspace ID | 5 |
| Account list, search, visibility/status filters, sort/order, next/first | `GET subscriptions` | Exact readable accounts, server status `needs_auth/enabled/disabled`; pending/empty/error/retry; Codex is the only create provider | 6 |
| New account dialog | `POST subscriptions` | Current writer; required title, user/workspace visibility; no credential/browser-enabled input; starts at server's needs_auth; pending/cancel/error/ACK, then opens exact returned ID | 6 |
| Selected account and All accounts | `GET subscriptions/:id`; returned creation ID in URL | Exact server record; loading/error/retry; no hidden-new-record problem under list filters, no fallback to another account | 6 |
| Account title | `PATCH subscriptions/:id {title}` | Creator + current writer; serialized autosave, retained failed draft/retry | 6 |
| Account visibility | `PATCH subscriptions/:id {visibility}` | Creator + current writer; confirmation explains billing/use or immediate revocation; ACK-only state | 6 |
| Authenticate / reauthenticate | `POST subscriptions/:id/login`, NDJSON | Creator + current writer; exact selected ID, no fallback; safe HTTPS verification link and device code/expiry; bounded validated event stream; only server connected event confirms authentication | 7 |
| Device login cancel, expiry, error and retry | Abort request/body; refresh authoritative account | Cancel on explicit control/unmount/workspace switch, code removed; failed/truncated stream never enables account; inline retry for same account, pending blocks competing account controls | 7 |
| Disable account | `PATCH subscriptions/:id {status:"disabled"}` | Creator + current writer; confirmation explains active-run revocation; no browser enabled assertion | 6 |
| Enable login for disabled account | `PATCH subscriptions/:id {status:"needs_auth"}` | Creator + current writer; enables authentication only; status remains server-derived | 6 |
| Models show/hide/retry/empty | `GET subscriptions/:id/models` | Exact selected enabled readable account; real server IDs only; no default/mock models, no account/provider fallback | 6 |
| Workspace default model / Claude | No supported operation | Default row directs account/model selection to Agents; unsupported Claude mock account removed | 1 |
| Connection list/search/type/visibility/connected/sort/order/next/first | `GET connections` | Readable exact records; current human writer + creator controls configure/grant/connect/disconnect according to actual backend code; pending/empty/error/retry | 8 |
| New Connection dialog | `POST connections` | Current writer; GitHub association derived from positive account+installation IDs; MCP non-secret association identifier; explicit type/title/visibility; pending/cancel/error/ACK | 8 |
| Selected Connection and All connections | `GET connections/:id`; returned creation ID in URL | Exact server record; loading/error/retry; newly created config remains reachable under active filters | 8 |
| Connection title | `PATCH connections/:id {title}` | Creator + current writer; no unnecessary editToken or grant invalidation; ACK autosave/retry | 8 |
| Connection visibility | `PATCH connections/:id {visibility,editToken}` | Creator + current writer; confirms grants/approval invalidation; server stale fence; failed input retained | 9 |
| Configure binding replacement | `PATCH connections/:id {credentialRef,editToken}` | Deployment-approved reference only; never credential values; saved ref not readable; explicit replacement dialog; disconnects and revokes grants, current fence | 9 |
| Configure GitHub replacement | Same PATCH with typed config | App/account/installation IDs, up to 50 exact repository ID/full-name pairs, issues none/read/write. No key/token field; account association matching enforced server-side | 9 |
| Configure MCP replacement | Same PATCH with typed config | HTTPS or deployment-approved loopback HTTP endpoint without credential-bearing URL fields; up to 50 explicit tool/targetArgument/read-or-write policies and 100 exact resource URIs; trusted read-only setting comes from human config, never annotations | 9 |
| Connect/reconnect | `POST connections/:id/connect` | Current owner/writer and trusted server deployment binding/allowlist; actual ACK; missing service/config/credential gives inline error, no connected fallback | 9 |
| Discover + actions/resources widgets | `POST connections/:id/discover` | Server discovery results, never presets; tied to current connected editToken, discarded from use after policy changes/disconnect | 9 |
| Scoped Grant dialog: target, resources, action policies, explicit audiences | `POST connections/:id/grants` | Live eligible Agent, exact discovered resources/actions, allowed/confirmation/disabled policy, no implicit recipients; private Connection selects only creator/creator-owned Agents. Server rechecks membership/scope. Max 50 actions/100 resources/500 humans/100 Agents; pending/cancel/error/ACK | 10 |
| Grant Agent/audience search and next/first | Bounded `GET agents`/`GET members` | Whole-word search, sealed cursors, user Connection Agent createdBy narrowing before limit; selected IDs retained across pages. No first-page-only selection limitation | 10 |
| Revoke grant: choose Agent/current-or-archived/search/page/revoke | `DELETE connections/:id/grants/:agentId` | Exact live selected Agent, owner/writer confirmation; never claims an unreadable grant exists; ACK invalidation | 10 |
| Disconnect + provider deadline widget | `POST connections/:id/disconnect` | Confirms immediate Otto revoke, actual externalCredentialExpiresAt shown; no provider-side revocation claim | 9 |
| Operations show/hide/state/sort/order/next/first | `GET connections/:id/operations` | Server filters to caller sponsorship; 100-row pages, createdAt/updatedAt sort, 10s refresh; loading/empty/error/retry | 11 |
| Exact operation review widget | Returned action/target/arguments/audience/identity/run/expiry/retries/outcome | Safe React text/JSON display; credentials/provider output never requested; missing identity or expired approval disables approval | 11 |
| Approve | `POST operations/:id/approve {identity}` | Exact displayed digest, current authorization and expiry validated by server; confirmation/pending/error/ACK | 11 |
| Execute approved operation | `POST operations/:id/execute` | Explicit confirmation; no automatic external retries; invalidate after ACK even for failed/uncertain response; success only when returned state is succeeded | 11 |
| Retry failed read | `POST operations/:id/retry` | Explains server permits failed reads only, at most two, unexpired. Public view omits isWrite, so server determines eligibility; approved state requires explicit execution again | 11 |
| Uncertain/external-outcome reconciliation | No reconciliation write route | Explicit outside-Otto verification instruction, no replay/mark-reconciled/fake success | 11 |

## Design decisions for lead integration into DESIGN.md

Keep the existing seven-section sidebar, centered page column, Group/Row cards, compact row controls and Agent detail links. Ordinary single-field display edits retain 800ms autosave and blur/unmount flush; saves serialize and feedback follows acknowledgment. Permission/control transitions use confirmation and authoritative server state. Failed saves retain drafts with an inline Retry. Action failures also show an error toast so filtered rows disappearing after an ACK cannot hide an uncertain operation outcome. Grant and operation audiences show returned IDs beside names to distinguish exact recipients.

Use compact stock Dialog/Field forms for invitation, account and Connection creation before an Agent is available. Connection configuration and grants are cohesive explicit replacements because they revoke scope or require an exact audience. Forms block closing while a request is unresolved. Creation remains separate from authentication/configuration and never implies success of those later steps. Creating an account or Connection opens a server read of its exact returned ID, regardless of list filters; All accounts/connections returns to discovery.

Show device verification link/code/deadline only while the selected account's real authentication stream is active. Show actual account status and only models returned by that account. No account login email, plan quota or billed money is inferred. Public profile photo URLs are editable through Better Auth; photo uploads remain unavailable.

Read-only/unavailable settings retain quiet rows with a concrete API reason. Remove mock notification switches, default model choices, Claude account, Notion preset, email/Agent/connection counts and destructive success simulations. Connection discovery and exact operation review use real returned data. Saved Connection configuration/grants are not reconstructed from discovery or local selections.

## Pending items

| Missing seam/dependency | Concrete decision or configuration |
| --- | --- |
| Workspace create/title edit/delete | Add owner-authorized browser API if selected for MVP; installation claim stays operator-only |
| Notification preferences | Define persisted backend settings before offering editable switches |
| Change email/delete account/photo upload | Enable explicit Better Auth flows and a supported uploaded-photo reference path; current name/public-photo URL updates work |
| Invitation list/get route | Expose authorized bounded list/status if persistent invitation management is required; known-ID create/resend/revoke/accept works now |
| Acceptance when user has no workspace | Lead session/workspace boundary needs an invitation acceptance entry point before requiring existing workspace access; this page works for humans with current workspace access |
| Workspace default model / unsupported providers | Decide if needed; account/model selection already belongs to Agents, only Codex currently qualifies |
| Saved Connection config/grant readbacks | Add safe owner-authorized projections if in-place editing/status display is required; current UI replaces explicit config/grants and never pretends to know saved values |
| Protected-write reconciliation status | Add explicit server reconciliation semantics if needed; currently inspect the external system and authorize new work |
| Live GitHub/MCP/Infisical service | Configure exact server credential bindings and approved endpoint origins; no credential value is entered in the UI |
| Live Codex account qualification | Configure managed gateway/Infisical and qualify the exact account; no host/account/provider/model/billing fallback |
| Root browser and independent review | Run the scenarios below on the integrated revision; all visible behavior remains unverified by this lane |

## Numbered real-browser scenarios for integration QA

1. Load all seven settings sections as a real owner, contributor and viewer; verify actual workspace title/role/profile email, unavailable rows, no mock identities/models. Navigate between sections with a creation dialog open and ensure the next section does not inherit it. Use keyboard and narrow/mobile viewports.
2. Change name rapidly, blur, reload and verify Better Auth/session/directory readback. Inject a failing update: no success toast, draft retained, Retry succeeds. Set a public photo URL, clear it, check actual avatar readback; reject an unsafe/credential-bearing URL. Leave during debounce and confirm only the final draft persists.
3. Open Agents, search whole words, sort both directions, current/archive and traverse more than 100 entries with next/first. Open a returned Agent ID. New Agent opens the agent lane's real dialog; create an exact account/model/Skill selection and verify its server readback.
4. As owner change contributor/viewer/admin roles and remove eligible members, verifying reload. As admin confirm no admin promotion/removal controls; owner immutable. Transfer-required Task/Schedule checks refuse viewer demotion/removal and leave row unchanged. Self-demotion/removal refreshes workspace list and blocks stale controls. Cancel confirmations changes nothing.
5. Create contributor/viewer invitations and owner-only admin invitation. Verify returned ID/email and actual sent/unavailable/uncertain delivery. Resend/revoke exact ID; expired/accepted/revoked IDs fail visibly. Accept as the verified intended email and switch to the returned workspace; wrong email cannot accept. Reload has no fabricated invitation list.
6. Create user and shared Codex accounts while list filters are active. Open exact returned ID, show actual needs_auth, and use All accounts to return to discovery. Rename, share/unshare, disable and Enable login, reload each; another member reads shared metadata/models but cannot modify/login. Enabled account models reflect its exact server IDs. Reject unauthorized account changes and confirm no fallback/default model list.
7. With a controlled account login peer, start device authentication and inspect server code/link/deadline, finish and read back enabled status. Exercise service 503, malformed/unsafe/truncated stream, login_failed, device expiry, explicit cancel, navigate away and workspace switch. Each closes the exact stream, removes the code, retains authoritative status and permits same-account retry. No other account is selected.
8. Create real GitHub and MCP metadata with exact association IDs while filters are active; verify exact returned ID opens for setup, All connections returns to discovery, then reload, filters, search, sort/order, paging and no fabricated counts. Invalid IDs/title/association retain dialog inputs. Shared noncreator/viewer can read but cannot configure. Cancel creates nothing.
9. Replace a server-approved credential reference and complete exact GitHub or MCP config; reload metadata, connect/reconnect/discover with a controlled provider. Verify returned actions/resources, missing service/ref/allowlist failure, no credential echo. Use two tabs to provoke stale editToken on policy/config and show error. Title-only edit preserves grants; visibility/config/disconnect revoke them. Discovery becomes unusable after policy token changes. Disconnect displays the real possible provider expiry.
10. Discover, select an eligible real Agent, exact resources/actions and explicit human/Agent audiences, including entries beyond 100; save and prove authorization through Run/Connection backend readback. Confirm private Connection cannot select other humans/other creators' Agents. Empty/missing/oversized selection and revoked membership fail visibly. Revoke a selected current or archived Agent and prove denial; never infer prior grant existence from a checked box.
11. Create server-sponsored Connection operations via a real controlled Run. Page/filter/order them, review complete exact request, approve its displayed identity and explicitly execute. Expired/different-digest/revoked scope fails. Succeeded ACK gets success; failed/uncertain ACK refreshes current state with error. Retry a failed read at most twice; failed write is refused, uncertain write has no retry/reconciliation button. Cancel approval/execute produces no provider action.

## Checks and observed behavior

- Frozen Bun install after verifying repository package name `otto`: verified; no manifest/lockfile changes.
- Scoped Biome check: verified. `git diff --check`: verified.
- Web TypeScript and production build, each serialized through `/tmp/otto-ui-wiring-check.lock`: verified on the lane plus coordinated shared dependencies. Build reports the existing large-bundle warning.
- Focused Bun/Vitest production authentication transport tests: 8/8 verified using `bun --bun vitest run --config apps/web/src/features/settings/vitest.config.ts`. `/tmp` was full; setting `TMPDIR` to this thread's `settings-checks` storage directory resolved startup. No shared storage cleanup was performed.

| Real input to production `consumeLoginEvents` | Observed output/assertion |
| --- | --- |
| Device event + exact Codex connected event split across three chunks | Exactly both typed events delivered in order; completion resolves |
| Device event then EOF | Rejected without confirmation; no connected event |
| Other provider or unexpected credential field | Rejected as invalid event, no value echo |
| Malformed upstream body containing fixture private marker | Error contains only generic invalid-event message, marker absent |
| javascript/HTTP/userinfo verification link | Rejected before a device event is delivered |
| Server login_failed event | Authentication failure, never success |
| Duplicate device code or event after connected | Rejected |
| 65,537-byte open stream | Rejected at byte budget; underlying stream cancelled and reader unlocked |

Browser/native/PostgreSQL/live-provider/review checks are unverified and intentionally delegated to the integrating root. Source and evidence hashes accompany the final handoff; shared dependency commits are excluded from the owned revision list.

## Exact source hashes

| Owned source | SHA-256 |
| --- | --- |
| `apps/web/src/features/settings/connection-config.tsx` | `0f478a948cec47d6a9663a7dbf78fc34c439633d42922c8069942d48b068b3b8` |
| `apps/web/src/features/settings/connections.tsx` | `22a8f3e0c7c7a4f89d44c4623d9f2273aad133c8c04ef4d4e99af72111b72552` |
| `apps/web/src/features/settings/controls.tsx` | `9ec756deb699e5910bfd8125994d5fc2d38413cfdd2fe229cc1fe63cedcc7798` |
| `apps/web/src/features/settings/device-login.ts` | `1457d895e4acdbb3a9f12753e1392590b7c2f39ec9d19d95a34b1ce0267c0cfc` |
| `apps/web/src/features/settings/grant-directory.tsx` | `a8b9dbc7a5601bf3ba625af165fc1e634d2bf23eeab73ec2d6ea23cefebb24ed` |
| `apps/web/src/features/settings/subscription-auth-stream.test.ts` | `df520b291496c7c81944d186c075e2f2249a3bcb6425eb1571c932768fc8a00b` |
| `apps/web/src/features/settings/subscription-auth-stream.ts` | `4f46437204349a144bde1623e1b3daf1240839444819d7a18af6910590005e8a` |
| `apps/web/src/features/settings/subscriptions.tsx` | `6db0a8ad9dc4b999c8fa9326264d7bface75fcfe885b24ff18db63c110497ce3` |
| `apps/web/src/features/settings/vitest.config.ts` | `93c8343904ceb993877b7df2be9d9dce0a944c6e304e827ccfe17a4ccf7e1ba6` |
| `apps/web/src/routes/settings.tsx` | `23503b665866ad40dcc0998e67c14999d5599ab5746994517557fe5df386ec6b` |
