# Private Codex gateway

Selected boundary: one packaged Go process embeds the public CLIProxyAPI SDK;
Pi remains the Agent body. This module supports Codex subscription OAuth and
the Responses function-tool protocol only. Controlled peers qualify the
boundary; real OAuth eligibility, provider model discovery and subscription
usage remain unverified.

## Authority and HTTP contract

Pi calls Otto's existing Run-bound model route. Otto's `assertRunAttempt`
remains the product authority owner. An attempt capability authenticates that
accepted route; it does not choose a Subscription, account or model. Otto
replaces incoming routing headers and calls the gateway over its private
network. Go has no workspace, grant, user or capability registry.

Every gateway request requires `Authorization: Bearer <OTTO_GATEWAY_KEY>`.
The key stays in the Otto server and gateway; Pi and browsers never receive it.

| Route | Trusted Otto headers | Result |
| --- | --- | --- |
| `POST /otto/v1/responses` | `X-Otto-Subscription-Id`, `X-Otto-Account-Id`, `X-Otto-Model`, `X-Otto-Attempt-Id` | Responses JSON or native SSE; body model must equal the accepted canonical model; cache key requires trusted Session header below |
| `GET /otto/v1/models` | Subscription, Account and Attempt headers above | Inventory of that exact account; Model header may be empty |
| `GET /otto/ready` | Bearer only | 204 after the native executor and owned dispatch manager are installed |

Routing queries, aliases, model suffixes, unknown models, stock `/v1` routes,
management, images, websocket and other providers are denied. Discovery uses
native `HttpRequest` for the selected Auth ID at the fixed Codex `/models`
endpoint with `client_version=0.140.0`, and validates `models[].slug`. Go
rechecks current Store material before publishing the inventory. Otto filters
that inventory to the accepted model on its Run route.

When `prompt_cache_key` is present, Otto also injects `X-Otto-Session-Id`
from the accepted Run's private Session and rewrites Pi's native cache UUID to
that same domain ID. Go requires an exact match and a product ID of at most 64
bytes. Missing/mismatched Session headers are denied. Cache scope never grants
account/model authority. All caller headers are removed before native generation. Only function tools
are supported; native automatic image-tool injection is disabled. The JSON
body is canonicalized so duplicate keys cannot disagree with native decoding.
Successful native generation must use `text/event-stream` (both caller
stream modes); missing/wrong media types are denied. The bounded raw transport
rejects duplicate model/response keys and checks every model assertion before
the SDK can rewrite it. Dynamically discovered models use the SDK
`UserDefined` flag so absent local reasoning metadata does not silently strip
Pi reasoning fields; actual provider reasoning eligibility is unverified. Partial-stream failures close the stream; callers must treat a
stream without a completed response as uncertain rather than successful.

## Infisical seam and refresh

Go replaces the SDK Store with private callbacks to `OTTO_GATEWAY_STORE_URL`.
Both calls require `Authorization: Bearer <OTTO_GATEWAY_STORE_KEY>`:

* `GET /internal/gateway/accounts/{subscriptionId}` returns
  `{credential, fingerprint, authenticatedAt}` only for the currently
  authorized, qualified account.
* `PUT` at the same path accepts
  `{expectedFingerprint, expectedAuthenticatedAt, credential}` and returns
  `{fingerprint}` on a confirmed successful compare-and-set. The full GET
  wrapper is also accepted as the acknowledgement.

`credential` contains `provider: "codex"`, immutable `accountId`,
`accessToken`, `refreshToken`, ISO `expired`, optional `idToken` and optional
`planType`. Fingerprint is lowercase SHA256 hex over the UTF-8 JSON array
`[accountId, accessToken, refreshToken, idToken || "", expired]`. Refresh
preserves the real successful OAuth event `authenticatedAt` byte-for-byte.
Both access JWT and optional ID-token account claims must match the accepted
upstream ID. These checks establish consistency, not JWT signature validation.

The Otto server owns authorization, serialized login, Infisical writes and
CAS. It must mark qualification `needs_auth` before an external refresh write
and requalify only after acknowledged persistence and current authority. This
durable domain rule prevents a fresh gateway process from accepting an
unacknowledged rotation. The Go Store adds an in-memory fault marker and never
installs a rotated credential on failed or uncertain persistence. A changed
fingerprint cannot clear that marker. A strictly newer, successfully persisted
same-account OAuth event can recover it. The server must never issue that
event marker for ordinary display edits, refreshes or unconfirmed writes.

Login belongs to Otto server using public
`@earendil-works/pi-ai/providers/openai-codex` ->
`openaiCodexProvider().auth.oauth`: select `device_code`, forward structured
`interaction.notify`, supply AbortSignal and persist the result in Infisical
before enabling the Subscription. Go has no login endpoint, stdout parser or
loopback callback. The published package device-flow fixture is recorded in
the qualification evidence.

## Native SDK lifecycle and bounds

An empty bootstrap manager obtains the native Codex executor through
`Hooks.OnBeforeStart`. Each accepted request owns a fresh dispatch manager and guarded executor;
it never participates in service reload or auto refresh. Native Remove retains
ID epochs/scheduler tombstones, so the joined request discards its manager
instead of growing a shared pool. At most 16 requests/managers can remain
owned, including unfinished cleanup. Custom handlers call
`BaseAPIHandler.ExecuteWithAuthManager` / `ExecuteStreamWithAuthManager` with
`WithPinnedAuthID` and `WithExecutionSessionID`. This avoids stock handlers'
background-context reset and service plugin runtime replacement. No upstream
fork or private Go import is used.

`WithEngineConfigurator` captures the native response controller before the
mandatory trace writer obscures `Unwrap`. Unsupported socket deadlines deny
the request. `WithRequestLoggerFactory` returns nil, preventing request/error
body spooling. Upstream logs and stdout are discarded; outward errors are
fixed. The temporary directory holds only an empty config and auth directory.
Credential material stays in memory and private callback HTTP.

Bounds: 16 simultaneous requests; one active request per Subscription;
five-minute request/socket deadline including account-lock wait; 1 MiB input;
8 MiB upstream/output; 256 KiB SSE line/chunk; 256 models; 128 function tools;
15-second Store callback and 30-second provider-header timeout. Cancellation
drains SDK-facing channels and joins tracked native executor channels plus
actual transport/body Reads and Close. A failed two-second join retains its
slot, account gate, manager and material until the actual work finishes;
reauthentication cannot bypass unfinished I/O. New requests to that account
receive 503 while other slots/accounts remain usable. Only confirmed joining
releases locks, saved credentials, the manager and model-registry entries. Nonsecret fault
markers cap at 256; saturation denies admission until recovery/restart under
the server's durable authority.

## Runtime and checks

CLIProxyAPI `v8.0.12` is commit
`2044a01f422998de79a5da8015141b878886534d`. Go 1.26.0 and committed `go.sum`
pin the standalone module. The TS owner pins standard Pi 1.0.0 registry
packages, including pi-ai gitHead
`a13d35a742c6ef8462812a28fbe1d8c8b7431c32`; no custom Pi distribution is needed.

From `ops/gateway`:

```sh
go test -count=1 -v ./...
go vet ./...
go mod verify
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /path/to/otto-gateway .
```

Runtime reads `OTTO_GATEWAY_KEY`, `OTTO_GATEWAY_STORE_KEY`, and
`OTTO_GATEWAY_STORE_URL`, injected from Infisical. It binds private port 8317
on `0.0.0.0` and shuts down on SIGTERM/SIGINT. Packaging and the server's TS
composition belong to the integrator. No native vendor CLI is required.

One process avoids an SDK listener, bootstrap runtime and lifecycle per
selected account. A process per account would reduce shared selector risk
but would still require the same durable refresh/CAS rule and materially
multiply process management. No caller-key pool is assumed tenant safe.

CLIProxyAPI is MIT licensed; include [its unchanged notice](LICENSE.CLIProxyAPI)
with distribution. Binary packaging must also retain the license notices of
linked Go modules and Pi dependencies. `go version -m` records the linked
versions. No Go runtime license requires a maintained gateway fork.
