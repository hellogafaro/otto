/**
 * Subscription provider auth: bring-your-own-subscription login flows.
 *
 * A provider here is a consumer subscription (Claude Pro/Max, ChatGPT, Cursor,
 * X Premium, Kimi For Coding) connected over OAuth. Tokens never cross this
 * contract — the server holds them; clients only see connection status and
 * login-flow progress.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { OttoMemoryApprovalRequest } from "./otto-memory/base.ts";
import { BotId, IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./base-schemas.ts";
import { McpServerId } from "./mcp-server.ts";
import { ProviderInstanceId } from "./provider-instance.ts";

export const SubscriptionProviderId = Schema.Literals([
  "anthropic",
  "openai-codex",
  "xai",
  "kimi-for-coding",
  "opencode-go",
]);

export type SubscriptionProviderId = typeof SubscriptionProviderId.Type;

export const SubscriptionAuthMode = Schema.Literals(["oauth", "api-key"]);

export type SubscriptionAuthMode = typeof SubscriptionAuthMode.Type;

export const SubscriptionBaseUrl = TrimmedNonEmptyString.check(
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);

        return (
          (url.protocol === "https:" || url.protocol === "http:") &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    },
    { message: "Use an HTTP or HTTPS base URL without credentials, a query, or a fragment." },
  ),
);

/**
 * One signed-in account for a provider. `default` is the account the first
 * sign-in created; added accounts get their own ids.
 */
export const SubscriptionAccountId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(default|acct-[a-z0-9]{6,32})$/),
);

export type SubscriptionAccountId = typeof SubscriptionAccountId.Type;

export const SubscriptionProviderStatus = Schema.Struct({
  provider: SubscriptionProviderId,
  instanceId: Schema.optional(ProviderInstanceId),
  /** Set on entries of `linkedAccounts`. */
  accountId: Schema.optional(SubscriptionAccountId),
  /** True on the linked account that new requests use right now. */
  active: Schema.optional(Schema.Boolean),
  /** True on a linked account turned off in Settings; requests skip it until it is turned on. */
  paused: Schema.optional(Schema.Boolean),
  connected: Schema.Boolean,
  /** Account identifier supplied by the provider, when available. Never a token. */
  accountLabel: Schema.optional(TrimmedNonEmptyString),
  /** Subscription tier, such as "Pro" or "Max 20x", when the provider reports one. */
  plan: Schema.optional(TrimmedNonEmptyString),
  authMode: Schema.optional(SubscriptionAuthMode),
  baseUrl: Schema.optional(SubscriptionBaseUrl),
  /** ms epoch when the current access token expires. Absent when disconnected. */
  expiresAt: Schema.optional(Schema.Number),
  health: Schema.optional(
    Schema.Literals([
      "missing",
      "detected",
      "healthy",
      "expired",
      "revoked",
      "failed",
      "unsupported",
      "disabled",
      "failed-first-request",
      "recovered",
    ]),
  ),
  /**
   * True while the server runs the health check that follows a login. A separate
   * optional field so older clients still decode the status list.
   */
  healthChecking: Schema.optional(Schema.Boolean),
  lastSuccessfulRequestAt: Schema.optional(IsoDateTime),
  lastFailedRequest: Schema.optional(
    Schema.Struct({
      at: IsoDateTime,
      message: TrimmedNonEmptyString,
    }),
  ),
  nextRetryAt: Schema.optional(IsoDateTime),
  /**
   * The saved credential file changed on disk and could not be reread. The
   * server keeps using the credentials it loaded earlier, so `connected` and
   * health still describe them.
   */
  credentialWarning: Schema.optional(
    Schema.Struct({
      at: IsoDateTime,
      message: TrimmedNonEmptyString,
    }),
  ),
  reconnectAction: Schema.optional(TrimmedNonEmptyString),
  healthTest: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["not-run", "passed", "failed"]),
      checkedAt: Schema.optional(IsoDateTime),
    }),
  ),
  oauthCheck: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["passed", "failed"]),
      checkedAt: IsoDateTime,
    }),
  ),
  dependentBots: Schema.Array(Schema.Struct({ id: BotId, name: TrimmedNonEmptyString })).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependentRoutines: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});

export type SubscriptionProviderStatus = typeof SubscriptionProviderStatus.Type;

export const ProviderAccessStatus = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  accessMethod: Schema.Literals(["subscription-oauth", "api-key", "acp-cli", "browser", "mcp"]),
  health: Schema.Literals([
    "missing",
    "detected",
    "healthy",
    "expired",
    "revoked",
    "failed",
    "unsupported",
    "disabled",
    "failed-first-request",
    "recovered",
  ]),
  apiAccess: Schema.Literals(["separate", "included", "not-applicable"]),
  nextAction: TrimmedNonEmptyString,
  publishedLimit: Schema.optional(TrimmedNonEmptyString),
  temporary: Schema.optional(Schema.Boolean),
  repairAction: Schema.optional(TrimmedNonEmptyString),
  serverId: Schema.optional(TrimmedNonEmptyString),
  pluginId: Schema.optional(TrimmedNonEmptyString),
  lastSuccessfulRequestAt: Schema.optional(IsoDateTime),
  lastFailedRequest: Schema.optional(
    Schema.Struct({ at: IsoDateTime, message: TrimmedNonEmptyString }),
  ),
  nextRetryAt: Schema.optional(IsoDateTime),
  reconnectAction: Schema.optional(TrimmedNonEmptyString),
  dependentBots: Schema.Array(Schema.Struct({ id: BotId, name: TrimmedNonEmptyString })).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependentRoutines: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});

export type ProviderAccessStatus = typeof ProviderAccessStatus.Type;

export const BotInboxItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  incidentKey: TrimmedNonEmptyString,
  kind: Schema.Literals([
    "oauth-expired",
    "connector-failure",
    "routine-failure",
    "silence-watchdog-failure",
    "approval-request",
  ]),
  status: Schema.Literals(["open", "resolved"]),
  botId: BotId,
  botName: TrimmedNonEmptyString,
  taskOrRoutine: TrimmedNonEmptyString,
  lastFailure: TrimmedNonEmptyString,
  nextAction: TrimmedNonEmptyString,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  resolvedAt: Schema.optional(IsoDateTime),
  occurrenceCount: Schema.Int.check(Schema.isGreaterThan(0)),
  // Present on approval requests that ask to save shared memory.
  memoryApproval: Schema.optional(OttoMemoryApprovalRequest),
});

export type BotInboxItem = typeof BotInboxItem.Type;

export const BotInboxResolveInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});

export type BotInboxResolveInput = typeof BotInboxResolveInput.Type;

export const SubscriptionAuthStatuses = Schema.Struct({
  providers: Schema.Array(SubscriptionProviderStatus),
  accounts: Schema.Array(SubscriptionProviderStatus).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /**
   * Every signed-in account per provider, in the order requests try them.
   * When one hits a usage limit or is signed out, requests move to the next.
   */
  linkedAccounts: Schema.Array(SubscriptionProviderStatus).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  access: Schema.Array(ProviderAccessStatus).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  inbox: Schema.Array(BotInboxItem).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

export type SubscriptionAuthStatuses = typeof SubscriptionAuthStatuses.Type;

export const SubscriptionAuthHealthTestInput = Schema.Struct({
  provider: SubscriptionProviderId,
  instanceId: Schema.optional(ProviderInstanceId),
  accountId: Schema.optional(SubscriptionAccountId),
});

export type SubscriptionAuthHealthTestInput = typeof SubscriptionAuthHealthTestInput.Type;

export const SubscriptionAuthStartInput = Schema.Struct({
  provider: SubscriptionProviderId,
  instanceId: Schema.optional(ProviderInstanceId),
  /** Sign in to this linked account again. */
  accountId: Schema.optional(SubscriptionAccountId),
  /** Sign in to another account and add it to the end of the order. */
  addAccount: Schema.optional(Schema.Boolean),
  authMode: Schema.optional(SubscriptionAuthMode),
  /** Custom endpoints apply to API-key authentication only. */
  baseUrl: Schema.optional(SubscriptionBaseUrl),
});

export type SubscriptionAuthStartInput = typeof SubscriptionAuthStartInput.Type;

/**
 * A started login. `completion` says how it finishes: "poll" flows settle by
 * repeated `poll` calls; "paste" flows need the user to paste a code or key into
 * `complete`.
 */
export const SubscriptionAuthStartResult = Schema.Struct({
  loginId: Schema.String,
  provider: SubscriptionProviderId,
  url: Schema.String,
  userCode: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  completion: Schema.Literals(["poll", "paste"]),
});

export type SubscriptionAuthStartResult = typeof SubscriptionAuthStartResult.Type;

export const SubscriptionAuthPollInput = Schema.Struct({
  loginId: Schema.String,
});

export type SubscriptionAuthPollInput = typeof SubscriptionAuthPollInput.Type;

export const SubscriptionAuthCompleteInput = Schema.Struct({
  loginId: Schema.String,
  /** Pasted authorization input or API key. */
  code: Schema.String,
});

export type SubscriptionAuthCompleteInput = typeof SubscriptionAuthCompleteInput.Type;

export const SubscriptionAuthLoginProgress = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("connected"),
    /** Added field is optional so older clients still decode connected logins. */
    health: Schema.optional(Schema.Literal("checking")),
  }),
  Schema.Struct({ status: Schema.Literal("pending"), nextPollMs: Schema.Number }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
]);

export type SubscriptionAuthLoginProgress = typeof SubscriptionAuthLoginProgress.Type;

export const SubscriptionAuthLogoutInput = Schema.Struct({
  provider: SubscriptionProviderId,
  instanceId: Schema.optional(ProviderInstanceId),
  accountId: Schema.optional(SubscriptionAccountId),
});

export type SubscriptionAuthLogoutInput = typeof SubscriptionAuthLogoutInput.Type;

export const SubscriptionAuthAccountOrderInput = Schema.Struct({
  provider: SubscriptionProviderId,
  accountIds: Schema.Array(SubscriptionAccountId),
});

export type SubscriptionAuthAccountOrderInput = typeof SubscriptionAuthAccountOrderInput.Type;

export const SubscriptionAuthAccountPausedInput = Schema.Struct({
  provider: SubscriptionProviderId,
  accountId: SubscriptionAccountId,
  paused: Schema.Boolean,
});

export type SubscriptionAuthAccountPausedInput = typeof SubscriptionAuthAccountPausedInput.Type;

export class SubscriptionAuthError extends Schema.TaggedErrorClass<SubscriptionAuthError>()(
  "SubscriptionAuthError",
  {
    reason: Schema.String,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export const McpServerAuthenticateInput = Schema.Struct({
  mcpServerId: McpServerId,
});

export type McpServerAuthenticateInput = typeof McpServerAuthenticateInput.Type;

export const McpServerAuthenticationProgress = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("authorization-required"),
    authorizationUrl: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("connected"),
    toolCount: NonNegativeInt,
    recoveryFailures: Schema.Array(TrimmedNonEmptyString),
  }),
]);

export type McpServerAuthenticationProgress = typeof McpServerAuthenticationProgress.Type;

export const McpServerTools = Schema.Struct({
  toolNames: Schema.Array(Schema.String),
  /** The server answered but wants an OAuth sign-in before it lists tools. */
  needsSignIn: Schema.Boolean,
});

export type McpServerTools = typeof McpServerTools.Type;

export class McpServerToolsError extends Schema.TaggedErrorClass<McpServerToolsError>()(
  "McpServerToolsError",
  {
    mcpServerId: McpServerId,
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

/** An HTTP header name: an RFC 9110 token. */
export const McpServerHeaderName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  Schema.isMaxLength(128),
);

/** A header value: one line, never echoed back to any client. */
export const McpServerHeaderValue = Schema.String.check(
  Schema.isPattern(/^[^\r\n]*$/),
  Schema.isMinLength(1),
  Schema.isMaxLength(8_192),
);

/** The header names saved for a server. Values stay on the server. */
export const McpServerHeaders = Schema.Struct({
  names: Schema.Array(McpServerHeaderName),
});

export type McpServerHeaders = typeof McpServerHeaders.Type;

/**
 * Replaces a server's headers. A null value keeps the saved value for that name; a name
 * left out is removed.
 */
export const McpServerSetHeadersInput = Schema.Struct({
  mcpServerId: McpServerId,
  headers: Schema.Array(
    Schema.Struct({
      name: McpServerHeaderName,
      value: Schema.NullOr(McpServerHeaderValue),
    }),
  ).check(Schema.isMaxLength(20)),
});

export type McpServerSetHeadersInput = typeof McpServerSetHeadersInput.Type;

export class McpServerHeadersError extends Schema.TaggedErrorClass<McpServerHeadersError>()(
  "McpServerHeadersError",
  {
    mcpServerId: McpServerId,
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class McpServerAuthenticationError extends Schema.TaggedErrorClass<McpServerAuthenticationError>()(
  "McpServerAuthenticationError",
  {
    mcpServerId: McpServerId,
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.reason;
  }
}
