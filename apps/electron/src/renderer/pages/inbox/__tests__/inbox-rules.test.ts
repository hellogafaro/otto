import { describe, expect, it } from 'bun:test'
import { filterNotifications, formatUnreadCount, getNotificationLineKey, getNotificationTarget } from '../inbox-rules'

describe('inbox rules', () => {
  it('opens a mention on its comment’s entity, an assignment on its task', () => {
    expect(getNotificationTarget({ entity: 'comment:c1', comment: { id: 'c1', content: 'hi', entity: 'task:t1' } })).toBe('task:t1')
    expect(getNotificationTarget({ entity: 'task:t2', comment: null })).toBe('task:t2')
  })

  it('reads mentions and assignments as their sentences', () => {
    expect(getNotificationLineKey('mention')).toBe('inbox.mentioned')
    expect(getNotificationLineKey('assigned')).toBe('inbox.assigned')
  })

  it('keeps only unread items under the filter', () => {
    const items = [{ readAt: null }, { readAt: 5 }, { readAt: 6 }]
    expect(filterNotifications(items, false)).toHaveLength(3)
    expect(filterNotifications(items, true)).toEqual([{ readAt: null }])
  })

  it('caps the unread count at 99+ and draws nothing at 0', () => {
    expect(formatUnreadCount(0)).toBeNull()
    expect(formatUnreadCount(7)).toBe('7')
    expect(formatUnreadCount(99)).toBe('99')
    expect(formatUnreadCount(100)).toBe('99+')
  })
})
