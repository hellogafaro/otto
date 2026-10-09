# Independent gateway revision 3 affected review

**PASS — controlled gateway component contract on exact revision 3 below.** G6 is closed by independent actual-socket SSE parsing and byte-boundary checks. G1–G5 and the approved Session/cache/reasoning amendment retain prior revision-specific coverage; relevant stream/model/cleanup cases pass again on revision 3. No required component finding remains. This verdict does not grant final integrated Otto acceptance.

## Exact source and integrity

Reviewed baseline 241e425472fc26f713f96d5fb1ac3c88bd71f603 plus approved root input archive SHA256 b7c73322a600be601605b9b2c531d785ff53689500031223235601165579a290, overlaid only with revision 3 gateway archive SHA256 **a2a89ef72722928833bc6ff9e3e33884b66a922bb921132ec2984095597d8e76**.

Reviewed ops/gateway/main.go SHA256 **1245b89151dc5dd5203107a590d0b194431bfa7e74ef8aabe5e69b9675bf0b52**. Nine exact source hashes appear in initial-verification.json and final-verification.json. Pinned module remains CLIProxyAPI v8.0.12, origin 2044a01f422998de79a5da8015141b878886534d. No dependency or API change.

The independent stripped build is 48,709,794 bytes, SHA256 **6a4890e59bdd3f919e1c19e56ac0b4f9295708ba1d0e985b3b49f75eefd88831**, exactly matching the author binary.

Root explicitly assigned this affected recheck to the separate configured Otto reviewer, GPT-6.1-Sol high, thread thr_r6j9d2j6fs, in its isolated checkout. Revision 3 handoff, production diff and framing evidence were read. Previously read AGENTS/README/plan/principles/TESTING, Pi gateway map and revision 2 affected brief apply. Latest user AGENTS applies; explicit assignment selects this pinned candidate for controlled qualification despite older plan language describing unselected candidates.

Before the authorized overlay, all eight revision 2 source hashes matched and were backed up under previous-source/. The archive has exactly nine safe relative regular members; duplicate paths, traversal, .git, links and symlink destinations were excluded before application. All nine hashes were checked before and after. No deletion or implementation edit occurred. Final verification covers all 249 combined root/gateway source hashes, root input archive, all three author archives/evidence sets/binaries, both previous reviewer evidence manifests and both previous source backups. Earlier failed reports remain unchanged and valid for their own revisions.

## G6 correction and independent behavior

The sole production delta at main.go:882–903 restores one newline for native scanner event/comment metadata lines and two for data lines, counting restored bytes against existing frame and total bounds. This stays at the private HTTP write seam. Account pinning, early raw model assertions, current authority, native ownership, write failures, cancellation and request manager lifetime remain on the existing path. No stock route/handler fallback was introduced.

Pinned native code scans upstream lines without terminators, clones metadata and creates separate data buffers before translation. BaseAPIHandler drops empty chunks. The change restores delimiters discarded by that concrete path. Source inspection and independent tests found no introduced defect in this bounded change.

| Input through SDK/native path and gateway TCP socket | Frozen revision 2 | Revision 3 observed output |
| --- | --- | --- |
| LF or CRLF; comment plus created, function-call item, arguments delta, UTF8/text delta, completed; named event lines |0 dispatched events, concatenated event/data bytes; independent command exit 1 | HTTP200,5 JSON events in order; event/data types agree; tool identity and UTF8/escaped deltas preserved; exact gpt-5.4, terminal usage10; A1/B0 |
| Same events, data-only; optional space after colon; three-byte upstream Read fragmentation |0 dispatched events, exit 1 | HTTP200,5 dispatched events; no invented event field; same payload checks;824 output bytes |
| Original independent created/completed repro |0 complete frames in preserved revision 2 evidence |2 complete event/data frames with line/blank delimiters |
| Logical data line262142 bytes +2 restored delimiters | Not separately re-exercised |262144 output bytes,1 complete event, accepted at frame bound |
| Logical data line262143 bytes +2 restored delimiters | Not separately re-exercised |0 output bytes/events; oversized framed chunk withheld; native resources joined |
|8,526,960 upstream bytes, repeated64KiB data events | Not separately re-exercised |8,330,184 output bytes <=8,388,608 limit;127 complete frames, no terminal success; resources joined |

The independent parser dispatches only on blank lines, interprets event/data fields and comments, joins data lines, parses JSON, checks order/payloads and rejects unfinished data at EOF. This is not a substring assertion. Custom transcripts are injected at the raw provider response through reviewer transport after an actual loopback fixture request; they exercise the public SDK/native executor and actual gateway TCP bytes, without replacing a gateway adapter. The supplied native socket regression also exercises its upstream fixture server directly with data-only/LF/CRLF tool/text events.

Evidence: independent_test.go, overlay.json, red-overlay.json, independent-red.log, affected-green.log. The red overlay substitutes only preserved revision 2 main.go during compilation; no source or backup bytes were changed. Author red/green logs were inspected and hash-verified. Author full-suite log ends PASS, 11.512s; that remains author evidence, not an independent full-suite rerun.

## Regressions and carried coverage

Revision 3 actual TCP slow body cancellation releases the account in 101.736218ms and unread stream cancellation in 102.199654ms under injected 100ms deadline. Production deadline reaches the peer in 100.962564ms; ordinary cancellation joins upstream in 138.137µs. Failed writes cancel and join native streams before account reuse.

Held native Read/Close cleanup beyond 2.004402943s/2.003047028s still owns manager, gate and slot. Newer same-ID reauthentication cannot bypass unfinished work: A 503, unrelated B 200. Releasing the held I/O joins cleanup, releases resources and allows A 200. Sixteen live streams own 16 managers/slots; request 17=429; cancellation joins and releases all.

Missing/wrong media types and duplicate/escaped raw model/response keys remain 502 in both caller modes; valid SSE charset=200. No foreign assertion reaches output. Restored framing does not bypass the early raw assertion fence.

The exact production diff leaves other reviewed mechanisms unchanged. Prior revision 2 independent report ../gateway-recheck-2/review.md, SHA256 7cc8493a40c0879cdd9702906f080ffc4b690c1a1961d00b85a5e77d33afb130, establishes G1–G5 and the approved amendment: inactive metadata maxima1/1 across 80 IDs, strict Bearer/query rejection, concurrent same-account generation3/refresh1/CASwrite1, exact trusted Session/cache<=64, native header spoof denial and high-reasoning passthrough. Its G6 failure is superseded only for corrected revision 3. Earlier ../gateway-review/review.md retains the controlled public Pi OAuth probe and original component analysis. None is relabeled as a revision 3 rerun.

## Executed commands and statuses

Go commands ran in assigned ops/gateway with the previously verified private Go1.26 toolchain, GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off, author's module cache read-only, reviewer-owned GOCACHE/GOTMPDIR. No installation or author cache/source mutation.

| Command/check | Observed status | Evidence |
| --- | --- | --- |
| go test -overlay red-overlay.json -run TestG6IndependentSocketParser -count=1 -v ./... | Expected RED, exit 1,0.435s;4 variants dispatch0 events | independent-red.log |
| go test -overlay overlay.json -run affected selection -count=1 -v ./... | VERIFIED PASS, exit 0,7.320s | affected-green.log |
| go vet ./... | VERIFIED PASS, exit 0 | vet.log |
| CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o own-binary . | VERIFIED PASS, exit 0; exact author binary hash | build.log, final-verification.json |
| go mod verify | VERIFIED PASS, exit 0, all modules verified | module-verify.log |
| gofmt -l main.go main_test.go | VERIFIED PASS, exit 0, empty output | gofmt.log |
| Source/archive/evidence preservation | VERIFIED PASS | initial-verification.json, final-verification.json, verify.py |
| Race | UNVERIFIED: no C compiler/cgo; none installed | Prior actual ../gateway-review/go-race.log: -race requires cgo; not PASS |

Exact affected selection:

    TestG6|TestRecheckNativeSSEEventFraming|TestRecheckRawModelMediaAndAmbiguity|TestRecheckNativeJoinOwnsResources|TestRecheckManagerGlobalBudget|TestNativeSocketSSEFraming|TestStreamCancellationBoundsAndUsage|TestStreamWriteFailureJoinsCancel|TestProductionDeadlineCancelsPeer|TestSlowClientSocketDeadlines

The change is limited to the exercised stream write seam. No unchanged broad full suite, full TS/backend suite or provider traffic was repeated.

## Standalone scope and handoff

The controlled component passes on exact revision 3. Real account/provider eligibility, billing, isolation and durable external storage remain UNVERIFIED and are not controlled-contract blockers. Fresh-process recovery after unacknowledged refresh persistence still depends on Otto durable status and trusted current callback integration, not Go memory. Native reasoning eligibility remains provider-authoritative and unverified.

Final Otto acceptance requires a fresh independent integrated TS/Run/Pi/gateway review including current authority, accepted Session canonicalization, durable refresh uncertainty and public Pi composition. This component verdict cannot replace it.

Only approved archive members were applied. No author/main worktree, source history, staging, commit, deployment, shared DB, Notion, real credentials/login or external writes were touched. Scratch probes/evidence live in reviewer storage. All launched Go processes exited; loopback fixtures and held I/O were cleaned up by completed tests. Human work time unknown.
