import type { Database } from 'bun:sqlite'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getDb } from '../db/index.ts'
import { createId } from '../id.ts'

/**
 * Secrets: keys, tokens and envs, encrypted at rest.
 *
 *   secrets(id, name, value)
 *
 * `value` is one base64 string: nonce (12) + ciphertext + auth tag (16),
 * AES-256-GCM under `ENCRYPTION_KEY`. The row id is the authenticated data, so
 * a ciphertext copied into another row does not decrypt. No rotation or
 * versioning. Other domains keep a `secretId`; the value never leaves the server.
 */

const NONCE_BYTES = 12
const TAG_BYTES = 16

/** `ENCRYPTION_KEY` is 32 bytes as 64 hex characters or base64. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const text = raw?.trim()
  if (!text) throw new Error('ENCRYPTION_KEY is not set')
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64')
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)')
  return key
}

export function createSecretsStore(db: Database, key: Buffer) {
  db.exec(`CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL
  )`)

  function encrypt(id: string, plain: string): string {
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(Buffer.from(id))
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64')
  }

  function decrypt(id: string, value: string): string {
    const data = Buffer.from(value, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, NONCE_BYTES))
    decipher.setAAD(Buffer.from(id))
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES))
    const body = data.subarray(NONCE_BYTES, data.length - TAG_BYTES)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  }

  return {
    /** Store a new secret; `name` is unique. Returns its id. */
    createSecret(name: string, value: string): string {
      const id = createId()
      db.query('INSERT INTO secrets (id, name, value) VALUES (?, ?, ?)').run(id, name, encrypt(id, value))
      return id
    },

    /** The secret's value, or undefined when there is none. */
    getSecret(id: string): string | undefined {
      const row = db.query('SELECT value FROM secrets WHERE id = ?').get(id) as { value: string } | null
      return row ? decrypt(id, row.value) : undefined
    },

    /** Replace the value of an existing secret. */
    updateSecret(id: string, value: string): void {
      const result = db.query('UPDATE secrets SET value = ? WHERE id = ?').run(encrypt(id, value), id)
      if (result.changes === 0) throw new Error(`Secret ${id} does not exist`)
    },

    deleteSecret(id: string): void {
      db.query('DELETE FROM secrets WHERE id = ?').run(id)
    },
  }
}

let store: ReturnType<typeof createSecretsStore> | undefined

function defaultStore() {
  return (store ??= createSecretsStore(getDb(), parseEncryptionKey(process.env.ENCRYPTION_KEY)))
}

/** Fail at boot, not at the first read, when the key is missing or wrong. */
export function assertSecretsReady(): void {
  defaultStore()
}

export const createSecret = (name: string, value: string) => defaultStore().createSecret(name, value)
export const getSecret = (id: string) => defaultStore().getSecret(id)
export const updateSecret = (id: string, value: string) => defaultStore().updateSecret(id, value)
export const deleteSecret = (id: string) => defaultStore().deleteSecret(id)
