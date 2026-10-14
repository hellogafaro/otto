import * as NodeCrypto from "node:crypto";
import {
  type Actor,
  ActivityEntry,
  ActivityFileIds,
  type ActivityEntityType,
  ActivityRequestError,
  type AuthSessionId,
  type LibraryFileId,
  TaskChanges,
  TaskTimeDuration,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** What `data_json` holds: the fields only some row types have. */
const ActivityRowData = Schema.Struct({
  fileIds: Schema.optional(ActivityFileIds),
  changes: Schema.optional(TaskChanges),
  duration: Schema.optional(TaskTimeDuration),
  description: Schema.optional(Schema.String),
});

const decodeRowData = Schema.decodeUnknownOption(Schema.fromJsonString(ActivityRowData));

/** One `activity` row as written. */
export interface ActivityRow {
  readonly id: string;
  readonly entityType: ActivityEntityType;
  readonly entityId: string;
  readonly type: ActivityEntry["type"];
  readonly actor: Actor | null;
  readonly content: string;
  readonly data: typeof ActivityRowData.Type;
  readonly createdAt: string;
}

interface StoredActivityRow {
  readonly id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly type: string;
  readonly actor_type: string | null;
  readonly actor_id: string | null;
  readonly content: string;
  readonly data_json: string;
  readonly created_at: string;
}

const decodeEntry = Schema.decodeUnknownOption(ActivityEntry);

const fail = (detail: string) => Effect.fail(new ActivityRequestError({ detail }));

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/** Records a row once; replaying the same row changes nothing. */
export const insertActivityRow = (sql: SqlClient.SqlClient, row: ActivityRow) =>
  sql`
    INSERT INTO activity (
      id, entity_type, entity_id, type, actor_type, actor_id, content, data_json, created_at
    ) VALUES (
      ${row.id}, ${row.entityType}, ${row.entityId}, ${row.type}, ${row.actor?.type ?? null},
      ${row.actor?.id ?? null}, ${row.content}, ${JSON.stringify(row.data)}, ${row.createdAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;

const toEntry = (row: StoredActivityRow) =>
  decodeEntry({
    ...Option.getOrElse(decodeRowData(row.data_json), () => ({})),
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    type: row.type,
    actor:
      row.actor_type === null || row.actor_id === null
        ? null
        : { type: row.actor_type, id: row.actor_id },
    content: row.content,
    createdAt: row.created_at,
  });

const queryFailed = (detail: string) => Effect.mapError(() => new ActivityRequestError({ detail }));

const requireAuthor = (row: StoredActivityRow, personId: AuthSessionId) =>
  row.actor_type === "person" && row.actor_id === personId
    ? Effect.void
    : fail("Only the person who wrote this comment can change it.");

const requireEntry = (row: StoredActivityRow) =>
  Option.match(toEntry(row), {
    onNone: () => fail("That comment is damaged."),
    onSome: Effect.succeed,
  });

interface ActivityEntity {
  readonly entityType: ActivityEntityType;
  readonly entityId: string;
}

const makeActivityStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readComment = Effect.fn("ActivityStore.readComment")(function* (id: string) {
    const [row] = yield* sql<StoredActivityRow & { readonly deleted_at: string | null }>`
      SELECT id, entity_type, entity_id, type, actor_type, actor_id, content, data_json,
        created_at, deleted_at
      FROM activity
      WHERE id = ${id}
    `.pipe(queryFailed("Could not load the comment."));

    if (row === undefined || row.type !== "comment" || row.deleted_at !== null) {
      return yield* fail("That comment doesn't exist.");
    }

    return row;
  });

  /** An entity's timeline, oldest first, without deleted comments. */
  const list = Effect.fn("ActivityStore.list")(function* (entity: ActivityEntity) {
    const rows = yield* sql<StoredActivityRow>`
      SELECT id, entity_type, entity_id, type, actor_type, actor_id, content, data_json,
        created_at
      FROM activity
      WHERE entity_type = ${entity.entityType} AND entity_id = ${entity.entityId}
        AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `.pipe(queryFailed("Could not load the activity."));

    return { entries: rows.flatMap((row) => Option.toArray(toEntry(row))) };
  });

  /** Adds a comment by this person to an existing entity. */
  const addComment = Effect.fn("ActivityStore.addComment")(function* (
    input: ActivityEntity & {
      readonly content: string;
      readonly fileIds: ReadonlyArray<LibraryFileId>;
      readonly personId: AuthSessionId;
    },
  ) {
    const [task] = yield* sql<{ readonly task_id: string }>`
      SELECT task_id FROM projection_tasks WHERE task_id = ${input.entityId}
    `.pipe(queryFailed("Could not load the task."));

    if (task === undefined) return yield* fail("That task doesn't exist.");

    if (input.content.length === 0 && input.fileIds.length === 0) {
      return yield* fail("A comment needs text or a file.");
    }

    const row: ActivityRow = {
      id: NodeCrypto.randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      type: "comment",
      actor: { type: "person", id: input.personId },
      content: input.content,
      data: { fileIds: input.fileIds },
      createdAt: yield* nowIso,
    };

    yield* insertActivityRow(sql, row).pipe(queryFailed("Could not save the comment."));

    return yield* requireEntry(yield* readComment(row.id));
  });

  /** Hides a comment this person wrote; the row stays for the record. */
  const removeComment = Effect.fn("ActivityStore.removeComment")(function* (input: {
    readonly id: string;
    readonly personId: AuthSessionId;
  }) {
    yield* requireAuthor(yield* readComment(input.id), input.personId);

    yield* sql`
      UPDATE activity SET deleted_at = ${yield* nowIso} WHERE id = ${input.id}
    `.pipe(queryFailed("Could not delete the comment."));
  });

  return { list, addComment, removeComment };
});

/** Reads timelines and keeps people's comments; task events are written by the projector. */
export class ActivityStore extends Context.Service<
  ActivityStore,
  Effect.Success<typeof makeActivityStore>
>()("@otto/server/activity/ActivityStore") {}

export const ActivityStoreLive = Layer.effect(ActivityStore, makeActivityStore);
