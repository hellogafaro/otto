/**
 * The transcript's layout, as Slack lays out a channel (DESIGN.md, Chats > One chat): who wrote each turn,
 * which turns open a group (avatar, name and time) and where the day and "New messages" dividers go. Pure, so
 * the rules are tested without React.
 */

import type { Turn } from '@otto/ui'
import { actorColorIndex } from '../../lib/actors'

/** Consecutive turns by one author within this window form one group under one header. */
export const GROUP_WINDOW_MS = 5 * 60_000

/**
 * Who wrote a turn: a user message's `sender`, an agent turn's `author`. Rows from before multiplayer have
 * neither and fall back (a user message to the chat's creator, an agent turn to the chat's agent). System rows
 * (info, error, warning) and auth requests have no author: they sit in the text column without a header.
 */
export function turnActor(turn: Turn, fallback: { user: string | null; agent: string | null }): string | null {
  if (turn.type === 'user') return turn.message.sender ?? fallback.user
  if (turn.type === 'assistant') return turn.author ?? fallback.agent
  return null
}

/** The class of an author's name: the plain text color for the viewer's own ("You"), else the actor's stable palette color. */
export function authorNameClass(actor: string, me: string | null, palette: readonly string[]): string {
  return actor === me ? 'text-foreground' : palette[actorColorIndex(actor, palette.length)]
}

/** The ids of the messages a turn shows. */
function turnMessageIds(turn: Turn): string[] {
  if (turn.type !== 'assistant') return [turn.message.id]
  const ids = turn.activities.map((activity) => activity.messageId ?? activity.id)
  if (turn.response?.messageId) ids.push(turn.response.messageId)
  return ids
}

/**
 * The index of the turn the "New messages" divider goes above: the first turn after the one holding the
 * viewer's last read message that someone else wrote (your own messages are read). -1 when there is no marker,
 * it is not among the loaded turns, or nothing newer came from anyone else.
 */
export function firstUnreadTurn(turns: readonly Turn[], lastReadMessageId: string | undefined, isMine: (turn: Turn) => boolean): number {
  if (!lastReadMessageId) return -1
  const read = turns.findIndex((turn) => turnMessageIds(turn).includes(lastReadMessageId))
  if (read === -1) return -1
  for (let index = read + 1; index < turns.length; index++) {
    if (!isMine(turns[index])) return index
  }
  return -1
}

export type TranscriptEntry =
  | { type: 'day'; key: string; at: number }
  | { type: 'unread'; key: 'unread' }
  | { type: 'turn'; turn: Turn; index: number; actor: string | null; header: boolean }

const dayKey = (at: number) => new Date(at).toDateString()

/**
 * The entries of the shown turns: a day divider above the first turn and wherever the day changes, the unread
 * divider above `unreadIndex` (an index in `turns`), and each turn with its author and whether it opens a group.
 * A turn opens a group unless the turn before it is by the same author, less than five minutes earlier, with no
 * divider or system row between them.
 */
export function layoutTranscript(
  turns: readonly Turn[],
  { actorOf, unreadIndex = -1 }: { actorOf: (turn: Turn) => string | null; unreadIndex?: number },
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  let previous: { actor: string | null; at: number } | null = null
  let day = ''
  turns.forEach((turn, index) => {
    const at = turn.timestamp
    if (dayKey(at) !== day) {
      day = dayKey(at)
      entries.push({ type: 'day', key: `day-${day}`, at })
      previous = null
    }
    if (index === unreadIndex) {
      entries.push({ type: 'unread', key: 'unread' })
      previous = null
    }
    const actor = actorOf(turn)
    const continues: boolean = !!previous && actor !== null && previous.actor === actor && at - previous.at < GROUP_WINDOW_MS
    entries.push({ type: 'turn', turn, index, actor, header: actor !== null && !continues })
    previous = { actor, at }
  })
  return entries
}

/** A day divider's label: Today, Yesterday, else the weekday and date (with the year when it is not this year). */
export function dayLabel(at: number, now: number, language: string, labels: { today: string; yesterday: string }): string {
  const date = new Date(at)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return labels.today
  today.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return labels.yesterday
  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date)
}
