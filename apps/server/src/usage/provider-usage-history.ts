import { OttoUsageEntry } from "@otto/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  type PersistenceDecodeError,
  PersistenceSqlError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../persistence/errors.ts";

export interface ProviderUsageWindow {
  readonly sinceAt: string;
  readonly untilAt: string;
}

/**
 * Who a ledger entry's work belongs to: the author of the message its turn answered, else the
 * person who started the chat. Routines and other chats no person started belong to no one.
 */
export interface UsagePerson {
  readonly id: string;
  readonly displayName: string | null;
}

export interface ReportedUsage {
  readonly entry: OttoUsageEntry;
  readonly person: UsagePerson | null;
}

export class ProviderUsageHistory extends Context.Service<
  ProviderUsageHistory,
  {
    readonly readReported: (
      window: ProviderUsageWindow,
    ) => Effect.Effect<ReadonlyArray<ReportedUsage>, PersistenceSqlError | PersistenceDecodeError>;
  }
>()("@otto/server/usage/provider-usage-history/ProviderUsageHistory") {}

const UsageRow = Schema.Struct({
  reservationId: Schema.String,
  sourceKey: Schema.String,
  botId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  category: Schema.String,
  state: Schema.String,
  reservedTokens: Schema.Number,
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  reasoningTokens: Schema.NullOr(Schema.Number),
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  unavailableReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  settledAt: Schema.NullOr(Schema.String),
  personId: Schema.NullOr(Schema.String),
  personName: Schema.NullOr(Schema.String),
});

type UsageRow = typeof UsageRow.Type;

const decodeUsageEntry = Schema.decodeUnknownEffect(OttoUsageEntry);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readReported = Effect.fn("ProviderUsageHistory.readReported")(function* (
    window: ProviderUsageWindow,
  ) {
    const rows = yield* sql<UsageRow>`
      SELECT
        e.reservation_id AS "reservationId", e.source_key AS "sourceKey", e.bot_id AS "botId",
        e.thread_id AS "threadId", e.turn_id AS "turnId", e.category, e.state,
        e.reserved_tokens AS "reservedTokens", e.input_tokens AS "inputTokens",
        e.output_tokens AS "outputTokens", e.reasoning_tokens AS "reasoningTokens",
        e.provider, e.model, e.unavailable_reason AS "unavailableReason",
        e.created_at AS "createdAt", e.settled_at AS "settledAt",
        COALESCE(m.author_person_id, c.created_by) AS "personId",
        m.author_display_name AS "personName"
      FROM otto_bot_usage_entries e
      LEFT JOIN projection_turns t ON t.thread_id = e.thread_id AND t.turn_id = e.turn_id
      LEFT JOIN projection_thread_messages m ON m.message_id = t.pending_message_id
      LEFT JOIN projection_threads c ON c.thread_id = e.thread_id
      WHERE e.state = 'reported'
        AND e.provider IS NOT NULL
        AND e.model IS NOT NULL
        AND e.created_at >= ${window.sinceAt}
        AND e.created_at < ${window.untilAt}
      ORDER BY e.created_at ASC, e.reservation_id ASC
    `.pipe(Effect.mapError(toPersistenceSqlError("ProviderUsageHistory.readReported")));

    return yield* Effect.forEach(rows, ({ personId, personName, ...row }) =>
      decodeUsageEntry(row).pipe(
        Effect.map(
          (entry): ReportedUsage => ({
            entry,
            person: personId === null ? null : { id: personId, displayName: personName },
          }),
        ),
        Effect.mapError(toPersistenceDecodeError("ProviderUsageHistory.readReported")),
      ),
    );
  });

  return ProviderUsageHistory.of({ readReported });
});

export const layer = Layer.effect(ProviderUsageHistory, make);
