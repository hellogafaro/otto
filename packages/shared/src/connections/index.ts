import { asc, eq } from 'drizzle-orm'
import { initDb, type Db } from '../db/index.ts'
import { createId } from '../id.ts'
import { initSecretsStore, type createSecretsStore } from '../secrets/index.ts'
import { getCatalogEntry, type ConnectionType } from './catalog.ts'
import { connections } from './schema.ts'

/**
 * Connections: the accounts and endpoints Otto talks to (AI providers for now).
 *
 *   connections(id, type, title, baseUrl, secretId, createdAt)   (schema.ts)
 *
 * `type` is an id from the catalog (catalog.ts). The credential lives in the
 * secrets domain; a connection only keeps its `secretId`, and neither the id
 * nor the value is ever returned: callers see `hasSecret`, and the server reads
 * the value with `getConnectionSecret`.
 */

type SecretsStore = ReturnType<typeof createSecretsStore>

export type Connection = {
  id: string
  type: ConnectionType
  title: string
  baseUrl: string | null
  hasSecret: boolean
  createdAt: Date
}

function toConnection(row: typeof connections.$inferSelect): Connection {
  return {
    id: row.id,
    type: row.type as ConnectionType,
    title: row.title,
    baseUrl: row.baseUrl,
    hasSecret: row.secretId !== null,
    createdAt: row.createdAt,
  }
}

export function createConnectionsStore(db: Db, secrets: SecretsStore) {
  const rowOf = (id: string) => db.select().from(connections).where(eq(connections.id, id)).get()

  return {
    createConnection(input: { type: string; title?: string; baseUrl?: string; secret?: string }): Connection {
      const entry = getCatalogEntry(input.type)
      if (!entry) throw new Error(`Unknown connection type: ${input.type}`)
      const title = input.title ?? entry.title
      const secretId = input.secret === undefined ? null : secrets.createSecret(title, input.secret)
      try {
        const row = db
          .insert(connections)
          .values({
            id: createId(),
            type: entry.id,
            title,
            baseUrl: input.baseUrl ?? entry.baseUrl ?? null,
            secretId,
            createdAt: new Date(),
          })
          .returning()
          .get()
        return toConnection(row)
      } catch (error) {
        if (secretId) secrets.deleteSecret(secretId)
        throw error
      }
    },

    getConnection(id: string): Connection | undefined {
      const row = rowOf(id)
      return row && toConnection(row)
    },

    getConnections(): Connection[] {
      return db.select().from(connections).orderBy(asc(connections.createdAt)).all().map(toConnection)
    },

    /** The stored credential, or undefined when the connection has none. */
    getConnectionSecret(id: string): string | undefined {
      const secretId = rowOf(id)?.secretId
      return secretId ? secrets.getSecret(secretId) : undefined
    },

    updateConnection(id: string, patch: { title?: string; baseUrl?: string; secret?: string }): Connection {
      const row = rowOf(id)
      if (!row) throw new Error(`Connection ${id} does not exist`)
      let secretId = row.secretId
      let createdSecretId: string | undefined
      if (patch.secret !== undefined) {
        if (secretId) secrets.updateSecret(secretId, patch.secret)
        else secretId = createdSecretId = secrets.createSecret(patch.title ?? row.title, patch.secret)
      }
      try {
        const updated = db
          .update(connections)
          .set({ title: patch.title, baseUrl: patch.baseUrl, secretId })
          .where(eq(connections.id, id))
          .returning()
          .get()
        return toConnection(updated)
      } catch (error) {
        if (createdSecretId) secrets.deleteSecret(createdSecretId)
        throw error
      }
    },

    /** Removes the connection and its secret. */
    deleteConnection(id: string): void {
      const secretId = rowOf(id)?.secretId
      db.delete(connections).where(eq(connections.id, id)).run()
      if (secretId) secrets.deleteSecret(secretId)
    },
  }
}

let store: ReturnType<typeof createConnectionsStore> | undefined

function defaultStore() {
  return (store ??= createConnectionsStore(initDb(), initSecretsStore()))
}

export const createConnection = (input: { type: string; title?: string; baseUrl?: string; secret?: string }) =>
  defaultStore().createConnection(input)
export const getConnection = (id: string) => defaultStore().getConnection(id)
export const getConnections = () => defaultStore().getConnections()
export const getConnectionSecret = (id: string) => defaultStore().getConnectionSecret(id)
export const updateConnection = (id: string, patch: { title?: string; baseUrl?: string; secret?: string }) =>
  defaultStore().updateConnection(id, patch)
export const deleteConnection = (id: string) => defaultStore().deleteConnection(id)
