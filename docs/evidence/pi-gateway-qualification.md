# Codex gateway qualification

The selected route is Pi → Otto's authorized Run/model route → one private
CLIProxyAPI SDK gateway → exact Codex OAuth account and canonical model.
Only controlled peers are qualified here. Real account eligibility, provider
discovery and subscription usage are unverified. Independent acceptance is
pending root inspection and a fresh reviewer.

## Inputs and executed artifacts

Baseline: `241e425472fc26f713f96d5fb1ac3c88bd71f603`. The input archive SHA256
was `b7c73322a600be601605b9b2c531d785ff53689500031223235601165579a290`.
Every archive member was checked as a regular, safe relative file before the
isolated overlay; all 240 `input.json` file hashes matched. Shared source
clones and the main checkout were read only. Overlay changes, including the
reviewed unrelated schema fix, are not this lane's changes.

CLIProxyAPI Go module `v8.0.12` resolves exactly to
`2044a01f422998de79a5da8015141b878886534d` (recorded module origin/tag).
Go 1.26.0 linux-amd64 official archive SHA256:
`aac1b08a0fb0c4e0a7c1555beb7b59180b05dfc5a3d62e40e9de90cd42f88235`.
It was installed only in worker storage. No global toolchain was changed.

The published `@earendil-works/pi-ai@1.0.0` has gitHead
`a13d35a742c6ef8462812a28fbe1d8c8b7431c32` and registry integrity
`sha512-3/W1vdDaVtpeMd23ElvJC12HLA5yS/BGqqcXF+0SK082dN7cbgNcCwguTBRBC258Ke8SzSvUW1B75iAf8w8IxA==`.
The downloaded safe archive SHA256 is
`f39b99c29b8598f175b10840e5d2a81983e7c0ce5cae4d7df83a1007447d2c2b`.
Public `providers/openai-codex` → `openaiCodexProvider().auth.oauth` was
executed from those published bytes under Bun 1.4.2. The earlier direct source
probe used `a276dabe57911253350bffb93cb7d7aff6a73261` and is separately
attributed; it is not the final packaging pin.

## Source findings and reproduced traps

| Finding at pinned source | Executed observation | Selected correction |
| --- | --- | --- |
| Stock Responses calls `GetContextWithCancel` with `context.Background()` in `sdk/api/handlers/openai/openai_responses_handlers.go` | Middleware pinned B; stock HTTP selected A | Custom private handler calls public `ExecuteWithAuthManager` / stream counterpart directly with `WithPinnedAuthID` |
| `sdk/cliproxy/auth/conductor_lifecycle.go` persistence errors do not prevent Register/Update installation | Failed Store save: HTTP 200, A generated twice, rotated token installed | Guarded `ProviderExecutor.Refresh` must complete CAS before returning an updated Auth |
| Service `syncPluginModelRuntime` runs after startup/reload in `sdk/cliproxy/service_lifecycle.go` | Service-managed decorator/registry replaced during qualification | Empty bootstrap manager supplies native executor; separate owned dispatch manager never receives service reload/auto refresh |
| `internal/api/server.go` has no socket timeouts; mandatory CPA trace writer lacks `Unwrap` | Initial slow-body/slow-write probes retained the account past their deadline | Public `WithEngineConfigurator` captures native response controller before wrappers; unsupported deadlines fail closed |
| Request middleware can spool body material even with normal logging disabled | Source traces error-only request/body capture | Public `WithRequestLoggerFactory` returns nil; no ordinary request/error-body files |
| Native Codex executor can append an image tool | Function allowlist alone could not constrain the outgoing request | Public config JSON disables image generation; fake peer rejects every non-function outgoing tool |

The controlled source trap rerun passed as a regression detector in
`source-red-green.log`: unguarded save failure generated twice and installed
the rotation; guarded failure generated once and did not install it. A pending
refresh followed by Store failure denied the waiting request before generation.
Earlier abandoned native Go login probes are not part of the selected route.

## Measured production boundary

The focused tests start the actual embedded SDK server, call real loopback
HTTP, and drive native Codex execution/refresh against fake peers. A deny
transport intercepts every provider URL and fails any nonfixture socket
attempt. Fixture values are explicitly synthetic.

| Boundary exercised | Observed result |
| --- | --- |
| A success | HTTP 200; A generation 1, refresh 0; B generation/refresh 0 |
| A 429 | HTTP 429; A generation 1, refresh 0; B traffic 0 |
| A 401 and confirmed refresh | HTTP 200; A generation 2, refresh 1; B traffic 0 |
| Invalid refresh | HTTP 401; A generation 1, bounded native refresh calls 3; B traffic 0 |
| Foreign refreshed identity | HTTP 401; A generation 1, refresh 1; B traffic 0 |
| Concurrent eligible B stream during A 429/401 | B stays generation 1, refresh 0; A never dispatches to B |
| Body/header/query/route spoof and aliases | Denied; caller routing headers stripped; body must match trusted canonical model |
| Account model discovery | A inventory excludes B-only model; revocation during discovery prevents publication |
| Wrong raw served model, both stream modes | HTTP 502 before a foreign model escapes SDK rewriting |
| Store failure and lost acknowledgement | HTTP 401; one A generation/refresh/PUT; rotated token not installed or retained |
| Revoke / reauthentication during refresh | No generation retry; CAS rejects stale write and preserves newer durable material |
| Fault recovery | Fingerprint change and an intervening failed Store read cannot recover; a later confirmed same-ID login event restores A while B remains usable |
| Fresh OS process after failed persistence | Rechecks durable record; each failure allows one A request/refresh, no retry or B traffic |
| Normal cancel | Actual fake upstream cancellation joined in 118 microseconds in the recorded run |
| Native usage / oversize frame | Completed usage remains 10, not summed intermediate events; oversized SSE frame rejected |
| Downstream write failure | Cancels and joins actual upstream before account reuse |
| 100 ms injected production deadline | Cancels fake upstream around 100 ms |
| Open slow TCP body / unread output | Account released around 102 ms; stream upstream cancel observed; peer remained open |
| Inactive cleanup | No retained account lock, saved credential, manager Auth or registered client model; 16 request slots and 256 nonsecret fault-marker cap |
| Ordinary files / errors | Fixture temp trees contain no refresh credential marker; synthetic provider error marker is absent from outward responses |

Main's TS Store must additionally durably set `needs_auth` before an external
refresh write and requalify only after confirmed persistence/current authority.
The Go process's transient marker does not certify that domain/Infisical seam;
the integrator owns its separate production tests, including restart after an
unacknowledged write.

Published Pi public OAuth fake-fetch proof exercised structured `device_code`
notification, successful account A, cancellation before token exchange,
invalid access JWT, foreign refresh identity rejected by the Otto fixture, and
synthetic persistence failure before enablement. Every fetch was intercepted,
with no sockets. Pi returns structured credentials; identity preservation and
successful persistence remain Otto responsibilities.

## Check record and evidence location

From the isolated `ops/gateway`, Go test, vet, module verification, formatting
and a stripped `CGO_ENABLED=0` build passed. The full recorded test suite ran
in 5.600 seconds. The race detector was not run: `go test -race` reported that
cgo is required; no C compiler is installed. This is an unverified check, not
a pass. No entire Otto install, provider request or deployment was performed.

Executed commands used this worker-only Go binary and caches:

```sh
export GOMODCACHE=/home/g4f4r0/.bb/thread-storage/thr_m322hsr4yf/gateway/mod
export GOCACHE=/home/g4f4r0/.bb/thread-storage/thr_m322hsr4yf/gateway/cache
GATEWAY_GO=/home/g4f4r0/.bb/thread-storage/thr_m322hsr4yf/gateway/go/bin/go
# working directory: assigned checkout/ops/gateway
"$GATEWAY_GO" test -count=1 -v ./...
"$GATEWAY_GO" vet ./...
"$GATEWAY_GO" mod verify
CGO_ENABLED=0 "$GATEWAY_GO" build -trimpath -ldflags='-s -w' -o /home/g4f4r0/.bb/thread-storage/thr_m322hsr4yf/gateway/otto-gateway .
bun /home/g4f4r0/.bb/thread-storage/thr_m322hsr4yf/gateway/pi-public-proof/probe.ts
```

Worker storage `gateway/` holds `production-tests.log`, `production-vet.log`,
`production-build.log`, `module-verify.log`, `production-race.log`,
`source-red-green.log`, `pi-public-results.json`, `pi-registry.json`,
`module-pin.json`, the reproducible scratch probes and the final SHA256
manifest. Fixtures and child processes were stopped after the checks.

The final module is one process with two in-memory SDK managers, not two
gateway services. A process per selected account would repeat the native
listener/bootstrap and supervisor lifecycle; it would not remove the durable
refresh acknowledgement requirement. Measured stripped binary size and
linked module versions are in the export manifest. No per-account RSS or
live-provider throughput claim is made.
