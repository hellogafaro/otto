import { eq } from 'drizzle-orm'
import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createSecretsStore, parseEncryptionKey } from './index.ts'
import { secrets } from './schema.ts'

const KEY = parseEncryptionKey('0'.repeat(64))
const OTHER_KEY = parseEncryptionKey('1'.repeat(64))

async function setup(key = KEY) {
  const db = openDb(':memory:')
  await pushSchema(db)
  return { db, store: createSecretsStore(db, key) }
}

const rowOf = (db: ReturnType<typeof openDb>, id: string) =>
  db.select().from(secrets).where(eq(secrets.id, id)).get()!

test('a secret round-trips and is not stored in plain text', async () => {
  const { db, store } = await setup()
  const id = store.createSecret('anthropic-key', 'sk-ant-123')
  expect(id).toMatch(/^[0-9a-z]{12}$/)
  expect(store.getSecret(id)).toBe('sk-ant-123')
  const row = rowOf(db, id)
  expect(row.title).toBe('anthropic-key')
  expect(row.value).not.toContain('sk-ant-123')
})

test('the same value encrypts differently each time', async () => {
  const { db, store } = await setup()
  const a = store.createSecret('a', 'same')
  const b = store.createSecret('b', 'same')
  expect(rowOf(db, a).value).not.toBe(rowOf(db, b).value)
  expect(store.getSecret(a)).toBe(store.getSecret(b))
})

test('a missing secret is undefined', async () => {
  const { store } = await setup()
  expect(store.getSecret('nope')).toBeUndefined()
})

test('update replaces the value and fails for a missing id', async () => {
  const { store } = await setup()
  const id = store.createSecret('k', 'old')
  store.updateSecret(id, 'new')
  expect(store.getSecret(id)).toBe('new')
  expect(() => store.updateSecret('missing', 'x')).toThrow()
})

test('delete removes it and is safe to repeat', async () => {
  const { store } = await setup()
  const id = store.createSecret('k', 'v')
  store.deleteSecret(id)
  store.deleteSecret(id)
  expect(store.getSecret(id)).toBeUndefined()
})

test('the wrong key does not decrypt', async () => {
  const { db, store } = await setup()
  const id = store.createSecret('k', 'v')
  expect(() => createSecretsStore(db, OTHER_KEY).getSecret(id)).toThrow()
})

test('a tampered value does not decrypt', async () => {
  const { db, store } = await setup()
  const id = store.createSecret('k', 'value')
  const { value } = rowOf(db, id)
  const bytes = Buffer.from(value, 'base64')
  bytes[bytes.length - 1]! ^= 1
  db.update(secrets).set({ value: bytes.toString('base64') }).where(eq(secrets.id, id)).run()
  expect(() => store.getSecret(id)).toThrow()
})

test('a ciphertext moved to another id does not decrypt', async () => {
  const { db, store } = await setup()
  const a = store.createSecret('a', 'secret-a')
  const b = store.createSecret('b', 'secret-b')
  const { value } = rowOf(db, a)
  db.update(secrets).set({ value }).where(eq(secrets.id, b)).run()
  expect(() => store.getSecret(b)).toThrow()
})

test('the key must be set and 32 bytes', () => {
  expect(() => parseEncryptionKey(undefined)).toThrow('not set')
  expect(() => parseEncryptionKey('  ')).toThrow('not set')
  expect(() => parseEncryptionKey('abcd')).toThrow('32 bytes')
  expect(parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32)
  expect(parseEncryptionKey('0'.repeat(64))).toHaveLength(32)
})
