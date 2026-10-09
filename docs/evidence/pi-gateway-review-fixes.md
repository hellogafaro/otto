# Gateway review corrections

The original archive `8900154675264d32610dbc63c4be4b77ae6e5f035eef73300417d1565d179bc6`
and its raw evidence are preserved. Independent review of main.go
`2471239f059d5bacde3cf427943f82b0be7aa8119ece935d3042b7ec5f548e66`
returned five required findings; the author reproduced all five on a restored
baseline/input/frozen archive before changing owned gateway files.

| Finding | Red reproduction | Correction and executed result |
| --- | --- | --- |
| G1 native work not joined | SDK-facing channels closed; body still open, slot/account released, next A200 | Counts transport calls, actual body Reads/Close and native executor stream completion. Held Read and held Close each survive the two-second failed join with a retained slot/manager/account gate. Newer successful same-ID auth cannot bypass it: A503, B200. Release the held cleanup: actual join, then A200. |
| G2 wrong/missing generation media type | application/json carrying foreign-model SSE gave stream200 | Require successful generation text/event-stream in both caller modes; missing/application-json/text-plain give502. Valid charset SSE still200. |
| G3 duplicate model assertions | foreign then accepted duplicate model was forwarded200 | Reject duplicate model and event response keys before native parsing. Both duplicate variants and both stream modes give502 with no foreign assertion forwarded. |
| G4 inactive native metadata | 40 then80 epoch IDs retained with Auths0 | Request-lifetime public manager discarded only after joining. After40/80 distinct IDs: retained managers0; observed native epoch and scheduler generation IDs per manager max1. |
| G5 request form | raw key and readiness query each204 | Require documented Bearer scheme and reject queries before readiness; raw key401, query400, valid readiness204. |

The real published Pi1.0.0 composition captured request keys
`include,input,max_output_tokens,model,prompt_cache_key,reasoning,store,stream,tools`.
The original gateway rejected the cache key. Its narrow amended contract is
trusted `X-Otto-Session-Id` from accepted Run.sessionId; Otto maps the Pi native
UUID in the canonical body to that product Session. Go requires exact key/header
match, bounded product ID <=64 bytes. Missing, mismatched and spoofed scope
requests do not generate. Native A receives exact approved Session-Id/cache
key and high reasoning. Dynamic model definitions explicitly use native
UserDefined to preserve reasoning when local capability metadata is absent.
Cache scope supplies no account/model authority; real provider capabilities
remain unverified. Published Pi → full Otto domain-route composition is the
integrator's separate qualification, not certified by this Go fixture.

New raw logs and exact hashes are in worker storage
`gateway/revision-2/`; the old storage files were not overwritten. Tests use the
actual pinned SDK/native server and loopback peers; every nonfixture provider
socket is denied. New archive/manifest record final tests, vet/build/module and
format checks. Independent affected-change acceptance is pending the original
read-only reviewer's recheck. No live credentials, provider requests, commits,
main checkout edits or deployment occurred.
