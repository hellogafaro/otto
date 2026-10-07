import { describe, expect, it } from 'bun:test'
import type { Turn } from '@otto/ui'
import { actorColorIndex } from '../../../lib/actors'
import { GROUP_WINDOW_MS, authorNameClass, dayLabel, firstUnreadTurn, layoutTranscript, turnActor } from '../chat-transcript'

const MIN = 60_000
const base = new Date(2026, 9, 7, 10, 0).getTime()

const user = (id: string, at: number, sender?: string): Turn =>
  ({ type: 'user', timestamp: at, message: { id, role: 'user', content: id, timestamp: at, sender } }) as Turn
const agent = (id: string, at: number, author?: string): Turn =>
  ({ type: 'assistant', turnId: id, activities: [], response: { text: id, isStreaming: false, messageId: id }, isStreaming: false, isComplete: true, timestamp: at, author }) as Turn
const system = (id: string, at: number): Turn =>
  ({ type: 'system', timestamp: at, message: { id, role: 'error', content: id, timestamp: at } }) as Turn

const fallback = { user: 'user:owner', agent: 'agent:writer' }
const actorOf = (turn: Turn) => turnActor(turn, fallback)
const summary = (turns: Turn[], unreadIndex?: number) =>
  layoutTranscript(turns, { actorOf, unreadIndex }).map((entry) =>
    entry.type === 'turn' ? `${entry.actor ?? '-'}${entry.header ? '*' : ''}` : entry.type)

describe('chat transcript', () => {
  it('reads authors, falling back for rows from before multiplayer', () => {
    expect(actorOf(user('u', base, 'user:ada'))).toBe('user:ada')
    expect(actorOf(user('u', base))).toBe('user:owner')
    expect(actorOf(agent('a', base, 'agent:editor'))).toBe('agent:editor')
    expect(actorOf(agent('a', base))).toBe('agent:writer')
    expect(actorOf(system('s', base))).toBeNull()
  })

  it('groups consecutive turns by one author within five minutes', () => {
    expect(summary([
      user('u1', base, 'user:ada'),
      user('u2', base + MIN, 'user:ada'),
      user('u3', base + 2 * MIN, 'user:bob'),
      agent('a1', base + 3 * MIN, 'agent:writer'),
      agent('a2', base + 4 * MIN, 'agent:writer'),
      agent('a3', base + 5 * MIN, 'agent:editor'),
      user('u4', base + 6 * MIN, 'user:ada'),
      user('u5', base + 6 * MIN + GROUP_WINDOW_MS, 'user:ada'),
    ])).toEqual(['day', 'user:ada*', 'user:ada', 'user:bob*', 'agent:writer*', 'agent:writer', 'agent:editor*', 'user:ada*', 'user:ada*'])
  })

  it('starts a group again after a system row and the unread divider', () => {
    expect(summary([
      agent('a1', base, 'agent:writer'),
      system('e1', base + MIN),
      agent('a2', base + 2 * MIN, 'agent:writer'),
      agent('a3', base + 3 * MIN, 'agent:writer'),
    ], 3)).toEqual(['day', 'agent:writer*', '-', 'agent:writer*', 'unread', 'agent:writer*'])
  })

  it('puts a day divider above the first turn and at each new day, and breaks the group there', () => {
    const late = new Date(2026, 9, 6, 23, 58).getTime()
    expect(summary([user('u1', late, 'user:ada'), user('u2', late + 3 * MIN, 'user:ada')]))
      .toEqual(['day', 'user:ada*', 'day', 'user:ada*'])
  })

  it('labels days Today, Yesterday, then the weekday and date', () => {
    const labels = { today: 'Today', yesterday: 'Yesterday' }
    const now = new Date(2026, 9, 7, 12).getTime()
    expect(dayLabel(new Date(2026, 9, 7, 1).getTime(), now, 'en', labels)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 6, 23).getTime(), now, 'en', labels)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 5, 9).getTime(), now, 'en', labels)).toBe('Monday, October 5')
    expect(dayLabel(new Date(2025, 11, 31, 9).getTime(), now, 'en', labels)).toBe('Wednesday, December 31, 2025')
  })

  it('places the unread divider after the last read message, skipping your own', () => {
    const turns = [user('u1', base, 'user:me'), agent('a1', base + MIN), user('u2', base + 2 * MIN, 'user:me'), user('u3', base + 3 * MIN, 'user:ada')]
    const isMine = (turn: Turn) => actorOf(turn) === 'user:me'
    expect(firstUnreadTurn(turns, 'a1', isMine)).toBe(3)
    expect(firstUnreadTurn(turns, 'u3', isMine)).toBe(-1)
    expect(firstUnreadTurn(turns, undefined, isMine)).toBe(-1)
    expect(firstUnreadTurn(turns, 'not-loaded', isMine)).toBe(-1)
  })

  it('keeps each actor on the same name color (stable hash)', () => {
    expect(actorColorIndex('user:ownerid00001', 6)).toBe(5)
    expect(actorColorIndex('user:secondid0001', 6)).toBe(4)
    expect(actorColorIndex('agent:writer000001', 6)).toBe(4)
    expect(actorColorIndex('agent:default', 6)).toBe(5)
  })

  it('draws the viewer in the plain text color and everyone else in their palette color', () => {
    const palette = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(authorNameClass('user:ownerid00001', 'user:ownerid00001', palette)).toBe('text-foreground')
    expect(authorNameClass('user:secondid0001', 'user:ownerid00001', palette)).toBe('e')
    expect(authorNameClass('agent:default', 'user:ownerid00001', palette)).toBe('f')
    expect(authorNameClass('user:secondid0001', null, palette)).toBe('e')
  })
})
