# Gateway accounts, sharing and usage: validation record

4 October 2026. Integration of the independently accepted gateway/accounts/usage slice into main. Controlled peers (private PostgreSQL, published Pi 1.0.0, pinned CLIProxyAPI v8.0.12 Go helper, OAuth/Infisical/provider fixtures) only; no live OAuth, provider, Infisical or billing, and no billing qualification is claimed.

## Accepted source and reviewer

| Item | Value |
| --- | --- |
| Accepted snapshot | author `thr_hkucx42774` `freeze-fixture`; manifest `source.sha256` `872b340bcafd83d9569bc1b0ca99500f60606e49f6b18a1962feff5a96381923`; archive `757e8da478fbe8dc337a4b2f85dabaa3c33dd0731fda7588ca68eda2073dfbca` (321 files) |
| Base | HEAD `084b76d2` plus the 319-file input (manifest `8b1b8863…`, archive `d62a2028…`) |
| Independent review | `thr_fvywi2nkuc`, final PASS, [verdict](gateway-accounts-usage-verdict.md) (copied byte-exact, sha256 `0efa10205d053b38babd57c3c9388a54679215d41a68e9ba644bf8c32c1ecbe3`); reviewer evidence index `f25978de7dd518087ffbcfd4693e04e955a0ce7059dc7d03069309114a847d50`. Earlier snapshots bde847, f1f2 and f1b were rejected or superseded; see the verdict. |
| Reviewer's final affected batch | 9 files, 173 of 173 pass on the final snapshot (carried, not rerun) |

## Integrated paths (13: 11 modified, 2 new; each equals the accepted freeze byte for byte)

`TESTING.md`, `apps/server/src/model-gateway.ts`, `docs/gateway-accounts-usage.md` (new), `docs/pi-gateway-plan.md`, `ops/gateway/main.go` (`0e7e2a57…`), `ops/gateway/main_test.go` (`cd099a83…`), `packages/agents/src/index.ts`, `packages/runs/src/index.ts`, `packages/runs/src/pi.ts` (`f911ddd4…`), `packages/runs/src/schema.ts`, `tests/pi-gateway-runtime.test.ts`, `tests/pi.test.ts`, `tests/run-usage-cost.test.ts` (new). Plus this record and `gateway-accounts-usage-verdict.md`. Before integration each modified path in main was byte-identical to the 319-file input, so nothing was merged by hand. All other main bytes, including the final Tasks recurrence files, the Task verdict and `docs/tasks.md`, are unchanged.

## Checks and attribution

| Check | By | Result |
| --- | --- | --- |
| Frozen install, biome, tsc plus web, boundaries, consistency, `git diff --check`, `bun run build`; Go gofmt, vet, mod verify, CGO-off build, `go test ./...`; native batch 173/173 | independent reviewer, on the accepted snapshot | pass (see verdict) |
| Red-before-fix and green evidence for money, compaction summary retries, Agent private account, gateway cancelled read, provenance, overflow notice, fixture timeout | author, retained in author freeze `evidence/` | see `freeze/commands.md`, `freeze-f1f2/README.md`, `freeze-f1b/README.md`, `freeze-fixture/README.md` |
| On integrated main: `bun run check`, `typecheck` (tsc plus web), `check:boundaries`, `check:consistency`, `git diff --check` | integrator (author thread) | all exit 0 |
| On integrated main: vitest `task-recurrence`, `pi`, `run-usage-cost`, `subscription-auth`, `pi-gateway-runtime`, with a helper freshly built from main `ops/gateway` (sha256 `af89bafe…`) | integrator | 5 files, 93 of 93 pass |
| Integrated owned hashes and unowned main bytes | integrator | 13 of 13 owned equal the freeze; all other main files unchanged |

Not run on main: the full suite (the reviewer's 173 and the source-disjoint Task proofs carry), `bun run build`, Playwright (no UI change; no screenshot applies), Docker, `go test -race`.

## Current UI/API contract

Typed routes, examples and wiring note: [accounts and usage](../gateway-accounts-usage.md). Summary: create, login (NDJSON device code), share by `visibility`, `GET /subscriptions/:id/models`, and `GET /runs/:id/usage` returning `scope: "pi_observed"`, `unreportedCount` and `estimatedCost` (USD, `api_list_price`, or null). `estimatedCost` is an API list-price estimate, not a charge. Agent create/update now requires the author may use the Subscription.

## Limits that remain open

- One earlier high-load native failure on a 15s helper run is undiagnosed and inconclusive; the diagnosed cause of the grouped failures was the fixture's 1s store timeout, now 15s as in production.
- Optional hardening noted by the reviewer in the verdict is not applied.
- No live OAuth, provider eligibility, Infisical, Garage, billing or invoice qualification; quota windows and actual charges are not available through the embedded SDK path. Totals exclude requests Pi does not report; receipts after a Stop request are not published.
