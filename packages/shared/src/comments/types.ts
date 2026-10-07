/** What callers (including the renderer) see of comments and activity events; no database imports here. */
import type { Resource } from '../projects/types.ts'

/** A row is a comment someone wrote or an activity event a domain wrote. */
export type CommentType = 'comment' | 'event'

/** What happened to a task. Due dates are epoch milliseconds or null, `time` is milliseconds logged. */
export type ActivityEvent =
  | { kind: 'created' }
  | { kind: 'status'; from: string; to: string }
  | { kind: 'title'; from: string; to: string }
  | { kind: 'due'; from: number | null; to: number | null }
  | { kind: 'project'; from: string; to: string }
  | { kind: 'assignees'; from: string[]; to: string[] }
  | { kind: 'links'; added: Resource[]; removed: Resource[] }
  | { kind: 'time'; time: number }

/** Timestamps are epoch milliseconds so a row survives JSON as is. */
export type Comment = {
  id: string
  /** What it is on: a typed reference such as `task:<id>` or `project:<id>`. */
  entity: string
  type: CommentType
  /** 'user:<id>' or 'agent:<id>'. */
  createdBy: string
  /** Markdown for a comment (a mention is the token `user:<id>`); the event JSON for an event. */
  content: string
  /** The parsed event, only when `type` is 'event'. */
  event?: ActivityEvent
  createdAt: number
  updatedAt: number
}

/** A page of an entity's comments and events, oldest first; `more` = there are older rows, `earlier` = how many. */
export type CommentPage = { items: Comment[]; more: boolean; earlier: number }
