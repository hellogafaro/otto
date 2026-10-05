import { eq } from 'drizzle-orm'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { initDb, type Db } from '../db/index.ts'
import { createId } from '../id.ts'
import { secrets } from './schema.ts'

/**
 * Secrets: keys, tokens and envs, encrypted at rest.
 *
 *   secrets(id, title, value)   (schema.ts)
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

export function createSecretsStore(db: Db, key: Buffer) {
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
    /** Store a new secret under a human `title`. Returns its id. */
    createSecret(title: string, value: string): string {
      const id = createId()
      db.insert(secrets).values({ id, title, value: encrypt(id, value) }).run()
      return id
    },

    /** The secret's value, or undefined when there is none. */
    getSecret(id: string): string | undefined {
      const row = db.select({ value: secrets.value }).from(secrets).where(eq(secrets.id, id)).get()
      return row ? decrypt(id, row.value) : undefined
    },

    /** Replace the value of an existing secret. */
    updateSecret(id: string, value: string): void {
      const updated = db.update(secrets).set({ value: encrypt(id, value) }).where(eq(secrets.id, id)).returning({ id: secrets.id }).all()
      if (updated.length === 0) throw new Error(`Secret ${id} does not exist`)
    },

    deleteSecret(id: string): void {
      db.delete(secrets).where(eq(secrets.id, id)).run()
    },
  }
}

let store: ReturnType<typeof createSecretsStore> | undefined

function defaultStore() {
  return (store ??= createSecretsStore(initDb(), parseEncryptionKey(process.env.ENCRYPTION_KEY)))
}

/** Set the secrets domain up at boot: fails now, not at the first read, when the key is missing or wrong. */
export function initSecrets(): void {
  defaultStore()
}

export const createSecret = (title: string, value: string) => defaultStore().createSecret(title, value)
export const getSecret = (id: string) => defaultStore().getSecret(id)
export const updateSecret = (id: string, value: string) => defaultStore().updateSecret(id, value)
export const deleteSecret = (id: string) => defaultStore().deleteSecret(id)
