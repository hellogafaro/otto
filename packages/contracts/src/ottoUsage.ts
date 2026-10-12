import * as Schema from "effect/Schema";

import {
  OttoUsageReservationId,
  BotId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";
import { BotEngine } from "./orchestration/roster.ts";

export const OttoUsageCategory = Schema.Literals([
  "turn",
  "tool",
  "observer",
  "reflector",
  "extraction",
  "recall",
  "routine",
  "delegated",
]);

export type OttoUsageCategory = typeof OttoUsageCategory.Type;

export const OttoUsageState = Schema.Literals(["reserved", "reported", "unavailable", "released"]);

export type OttoUsageState = typeof OttoUsageState.Type;

export const OttoUsageEntry = Schema.Struct({
  reservationId: OttoUsageReservationId,
  sourceKey: TrimmedNonEmptyString,
  botId: BotId,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  category: OttoUsageCategory,
  state: OttoUsageState,
  reservedTokens: NonNegativeInt,
  inputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.optional(NonNegativeInt),
  cacheCreationTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  reasoningTokens: Schema.NullOr(NonNegativeInt),
  provider: Schema.NullOr(ProviderDriverKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  unavailableReason: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime),
});

export type OttoUsageEntry = typeof OttoUsageEntry.Type;

export const OttoBotUsageSummary = Schema.Struct({
  botId: BotId,
  consumedTokens: NonNegativeInt,
  reservedTokens: NonNegativeInt,
  measurements: Schema.Struct({
    input: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
    output: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
    observer: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
    reflector: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
  }),
  entries: Schema.Array(OttoUsageEntry),
});

export type OttoBotUsageSummary = typeof OttoBotUsageSummary.Type;

export const OttoBotUsageInput = Schema.Struct({ botId: BotId });

export type OttoBotUsageInput = typeof OttoBotUsageInput.Type;

export const OttoEstimatedCost = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    usd: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), usd: Schema.Null }),
]);

export type OttoEstimatedCost = typeof OttoEstimatedCost.Type;

export const OttoStepUsageSnapshot = Schema.Struct({
  botId: BotId,
  engine: BotEngine,
  tokens: Schema.NullOr(NonNegativeInt),
  estimatedCost: OttoEstimatedCost,
});

export type OttoStepUsageSnapshot = typeof OttoStepUsageSnapshot.Type;

export const OttoBotUsageSnapshot = Schema.Struct({
  ...OttoBotUsageSummary.fields,
  estimatedCost: OttoEstimatedCost,
  subscriptionPool: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("available"),
      used: NonNegativeInt,
      limit: NonNegativeInt,
      unit: TrimmedNonEmptyString,
    }),
    Schema.Struct({
      status: Schema.Literal("unavailable"),
      used: Schema.Null,
      limit: Schema.Null,
      unit: Schema.Null,
    }),
  ]),
});

export type OttoBotUsageSnapshot = typeof OttoBotUsageSnapshot.Type;

export class OttoBotUsageReadError extends Schema.TaggedErrorClass<OttoBotUsageReadError>()(
  "OttoBotUsageReadError",
  { botId: BotId, detail: TrimmedNonEmptyString },
) {}
