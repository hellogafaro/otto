import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Per-bot switches: the skills a bot leaves off, and each connected account's per-bot
 * choices that differ from its default (a team account off for one bot, or a personal
 * account its owner lends to a bot they don't own).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_bots ADD COLUMN disabled_skill_ids_json TEXT NOT NULL DEFAULT '[]'`;
  yield* sql`ALTER TABLE composio_accounts ADD COLUMN bot_access_json TEXT NOT NULL DEFAULT '{}'`;
});
