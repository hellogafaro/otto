import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, Visibility } from "./base-schemas.ts";

export const ComposioConnectionStatus = Schema.Literals([
  "INITIALIZING",
  "INITIATED",
  "ACTIVE",
  "FAILED",
  "EXPIRED",
  "INACTIVE",
  "REVOKED",
]);

export type ComposioConnectionStatus = typeof ComposioConnectionStatus.Type;

/** `user` accounts stay with the person who connected them; `organization` accounts serve every bot. */
export const ComposioVisibility = Visibility;

/**
 * New accounts set this key to false so they start off for every bot. An explicit bot id
 * still wins. Accounts connected before this have no entry and keep the previous default.
 */
export const COMPOSIO_BOT_ACCESS_DEFAULT = "*";

export type ComposioVisibility = typeof ComposioVisibility.Type;

export const ComposioConnection = Schema.Struct({
  id: TrimmedNonEmptyString,
  toolkitSlug: TrimmedNonEmptyString,
  status: ComposioConnectionStatus,
  /** The label the person typed when connecting, such as Work, or an older account's Composio alias. */
  alias: Schema.optional(TrimmedNonEmptyString),
  /** Who the account signed in as, such as an email address, once the provider reports it. */
  accountName: Schema.optional(TrimmedNonEmptyString),
  /** The app's name and logo from Composio's catalog, when it lists the toolkit. */
  toolkitName: Schema.optional(TrimmedNonEmptyString),
  logoUrl: Schema.optional(TrimmedNonEmptyString),
  visibility: ComposioVisibility.pipe(
    Schema.withDecodingDefault(Effect.succeed("organization" as const)),
  ),
  /** The viewer connected it (or nobody is recorded), so they may change or disconnect it. */
  manageable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Who connected a workspace account, when it is someone else. */
  ownerName: Schema.optional(TrimmedNonEmptyString),
  /**
   * Per-bot choices, by bot id. A missing choice uses the account default: older accounts
   * are on for the team or their owner, and a new account is off until someone turns it on.
   */
  botAccess: Schema.Record(Schema.String, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});

export type ComposioConnection = typeof ComposioConnection.Type;

export const ComposioStatus = Schema.Struct({
  configured: Schema.Boolean,
  connections: Schema.Array(ComposioConnection),
});

export type ComposioStatus = typeof ComposioStatus.Type;

export const ComposioToolkit = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  logoUrl: Schema.optional(TrimmedNonEmptyString),
  categories: Schema.Array(TrimmedNonEmptyString),
  toolsCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type ComposioToolkit = typeof ComposioToolkit.Type;

export const ComposioToolkitSearchInput = Schema.Struct({
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});

export type ComposioToolkitSearchInput = typeof ComposioToolkitSearchInput.Type;

export const ComposioGetToolkitInput = Schema.Struct({
  slug: TrimmedNonEmptyString,
});

export type ComposioGetToolkitInput = typeof ComposioGetToolkitInput.Type;

export const ComposioTool = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});

export type ComposioTool = typeof ComposioTool.Type;

/** An event in the app that can start a routine, such as a new email. */
export const ComposioTriggerType = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});

export type ComposioTriggerType = typeof ComposioTriggerType.Type;

/** One app from Composio's catalog with the tools it gives bots and the events it reports. */
export const ComposioToolkitDetail = Schema.Struct({
  toolkit: ComposioToolkit,
  tools: Schema.Array(ComposioTool),
  triggers: Schema.Array(ComposioTriggerType).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

export type ComposioToolkitDetail = typeof ComposioToolkitDetail.Type;

/** One field Composio asks for when creating an auth config or connecting an account. */
export const ComposioAuthField = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  type: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  required: Schema.Boolean,
  /** Mask it. Composio does not always flag secrets, so a secret-looking name counts too. */
  secret: Schema.Boolean,
  default: Schema.optional(Schema.String),
});

export type ComposioAuthField = typeof ComposioAuthField.Type;

/** One way to authenticate an app Composio does not host, and the fields that way asks for. */
export const ComposioAuthScheme = Schema.Struct({
  mode: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  creationFields: Schema.Array(ComposioAuthField),
  connectionFields: Schema.Array(ComposioAuthField),
});

export type ComposioAuthScheme = typeof ComposioAuthScheme.Type;

/** An auth config already in the Composio project. Credentials stay there. */
export const ComposioAuthConfigSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  scheme: TrimmedNonEmptyString,
  connections: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type ComposioAuthConfigSummary = typeof ComposioAuthConfigSummary.Type;

/**
 * What connecting an app needs. Managed apps (Composio hosts the OAuth app) skip the config
 * step. The rest pick an existing config or create one from `schemes`.
 */
export const ComposioAuthSetup = Schema.Struct({
  managed: Schema.Boolean,
  schemes: Schema.Array(ComposioAuthScheme),
  configs: Schema.Array(ComposioAuthConfigSummary),
});

export type ComposioAuthSetup = typeof ComposioAuthSetup.Type;

/** Fields forwarded to Composio to create an auth config. Otto does not keep them. */
export const ComposioCreateAuthConfigInput = Schema.Struct({
  toolkitSlug: TrimmedNonEmptyString,
  scheme: TrimmedNonEmptyString,
  credentials: Schema.Record(Schema.String, Schema.String),
});

export type ComposioCreateAuthConfigInput = typeof ComposioCreateAuthConfigInput.Type;

export const ComposioCreateAuthConfigResult = Schema.Struct({
  authConfigId: TrimmedNonEmptyString,
});

export type ComposioCreateAuthConfigResult = typeof ComposioCreateAuthConfigResult.Type;

export const ComposioAuthorizeInput = Schema.Struct({
  toolkitSlug: TrimmedNonEmptyString,
  /** The person's label for the account, unique among their own accounts for this app. */
  alias: Schema.optional(TrimmedNonEmptyString),
  visibility: Schema.optional(ComposioVisibility),
  /** An existing or just-created auth config. Managed apps omit this. */
  authConfigId: Schema.optional(TrimmedNonEmptyString),
  /** The scheme of that config, so connection fields are shaped the way Composio expects. */
  authScheme: Schema.optional(TrimmedNonEmptyString),
  /** Connection-time fields, such as a store name or an API key. Not stored. */
  connection: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type ComposioAuthorizeInput = typeof ComposioAuthorizeInput.Type;

export const ComposioAuthorizeResult = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
  /** Absent when the account is already active, such as an API key. */
  redirectUrl: Schema.optional(TrimmedNonEmptyString),
});

export type ComposioAuthorizeResult = typeof ComposioAuthorizeResult.Type;

export const ComposioDisconnectInput = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
});

export type ComposioDisconnectInput = typeof ComposioDisconnectInput.Type;

/**
 * The person who connected an account shares it with the workspace or keeps it to themselves,
 * or switches it on or off for one bot. Only that person lends a personal account to a bot.
 */
export const ComposioUpdateConnectionInput = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
  visibility: Schema.optional(ComposioVisibility),
  bot: Schema.optional(Schema.Struct({ botId: TrimmedNonEmptyString, enabled: Schema.Boolean })),
});

export type ComposioUpdateConnectionInput = typeof ComposioUpdateConnectionInput.Type;

/** The person already has an account for this app with that label. */
export class ComposioLabelTakenError extends Schema.TaggedErrorClass<ComposioLabelTakenError>()(
  "ComposioLabelTakenError",
  {
    toolkitSlug: TrimmedNonEmptyString,
    label: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}

export class ComposioOperationError extends Schema.TaggedErrorClass<ComposioOperationError>()(
  "ComposioOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}
