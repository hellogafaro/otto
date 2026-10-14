import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

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

/** `user` accounts stay with the person who connected them; `workspace` accounts serve every bot. */
export const ComposioVisibility = Schema.Literals(["user", "workspace"]);

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
  visibility: ComposioVisibility.pipe(Schema.withDecodingDefault(Effect.succeed("workspace"))),
  /** The viewer connected it (or nobody is recorded), so they may change or disconnect it. */
  manageable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Who connected a workspace account, when it is someone else. */
  ownerName: Schema.optional(TrimmedNonEmptyString),
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

export const ComposioConfigureInput = Schema.Struct({
  apiKey: TrimmedNonEmptyString,
});

export type ComposioConfigureInput = typeof ComposioConfigureInput.Type;

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

/** The person who connected an account shares it with the workspace or keeps it to themselves. */
export const ComposioUpdateConnectionInput = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
  visibility: ComposioVisibility,
});

export type ComposioUpdateConnectionInput = typeof ComposioUpdateConnectionInput.Type;

export class ComposioOperationError extends Schema.TaggedErrorClass<ComposioOperationError>()(
  "ComposioOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}
