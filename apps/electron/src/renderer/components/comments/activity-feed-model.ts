/**
 * The Activity feed's layout, pure so its rules are tested without React: which items run together as one block
 * of quiet event lines, where the next page starts and how it joins what is shown.
 */

import type { ActivityEvent, Comment } from '../../../shared/types'

export type ActivityBlock =
  | { type: 'comment'; key: string; comment: Comment }
  | { type: 'events'; key: string; events: Comment[] }

/**
 * The shown items as blocks, oldest first: each comment alone, consecutive events together (one run of lines,
 * set closer than the blocks). An event row without a readable `event` is left out and does not split a run.
 */
export function layoutActivity(items: readonly Comment[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = []
  for (const item of items) {
    if (item.type === 'comment') {
      blocks.push({ type: 'comment', key: item.id, comment: item })
      continue
    }
    if (!item.event) continue
    const last = blocks[blocks.length - 1]
    if (last?.type === 'events') last.events.push(item)
    else blocks.push({ type: 'events', key: item.id, events: [item] })
  }
  return blocks
}

/** The id the next (earlier) page is read before: the oldest stored row; the synthesized `created-` event is none. */
export const earlierAnchor = (items: readonly Comment[]): string | undefined =>
  items.find((item) => !item.id.startsWith('created-'))?.id

/** An earlier page put before what is shown; a row already shown (a reload moved the boundary) stays once, where it is. */
export function prependPage(shown: readonly Comment[], page: readonly Comment[]): Comment[] {
  const ids = new Set(shown.map((item) => item.id))
  return [...page.filter((item) => !ids.has(item.id)), ...shown]
}

/** Who an assignees event added and who it removed. */
export function assigneeChange(event: Extract<ActivityEvent, { kind: 'assignees' }>): { added: string[]; removed: string[] } {
  return {
    added: event.to.filter((actor) => !event.from.includes(actor)),
    removed: event.from.filter((actor) => !event.to.includes(actor)),
  }
}
