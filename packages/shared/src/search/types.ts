/** What callers (including the renderer) see of workspace search; no database imports here. */
import type { LibraryItemType } from '../library/types.ts'
import type { TaskStatus } from '../tasks/types.ts'

/** The kinds of result, in the order they are listed. */
export const SEARCH_KINDS = ['chat', 'task', 'project', 'library', 'comment'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

/** One result. `snippet` is the text around the match when it is not the title (a message, a description, a comment). */
export type SearchHit =
  | { kind: 'chat'; id: string; title: string | null; snippet: string; matchCount: number }
  | { kind: 'task'; id: string; title: string; status: TaskStatus; projectId: string; snippet?: string }
  | { kind: 'project'; id: string; title: string; snippet?: string }
  | { kind: 'library'; id: string; title: string; type: LibraryItemType; parentId: string | null }
  /** `entity` is the `task:<id>` or `project:<id>` the comment is on, `title` that entity's. */
  | { kind: 'comment'; id: string; entity: string; title: string; snippet: string }
