import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { getNotifications, getUnreadCount } from '../notifications/index.ts'
import { createWorkspaceMember, updateWorkspaceMirror } from '../workspaces/members.ts'
import { createComment, deleteComment, getComments, getCommentsById, getMentions, MAX_COMMENT, updateComment } from './index.ts'

const W = 'workspace0001'
const OTHER_W = 'workspace0002'
const [A, B, C, OUT] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd']
const [ME, BOB] = [`user:${A}`, `user:${B}`]
const TASK = 'task:tttttttttttt'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  updateWorkspaceMirror([{ id: W, title: 'Main' }, { id: OTHER_W, title: 'Side' }], db)
  for (const id of [A, B, C]) createWorkspaceMember(W, id, 'member', db)
  createWorkspaceMember(OTHER_W, A, 'member', db)
  const say = (extra: Partial<Parameters<typeof createComment>[0]> = {}) =>
    createComment({ workspaceId: W, entity: TASK, createdBy: ME, content: 'hi', ...extra }, db)
  return { db, say }
}

const code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as { code?: string }).code
  }
}

test('a mention tells members only, once each, never the author; unknown ids are ignored', async () => {
  const { db, say } = await setup()
  const row = say({ content: `hey user:${B} and user:${B}, also user:${A}, user:${OUT} and user:${'x'.repeat(12)}, ${A}` })
  expect(row).toMatchObject({ entity: TASK, createdBy: ME, createdAt: row.updatedAt })
  expect(row.id).toMatch(/^[0-9a-z]{12}$/)
  const seen = (userId: string, workspaceId = W) =>
    getNotifications(userId, workspaceId, db).map((n) => [n.type, n.readAt === null ? 'unread' : 'read', n.createdBy, n.entity])
  expect(seen(B)).toEqual([['mention', 'unread', ME, `comment:${row.id}`]])
  expect(seen(A)).toEqual([])
  expect(seen(C)).toEqual([])
  expect(seen(OUT)).toEqual([])
  expect(seen(B, OTHER_W)).toEqual([]) // notified in the workspace of the comment only
  expect(getUnreadCount(B, W, db)).toBe(1)
})

test('an agent mentions people and is itself never notified', async () => {
  const { db, say } = await setup()
  say({ createdBy: 'agent:default', content: `fyi user:${A} user:${B}` })
  expect([A, B, C].map((id) => getNotifications(id, W, db).length)).toEqual([1, 1, 0])
})

test('mentions are found by token, and the text is not changed', () => {
  expect(getMentions(`user:${A} xuser:${B} user:${A}`)).toEqual([A])
  expect(getMentions('no one')).toEqual([])
})

test('validates entity, author and content', async () => {
  const { say } = await setup()
  expect(code(() => say({ entity: 'task:x' }))).toBe('invalid')
  expect(code(() => say({ entity: 'chat:tttttttttttt' }))).toBe('invalid') // not a type yet
  expect(code(() => say({ entity: 'Task:tttttttttttt' }))).toBe('invalid')
  expect(say({ entity: 'comment:tttttttttttt' }).entity).toBe('comment:tttttttttttt') // a reply
  expect(code(() => say({ createdBy: 'user' }))).toBe('invalid')
  expect(code(() => say({ content: '  ' }))).toBe('invalid')
  expect(code(() => say({ content: 1 as never }))).toBe('invalid')
  expect(code(() => say({ content: 'x'.repeat(MAX_COMMENT + 1) }))).toBe('invalid')
  expect(say({ content: 'x'.repeat(MAX_COMMENT) }).content).toHaveLength(MAX_COMMENT)
})

test('a comment that fails writes no notification', async () => {
  const { db, say } = await setup()
  expect(code(() => say({ content: `user:${B} ${'x'.repeat(MAX_COMMENT)}` }))).toBe('invalid')
  expect(getNotifications(B, W, db)).toEqual([])
})

test('getComments is oldest first, per workspace and entity', async () => {
  const { db, say } = await setup()
  const first = say({ content: 'one' })
  const second = say({ content: 'two', createdBy: BOB })
  say({ entity: 'task:uuuuuuuuuuuu' })
  createComment({ workspaceId: OTHER_W, entity: TASK, createdBy: ME, content: 'elsewhere' }, db)
  expect(getComments(W, TASK, db).map((row) => row.id)).toEqual([first.id, second.id])
  expect(getCommentsById(W, [second.id, 'nope'], db).map((row) => row.id)).toEqual([second.id])
  expect(getCommentsById(OTHER_W, [second.id], db)).toEqual([])
})

test('only the author edits or deletes, an edit bumps updatedAt and notifies nobody', async () => {
  const { db, say } = await setup()
  const comment = say({ content: 'first' })
  expect(code(() => updateComment(W, comment.id, BOB, 'mine now', undefined, db))).toBe('forbidden')
  expect(code(() => deleteComment(W, comment.id, BOB, db))).toBe('forbidden')
  expect(code(() => updateComment(W, 'nope', ME, 'x', undefined, db))).toBe('not_found')
  expect(code(() => updateComment(OTHER_W, comment.id, ME, 'x', undefined, db))).toBe('not_found')
  expect(code(() => deleteComment(OTHER_W, comment.id, ME, db))).toBe('not_found')
  expect(code(() => updateComment(W, comment.id, ME, ' ', undefined, db))).toBe('invalid')

  const edited = updateComment(W, comment.id, ME, `now with user:${B}`, comment.updatedAt, db)
  expect(edited).toMatchObject({ content: `now with user:${B}`, createdAt: comment.createdAt })
  expect(edited.updatedAt).toBeGreaterThan(comment.updatedAt)
  expect(code(() => updateComment(W, comment.id, ME, 'stale', comment.updatedAt, db))).toBe('conflict')
  expect(getComments(W, TASK, db)[0]?.content).toBe(`now with user:${B}`)
  expect(getNotifications(B, W, db)).toEqual([])
})

test('deleting a comment deletes its notifications and no others', async () => {
  const { db, say } = await setup()
  const comment = say({ content: `user:${B} user:${C}` })
  const other = say({ content: `user:${B}` })
  deleteComment(W, comment.id, ME, db)
  expect(getComments(W, TASK, db).map((row) => row.id)).toEqual([other.id])
  expect(getNotifications(B, W, db).map((n) => n.entity)).toEqual([`comment:${other.id}`])
  expect(getNotifications(C, W, db)).toEqual([])
})
