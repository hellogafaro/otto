import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "../base-schemas.ts";
import { Actor } from "./work.ts";

/**
 * Otto: Why a person hears about something: a task given to them, a comment that mentions them,
 * answers them or lands on their task, or a chat message that mentions them.
 */
export const NotificationType = Schema.Literals([
  "assigned",
  "owner",
  "mention",
  "reply",
  "comment",
  "chat_mention",
]);
export type NotificationType = typeof NotificationType.Type;

export const NotificationId = TrimmedNonEmptyString.check(Schema.isMaxLength(100));

export const Notification = Schema.Struct({
  id: NotificationId,
  type: NotificationType,
  /** Who did it; null when nobody is known. */
  actor: Schema.NullOr(Actor),
  entityType: Schema.Literals(["task", "chat"]),
  entityId: TrimmedNonEmptyString,
  /** The task or chat title when it happened. */
  title: TrimmedString,
  /** The comment or message, as plain text, cut short. */
  excerpt: TrimmedString,
  createdAt: IsoDateTime,
  readAt: Schema.NullOr(IsoDateTime),
});
export type Notification = typeof Notification.Type;

export const NotificationListResult = Schema.Struct({
  notifications: Schema.Array(Notification),
  unread: Schema.Number,
});

/** Marks these notifications read, or every one when `ids` is left out. */
export const NotificationMarkReadInput = Schema.Struct({
  ids: Schema.optional(Schema.Array(NotificationId).check(Schema.isMaxLength(100))),
});

export class NotificationRequestError extends Schema.TaggedErrorClass<NotificationRequestError>()(
  "NotificationRequestError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
