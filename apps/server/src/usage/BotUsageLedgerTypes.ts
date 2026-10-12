import {
  OttoBotUsageSummary,
  OttoUsageEntry,
  type OttoUsageCategory,
  type OttoUsageReservationId,
  type BotId,
  type ProviderDriverKind,
  type ThreadId,
  type TurnId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import { type PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";

export const OTTO_TURN_USAGE_RESERVATION_TOKENS = 32_000;

export interface ReserveBotUsageInput {
  readonly reservationId: OttoUsageReservationId;
  readonly sourceKey: string;
  readonly botId: BotId;
  readonly threadId: ThreadId | null;
  readonly turnId: TurnId | null;
  readonly category: OttoUsageCategory;
  readonly maximumTokens: number;
  readonly provider: ProviderDriverKind | null;
  readonly model: string | null;
  readonly createdAt: string;
}

export type SettleBotUsageDetails =
  | {
      readonly state: "reported";
      readonly inputTokens: number;
      readonly cachedInputTokens?: number;
      readonly cacheCreationTokens?: number;
      readonly outputTokens: number;
      readonly reasoningTokens: number | null;
    }
  | { readonly state: "unavailable"; readonly reason: string }
  | { readonly state: "released" };

export type SettleBotUsageInput = SettleBotUsageDetails & {
  readonly reservationId: OttoUsageReservationId;
  readonly settledAt: string;
};

export type SettleBotUsageForTurnInput = SettleBotUsageDetails & {
  readonly botId: BotId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly settledAt: string;
};

export type BotUsageLedgerError = PersistenceSqlError | PersistenceDecodeError;

export interface BotUsageLedgerShape {
  readonly pricingTotals: (botId: BotId) => Effect.Effect<
    {
      readonly complete: boolean;
      readonly models: ReadonlyArray<{
        readonly model: string;
        readonly inputTokens: number;
        readonly cachedInputTokens: number;
        readonly cacheCreationTokens: number;
        readonly outputTokens: number;
        readonly reasoningTokens: number;
      }>;
    },
    BotUsageLedgerError
  >;
  readonly reserve: (
    input: ReserveBotUsageInput,
  ) => Effect.Effect<OttoUsageEntry, BotUsageLedgerError>;
  readonly settle: (
    input: SettleBotUsageInput,
  ) => Effect.Effect<OttoUsageEntry, BotUsageLedgerError>;
  readonly bindTurn: (input: {
    readonly reservationId: OttoUsageReservationId;
    readonly turnId: TurnId;
  }) => Effect.Effect<OttoUsageEntry, BotUsageLedgerError>;
  readonly settleForTurn: (
    input: SettleBotUsageForTurnInput,
  ) => Effect.Effect<ReadonlyArray<OttoUsageEntry>, BotUsageLedgerError>;
  readonly finalizeForTurn: (input: {
    readonly botId: BotId;
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly settledAt: string;
    readonly cancelled?: boolean;
  }) => Effect.Effect<ReadonlyArray<OttoUsageEntry>, BotUsageLedgerError>;
  readonly recordMeasurement: (input: {
    readonly reservationId: OttoUsageReservationId;
    readonly sourceKey: string;
    readonly botId: BotId;
    readonly threadId: ThreadId | null;
    readonly turnId: TurnId | null;
    readonly category: OttoUsageCategory;
    readonly inputTokens: number;
    readonly cachedInputTokens?: number;
    readonly cacheCreationTokens?: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number | null;
    readonly provider: ProviderDriverKind | null;
    readonly model: string | null;
    readonly includedInReservation?: boolean;
    readonly createdAt: string;
  }) => Effect.Effect<OttoUsageEntry, BotUsageLedgerError>;
  /** Records work that charges no tokens so a restart before it settles marks it interrupted. */
  readonly recordStart: (
    input: Omit<ReserveBotUsageInput, "maximumTokens">,
  ) => Effect.Effect<OttoUsageEntry, BotUsageLedgerError>;
  readonly summarize: (botId: BotId) => Effect.Effect<OttoBotUsageSummary, BotUsageLedgerError>;
}
