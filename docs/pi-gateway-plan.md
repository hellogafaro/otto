# Managed Pi and one account gateway

3 October 2026. Pi 1.0.0 replaces ACP for every Otto Agent. CLIProxyAPI v8.0.12 is the single managed gateway, initially Codex OAuth/Responses only. Users connect supported accounts through Otto, without installing a vendor CLI or choosing a harness. The [implementation checkpoint](pi-implementation.md) records current checks and independent review status; earlier ACP/native-computer evidence remains historical.

The model reasons; Pi runs the loop and tools inside the configured Computer boundary; the gateway provides upstream model access; Otto owns product records, authorization and collaboration. SDK/gateway authentication deliberately replaces the previous native-login requirement. It does not prove provider eligibility, equivalent native behavior, subscription billing or physical isolation. No account/model/billing fallback. Compute provisioning remains deferred.

## Implemented boundaries

| Source | Responsibility |
| --- | --- |
| [`PiInstallation`, `prepareRunModel`, `admitRun`, `validateRunSources`](../packages/runs/src/index.ts) | One trusted installation, exact authorized provider/model/private account proof, immutable skills/content/grants and atomic Run/queue admission. Preflight model I/O runs outside the workspace write transaction; exact retry retains accepted inputs. Configuration changes fence queued work, while active work keeps its accepted model. |
| [`createRunRuntime`](../packages/runs/src/runtime.ts), [`ComputerProcess`](../packages/environments/src/computer.ts) | Materialize curated Pi configuration and extension, launch over existing remote stdin/stdout, retain launch/attempt/deadline/lease/generation/source fences. Scripts need no model credentials. No host-local fallback. |
| [`connectPi`](../packages/runs/src/pi.ts), [`managed extension`](../packages/runs/src/pi-extension.ts), [`createRunTools`, `runToolSchema`](../apps/server/src/tools.ts) | Bounded native JSONL RPC and one scoped Otto tool. The owning Zod union advertises operations; the server still validates current Run identity and accepted/live source/grant audiences. Native coding tools remain inside the Computer boundary. No host credential/skill/extension discovery or codemode. |
| [`Session binding`](../packages/sessions/src/index.ts) | Private Pi context pinned to Agent/Chat/Environment, Pi version and accepted provider/model/account. No browser path input or public transcript. Incompatible old snapshots fail closed; do not reconstruct their account or scope from current authority. |
| [`Subscription login`](../apps/server/src/subscription-login.ts), [`Infisical accounts`](../apps/server/src/subscription-secrets.ts), [`private store callback`](../apps/server/src/gateway-store-api.ts) | Public Pi SDK device OAuth; creator/current membership/visibility and explicit needs_auth/disabled transitions. Confirmed secret persistence precedes enablement. Refresh enters durable needs_auth before delivery; lost acknowledgement stays unavailable after restart. A fresh confirmed OAuth event can clear a same-account gateway block; display edits or token rotation cannot. |
| [`model proxy`](../apps/server/src/model-gateway.ts), [`Go gateway`](../ops/gateway/main.go) | Attempt-scoped capability resolves accepted account/model from Otto; caller routing headers never select accounts. Dedicated private SDK pin survives dispatch, stock routes are denied. Selected-account model discovery intersects exact pinned Pi metadata/config. Native cache keys map to the accepted Otto Session. |
| Runtime `usage` and [`getRunUsage`](../packages/runs/src/index.ts) | Pi-observed receipts (assistant messages and compaction summary requests) deduplicate by attempt/sequence. Exact replay does not add usage; unknown values remain null. Only finished receipt capture exposes whole-Run token totals; stopped/revoked/incomplete Runs retain their observed message count with complete=false and null totals. `estimatedCost` is an API list price estimate from the price accepted with the Run, never a charge; `scope: "pi_observed"` excludes anything Pi does not report. See [accounts and usage](gateway-accounts-usage.md). |
| Runtime `stop`, `steer`, `reconcile`, `close` and [`queue`](../apps/server/src/queue.ts) | Responsive targeted controls, terminal `agent_settled` after callback cleanup, bounded model/tool joins and authoritative remote tree stop. Missing launch acknowledgement or unjoined I/O retains durable uncertainty and the lease. Startup/recovery never launches a second loop. |
| [`lifecycle`](../apps/server/src/lifecycle.ts), [`Dockerfile`](../ops/Dockerfile), [`compose`](../ops/compose.yaml) | Standard exact Pi packages plus one compiled gateway service. Gateway shares the server network namespace; private keys authenticate transport, not upstream account permission. Server readiness includes the private gateway. No vendor CLI, credential files or compute provisioning. |

Pi JSONL RPC fits the existing remote ComputerProcess boundary. The SDK is used for structured OAuth only, not to move the model/tool loop into Otto's server. The selected published packages have gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`; the earlier inspected source `a276dabe57911253350bffb93cb7d7aff6a73261` is a distinct pin. Selected core/RPC/OAuth source seams were compared and the published CLI itself exercised; there is no source-hash equivalence claim or custom dist pipeline.

## Pi events and later GUI

| Native capability/events | Otto surface |
| --- | --- |
| Prompt, text deltas, final assistant usage, agent_settled | Saved Run output, status and reported token aggregate; agent_end alone is not settlement. |
| Scoped tool input, questions and exact approvals | Existing typed Otto domain operations and human attention records; Pi UI confirmation is not authority. |
| Steer, abort, pending callbacks | Targeted Run controls, bounded joins and truthful uncertainty. |
| Private Session resume | Authorized continuation; no shared raw transcript or native path. |
| Builtin read/write/edit/bash | Computer-local work and explicitly published File results; native traces stay private. |
| TUI status, navigation and panels | Interaction reference for a later lean GUI, not terminal scraping or panel parity. |

## Qualification and smallest vertical slice

One route must prove exact account/model pinning through retry, 429/unavailable and unknown identities; spoofed headers must not select another account. Discovery is account-specific, not a global permission grant. Login/refresh/revocation must preserve confirmed Infisical persistence and current actor authority. Pending tool steer/Stop and restart must join server I/O and remote tree cleanup before reuse. Reported usage must deduplicate and preserve unknowns. Stock caller keys do not themselves establish per-account authorization; Otto's existing Run/Subscription boundary does.

The integration slice is authenticated HTTP → real private PostgreSQL/pg-boss → packaged Pi → attempt-bound Otto proxy → embedded CLIProxyAPI → controlled upstream → coding/scoped tool → saved output/usage and authorized readback. Negative/control cases retain current account/source revocation, private Session scope, exact retry and missing-ack/cleanup uncertainty. Controlled peers qualify these exercised contracts only. Real provider OAuth/model eligibility/billing, Infisical deployment, Garage durability and selected compute isolation require later live qualification. No second gateway, model catalog, provider registry or extra auth framework.
