import {
  type AuthSessionId,
  Notification,
  type NotificationListResult,
  NotificationRequestError,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** One notification as written: who it is for and what it says. */
export type NotificationRow = Omit<Notification, "readAt"> & { readonly personId: string };

interface StoredNotificationRow {
  readonly id: string;
  readonly type: string;
  readonly actor_type: string | null;
  readonly actor_id: string | null;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly created_at: string;
  readonly read_at: string | null;
}

const decodeNotification = Schema.decodeUnknownOption(Notification);

/** How many a person's list shows; older ones stay stored but out of sight. */
const LIST_LIMIT = 50;

const queryFailed = (detail: string) =>
  Effect.mapError(() => new NotificationRequestError({ detail }));

const makeNotificationStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /** Records a notification once; the same id again changes nothing. */
  const insert = (row: NotificationRow) =>
    sql`
      INSERT INTO notifications (
        id, person_id, type, actor_type, actor_id, entity_type, entity_id, title, excerpt,
        created_at
      ) VALUES (
        ${row.id}, ${row.personId}, ${row.type}, ${row.actor?.type ?? null},
        ${row.actor?.id ?? null}, ${row.entityType}, ${row.entityId}, ${row.title},
        ${row.excerpt}, ${row.createdAt}
      )
      ON CONFLICT (id) DO NOTHING
    `.pipe(queryFailed("Could not save the notification."), Effect.asVoid);

  /** A person's latest notifications, newest first, and how many they haven't read. */
  const list = Effect.fn("NotificationStore.list")(function* (personId: AuthSessionId) {
    const rows = yield* sql<StoredNotificationRow>`
      SELECT id, type, actor_type, actor_id, entity_type, entity_id, title, excerpt, created_at,
        read_at
      FROM notifications
      WHERE person_id = ${personId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${LIST_LIMIT}
    `.pipe(queryFailed("Could not load your notifications."));

    const [count] = yield* sql<{ readonly unread: number }>`
      SELECT COUNT(*) AS unread FROM notifications
      WHERE person_id = ${personId} AND read_at IS NULL
    `.pipe(queryFailed("Could not load your notifications."));

    const notifications = rows.flatMap((row) =>
      Option.toArray(
        decodeNotification({
          id: row.id,
          type: row.type,
          actor:
            row.actor_type === null || row.actor_id === null
              ? null
              : { type: row.actor_type, id: row.actor_id },
          entityType: row.entity_type,
          entityId: row.entity_id,
          title: row.title,
          excerpt: row.excerpt,
          createdAt: row.created_at,
          readAt: row.read_at,
        }),
      ),
    );

    return { notifications, unread: Number(count?.unread ?? 0) } satisfies Schema.Schema.Type<
      typeof NotificationListResult
    >;
  });

  /** Marks a person's notifications read: these ids, or all of them. */
  const markRead = Effect.fn("NotificationStore.markRead")(function* (input: {
    readonly personId: AuthSessionId;
    readonly ids?: ReadonlyArray<string> | undefined;
  }) {
    const readAt = DateTime.formatIso(yield* DateTime.now);

    yield* (
      input.ids === undefined
        ? sql`
            UPDATE notifications SET read_at = ${readAt}
            WHERE person_id = ${input.personId} AND read_at IS NULL
          `
        : input.ids.length === 0
          ? Effect.void
          : sql`
              UPDATE notifications SET read_at = ${readAt}
              WHERE person_id = ${input.personId} AND read_at IS NULL
                AND ${sql.in("id", input.ids)}
            `
    ).pipe(queryFailed("Could not mark your notifications read."));
  });

  return { insert, list, markRead };
});

/** Each person's notifications: the reactor writes them, the person reads and clears them. */
export class NotificationStore extends Context.Service<
  NotificationStore,
  Effect.Success<typeof makeNotificationStore>
>()("@otto/server/notifications/notification-store/NotificationStore") {}

export const NotificationStoreLive = Layer.effect(NotificationStore, makeNotificationStore);
