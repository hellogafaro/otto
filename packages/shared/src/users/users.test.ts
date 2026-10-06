import { eq } from 'drizzle-orm'
import { expect, test } from 'bun:test'
import { openDb, type Db } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { library } from '../library/schema.ts'
import { projects, projectsMembers } from '../projects/schema.ts'
import { tasks, timesheets } from '../tasks/schema.ts'
import { createWorkspaceInvitation, getWorkspaceInvitation, isWorkspaceMember } from '../workspaces/members.ts'
import { workspaces, workspacesInvitations, workspacesMembers } from '../workspaces/schema.ts'
import { createUsersStore, INVITATION_REQUIRED, OWNER_ONLY } from './index.ts'
import { users } from './schema.ts'

const PASSWORD = 'a long enough password'
const ORIGIN = 'http://localhost:9100'
const REGISTRY = [
  { id: 'aaaa1111-2222', title: 'Main' },
  { id: 'bbbb3333-4444', title: 'Side' },
]

/** Better Auth limits requests per client address; every request gets its own, unless a test pins one. */
let nextAddress = 0

/** The same database, but a user row takes 25 ms to land: the window in which a second first sign-up could slip in. */
function withSlowUserInsert(db: Db): Db {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (prop !== 'insert') return typeof value === 'function' ? value.bind(target) : value
      return (table: never) => {
        const insert = target.insert(table)
        if ((table as unknown) !== users) return insert
        return {
          values: (...rows: [never]) => {
            const values = insert.values(...rows)
            return { returning: () => ({ then: (resolve: never, reject: never) => sleep(25).then(() => values.returning().then(resolve, reject)) }) }
          },
        }
      }
    },
  })
}

async function setup({ slowInsert = false, ownerEmail }: { slowInsert?: boolean; ownerEmail?: string } = {}) {
  const db = openDb(':memory:')
  await pushSchema(db)
  const store = createUsersStore(slowInsert ? withSlowUserInsert(db) : db, { secret: 'x'.repeat(40), baseURL: ORIGIN, ownerEmail, getWorkspaces: () => REGISTRY })
  const call = (method: string, path: string, body?: unknown, cookie?: string, address = `10.0.${nextAddress++ >> 8}.${nextAddress & 255}`) =>
    store.auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method,
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': address, ...(cookie && { cookie }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  const signUp = (email: string) => call('POST', '/sign-up/email', { name: email, email, password: PASSWORD })
  return { db, store, call, signUp }
}

/** The `name=value` pairs of the Set-Cookie headers, as a Cookie header. */
const cookieOf = (res: Response) => res.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code

/** Owner signed up; returns the cookie. */
async function signUpOwner(t: Awaited<ReturnType<typeof setup>>) {
  const res = await t.signUp('owner@example.com')
  expect(res.status).toBe(200)
  return cookieOf(res)
}

async function invite(t: Awaited<ReturnType<typeof setup>>, cookie: string, email: string, role = 'member') {
  const res = await t.call('POST', '/organization/invite-member', { email, role, organizationId: REGISTRY[0]!.id }, cookie)
  return { res, body: (await res.clone().json()) as { id?: string; code?: string } }
}

test('Better Auth and the organization plugin run on bun:sqlite with workspace ids as organization ids', async () => {
  const t = await setup()
  const cookie = await signUpOwner(t)

  // The mirror and the owner rows exist, under our ids, with the registry's titles.
  expect(t.db.select().from(workspaces).all().map((w) => [w.id, w.title, w.slug])).toEqual(REGISTRY.map((w) => [w.id, w.title, w.id]))
  const owner = t.db.select().from(users).get()!
  expect(owner.id).toMatch(/^[0-9a-z]{12}$/)
  expect(t.db.select().from(workspacesMembers).all().map((m) => [m.workspaceId, m.userId, m.role])).toEqual(
    REGISTRY.map((w) => [w.id, owner.id, 'owner']),
  )

  // The plugin reads them: the session user sees both workspaces and can open one by id.
  const list = (await (await t.call('GET', '/organization/list', undefined, cookie)).json()) as { id: string; name?: string }[]
  expect(list.map((w) => w.id).sort()).toEqual(REGISTRY.map((w) => w.id))
  const full = (await (await t.call('GET', `/organization/get-full-organization?organizationId=${REGISTRY[0]!.id}`, undefined, cookie)).json()) as {
    id: string
    members: { role: string }[]
  }
  expect(full.id).toBe(REGISTRY[0]!.id)
  expect(full.members.map((m) => m.role)).toEqual(['owner'])

  // An owner invites, the invitee signs up with it and accepts: a member row appears.
  const { body } = await invite(t, cookie, 'Friend@Example.com')
  expect(body.id).toMatch(/^[0-9a-z]{12}$/)
  const friend = await t.signUp('friend@example.com')
  expect(friend.status).toBe(200)
  const accepted = await t.call('POST', '/organization/accept-invitation', { invitationId: body.id }, cookieOf(friend))
  expect(accepted.status).toBe(200)
  const friendId = t.db.select().from(users).where(eq(users.email, 'friend@example.com')).get()!.id
  expect(t.db.select().from(workspacesMembers).where(eq(workspacesMembers.userId, friendId)).all().map((m) => [m.workspaceId, m.role])).toEqual([
    [REGISTRY[0]!.id, 'member'],
  ])
})

test('without OTTO_OWNER_EMAIL the first sign-up wins', async () => {
  const t = await setup()
  expect(t.store.needsOwner()).toBe(true)
  expect((await t.signUp('anyone@example.com')).status).toBe(200)
  expect(t.store.needsOwner()).toBe(false)
})

test('with OTTO_OWNER_EMAIL only that email may make the first account, whatever its case or spaces', async () => {
  const t = await setup({ ownerEmail: '  Boss@Example.com ' })
  for (const email of ['a@example.com', 'boss@example.org', 'xboss@example.com']) {
    const res = await t.signUp(email)
    expect(res.status).toBe(403)
    expect(await codeOf(res)).toBe(OWNER_ONLY)
  }
  expect(t.db.select().from(users).all()).toEqual([])
  expect(t.store.needsOwner()).toBe(true)
  expect((await t.signUp('BOSS@example.COM')).status).toBe(200)
  expect(t.db.select().from(users).all().map((u) => u.email)).toEqual(['boss@example.com'])
  // Once the owner exists, the email gate is over: a stranger needs an invitation.
  expect(await codeOf(await t.signUp('a@example.com'))).toBe(INVITATION_REQUIRED)
})

test('later sign-ups need a pending invitation for exactly that email', async () => {
  const t = await setup()
  const cookie = await signUpOwner(t)

  const stranger = await t.signUp('stranger@example.com')
  expect(stranger.status).toBe(403)
  expect(await codeOf(stranger)).toBe(INVITATION_REQUIRED)

  await invite(t, cookie, 'friend@example.com')
  const wrong = await t.signUp('other@example.com')
  expect(await codeOf(wrong)).toBe(INVITATION_REQUIRED)
  expect((await t.signUp('friend@example.com')).status).toBe(200)

  // An expired or cancelled invitation does not count.
  await invite(t, cookie, 'late@example.com')
  t.db.update(workspacesInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(workspacesInvitations.email, 'late@example.com')).run()
  expect(await codeOf(await t.signUp('late@example.com'))).toBe(INVITATION_REQUIRED)
  await invite(t, cookie, 'gone@example.com')
  t.db.update(workspacesInvitations).set({ status: 'canceled' }).where(eq(workspacesInvitations.email, 'gone@example.com')).run()
  expect(await codeOf(await t.signUp('gone@example.com'))).toBe(INVITATION_REQUIRED)
  expect(t.db.select().from(users).all().map((u) => u.email)).toEqual(['owner@example.com', 'friend@example.com'])
})

test('two concurrent first sign-ups: exactly one wins', async () => {
  for (const slowInsert of [false, true]) {
    const t = await setup({ slowInsert })
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => t.signUp(`user${i}@example.com`)))
    expect(results.filter((res) => res.status === 200)).toHaveLength(1)
    for (const res of results.filter((res) => res.status !== 200)) expect(await codeOf(res)).toBe(INVITATION_REQUIRED)
    expect(t.db.select().from(users).all()).toHaveLength(1)
    expect(t.db.select().from(workspacesMembers).all()).toHaveLength(REGISTRY.length)
  }
})

test('sign-in sets the session cookie that get-session reads, and sign-out ends it', async () => {
  const t = await setup()
  await signUpOwner(t)
  const bad = await t.call('POST', '/sign-in/email', { email: 'owner@example.com', password: 'not the password!' })
  expect(bad.status).toBe(401)
  const res = await t.call('POST', '/sign-in/email', { email: 'owner@example.com', password: PASSWORD })
  expect(res.status).toBe(200)
  const cookie = cookieOf(res)
  expect(cookie).toContain('session_token=')
  const session = (await (await t.call('GET', '/get-session', undefined, cookie)).json()) as { user: { email: string } }
  expect(session.user.email).toBe('owner@example.com')
  expect((await t.call('POST', '/sign-out', {}, cookie)).status).toBe(200)
  expect(await (await t.call('GET', '/get-session', undefined, cookie)).json()).toBeNull()
})

test('sign-in attempts from one address are limited', async () => {
  const t = await setup()
  await signUpOwner(t)
  const attempt = () => t.call('POST', '/sign-in/email', { email: 'owner@example.com', password: 'not the password!' }, undefined, '192.0.2.99')
  const statuses = []
  for (let i = 0; i < 5; i++) statuses.push((await attempt()).status)
  expect(statuses).toEqual([401, 401, 401, 429, 429])
})

test('a short password is refused', async () => {
  const t = await setup()
  const res = await t.call('POST', '/sign-up/email', { name: 'A', email: 'a@example.com', password: 'short' })
  expect(res.status).toBe(400)
})

test('the admin role is refused on invitations and role changes; owner and member are fine', async () => {
  const t = await setup()
  const cookie = await signUpOwner(t)
  const refused = await invite(t, cookie, 'a@example.com', 'admin')
  expect(refused.res.status).toBe(403)
  expect(refused.body.code).toBe('ROLE_NOT_ALLOWED')
  expect((await invite(t, cookie, 'b@example.com', 'owner')).res.status).toBe(200)
  expect((await invite(t, cookie, 'c@example.com', 'member')).res.status).toBe(200)

  // A member's role cannot become admin either.
  const invitation = (await invite(t, cookie, 'd@example.com')).body
  const member = await t.signUp('d@example.com')
  await t.call('POST', '/organization/accept-invitation', { invitationId: invitation.id }, cookieOf(member))
  const memberId = t.db.select().from(users).where(eq(users.email, 'd@example.com')).get()!.id
  const update = (role: string) =>
    t.call('POST', '/organization/update-member-role', { memberId: t.db.select().from(workspacesMembers).where(eq(workspacesMembers.userId, memberId)).get()!.id, role, organizationId: REGISTRY[0]!.id }, cookie)
  const toAdmin = await update('admin')
  expect(toAdmin.status).toBe(403)
  expect((await update('owner')).status).toBe(200)
})

test('workspaces are not created, changed or deleted through the plugin', async () => {
  const t = await setup()
  const cookie = await signUpOwner(t)
  for (const [path, body] of [
    ['/organization/create', { name: 'New', slug: 'new' }],
    ['/organization/update', { data: { name: 'Renamed' }, organizationId: REGISTRY[0]!.id }],
    ['/organization/delete', { organizationId: REGISTRY[0]!.id }],
  ] as const) {
    expect((await t.call('POST', path, body, cookie)).status).toBe(404)
  }
  expect(t.db.select().from(workspaces).all()).toHaveLength(REGISTRY.length)
})

test('initOwner gives the legacy actor to the first user, everywhere, once', async () => {
  const t = await setup()
  const now = new Date()
  const base = { workspaceId: REGISTRY[0]!.id, createdAt: now, updatedAt: now }
  t.db.insert(library).values([
    { id: 'lib000000001', ...base, type: 'file', title: 'a', createdBy: 'user' },
    { id: 'lib000000002', ...base, type: 'file', title: 'b', createdBy: 'agent:default' },
  ]).run()
  t.db.insert(projects).values({ id: 'prj000000001', ...base, title: 'P' }).run()
  t.db.insert(projectsMembers).values([
    { projectId: 'prj000000001', actor: 'user', role: 'contributor' },
    { projectId: 'prj000000001', actor: 'agent:default', role: 'viewer' },
  ]).run()
  const task = { ...base, projectId: 'prj000000001', title: 'T' }
  t.db.insert(tasks).values([
    { id: 'tsk000000001', ...task, createdBy: 'user', assignees: ['agent:x', 'user'] },
    { id: 'tsk000000002', ...task, createdBy: 'agent:default', assignees: ['agent:x'] },
    { id: 'tsk000000003', ...task, createdBy: 'user', assignees: ['user', 'agent:x', 'user'] },
  ]).run()
  t.db.insert(timesheets).values({ id: 'tms000000001', workspaceId: base.workspaceId, taskId: 'tsk000000001', createdBy: 'user', createdAt: now, time: 5 }).run()

  await signUpOwner(t)
  const me = `user:${t.db.select().from(users).get()!.id}`
  const snapshot = () => [
    t.db.select({ by: library.createdBy }).from(library).orderBy(library.id).all().map((r) => r.by),
    t.db.select({ by: projectsMembers.actor }).from(projectsMembers).orderBy(projectsMembers.role).all().map((r) => r.by),
    t.db.select({ by: tasks.createdBy, who: tasks.assignees }).from(tasks).orderBy(tasks.id).all(),
    t.db.select({ by: timesheets.createdBy }).from(timesheets).all().map((r) => r.by),
  ]
  const expected = [
    [me, 'agent:default'],
    [me, 'agent:default'],
    [
      { by: me, who: ['agent:x', me] },
      { by: 'agent:default', who: ['agent:x'] },
      { by: me, who: [me, 'agent:x'] },
    ],
    [me],
  ]
  expect(snapshot()).toEqual(expected)

  // Running it again, or at every boot, changes nothing.
  t.store.initOwner(me.slice('user:'.length))
  t.store.initFirstOwner()
  expect(snapshot()).toEqual(expected)
  expect(t.db.select().from(workspacesMembers).all()).toHaveLength(REGISTRY.length)
})

test('the mirror follows the registry: titles update, removed workspaces take their members along', async () => {
  const t = await setup()
  await signUpOwner(t)
  let registry = [{ id: 'bbbb3333-4444', title: 'Renamed' }, { id: 'cccc5555-6666', title: 'New' }]
  const store = createUsersStore(t.db, { secret: 'x'.repeat(40), getWorkspaces: () => registry })
  store.initFirstOwner()
  expect(t.db.select().from(workspaces).orderBy(workspaces.id).all().map((w) => [w.id, w.title])).toEqual([
    ['bbbb3333-4444', 'Renamed'],
    ['cccc5555-6666', 'New'],
  ])
  expect(t.db.select().from(workspacesMembers).all().map((m) => [m.workspaceId, m.role]).sort()).toEqual([
    ['bbbb3333-4444', 'owner'],
    ['cccc5555-6666', 'owner'],
  ])
  registry = []
  store.initFirstOwner()
  expect(t.db.select().from(workspaces).all()).toEqual([])
  expect(t.db.select().from(workspacesMembers).all()).toEqual([])
})

test('a local install gets one user, owner of every workspace, made once', async () => {
  const t = await setup()
  const id = t.store.initLocalUser({ name: 'You', email: 'Local@Localhost' })
  expect(id).toMatch(/^[0-9a-z]{12}$/)
  expect(t.store.initLocalUser({ name: 'Other', email: 'other@localhost' })).toBe(id)
  expect(t.db.select().from(users).all().map((u) => [u.id, u.name, u.email])).toEqual([[id, 'You', 'local@localhost']])
  expect(t.db.select().from(workspacesMembers).all().map((m) => [m.userId, m.role])).toEqual([[id, 'owner'], [id, 'owner']])
  expect(t.store.getFirstUser()?.id).toBe(id)
  expect(t.store.needsOwner()).toBe(false)
})

test('an invitation made by the domain function is the plugin\'s: sign up, accept through its endpoint, become a member', async () => {
  const t = await setup()
  await signUpOwner(t)
  const ownerId = t.db.select().from(users).get()!.id
  const invitation = createWorkspaceInvitation({ workspaceId: REGISTRY[1]!.id, email: 'Friend@Example.com', inviterId: ownerId }, t.db)

  // Someone else with their own invitation cannot take it: it is bound to the email.
  createWorkspaceInvitation({ workspaceId: REGISTRY[0]!.id, email: 'other@example.com', inviterId: ownerId }, t.db)
  const other = await t.signUp('other@example.com')
  const stolen = await t.call('POST', '/organization/accept-invitation', { invitationId: invitation.id }, cookieOf(other))
  expect(stolen.status).not.toBe(200)
  expect(isWorkspaceMember(REGISTRY[1]!.id, t.db.select().from(users).where(eq(users.email, 'other@example.com')).get()!.id, t.db)).toBe(false)

  const friend = await t.signUp('friend@example.com')
  expect(friend.status).toBe(200)
  const accepted = await t.call('POST', '/organization/accept-invitation', { invitationId: invitation.id }, cookieOf(friend))
  expect(accepted.status).toBe(200)
  const friendId = t.db.select().from(users).where(eq(users.email, 'friend@example.com')).get()!.id
  expect(isWorkspaceMember(REGISTRY[1]!.id, friendId, t.db)).toBe(true)
  expect(isWorkspaceMember(REGISTRY[0]!.id, friendId, t.db)).toBe(false)
  expect(getWorkspaceInvitation(invitation.id, t.db)?.status).toBe('accepted')

  // Used once: it does not open a second sign-up and cannot be accepted again.
  expect((await t.call('POST', '/organization/accept-invitation', { invitationId: invitation.id }, cookieOf(friend))).status).not.toBe(200)
})

test('an expired invitation cannot be accepted', async () => {
  const t = await setup()
  await signUpOwner(t)
  const ownerId = t.db.select().from(users).get()!.id
  const invitation = createWorkspaceInvitation({ workspaceId: REGISTRY[0]!.id, email: 'late@example.com', inviterId: ownerId }, t.db)
  const late = await t.signUp('late@example.com')
  t.db.update(workspacesInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(workspacesInvitations.id, invitation.id)).run()
  expect((await t.call('POST', '/organization/accept-invitation', { invitationId: invitation.id }, cookieOf(late))).status).not.toBe(200)
  expect(isWorkspaceMember(REGISTRY[0]!.id, t.db.select().from(users).where(eq(users.email, 'late@example.com')).get()!.id, t.db)).toBe(false)
})
