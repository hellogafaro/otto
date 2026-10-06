/** What callers (including the renderer) see of comments; no database imports here. */

/** Timestamps are epoch milliseconds so a row survives JSON as is. */
export type Comment = {
  id: string
  /** What it is on: a typed reference such as `task:<id>` or `project:<id>`. */
  entity: string
  /** 'user:<id>' or 'agent:<id>'. */
  createdBy: string
  /** Markdown; a mention is the token `user:<id>`. */
  content: string
  createdAt: number
  updatedAt: number
}
