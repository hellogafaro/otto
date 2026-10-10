# Native pre-MVP acceptance

This is the single current operation, page and scenario checklist. Restored historical reports do not prove the current native runtime. A check is passed only for its recorded source and environment; affected checks must run again after changes.

## Scope and recovery

- Exact v1 anchor: `2a6e9a79be8b268b6cac583f68a68fa674be2fe9`.
- Native integration checkpoint: `fa912a635c5d38feb0948cf9611b7d1348f21036`. The corrected full-suite and live source manifests below also include the separately checkpointed durable launcher; its exact bytes are recorded in the startup evidence.
- Current-source recovery checkpoint: `c7f5b4e5eaab18efed20f689a6764bbab0e1f284`.
- Exact forward restoration: `9b3a9a70342c72414a33c313f6ef07fd2301c1ba`, tree `a1c9dbda28baaaac5eb904216736eb9807d6f506`, identical to the anchor. An initial restoration commit retained 14 rename-source files; the next forward commit removed them before implementation.
- Local recovery evidence: `~/.capy/work/otto-v1-restoration/`. The 2,151-entry source archive and hashes were verified. Current login and Home source/assets are preserved separately. Saved app data has a consistent SQLite backup with integrity check plus 102 supporting files; Keychain entries remain untouched and were not exported. No saved app data was removed or converted.
- Isolated baseline work: `~/.capy/work/otto-v1-preflight-2a6e9a79/`. PostgreSQL 17 is a qualified local candidate, not a claim about all production versions.

## Evidence requirements

For each supported operation, record the natural-language request, native Mastra tool, authorized domain function, actor/membership, persisted result, UI or artifact observation, reload/cold-restart result, revision, evidence path and verdict. Direct API/domain checks complement but do not replace model-through-tool UI proof. Keep real-provider and deterministic-fixture results separate.

Use normal authenticated separate user/browser contexts. The finite multiplayer inventory must include one/two humans crossed with one/two agents, humans only, shared project across users, member/nonmember/cross-workspace denial, implicit/explicit/unavailable/revoked recipients, simultaneous sends, active ownership, queued messages, reconnect/reload/cold restart, approved/denied/duplicate/stale requests and leak/duplicate-effect checks.

## Current verdicts

Remaining required closure is real Garage-backed Files persistence, the three
unresolved upload RSS caps, and bounded durable-user Agent qualification after
the correct provider account is configured. Ordinary account/workspace access
has passed. Remote computer/browser provisioning is optional and remains
explicitly unavailable; it is not a pre-MVP completion gate. Actual external
reset/invitation mail is a separate unconfigured integration, not a login gate.

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
Original failed proof remains unchanged. Further memory work needs a bounded
implementation scope; the Captain's earlier local-testing exception does not
constitute Johan's acceptance of all-done.

The corrected bounded **live** continuation proof passed all 14 checks in `real-provider-continuity-live-cdb3065e-9164-48d6-b030-6409288a13eb/result.json`, SHA-256 `272557ade3fcfd80a26833e91325c4a50d8cca4f843310bfd87fd09b8643ddc0`. It used eight SDK calls across three finished Runs on the same sponsor-private Session: one Task creation, one successful rename, one exact authenticated approval for 30 human minutes, and Run 3's own published title/ID/30 answer backed by its actual `task_get`/`time_list` results with zero new effects. Independent authenticated readback/reload and no-inference server restart passed; all 282 source hashes and harness `0d12ea896f5d9a7021d9effbb8186a0d13b63928ae5b7d1cbff6c7c2b718fc47` remained unchanged. The first `task_update` produced an output-error that the model recovered from; this is not an error-free-tool claim. Observed usage is 14,065 input and 638 output tokens, not billing qualification. No more live calls are needed for this bounded gate. Durable Garage and person-configured Default-agent execution remain unverified; ordinary account/workspace authentication has since passed as recorded below.

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
