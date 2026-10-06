import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import {
  createNotification,
  deleteEntityNotifications,
  deleteNotifications,
  getNotifications,
  getUnreadCount,
  updateNotificationStatus,
} from './index.ts'

const W = 'workspace0001'
const OTHER_W = 'workspace0002'
const [A, B] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']
const TASK = 'task:tttttttttttt'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  const tell = (userId: string, extra: Partial<Parameters<typeof createNotification>[0]> = {}) =>
    createNotification({ userId, workspaceId: W, entity: TASK, type: 'assigned', createdBy: `user:${A}`, ...extra }, db)
  return { db, tell }
}

const code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as { code?: string }).code
  }
}

test('validates the entity, type and actor', async () => {
  const { tell } = await setup()
  expect(code(() => tell(B, { entity: 'chat:tttttttttttt' }))).toBe('invalid')
  expect(code(() => tell(B, { entity: 'task:x' }))).toBe('invalid')
  expect(code(() => tell(B, { type: 'comment' as never }))).toBe('invalid')
  expect(code(() => tell(B, { createdBy: 'user' }))).toBe('invalid')
  expect(() => tell(B, { type: 'mention', entity: 'comment:cccccccccccc' })).not.toThrow()
})

test('one row per user, entity and type: the same sentence again makes it unread and new', async () => {
  const { db, tell } = await setup()
  tell(B, { type: 'mention', entity: 'comment:cccccccccccc' })
  tell(A, { type: 'mention', entity: 'comment:cccccccccccc' })
  tell(B)
  const [assigned] = getNotifications(B, W, db)
  updateNotificationStatus(B, W, 'all', 'read', db)
  tell(B, { createdBy: `user:${B}` })
  expect(getNotifications(B, W, db).map((n) => [n.type, n.readAt === null ? 'unread' : 'read'])).toEqual([['assigned', 'unread'], ['mention', 'read']])
  expect(getNotifications(B, W, db)[0]).toMatchObject({ id: assigned!.id, createdBy: `user:${B}` })
  expect(getNotifications(A, W, db)).toHaveLength(1)
})

test('notifications are mine, newest first, per workspace, with unread counted', async () => {
  const { db, tell } = await setup()
  tell(B, { entity: 'task:111111111111' })
  tell(B, { entity: 'task:222222222222' })
  createNotification({ userId: B, workspaceId: OTHER_W, entity: TASK, type: 'assigned', createdBy: `user:${A}` }, db)
  tell(A)
  expect(getNotifications(B, W, db).map((n) => n.entity)).toEqual(['task:222222222222', 'task:111111111111'])
  expect(getNotifications(B, W, db)[0]).toMatchObject({ type: 'assigned', readAt: null, createdBy: `user:${A}` })
  expect([getUnreadCount(B, W, db), getUnreadCount(B, OTHER_W, db), getUnreadCount(A, W, db)]).toEqual([2, 1, 1])
})

test('mark read or unread and clear: by id, for all, never another user or workspace', async () => {
  const { db, tell } = await setup()
  tell(B, { entity: 'task:111111111111' })
  tell(B, { entity: 'task:222222222222' })
  tell(A)
  createNotification({ userId: B, workspaceId: OTHER_W, entity: TASK, type: 'assigned', createdBy: `user:${A}` }, db)
  const [newer, older] = getNotifications(B, W, db)
  const mine = getNotifications(A, W, db)[0]!

  updateNotificationStatus(B, W, [older!.id], 'read', db)
  expect(getUnreadCount(B, W, db)).toBe(1)
  updateNotificationStatus(B, W, [older!.id], 'unread', db)
  expect(getUnreadCount(B, W, db)).toBe(2)
  updateNotificationStatus(B, W, [mine.id], 'read', db) // A's: ignored
  expect(getUnreadCount(A, W, db)).toBe(1)
  updateNotificationStatus(B, W, [], 'read', db)
  expect(getUnreadCount(B, W, db)).toBe(2)
  updateNotificationStatus(B, W, 'all', 'read', db)
  expect(getUnreadCount(B, W, db)).toBe(0)
  expect(getUnreadCount(B, OTHER_W, db)).toBe(1) // 'all' stays in its workspace
  expect(code(() => updateNotificationStatus(B, W, 'all', 'pending' as never, db))).toBe('invalid')

  deleteNotifications(B, W, [newer!.id, mine.id], db)
  expect(getNotifications(B, W, db).map((n) => n.id)).toEqual([older!.id])
  expect(getNotifications(A, W, db)).toHaveLength(1)
  deleteNotifications(B, W, 'all', db)
  expect(getNotifications(B, W, db)).toEqual([])
  expect(getNotifications(B, OTHER_W, db)).toHaveLength(1)
})

test('deleteEntityNotifications removes what one entity told, for everyone', async () => {
  const { db, tell } = await setup()
  tell(A, { type: 'mention', entity: 'comment:cccccccccccc' })
  tell(B, { type: 'mention', entity: 'comment:cccccccccccc' })
  tell(B, { type: 'mention', entity: 'comment:dddddddddddd' })
  deleteEntityNotifications('comment:cccccccccccc', db)
  expect(getNotifications(A, W, db)).toEqual([])
  expect(getNotifications(B, W, db).map((n) => n.entity)).toEqual(['comment:dddddddddddd'])
})
