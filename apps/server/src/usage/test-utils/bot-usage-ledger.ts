import { OttoUsageReservationId, BotId, ProviderDriverKind, ThreadId } from "@otto/contracts";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "../../persistence/layers/sqlite.ts";
import { BotUsageLedgerLive, type ReserveBotUsageInput } from "../bot-usage-ledger.ts";

const layer = BotUsageLedgerLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

const reserveInput = (
  reservationId: string,
  overrides: Partial<ReserveBotUsageInput> = {},
): ReserveBotUsageInput => ({
  reservationId: OttoUsageReservationId.make(reservationId),
  sourceKey: `turn-start:${reservationId}`,
  botId: BotId.make("bot-1"),
  threadId: ThreadId.make("thread-1"),
  turnId: null,
  category: "turn",
  maximumTokens: 1_000,
  provider: ProviderDriverKind.make("codex"),
  model: "gpt-5.6-sol",
  createdAt: "2026-08-30T20:00:00.000Z",
  ...overrides,
});

export { layer, reserveInput };
