import { afterEach, expect, setSystemTime, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { getNotifications, getUnreadCount } from '../notifications/index.ts'
import { createWorkspaceMember, updateWorkspaceMirror } from '../workspaces/members.ts'
import { createComment, createEvent, deleteComment, EVENT_MERGE_MS, getComments, getCommentsById, getMentions, MAX_COMMENT, searchComments, updateComment } from './index.ts'
import type { ActivityEvent } from './types.ts'

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
  expect(row).toMatchObject({ entity: TASK, type: 'comment', createdBy: ME, createdAt: row.updatedAt })
  expect(row.event).toBeUndefined()
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
  expect(getComments(W, TASK, {}, db).items.map((row) => row.id)).toEqual([first.id, second.id])
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
  expect(getComments(W, TASK, {}, db).items[0]?.content).toBe(`now with user:${B}`)
  expect(getNotifications(B, W, db)).toEqual([])
})

test('deleting a comment deletes its notifications and no others', async () => {
  const { db, say } = await setup()
  const comment = say({ content: `user:${B} user:${C}` })
  const other = say({ content: `user:${B}` })
  deleteComment(W, comment.id, ME, db)
  expect(getComments(W, TASK, {}, db).items.map((row) => row.id)).toEqual([other.id])
  expect(getNotifications(B, W, db).map((n) => n.entity)).toEqual([`comment:${other.id}`])
  expect(getNotifications(C, W, db)).toEqual([])
})

test('search finds comment text in the workspace only, newest first, and nothing for a blank query', async () => {
  const { say, db } = await setup()
  const first = say({ content: 'The Budget is tight' })
  say({ content: 'unrelated' })
  const second = say({ content: 'budget again', entity: 'project:pppppppppppp' })
  createComment({ workspaceId: OTHER_W, entity: TASK, createdBy: ME, content: 'budget elsewhere' }, db)
  expect(searchComments(W, 'BUDGET', 20, db).map((comment) => comment.id)).toEqual([second.id, first.id])
  expect(searchComments(W, 'budget', 1, db).map((comment) => comment.id)).toEqual([second.id])
  expect(searchComments(W, '%', 20, db)).toEqual([])
  expect(searchComments(W, ' ', 20, db)).toEqual([])
})

afterEach(() => void setSystemTime())

const T0 = new Date('2026-01-01T10:00:00Z').getTime()
const event = (db: Awaited<ReturnType<typeof setup>>['db'], e: ActivityEvent, createdBy = ME) => createEvent({ workspaceId: W, entity: TASK, createdBy, event: e }, db)
const feed = (db: Awaited<ReturnType<typeof setup>>['db'], page = {}) => getComments(W, TASK, page, db)

test('an event is a type event row with its parsed event, and never notifies', async () => {
  const { db } = await setup()
  const row = event(db, { kind: 'title', from: `user:${B}`, to: `ask user:${C}` })!
  expect(row).toMatchObject({ entity: TASK, type: 'event', createdBy: ME, event: { kind: 'title', from: `user:${B}`, to: `ask user:${C}` } })
  expect(JSON.parse(row.content)).toEqual(row.event)
  expect(feed(db).items).toEqual([row])
  expect([A, B, C].map((id) => getNotifications(id, W, db).length)).toEqual([0, 0, 0])
  expect(getUnreadCount(B, W, db)).toBe(0)
  expect(code(() => event(db, { kind: 'time', time: 1 }, 'user'))).toBe('invalid')
  expect(code(() => createEvent({ workspaceId: W, entity: 'task:x', createdBy: ME, event: { kind: 'time', time: 1 } }, db))).toBe('invalid')
})

test('an event to the same value, or links without links, writes nothing', async () => {
  const { db } = await setup()
  expect(event(db, { kind: 'status', from: 'todo', to: 'todo' })).toBeNull()
  expect(event(db, { kind: 'assignees', from: [ME], to: [ME] })).toBeNull()
  expect(event(db, { kind: 'due', from: null, to: null })).toBeNull()
  expect(event(db, { kind: 'links', added: [], removed: [] })).toBeNull()
  expect(feed(db).items).toEqual([])
})

test('a from/to event by the same actor of the same kind within 5 minutes merges; back to the start deletes it', async () => {
  const { db } = await setup()
  setSystemTime(T0)
  const first = event(db, { kind: 'title', from: 'a', to: 'ab' })!
  setSystemTime(T0 + EVENT_MERGE_MS - 1)
  const merged = event(db, { kind: 'title', from: 'ab', to: 'abc' })!
  expect(merged).toMatchObject({ id: first.id, createdAt: T0, event: { kind: 'title', from: 'a', to: 'abc' } })
  expect(merged.updatedAt).toBeGreaterThan(first.updatedAt)
  expect(feed(db).items.map((row) => row.event)).toEqual([{ kind: 'title', from: 'a', to: 'abc' }])
  expect(event(db, { kind: 'title', from: 'abc', to: 'a' })).toBeNull()
  expect(feed(db).items).toEqual([])
  // after 5 minutes: a new row
  setSystemTime(T0)
  event(db, { kind: 'title', from: 'a', to: 'b' })
  setSystemTime(T0 + EVENT_MERGE_MS)
  event(db, { kind: 'title', from: 'b', to: 'c' })
  expect(feed(db).items.map((row) => row.event)).toEqual([{ kind: 'title', from: 'a', to: 'b' }, { kind: 'title', from: 'b', to: 'c' }])
})

test('no merge for another actor, another kind, a comment in between, or kinds without from/to', async () => {
  const { db, say } = await setup()
  event(db, { kind: 'due', from: null, to: 1 })
  event(db, { kind: 'due', from: 1, to: 2 }, BOB)
  event(db, { kind: 'status', from: 'todo', to: 'doing' }, BOB)
  event(db, { kind: 'due', from: 2, to: 3 }, BOB)
  say({ content: 'between' })
  event(db, { kind: 'due', from: 3, to: 4 }, BOB)
  event(db, { kind: 'time', time: 5 })
  event(db, { kind: 'time', time: 6 })
  event(db, { kind: 'links', added: [{ type: 'url', title: 'x', ref: 'https://x.dev' }], removed: [] })
  event(db, { kind: 'links', added: [], removed: [{ type: 'url', title: 'x', ref: 'https://x.dev' }] })
  expect(feed(db).items.map((row) => row.event?.kind ?? row.content)).toEqual(['due', 'due', 'status', 'due', 'between', 'due', 'time', 'time', 'links', 'links'])
})

test('getComments interleaves comments and events by time, ties by insertion, and pages from the newest', async () => {
  const { db, say } = await setup()
  setSystemTime(T0)
  const ids = [
    say({ content: 'one' }).id,
    event(db, { kind: 'status', from: 'todo', to: 'doing' })!.id,
    say({ content: 'two', createdBy: BOB }).id,
  ]
  setSystemTime(T0 + 1)
  ids.push(event(db, { kind: 'time', time: 60_000 })!.id, say({ content: 'three' }).id)
  createComment({ workspaceId: OTHER_W, entity: TASK, createdBy: ME, content: 'elsewhere' }, db)
  say({ entity: 'task:uuuuuuuuuuuu' })
  expect(feed(db)).toEqual({ items: expect.any(Array), more: false })
  expect(feed(db).items.map((row) => row.id)).toEqual(ids)
  const last = feed(db, { limit: 2 })
  expect([last.items.map((row) => row.id), last.more]).toEqual([ids.slice(3), true])
  const middle = feed(db, { limit: 2, before: last.items[0]!.id })
  expect([middle.items.map((row) => row.id), middle.more]).toEqual([ids.slice(1, 3), true])
  const first = feed(db, { limit: 2, before: middle.items[0]!.id })
  expect([first.items.map((row) => row.id), first.more]).toEqual([ids.slice(0, 1), false])
  expect(feed(db, { before: 'nope00000000' })).toEqual({ items: [], more: false })
  expect(getComments(OTHER_W, TASK, { before: ids[4] }, db)).toEqual({ items: [], more: false })
  expect(feed(db, { limit: 0 }).items).toHaveLength(1) // clamped to 1
  expect(feed(db, { limit: 10_000 }).items).toHaveLength(5)
})

test('search ignores events, and an event can be neither edited nor deleted', async () => {
  const { db, say } = await setup()
  const row = event(db, { kind: 'title', from: 'budget', to: 'budget 2' })!
  const comment = say({ content: 'the budget' })
  expect(searchComments(W, 'budget', 20, db).map((found) => found.id)).toEqual([comment.id])
  expect(code(() => updateComment(W, row.id, ME, 'x', undefined, db))).toBe('forbidden')
  expect(code(() => deleteComment(W, row.id, ME, db))).toBe('forbidden')
  expect(feed(db).items.map((found) => found.id)).toEqual([row.id, comment.id])
})
