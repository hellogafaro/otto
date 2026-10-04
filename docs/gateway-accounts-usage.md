# AI accounts, sharing and usage

4 October 2026. The supported end-to-end path is one managed CLIProxyAPI gateway (pinned v8.0.12, commit `2044a01f`), Codex OAuth/Responses only, with Pi as the sole Agent runtime. This page is the typed contract for the Subscription and Run usage APIs and the limits of what they report. Controlled peers prove the exercised contracts only; no live account, provider, billing or Infisical deployment was used.

## Account lifecycle

| Step | Route (under `/api/workspaces/:workspaceId`) | Who | Result |
| --- | --- | --- | --- |
| Create | `POST /subscriptions` `{ title, provider: "codex", visibility?: "user" \| "workspace" }` | writer | `status: "needs_auth"`, `visibility: "user"` by default |
| Connect | `POST /subscriptions/:id/login` | creator only | `application/x-ndjson`: `{ type: "device_code", verificationUri, userCode, expiresInSeconds }`, then `{ type: "connected", provider: "codex" }` or `{ type: "error", code: "login_failed" }`. Closing the request cancels the login. |
| Share / unshare | `PATCH /subscriptions/:id` `{ visibility }` | creator only | `workspace` lets every current member use the account; `user` revokes at once, including active Runs. |
| Revoke / re-verify | `PATCH /subscriptions/:id` `{ status: "disabled" \| "needs_auth" }` | creator only | A disabled account needs `needs_auth` before it can log in again. |
| Discover | `GET /subscriptions`, `GET /subscriptions/:id` | creator, or any member when `workspace` | `{ id, createdBy, title, provider, visibility, status, createdAt, updatedAt }`. Never credentials or upstream identity. |
| Models | `GET /subscriptions/:id/models` | same as discover | `{ items: [{ id }], next: null }`: only models this exact account offers that the pinned Pi catalog or server config knows. |
| Use | `POST /agents` / `PATCH /agents/:id` with `subscriptionId`, then `POST /runs` | the Agent author and the Run sponsor | Both now require the actor to be able to use the account (own, or shared by a current member); otherwise 403 with no record written. |

A shared account runs with the creator's credential and nothing else: members get no credential, no transfer of ownership, no private Session context. The accepted account, upstream account id, model and Pi version are saved with the Run; there is no fallback to another account, model or API billing channel. The creator leaving the workspace, a visibility shrink, `disabled` or `needs_auth` stop the next model request of an active Run and deny new admission. A refresh whose acknowledgement is lost leaves the account `needs_auth` for everyone, also after a restart, until the creator authenticates again. A different ChatGPT identity cannot be connected to an existing Subscription. The gateway blocks an account for every member after a genuinely failed credential read until fresh authentication; a read cut short only by that request's own cancellation or deadline (a Stop, revocation or timeout mid-stream) refuses that request without blocking the account.

## Run usage

`GET /runs/:id/usage`, readable by the Run's current human audience:

```ts
interface RunUsage {
  provider: string | null;
  model: string;
  scope: "pi_observed"; // Pi-reported model requests only; never provider-billed or whole-account consumption
  complete: boolean; // finished and at least one receipt; false for running, stopped, failed, revoked
  messageCount: number; // receipts: assistant messages and compaction summary requests
  unreportedCount: number; // receipts with any unreported count
  inputTokens: number | null; // uncached input; processed input is input + cacheRead + cacheWrite
  outputTokens: number | null; // includes reasoning
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  estimatedCost: { amount: number; currency: "USD"; basis: "api_list_price" } | null;
}
```

```json
{ "provider": "codex", "model": "gpt-6.1-sol", "scope": "pi_observed", "complete": true, "messageCount": 3, "unreportedCount": 0,
  "inputTokens": 30, "outputTokens": 6, "cacheReadTokens": 0, "cacheWriteTokens": 0, "totalTokens": 36,
  "estimatedCost": { "amount": 0.00012, "currency": "USD", "basis": "api_list_price" } }
```

- Totals are `null` unless the Run finished and every receipt reported that count. A stopped, revoked or failed Run keeps its receipts but shows `complete: false` and no totals. Receipts arriving after a Stop request are not published.
- Receipts deduplicate by attempt and sequence. A Pi compaction summary request takes the next sequence of the same attempt (Pi's one terminal notice that overflow recovery already ran has no summary request and adds no receipt). Its tokens come from Pi's `compaction_end.result.usage`; each failed summary request (`summarization_retry_scheduled`, a final failure or an aborted compaction) is a receipt with null counts, so totals stay unknown instead of guessed.
- `estimatedCost` is NOT a charge. A Codex subscription is flat-rate; the figure prices each request's reported tokens at the pinned Pi catalog's API list price accepted with the Run (`inputs.modelConfig.cost`, USD per million tokens, highest tier whose threshold the request's input + cache tokens exceeds, as Pi's `calculateCost`). Runs accepted before this change, models without a catalog price, or any request with an unreported input, output, cacheRead or cacheWrite count (the four counts priced) give `null`; an unreported `totalTokens` alone does not affect the estimate. A priced zero and an unknown price are different.
- Not available: invoices, plan quota windows, credits, or money actually deducted. CLIProxyAPI v8.0.12 exposes tokens only (below) and no charge for Codex.

## Upstream comparison

Pinned CLIProxyAPI v8.0.12 (`2044a01f`, read from the module source): its public `sdk/cliproxy/usage` `Plugin.HandleUsage(ctx, Record)` receives per-upstream-request token details (including failed requests) in an in-memory queue; there are no prices or money. Its README states that built-in usage statistics were removed in v6.10 and that community tools estimate cost from editable price tables. Quota windows (5h/7d) exist only through management-API quota plugins, which the embedded SDK path does not run. Latest v8.0.13 (2026-10-03) differs by 11 commits and none adds usage, quota or price features; the pin was not changed.

The gateway builds one private manager per request with the single accepted credential and `SetRetryConfig(0, 0, 1)`, so it adds no cross-account or extra-round retries. A usage plugin could still see requests Pi never reports (a stream cut by Stop or revocation, a failure with partial counts). It is not used: it would be a second accounting authority needing reconciliation with Pi receipts (a request count join does not exist), a Go change, and durable delivery from a stateless in-memory gateway. Pi receipts remain the single authority and `scope` says what they cover.

## UI wiring note

Account list, share toggle and per-account models come from the routes above; a login screen reads the NDJSON stream and shows the device code; disable the share toggle and login for anyone but `createdBy`. Show `estimatedCost` only as "estimated at API list price" and `null` as unknown, never as free; show `complete: false` or `unreportedCount > 0` as partial.
