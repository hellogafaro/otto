/** What callers (including the renderer) see of notifications; no database imports here. */

/** The verb of the sentence "`createdBy` <type> you on `entity`"; open, see `NOTIFICATION_TYPES`. */
export type NotificationType = 'mention' | 'assigned'

/** Timestamps are epoch milliseconds so a row survives JSON as is. */
export type Notification = {
  id: string
  type: NotificationType
  /** When it was read; null = unread. */
  readAt: number | null
  createdAt: number
  /** Who did it: 'user:<id>' or 'agent:<id>'. */
  createdBy: string
  /** What it is about: `task:<id>`, or `comment:<id>` for a mention (the comment holds the text and its own entity). */
  entity: string
}

/**
 * What the inbox RPC returns. `entityTitle` is the title of what the notification is about (for a mention, the
 * title of the comment's own entity), null when that is gone. `comment` is set when `entity` is a comment; a
 * click opens `comment.entity`, else `entity`.
 */
export type NotificationItem = Notification & {
  entityTitle: string | null
  comment: { id: string; content: string; entity: string } | null
}
