import { afterEach, beforeEach, expect, test } from 'bun:test'
import * as nodeFs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEncryptionKey } from '@otto/shared/secrets'
import { initEncryptionKey } from '../encryption-key'

// A reversible fake of the OS keychain: the "protected" blob is the text reversed.
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain: string) => Buffer.from([...plain].reverse().join('')),
  decryptString: (blob: Buffer) => [...blob.toString()].reverse().join(''),
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'otto-key-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const file = () => join(dir, 'encryption-key')

test('generates a 32-byte key once and loads the same one on every launch', () => {
  const first: Record<string, string | undefined> = {}
  expect(initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env: first })).toBe('safe')
  expect(parseEncryptionKey(first.ENCRYPTION_KEY)).toHaveLength(32)

  const second: Record<string, string | undefined> = {}
  initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env: second })
  expect(second.ENCRYPTION_KEY).toBe(first.ENCRYPTION_KEY)
})

test('the file holds the protected blob, not the key, with mode 0600', () => {
  const env: Record<string, string | undefined> = {}
  initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env })
  expect(readFileSync(file(), 'utf8')).not.toContain(env.ENCRYPTION_KEY!)
  expect(statSync(file()).mode & 0o777).toBe(0o600)
})

test('an ENCRYPTION_KEY in the environment wins and no file is written', () => {
  const env = { ENCRYPTION_KEY: 'a'.repeat(64) }
  expect(initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env })).toBe('env')
  expect(env.ENCRYPTION_KEY).toBe('a'.repeat(64))
  expect(() => statSync(file())).toThrow()
})

test('without safeStorage the key is kept in a 0600 file in the clear, with a warning', () => {
  const warnings: string[] = []
  const first: Record<string, string | undefined> = {}
  expect(initEncryptionKey({ safeStorage: fakeSafeStorage(false), configDir: dir, env: first, warn: (m) => warnings.push(m) })).toBe('plain')
  expect(warnings).toHaveLength(1)
  expect(statSync(file()).mode & 0o777).toBe(0o600)

  const second: Record<string, string | undefined> = {}
  expect(initEncryptionKey({ safeStorage: fakeSafeStorage(false), configDir: dir, env: second })).toBe('plain')
  expect(second.ENCRYPTION_KEY).toBe(first.ENCRYPTION_KEY)
})

test.each([
  ['garbage', 'not a key'],
  ['an unknown format', 'rot13:abcd'],
  ['a protected blob of the wrong size', `safe:${Buffer.from('short').toString('base64')}`],
  ['an empty file', ''],
])('%s is an error and the file is left as it was', (_name, content) => {
  writeFileSync(file(), content)
  const env: Record<string, string | undefined> = {}
  expect(() => initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env })).toThrow(/cannot be used/)
  expect(env.ENCRYPTION_KEY).toBeUndefined()
  expect(readFileSync(file(), 'utf8')).toBe(content)
})

test('a blob the keychain cannot decrypt is an error, never a new key', () => {
  initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env: {} })
  const before = readFileSync(file(), 'utf8')
  const broken = { ...fakeSafeStorage(), decryptString: () => { throw new Error('keychain changed') } }
  expect(() => initEncryptionKey({ safeStorage: broken, configDir: dir, env: {} })).toThrow(/keychain changed/)
  expect(readFileSync(file(), 'utf8')).toBe(before)
})

test('an unreadable file (not a missing one) is an error', () => {
  const fs = { ...nodeFs, readFileSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) } }
  expect(() => initEncryptionKey({ safeStorage: fakeSafeStorage(), configDir: dir, env: {}, fs })).toThrow(/denied/)
})
