import { eq } from 'drizzle-orm'
import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createSecretsStore, parseEncryptionKey } from '../secrets/index.ts'
import { secrets } from '../secrets/schema.ts'
import { createConnectionsStore } from './index.ts'
import { connections } from './schema.ts'

const KEY = parseEncryptionKey('0'.repeat(64))

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return { db, store: createConnectionsStore(db, createSecretsStore(db, KEY)) }
}

const secretRows = (db: ReturnType<typeof openDb>) => db.select().from(secrets).all()

test('create takes title and baseUrl from the catalog', async () => {
  const { store } = await setup()
  const connection = store.createConnection({ type: 'openai' })
  expect(connection.id).toMatch(/^[0-9a-z]{12}$/)
  expect(connection).toMatchObject({ type: 'openai', title: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hasSecret: false })
  expect(connection.createdAt).toBeInstanceOf(Date)
  expect(store.createConnection({ type: 'claude' }).baseUrl).toBeNull()
  expect(store.getConnection(connection.id)).toEqual(connection)
})

test('create with a secret stores it and keeps explicit values', async () => {
  const { db, store } = await setup()
  const connection = store.createConnection({ type: 'custom', title: 'My proxy', baseUrl: 'http://proxy.test/v1', secret: 'sk-123' })
  expect(connection).toMatchObject({ title: 'My proxy', baseUrl: 'http://proxy.test/v1', hasSecret: true })
  expect(store.getConnectionSecret(connection.id)).toBe('sk-123')
  expect(secretRows(db).map((row) => row.title)).toEqual(['My proxy'])
})

test('an unknown type throws and stores nothing', async () => {
  const { db, store } = await setup()
  expect(() => store.createConnection({ type: 'nope', secret: 'x' })).toThrow('Unknown connection type: nope')
  expect(store.getConnections()).toEqual([])
  expect(secretRows(db)).toEqual([])
})

test('a failed insert does not leave an orphan secret', async () => {
  const { db, store } = await setup()
  db.run('DROP TABLE connections')
  expect(() => store.createConnection({ type: 'openai', secret: 'x' })).toThrow()
  expect(secretRows(db)).toEqual([])
})

test('getConnections is ordered by creation', async () => {
  const { db, store } = await setup()
  const a = store.createConnection({ type: 'openai' })
  const b = store.createConnection({ type: 'anthropic' })
  const c = store.createConnection({ type: 'ollama' })
  db.update(connections).set({ createdAt: new Date(3000) }).where(eq(connections.id, a.id)).run()
  db.update(connections).set({ createdAt: new Date(1000) }).where(eq(connections.id, b.id)).run()
  db.update(connections).set({ createdAt: new Date(2000) }).where(eq(connections.id, c.id)).run()
  expect(store.getConnections().map((connection) => connection.id)).toEqual([b.id, c.id, a.id])
})

test('missing connections read as undefined', async () => {
  const { store } = await setup()
  expect(store.getConnection('nope')).toBeUndefined()
  expect(store.getConnectionSecret('nope')).toBeUndefined()
  expect(store.createConnection({ type: 'ollama' })).toBeDefined()
  expect(store.getConnectionSecret(store.getConnections()[0]!.id)).toBeUndefined()
})

test('update changes title and baseUrl and keeps the rest', async () => {
  const { store } = await setup()
  const created = store.createConnection({ type: 'openai', secret: 'sk' })
  const updated = store.updateConnection(created.id, { title: 'Work', baseUrl: 'http://gw.test' })
  expect(updated).toMatchObject({ id: created.id, type: 'openai', title: 'Work', baseUrl: 'http://gw.test', hasSecret: true })
  expect(updated.createdAt).toEqual(created.createdAt)
  expect(store.updateConnection(created.id, {})).toEqual(updated)
  expect(store.getConnectionSecret(created.id)).toBe('sk')
})

test('update replaces an existing secret and creates a missing one', async () => {
  const { db, store } = await setup()
  const withSecret = store.createConnection({ type: 'openai', secret: 'old' })
  store.updateConnection(withSecret.id, { secret: 'new' })
  expect(store.getConnectionSecret(withSecret.id)).toBe('new')
  expect(secretRows(db)).toHaveLength(1)

  const without = store.createConnection({ type: 'ollama' })
  expect(store.updateConnection(without.id, { secret: 'fresh' }).hasSecret).toBe(true)
  expect(store.getConnectionSecret(without.id)).toBe('fresh')
  expect(secretRows(db)).toHaveLength(2)
})

test('update of a missing connection throws', async () => {
  const { store } = await setup()
  expect(() => store.updateConnection('missing', { title: 'x' })).toThrow()
})

test('delete removes the row and its secret and is safe to repeat', async () => {
  const { db, store } = await setup()
  const keep = store.createConnection({ type: 'anthropic', secret: 'keep' })
  const gone = store.createConnection({ type: 'openai', secret: 'gone' })
  store.deleteConnection(gone.id)
  store.deleteConnection(gone.id)
  expect(store.getConnection(gone.id)).toBeUndefined()
  expect(db.select().from(connections).all().map((row) => row.id)).toEqual([keep.id])
  expect(secretRows(db)).toHaveLength(1)
  expect(store.getConnectionSecret(keep.id)).toBe('keep')
})

test('a returned connection never carries the secret', async () => {
  const { store } = await setup()
  const created = store.createConnection({ type: 'openai', secret: 'sk-very-secret' })
  const updated = store.updateConnection(created.id, { secret: 'sk-even-more-secret' })
  for (const connection of [created, updated, store.getConnection(created.id), ...store.getConnections()]) {
    expect(Object.keys(connection!).sort()).toEqual(['baseUrl', 'createdAt', 'hasSecret', 'id', 'title', 'type'])
    expect(JSON.stringify(connection)).not.toContain('secret-')
    expect(JSON.stringify(connection)).not.toContain('sk-')
  }
})
