import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("075_GroupPeopleAccounts", (it) => {
  it.effect("turns each account's sign-in sessions into one person", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 74 });
      yield* sql`CREATE TABLE users (id TEXT PRIMARY KEY)`;
      yield* sql`INSERT INTO users (id) VALUES ('user-ana')`;
      yield* sql`
        INSERT INTO auth_sessions (
          session_id, subject, scopes, method, client_label, client_device_type, issued_at, expires_at
        ) VALUES
          ('session-1', 'user-ana', '[]', 'browser-session-cookie', 'Ana', 'unknown', '2026-10-01', '2026-11-01'),
          ('session-2', 'user-ana', '[]', 'browser-session-cookie', 'Ana', 'unknown', '2026-10-02', '2026-11-01'),
          ('paired', 'one-time-token', '[]', 'browser-session-cookie', 'Ben', 'unknown', '2026-10-02', '2026-11-01')
      `;

      const members = JSON.stringify([
        { kind: "bot", botId: "bot-1", role: "boss" },
        { kind: "person", personId: "session-1", displayName: "Ana" },
        { kind: "person", personId: "session-2", displayName: "Ana" },
        { kind: "person", personId: "paired", displayName: "Ben" },
      ]);

      yield* sql`
        INSERT INTO projection_groups (group_id, name, boss_bot_id, members_json, created_at, updated_at)
        VALUES ('group-1', 'Mates', 'bot-1', ${members}, '2026-10-01', '2026-10-01')
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        ) VALUES (
          'event-1', 'thread', 'thread-1', 1, 'thread.message-sent', '2026-10-01',
          NULL, NULL, NULL, 'client', '{"authorPersonId":"session-2"}', '{}'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 75 });

      const [group] = yield* sql<{ readonly members: string }>`
        SELECT members_json AS "members" FROM projection_groups
      `;

      const [event] = yield* sql<{ readonly payload: string }>`
        SELECT payload_json AS "payload" FROM orchestration_events
      `;

      assert.deepEqual(
        JSON.parse(group?.members ?? "[]").map((member: { personId?: string }) => member.personId),
        [undefined, "user-ana", "paired"],
      );
      assert.equal(event?.payload, '{"authorPersonId":"user-ana"}');
    }),
  );
});
