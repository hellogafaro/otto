# Independent review: gateway accounts, sharing and usage

Reviewer: thread thr_fvywi2nkuc (Cody, fresh and separate from the author). No production edits, staging, commits, main/UI reads, or live provider/OAuth/Infisical/billing actions.

## Verdict

**PASS** on the final snapshot below, for the reviewed seams: account connect and shared use, Agent admission, Pi-observed usage and estimated cost, native compaction receipts, and gateway store-read provenance.

Limits that stay open (see "Unresolved and unverified"): one inconclusive high-load native failure, an optional hardening, and no live qualification.

## Exact artifact

| Item | Value |
| --- | --- |
| Final snapshot | /home/g4f4r0/.bb/thread-storage/thr_hkucx42774/freeze-fixture |
| Manifest `source.sha256` | 872b340bcafd83d9569bc1b0ca99500f60606e49f6b18a1962feff5a96381923 |
| Archive `source.tar.gz` | 757e8da478fbe8dc337a4b2f85dabaa3c33dd0731fda7588ca68eda2073dfbca |
| Delta patch vs f1b | 881e1bb86bf3f651f952faf919285cd27d6822f0d746abb04b7a657f67a892ac |
| Base | HEAD 084b76d23abb3a5880474af73cee991d090e0d68 plus input manifest 8b1b8863…/archive d62a2028… (319 files) |
| Verified here | 321 of 321 files; 321 safe regular members; index tree identical to HEAD (daa21346…) |
| `ops/gateway/main.go` | 0e7e2a57e198044994dacf7b9dccb64e751bf6aea0e982d9a2adcf682c669ada |
| `ops/gateway/main_test.go` | cd099a8370e2c6f25d70886ff61f9a71d43f3c8a4b844ce9498eadf3821416d3 |
| `packages/runs/src/pi.ts` | f911ddd4cd3f627d311e96d3132f641bcc789ffb0b8c0c9c4091676530503648 |

Snapshots I reviewed, all preserved:

| Snapshot | Manifest | Status |
| --- | --- | --- |
| freeze (bde847) | bde8479e… | **Rejected** (F1, F2, grouped native failures) |
| freeze-f1f2 | 8c75e1cb… | Superseded (F1b open) |
| freeze-f1b | ba955fe1… | Superseded (fixture bound) |
| freeze-fixture | 872b340b… | **PASS** (this verdict) |

Only `ops/gateway/main_test.go:784` differs between f1b and the final snapshot (`Timeout: time.Second` changed to `15 * time.Second`).

## Findings and resolution

| ID | Finding | Evidence | Resolved on |
| --- | --- | --- | --- |
| F1 | A genuine store failure (non-200, or corrupt 200 body) racing request cancellation was reclassified as cancellation and did not block the account. The input `main.go` blocked it. | evidence/go-genuine-failure-cancel*.txt | f1f2 |
| F1b | An unrelated transport error (connection reset or refused) racing cancellation still did not block, because the check was `ctx.Err() != nil` alone. | evidence/go-f2-provenance-probe.txt | f1b: `ctx.Err() != nil` and `errors.Is(e, context.Canceled\|DeadlineExceeded)` |
| F2 | The bridge threw "Uncorrelated Pi compaction" on Pi 1.0.0's lone overflow-recovery `compaction_end`, which has no start. The input ignored it. The pinned Pi source shows the trigger: a second overflow in one turn, in `_checkCompaction` at `agent-session.js` ~2347. | evidence/bridge-probes-final.txt vs bridge-probes-input-baseline.txt and bridge-probes-f1f2.txt | f1f2. Only that exact notice shape is accepted; result, aborted, willRetry, other reason, or no message still throw. |
| G | Grouped native runs failed intermittently with a permanent 503 cascade. A diagnostic fixture showed the first causal event: a store GET hit the fixture's 1s `Client.Timeout` with a live context, so the gateway blocked the account (its designed fail-closed behavior). | evidence/pair1/ (1s: 2 of 2 failed), evidence/pair15/, evidence/pairH/ | final: helper store timeout is 15s, as in production `main.go:1030` |

The publication-gate lead is not the cause. The timed-out callback fell about 15 seconds after that test finished, inside the compaction-failure test (reconstructed clock, ±1s).

## Checks

**Fresh independent checks, run on the exact snapshots as noted:**

- Frozen install, biome, tsc plus web typecheck, boundaries, consistency, `git diff --check`, and `bun run build`: all exit 0. Install and the first static pass ran on bde847; the static suite and build were re-run on the final snapshot.
- Go 1.26.0 toolchain (go.dev checksum verified, own build): on the final snapshot, gofmt clean, `go vet`, `go mod verify`, `CGO_ENABLED=0 go build`, and `go test ./...` (11.8s) all pass. I built my own fixture from the final source (sha256 6c07a524…).
- Final affected batch, run once on the final snapshot with my own fixture: 9 files, **173 of 173 pass**, including all 19 native `pi-gateway-runtime` tests.
  - Files: pi-gateway-runtime, pi, run-usage-cost, pi-admission, subscription-auth, visibility, runs, execution-authority, runtime.
  - Native coverage: connect through the public Pi OAuth SDK, member discovery of exact-account models, private-account denial including Agent create, shrink to user and creator removal mid-Run, lost refresh acknowledgement and restart, native compaction (success, failed summary retries, Stop), native overflow recovery, and estimated cost parity with Pi's own `calculateCost`.
- Independent probes (retained in evidence/):
  - Provenance, run on f1b `main.go`, which is byte-identical in the final: reset/refused racing cancel blocks; a ctx-caused error does not; `Client.Timeout` with a live context blocks; a request deadline on a slow store does not; a 403 or corrupt 200 with concurrent cancel blocks.
  - Bridge overflow probe, run on f1f2 `pi.ts`, byte-identical in the final.
  - Estimator probe: `totalTokens` null with the four priced counts known gives an estimate, which matches the corrected wording.
  - `main.go` diff, input vs f1b: three store-read hunks only. The SSE, rawmodel, and native cleanup code is unchanged.

**Carried, not re-run by me:**

- The full 35-file vitest suite ran once on bde847, where 331 of 332 passed. The one failure was my own misuse of `OTTO_SHARE_SCREENSHOT_PATH` (no file extension). A rerun with a proper path passed 26 of 26. TypeScript is unchanged since f1f2, and Go only changed in the provenance lines and one fixture literal.
- Author-attributed only: 332 tests, Go checks, red/green captures, and the live wire captures (`overflow-wire.txt`).

## Money and usage: what I verified

- **Estimator:** matches Pi 1.0.0 `calculateCost` over every pinned Codex model, including the 272000-token tier edge. The currency is USD, per Pi's RPC docs.
- **Price basis:** accepted once with the Run into `inputs.modelConfig.cost` and immutable afterward. An old or missing price gives null, a zero price is only a known zero, and an incomplete Run gives null.
- **Receipts:** deduplicated by attempt and sequence. Compaction takes the next sequence, with no collision. Failed summary requests are null receipts, so totals stay unknown.
- **Scope:** `scope: "pi_observed"`; the docs state that this is not a provider charge or invoice.
- **Code-inspected only:** the old-row null path (pure function) and the Agent `PATCH` guard. Agent create denial is tested end to end.

## Unresolved and unverified

1. **Inconclusive high-load failure.** On f1b with a 15s fixture variant and no diagnostic logging, under 8 CPU hogs, 1 of 3 solo runs failed (5 failures, same 503 cascade). I never diagnosed it. After the correction, six concurrent runs with diagnostics passed 19 of 19 with zero block events, and one concurrent pair of the exact helper-only delta passed. I do not claim every contention failure is resolved. Evidence: logs/exp-B15s-3.log.
2. **Hardening, optional.** Mismatched cause is still exempt: ctx cancelled with a `DeadlineExceeded` error, or the reverse. `errors.Is(e, ctx.Err())` would block both (evidence/go-f1b-mismatch-probe.txt). Accepted as non-blocking for this slice.
3. **Existing limitation, not in scope.** A 400 or `response.failed` SSE reaches Pi as malformed SSE through the gateway. My diff shows this cannot be introduced by this change. I did not reproduce it.
4. **Minor.** A malformed `compaction_end.result.usage` becomes a null receipt (conservative), where malformed assistant usage throws.
5. **Not covered:** live OAuth, provider eligibility and billing, Infisical, Garage, Docker image, Playwright, `go -race`. Controlled peers certify only the exercised contracts.
6. **Pending:** task state, tracked time, and integration with main (the Task f1aa paths) stay with root.

## Preservation and cleanup

- The 8 baseline-deleted files are preserved at review/removed-baseline. The overwritten snapshots are at review/orig-bde847, review/orig-f1f2, and review/orig-f1b.
- Worktree: index equals HEAD, no staging or commits. The 321-file snapshot sits unstaged in the working tree. `node_modules` (frozen install) remains as ignored files. I removed `apps/web/dist`.
- No review processes, load workers, or fixtures remain. I killed one batch loop mid-run, and all temporary directories are removed.
- Evidence index: review/evidence-hash-index.txt (sha256 f25978de7dd518087ffbcfd4693e04e955a0ce7059dc7d03069309114a847d50). Unknown human time stays unknown.

## Copyable verdict

Independent PASS for freeze-fixture (manifest 872b340b…, archive 757e8da4…), HEAD 084b76d plus the 319-file input. F1, F1b and F2 are corrected and independently reproduced. The grouped native failure was diagnosed as the fixture's 1s store timeout blocking the account, and is corrected by `main_test.go:784` (15s). The final affected batch passed 173 of 173 with my own Go 1.26.0 fixture. Open limits: one undiagnosed high-load failure on a pre-correction variant, optional exact `errors.Is(e, ctx.Err())` hardening, and no live account, provider, billing or Infisical qualification.
