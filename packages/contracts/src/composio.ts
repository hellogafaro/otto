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

export type ComposioVisibility = typeof ComposioVisibility.Type;

export const ComposioConnection = Schema.Struct({
  id: TrimmedNonEmptyString,
  toolkitSlug: TrimmedNonEmptyString,
  status: ComposioConnectionStatus,
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
   * Per-bot choices that differ from the default, by bot id: a team account is on for every
   * bot and a personal one for the bots its owner owns, unless switched here.
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

/** One app from Composio's catalog with the tools it gives bots. */
export const ComposioToolkitDetail = Schema.Struct({
  toolkit: ComposioToolkit,
  tools: Schema.Array(ComposioTool),
});

export type ComposioToolkitDetail = typeof ComposioToolkitDetail.Type;

export const ComposioAuthorizeInput = Schema.Struct({
  toolkitSlug: TrimmedNonEmptyString,
  alias: Schema.optional(TrimmedNonEmptyString),
  visibility: Schema.optional(ComposioVisibility),
});

export type ComposioAuthorizeInput = typeof ComposioAuthorizeInput.Type;

export const ComposioAuthorizeResult = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
  redirectUrl: TrimmedNonEmptyString,
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

export class ComposioOperationError extends Schema.TaggedErrorClass<ComposioOperationError>()(
  "ComposioOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}
