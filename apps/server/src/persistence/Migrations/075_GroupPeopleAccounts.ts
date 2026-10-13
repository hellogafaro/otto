import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Group people used to be sign-in sessions, so one account showed up as many people.
 * Rewrites every session id that belongs to an account to that account's user id, in the
 * events that carry people and in the projections built from them.
 */
const MembersJson = Schema.fromJsonString(
  Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
);

const decodeMembers = Schema.decodeEffect(MembersJson);

const encodeMembers = Schema.encodeEffect(MembersJson);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('auth_sessions', 'users')
  `;

  if (tables.length < 2) return;

  const sessions = yield* sql<{ readonly sessionId: string; readonly userId: string }>`
    SELECT s.session_id AS "sessionId", s.subject AS "userId"
    FROM auth_sessions s
    JOIN users u ON u.id = s.subject
    WHERE s.session_id <> s.subject
  `;

  for (const { sessionId, userId } of sessions) {
    const pattern = `%${sessionId}%`;

    yield* sql`
      UPDATE orchestration_events
      SET payload_json = REPLACE(payload_json, ${sessionId}, ${userId})
      WHERE event_type IN (
        'group.created', 'group.person-assigned', 'group.person-unassigned',
        'thread.message-sent', 'thread.turn-start-requested'
      ) AND payload_json LIKE ${pattern}
    `;
    yield* sql`
      UPDATE projection_groups
      SET members_json = REPLACE(members_json, ${sessionId}, ${userId})
      WHERE members_json LIKE ${pattern}
    `;
    yield* sql`
      UPDATE projection_thread_messages
      SET author_person_id = ${userId}
      WHERE author_person_id = ${sessionId}
    `;
  }

  // Two sessions of one account in a group are now the same person, listed once.
  const groups = yield* sql<{ readonly groupId: string; readonly members: string }>`
    SELECT group_id AS "groupId", members_json AS "members" FROM projection_groups
  `;

  for (const group of groups) {
    const members = yield* decodeMembers(group.members);

    const unique = members.filter(
      (member, index) =>
        member.kind !== "person" ||
        members.findIndex(
          (other) => other.kind === "person" && other.personId === member.personId,
        ) === index,
    );

    if (unique.length === members.length) continue;
    yield* sql`
      UPDATE projection_groups SET members_json = ${yield* encodeMembers(unique)}
      WHERE group_id = ${group.groupId}
    `;
  }
});
