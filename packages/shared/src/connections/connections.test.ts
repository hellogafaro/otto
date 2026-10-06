import { eq } from 'drizzle-orm'
import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createSecretsStore, parseEncryptionKey } from '../secrets/index.ts'
import { secrets } from '../secrets/schema.ts'
import { getSetting, INSTALL } from '../settings/index.ts'
import { createConnectionsStore, narrowContext, userScope, workspaceScope, type ConnectionInput } from './index.ts'
import { connections } from './schema.ts'

const KEY = parseEncryptionKey('0'.repeat(64))

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return { db, store: createConnectionsStore(db, createSecretsStore(db, KEY)) }
}

const secretRows = (db: ReturnType<typeof openDb>) => db.select().from(secrets).all()
const input = (slug: string, extra: Partial<ConnectionInput> = {}): ConnectionInput => ({ slug, type: 'pi', authType: 'api_key', title: slug, ...extra })

test('create stores every field and returns it without the secret', async () => {
  const { store } = await setup()
  const created = store.createConnection(
    input('openrouter', {
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'pi/gpt',
      models: [{ id: 'pi/gpt', name: 'GPT' } as never, 'pi/other'],
      config: { piAuthProvider: 'openrouter', modelSelectionMode: 'userDefined3Tier', midStreamBehavior: 'queue' },
      account: { oauthAccountEmail: 'me@x.test', verifiedAt: 5 },
      createdAt: new Date(1000),
    }),
    { apiKey: 'sk-very-secret' },
  )
  expect(created.id).toMatch(/^[0-9a-z]{12}$/)
  expect(created).toMatchObject({
    scope: 'install',
    slug: 'openrouter',
    type: 'pi',
    authType: 'api_key',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'pi/gpt',
    config: { piAuthProvider: 'openrouter', modelSelectionMode: 'userDefined3Tier', midStreamBehavior: 'queue' },
    account: { oauthAccountEmail: 'me@x.test', verifiedAt: 5 },
    hasSecret: true,
  })
  expect(created.models).toHaveLength(2)
  expect(created.createdAt).toEqual(new Date(1000))
  expect(store.getConnection('openrouter')).toEqual(created)
  expect(JSON.stringify(created)).not.toContain('sk-')
  expect('secretId' in created).toBe(false)
})

test('the first connection becomes the default, later ones do not, and a deleted default moves on', async () => {
  const { db, store } = await setup()
  const a = store.createConnection(input('a'))
  const b = store.createConnection(input('b'))
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('a')
  expect(store.getDefaultConnection()?.slug).toBe('a')
  expect(store.setDefaultConnection('b')).toBe(true)
  expect(store.setDefaultConnection('nope')).toBe(false)
  expect(store.getDefaultConnection()?.slug).toBe('b')
  store.deleteConnection(b.id)
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('a')
  store.deleteConnection(a.id)
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBeNull()
  expect(store.getDefaultConnection()).toBeUndefined()
})

test('a setting that names a missing connection falls back to the first one', async () => {
  const { store } = await setup()
  store.createConnection(input('a'))
  store.createConnection(input('b'))
  store.setDefaultConnection('b')
  const row = store.getConnection('b')!
  store.deleteConnection(row.id)
  expect(store.getDefaultConnection()?.slug).toBe('a')
})

test('slugs are unique within a scope, and a workspace connection is found before the install one', async () => {
  const { store } = await setup()
  const install = store.createConnection(input('shared', { title: 'Install' }))
  expect(() => store.createConnection(input('shared'))).toThrow()
  const own = store.createConnection(input('shared', { title: 'Mine', scope: workspaceScope('w1') }))
  store.createConnection(input('only-install'))
  store.createConnection(input('only-w2', { scope: workspaceScope('w2') }))

  expect(store.getConnection('shared')?.id).toBe(install.id)
  expect(store.getConnection('shared', { workspaceId: 'w1' })?.id).toBe(own.id)
  expect(store.getConnection('shared', { workspaceId: 'w3' })?.id).toBe(install.id)
  expect(store.getConnections().map((c) => c.slug)).toEqual(['shared', 'only-install'])
  expect(store.getConnections({ workspaceId: 'w1' }).map((c) => `${c.slug}:${c.title}`)).toEqual(['shared:Mine', 'only-install:only-install'])
  expect(store.getConnections({ workspaceId: 'w2' }).map((c) => c.slug)).toEqual(['only-w2', 'shared', 'only-install'])
  expect(store.getAllConnections()).toHaveLength(4)
  // a workspace connection never becomes the install's default
  expect(store.getDefaultConnection()?.slug).toBe('shared')
})

test('the credential is one secret that is replaced in place, and never leaves the domain through a connection', async () => {
  const { db, store } = await setup()
  const created = store.createConnection(input('oauth', { authType: 'oauth' }), { accessToken: 'a1', refreshToken: 'r1', expiresAt: 10 })
  const [before] = secretRows(db)
  expect(store.getCredential('oauth')).toEqual({ accessToken: 'a1', refreshToken: 'r1', expiresAt: 10 })

  store.setCredential('oauth', { accessToken: 'a2', refreshToken: 'r2', expiresAt: 20 })
  const rows = secretRows(db)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.id).toBe(before!.id)
  expect(rows[0]!.value).not.toBe(before!.value)
  expect(rows[0]!.value).not.toContain('a2')
  expect(store.getCredential('oauth')?.accessToken).toBe('a2')
  expect(store.getConnection('oauth')?.hasSecret).toBe(true)

  store.deleteCredential('oauth')
  expect(secretRows(db)).toEqual([])
  expect(store.getCredential('oauth')).toBeUndefined()
  expect(store.getConnection('oauth')?.hasSecret).toBe(false)
  expect(store.getConnectionById(created.id)).toBeDefined()
})

test('update changes what it is given, keeps the rest and gives a connection without a secret one', async () => {
  const { db, store } = await setup()
  const created = store.createConnection(input('c', { baseUrl: 'http://a.test', defaultModel: 'm1' }))
  const updated = store.updateConnection(created.id, { title: 'Work', defaultModel: 'm2', models: ['m1', 'm2'] }, { apiKey: 'k' })
  expect(updated).toMatchObject({ title: 'Work', baseUrl: 'http://a.test', defaultModel: 'm2', models: ['m1', 'm2'], hasSecret: true })
  expect(updated.createdAt).toEqual(created.createdAt)
  expect(store.updateConnection(created.id, { baseUrl: null }).baseUrl).toBeNull()
  expect(store.getCredential('c')).toEqual({ apiKey: 'k' })
  expect(secretRows(db)).toHaveLength(1)
  expect(() => store.updateConnection('missing', { title: 'x' })).toThrow()
})

test('delete removes the row and its secret and is safe to repeat', async () => {
  const { db, store } = await setup()
  const keep = store.createConnection(input('keep'), { apiKey: 'keep' })
  const gone = store.createConnection(input('gone'), { apiKey: 'gone' })
  store.deleteConnection(gone.id)
  store.deleteConnection(gone.id)
  expect(db.select().from(connections).all().map((row) => row.id)).toEqual([keep.id])
  expect(secretRows(db)).toHaveLength(1)
  expect(store.getCredential('keep')).toEqual({ apiKey: 'keep' })
})

test('a failed write leaves no secret behind: the row and its secret are one transaction', async () => {
  const { db, store } = await setup()
  store.createConnection(input('dup'))
  expect(() => store.createConnection(input('dup'), { apiKey: 'orphan' })).toThrow()
  expect(secretRows(db)).toEqual([])

  const other = store.createConnection(input('other'), { apiKey: 'first' })
  db.run("CREATE TRIGGER no_update BEFORE UPDATE ON connections BEGIN SELECT RAISE(ABORT, 'locked'); END")
  expect(() => store.updateConnection(other.id, { title: 'x' }, { apiKey: 'second' })).toThrow()
  db.run('DROP TRIGGER no_update')
  expect(secretRows(db)).toHaveLength(1)
  expect(store.getCredential('other')).toEqual({ apiKey: 'first' })
})

test('a credential for a slug with no connection is held in memory and used by the setup that creates it', async () => {
  const { db, store } = await setup()
  store.setCredential('claude-max', { accessToken: 'a', refreshToken: 'r' })
  expect(secretRows(db)).toEqual([])
  expect(store.getCredential('claude-max')).toEqual({ accessToken: 'a', refreshToken: 'r' })

  const created = store.createConnection(input('claude-max', { authType: 'oauth' }))
  expect(created.hasSecret).toBe(true)
  expect(store.getCredential('claude-max')).toEqual({ accessToken: 'a', refreshToken: 'r' })
  expect(secretRows(db)).toHaveLength(1)
  // taken once: a connection of that slug in another scope does not get it again
  expect(store.createConnection(input('claude-max', { scope: workspaceScope('w') })).hasSecret).toBe(false)

  store.setCredential('temp', { apiKey: 'k' })
  store.deleteCredential('temp')
  expect(store.getCredential('temp')).toBeUndefined()
})

test('listeners hear about creates, changes and deletes, not about a credential refresh', async () => {
  const { store } = await setup()
  let heard = 0
  const stop = store.onConnectionsChange(() => heard++)
  const c = store.createConnection(input('a'), { accessToken: 't' })
  expect(heard).toBe(1)
  store.updateConnection(c.id, { defaultModel: 'm' })
  expect(heard).toBe(2)
  store.setCredential('a', { accessToken: 'refreshed' })
  expect(heard).toBe(2)
  store.deleteConnection(c.id)
  expect(heard).toBe(3)
  stop()
  store.createConnection(input('b'))
  expect(heard).toBe(3)
})

test('the secret is encrypted at rest and tied to its row', async () => {
  const { db, store } = await setup()
  store.createConnection(input('a'), { apiKey: 'sk-plain-text-key' })
  expect(JSON.stringify(db.select().from(connections).all())).not.toContain('sk-plain')
  expect(JSON.stringify(secretRows(db))).not.toContain('sk-plain')
  const [row] = secretRows(db)
  db.update(secrets).set({ id: 'zzzzzzzzzzzz' }).where(eq(secrets.id, row!.id)).run()
  expect(() => createSecretsStore(db, KEY).getSecret('zzzzzzzzzzzz')).toThrow()
})

test('a person\'s own connection is found before the workspace\'s and the install\'s, and is seen by nobody else', async () => {
  const { db, store } = await setup()
  const install = store.createConnection(input('claude', { title: 'Install' }), { accessToken: 'install-token' })
  const shared = store.createConnection(input('claude', { title: 'Workspace', scope: workspaceScope('w') }), { accessToken: 'workspace-token' })
  const alice = store.createConnection(input('claude', { title: 'Alice', scope: userScope('alice') }), { accessToken: 'alice-token' })
  const alicesOther = store.createConnection(input('mine', { scope: userScope('alice') }))
  store.createConnection(input('bob-only', { scope: userScope('bob') }), { apiKey: 'bob-key' })

  const asAlice = { userId: 'alice', workspaceId: 'w' }
  expect(store.getConnection('claude', asAlice)?.id).toBe(alice.id)
  expect(store.getConnection('claude', { userId: 'bob', workspaceId: 'w' })?.id).toBe(shared.id)
  expect(store.getConnection('claude', { userId: 'bob' })?.id).toBe(install.id)
  expect(store.getConnection('claude')?.id).toBe(install.id)
  // a list shows one connection per slug, the person's own first; another person's are never in it
  expect(store.getConnections(asAlice).map((c) => c.title)).toEqual(['Alice', 'mine'])
  expect(store.getConnections({ userId: 'bob' }).map((c) => c.slug)).toEqual(['bob-only', 'claude'])
  expect(store.getConnection('mine', { userId: 'bob', workspaceId: 'w' })).toBeUndefined()
  expect(store.getConnection('bob-only', asAlice)).toBeUndefined()
  expect(store.getConnections().map((c) => c.id)).toEqual([install.id])

  // a credential is read from the exact scope, so the one a chat resolved is the one it uses
  expect(store.getCredential('claude', alice.scope)).toEqual({ accessToken: 'alice-token' })
  expect(store.getCredential('claude', shared.scope)).toEqual({ accessToken: 'workspace-token' })
  expect(store.getCredential('claude')).toEqual({ accessToken: 'install-token' })
  expect(store.getCredential('mine', userScope('bob'))).toBeUndefined()
  store.setCredential('claude', { accessToken: 'alice-refreshed' }, alice.scope)
  expect(store.getCredential('claude', alice.scope)).toEqual({ accessToken: 'alice-refreshed' })
  expect(store.getCredential('claude')).toEqual({ accessToken: 'install-token' })
  expect(db.select().from(secrets).all()).toHaveLength(4)
  expect(alicesOther.scope).toBe('user:alice')
})

test('each person has their own default, which falls back to their first connection, then the install\'s default', async () => {
  const { db, store } = await setup()
  store.createConnection(input('install-a'))
  store.createConnection(input('install-b'))
  store.createConnection(input('a1', { scope: userScope('alice') }))
  store.createConnection(input('a2', { scope: userScope('alice') }))
  const alice = { userId: 'alice' }

  expect(store.getDefaultConnection({ userId: 'carol' })?.slug).toBe('install-a')
  expect(store.getDefaultConnection(alice)?.slug).toBe('a1')
  expect(store.setDefaultConnection('a2', alice)).toBe(true)
  expect(store.getDefaultConnection(alice)?.slug).toBe('a2')
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('install-a')
  expect(store.getDefaultConnection({ userId: 'carol' })?.slug).toBe('install-a')
  // choosing an install connection changes the install's default, not a person's
  expect(store.setDefaultConnection('install-b', { userId: 'carol' })).toBe(true)
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('install-b')
  expect(store.getDefaultConnection(alice)?.slug).toBe('a2')
  // a default that is gone falls back
  store.deleteConnection(store.getConnection('a2', alice)!.id)
  expect(store.getDefaultConnection(alice)?.slug).toBe('a1')
})

test('a credential held for a sign-in is found only by the scope it was held for', async () => {
  const { store } = await setup()
  store.setCredential('claude-max', { accessToken: 'alice-token' }, userScope('alice'))
  expect(store.getCredential('claude-max', userScope('bob'))).toBeUndefined()
  expect(store.getCredential('claude-max')).toBeUndefined()
  // bob's own setup of the same slug does not get alice's token; alice's does
  expect(store.createConnection(input('claude-max', { scope: userScope('bob') })).hasSecret).toBe(false)
  expect(store.createConnection(input('claude-max', { scope: userScope('alice') })).hasSecret).toBe(true)
  expect(store.getCredential('claude-max', userScope('alice'))).toEqual({ accessToken: 'alice-token' })
})

test('a request can name one scope only', async () => {
  const where = { userId: 'u', workspaceId: 'w' }
  expect(narrowContext(where)).toEqual(where)
  expect(narrowContext(where, 'user')).toEqual({ userId: 'u', installToo: false })
  expect(narrowContext(where, 'workspace')).toEqual({ workspaceId: 'w', installToo: false })
  expect(narrowContext(where, 'install')).toEqual({})
  const { store } = await setup()
  store.createConnection(input('claude'))
  store.createConnection(input('claude', { scope: userScope('u') }))
  expect(store.getConnection('claude', narrowContext(where, 'user'))?.scope).toBe('user:u')
  expect(store.getConnection('claude', narrowContext(where, 'workspace'))).toBeUndefined()
  expect(store.getConnection('claude', narrowContext(where, 'install'))?.scope).toBe('install')
})
