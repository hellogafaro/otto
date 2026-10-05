import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { createSecretsStore, parseEncryptionKey } from './index.ts'

const KEY = parseEncryptionKey('0'.repeat(64))
const OTHER_KEY = parseEncryptionKey('1'.repeat(64))

function setup(key = KEY) {
  const db = new Database(':memory:')
  return { db, store: createSecretsStore(db, key) }
}

test('a secret round-trips and is not stored in plain text', () => {
  const { db, store } = setup()
  const id = store.createSecret('anthropic-key', 'sk-ant-123')
  expect(id).toMatch(/^[0-9a-z]{12}$/)
  expect(store.getSecret(id)).toBe('sk-ant-123')
  const row = db.query('SELECT name, value FROM secrets WHERE id = ?').get(id) as { name: string; value: string }
  expect(row.name).toBe('anthropic-key')
  expect(row.value).not.toContain('sk-ant-123')
})

test('the same value encrypts differently each time', () => {
  const { db, store } = setup()
  const a = store.createSecret('a', 'same')
  const b = store.createSecret('b', 'same')
  const rows = db.query('SELECT value FROM secrets').all() as { value: string }[]
  expect(rows[0]!.value).not.toBe(rows[1]!.value)
  expect(store.getSecret(a)).toBe(store.getSecret(b))
})

test('names are unique and a missing secret is undefined', () => {
  const { store } = setup()
  store.createSecret('dup', 'x')
  expect(() => store.createSecret('dup', 'y')).toThrow()
  expect(store.getSecret('nope')).toBeUndefined()
})

test('update replaces the value and fails for a missing id', () => {
  const { store } = setup()
  const id = store.createSecret('k', 'old')
  store.updateSecret(id, 'new')
  expect(store.getSecret(id)).toBe('new')
  expect(() => store.updateSecret('missing', 'x')).toThrow()
})

test('delete removes it and is safe to repeat', () => {
  const { store } = setup()
  const id = store.createSecret('k', 'v')
  store.deleteSecret(id)
  store.deleteSecret(id)
  expect(store.getSecret(id)).toBeUndefined()
})

test('the wrong key does not decrypt', () => {
  const { db, store } = setup()
  const id = store.createSecret('k', 'v')
  expect(() => createSecretsStore(db, OTHER_KEY).getSecret(id)).toThrow()
})

test('a tampered value does not decrypt', () => {
  const { db, store } = setup()
  const id = store.createSecret('k', 'value')
  const { value } = db.query('SELECT value FROM secrets WHERE id = ?').get(id) as { value: string }
  const bytes = Buffer.from(value, 'base64')
  bytes[bytes.length - 1]! ^= 1
  db.query('UPDATE secrets SET value = ? WHERE id = ?').run(bytes.toString('base64'), id)
  expect(() => store.getSecret(id)).toThrow()
})

test('a ciphertext moved to another id does not decrypt', () => {
  const { db, store } = setup()
  const a = store.createSecret('a', 'secret-a')
  const b = store.createSecret('b', 'secret-b')
  const { value } = db.query('SELECT value FROM secrets WHERE id = ?').get(a) as { value: string }
  db.query('UPDATE secrets SET value = ? WHERE id = ?').run(value, b)
  expect(() => store.getSecret(b)).toThrow()
})

test('the key must be set and 32 bytes', () => {
  expect(() => parseEncryptionKey(undefined)).toThrow('not set')
  expect(() => parseEncryptionKey('  ')).toThrow('not set')
  expect(() => parseEncryptionKey('abcd')).toThrow('32 bytes')
  expect(parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32)
  expect(parseEncryptionKey('0'.repeat(64))).toHaveLength(32)
})
