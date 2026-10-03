# Independent corrected Pi component recheck

Verdict: **PASS for the corrected Phase A Pi protocol component**, within the controlled protocol scope. P1 and P2 are fixed on the exact source below. No whole-backend verdict: Phase B account/CAS/authority/recovery/native integration checks still require an immutable combined freeze; Go belongs to the separate reviewer. Provider isolation, live provider/billing and Garage remain unqualified.

## Exact reviewed revision

Baseline `241e425472fc26f713f96d5fb1ac3c88bd71f603` plus the original verified 240-file input, then corrected regular-file-only three-file overlay. Corrected archive SHA-256 `186da6f6aa84eaf54b084dcf81cd5c1bf8b3b34abe51bec8593bf95c3217b4bb`.

| Source | SHA-256 |
| --- | --- |
| packages/runs/src/pi.ts | 09791b09dc3ad8eb3b7f806c791db3573175590b3b58d43cb3b63ae008418561 |
| packages/runs/src/pi-extension.ts | fd5c966149ab3ed438f510a5acc85940739e822e11c0029f115b4286fd68f008 |
| tests/pi.test.ts | 34d996c7c985c11eb0af8bf4da80471a6069ebb1bba5155248cbfa778d5b1f54 |

The introduced production delta consists of two lifecycle corrections: finish resolves using the current cancellation state after callbacks join; cancel first awaits native abort acknowledgment, then takes a fresh callback/write join inside the existing single cancellation deadline. The extension is unchanged. Three regression tests add late-final-usage joining, post-settled Stop and ignored late usage with sticky uncertainty. No implementation edit by reviewer.

## Independent input → output evidence

| Probe/check | Status | Observed behavior |
| --- | --- | --- |
| Original P1 native race, exact public published Pi 1.0.0 | Verified | Real abort-generated final usage callback blocked after cancel began; native abort ACK arrived; after 30 ms cancel was still pending. Releasing callback let cancel complete; callback joined and prompt returned aborted. |
| Original P2 native race, exact public published Pi 1.0.0 | Verified | Native agent_settled observed while final onUsage blocked; accepted cancel then callback release returned aborted instead of finished. |
| Independent native ignored-late-usage probe | Verified | Callback held beyond configured 100 ms cleanup; cancellation rejected in ~99 ms with `Pi cancellation timeout; retain uncertainty`. Repeated cancel and prompt retained that exact error. Close while callback was still held returned its own cleanup timeout; repeated close retained the same promise and exact close error after callback release. |
| Independent native-shaped wire probes | Verified | Same fixed P1/P2 behavior; ignored late usage rejected in 101 ms; same repeated cancel/prompt errors and sticky close promise/error. |
| Focused Vitest under Bun | Verified | 39 production-client/extension tests pass, Bun 1.4.2 / Vitest 5.0.3. |
| Targeted Biome / strict lane TS | Verified | Three component files clean; no fixes; scoped strict typecheck passes. |
| Four actual published native smoke scenarios on corrected bytes | Verified | Scoped tool + two final usage receipts, exact retained private Session/model, native write + scoped tool, steer/abort during pending question all pass. All run against own clean loopback upstream/public dummy auth only. |
| Preservation and cleanup | Verified, limited | Corrected source hashes unchanged after checks; 47 historical reviewer-manifest proof files unchanged including original failed revision archive/report/traces. Seven new child roots absent; all 15 old/new own fixture ports refuse connection (errno 111). |

Both original native failures were reproduced before correction in the preserved [Phase A report](../pi-review/review.md). New native probes use the same installed public artifact already verified against registry SRI and all published tar files: coding-agent/pi-ai 1.0.0 gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. Exact portable package/lock and prior package proof remain unchanged. No custom distribution or source-a276 substitution.

The first scratch sticky-error assertion incorrectly required a close cleanup timeout while the callback was still blocked to equal the prior cancellation timeout. The preserved wire-initial-assertion.log shows that reviewer assertion failure. Corrected independent assertions check each API's repeated promise/error separately and pass. The native ignored-callback log prints the expected close timeout from finally; it is intentionally asserted, not a failed run. All three independent native programs and wire program exit successfully.

Native private transcript/tool-trace behavior from the original component review remains limited: no automatic native trace publication through onOutput, but native file tools are not a filesystem isolation boundary. The current transcript can be read into the model. Computer retained-scope and managed-path protections must be checked in Phase B; local root exit/closed ports are not remote process-tree or isolation certification.

Source/evidence only overlaid in the assigned reviewer checkout. Original failed proof remained immutable. No production fixes, main reads, author edits, full old-backend suite, Go tests, secrets, shared installs, databases, UI, commits/staging, task state or live-provider operations. No human time estimate.

## Standalone review text

Independent affected recheck: PASS for the corrected Pi protocol component archive 186da6f6aa84eaf54b084dcf81cd5c1bf8b3b34abe51bec8593bf95c3217b4bb, pi.ts 09791b09dc3ad8eb3b7f806c791db3573175590b3b58d43cb3b63ae008418561. Both required cancellation findings now pass independent actual published Pi 1.0.0 probes: late final usage joins before cancel succeeds, and accepted Stop during settlement callback drain returns aborted. Independently held native callbacks reject on the 100 ms deadline and preserve repeated cancellation/close errors. 39 focused Bun tests, targeted formatting/typing and four corrected native smoke scenarios pass. Original failed source/evidence remain unchanged; seven new fixture roots absent and all 15 own ports closed. This component verdict covers controlled protocol behavior only; no whole-backend acceptance or provider/isolation/billing/storage certification. Await immutable combined freeze for Phase B.
