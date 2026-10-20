import {
  type Actor,
  ActivityEntry,
  ActivityFileIds,
  type ActivityEntityType,
  ActivityRequestError,
  TaskChanges,
  TaskTimeDuration,
} from "@otto/contracts";
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
  personId: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  commentId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
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
  readonly updated_at: string | null;
}

const ROW_COLUMNS =
  "id, entity_type, entity_id, type, actor_type, actor_id, content, data_json, created_at, updated_at";

const decodeEntry = Schema.decodeUnknownOption(ActivityEntry);

const fail = (detail: string) => Effect.fail(new ActivityRequestError({ detail }));

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

/** A row as its timeline entry; an edit's row keeps the text it replaced in `content`. */
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
    ...(row.type === "comment_updated" ? { previousContent: row.content } : {}),
    ...(row.type === "comment" && row.updated_at !== null ? { updatedAt: row.updated_at } : {}),
    createdAt: row.created_at,
  });

const queryFailed = (detail: string) => Effect.mapError(() => new ActivityRequestError({ detail }));

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
      SELECT ${sql.literal(ROW_COLUMNS)}, deleted_at
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
      SELECT ${sql.literal(ROW_COLUMNS)}
      FROM activity
      WHERE entity_type = ${entity.entityType} AND entity_id = ${entity.entityId}
        AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `.pipe(queryFailed("Could not load the activity."));

    return { entries: rows.flatMap((row) => Option.toArray(toEntry(row))) };
  });

  /** One comment as its timeline shows it. */
  const getComment = Effect.fn("ActivityStore.getComment")(function* (id: string) {
    return yield* requireEntry(yield* readComment(id));
  });

  /**
   * One page of a task's comments, newest or oldest first, after the sort key `after` (the
   * creation time, then the id), with one more than `limit` when another page follows, and the
   * count of every comment on the task.
   */
  const listComments = Effect.fn("ActivityStore.listComments")(function* (input: {
    readonly taskId: string;
    readonly order: "newest" | "oldest";
    readonly limit: number;
    readonly after: readonly [string, string] | null;
  }) {
    const direction = sql.literal(input.order === "newest" ? "DESC" : "ASC");
    const comparison = sql.literal(input.order === "newest" ? "<" : ">");

    const after =
      input.after === null
        ? sql`1 = 1`
        : sql`(created_at ${comparison} ${input.after[0]} OR (created_at = ${input.after[0]} AND id ${comparison} ${input.after[1]}))`;

    const rows = yield* sql<StoredActivityRow>`
      SELECT ${sql.literal(ROW_COLUMNS)}
      FROM activity
      WHERE entity_type = 'task' AND entity_id = ${input.taskId} AND type = 'comment'
        AND deleted_at IS NULL AND ${after}
      ORDER BY created_at ${direction}, id ${direction}
      LIMIT ${input.limit + 1}
    `.pipe(queryFailed("Could not load the comments."));

    const [count] = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM activity
      WHERE entity_type = 'task' AND entity_id = ${input.taskId} AND type = 'comment'
        AND deleted_at IS NULL
    `.pipe(queryFailed("Could not count the comments."));

    return {
      rows: rows.flatMap((row) =>
        Option.toArray(toEntry(row)).map((entry) => ({
          entry,
          key: [row.created_at, row.id] as const,
        })),
      ),
      total: count?.count ?? 0,
    };
  });

  return { list, getComment, listComments };
});

/** Reads timelines and comments; the projector writes them from task events. */
export class ActivityStore extends Context.Service<
  ActivityStore,
  Effect.Success<typeof makeActivityStore>
>()("@otto/server/activity/activity-store/ActivityStore") {}

export const ActivityStoreLive = Layer.effect(ActivityStore, makeActivityStore);
