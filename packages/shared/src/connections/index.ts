import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { initDb, type Db } from '../db/index.ts'
import { createId } from '../id.ts'
import { initSecretsStore, type createSecretsStore } from '../secrets/index.ts'
import { getSetting, INSTALL, updateSetting, userEntity } from '../settings/index.ts'
import type { CustomEndpointConfig, LlmAuthType, LlmProviderType, MidStreamBehavior, ModelSelectionMode } from '../config/llm-connections.ts'
import type { ModelDefinition } from '../config/models.ts'
import { connections } from './schema.ts'

/**
 * Connections: the provider accounts and endpoints Otto talks to, the one source of truth for them.
 *
 *   connections(id, scope, slug, type, authType, title, baseUrl, defaultModel, models, config, account,
 *               secretId, lastUsedAt, createdAt, updatedAt)   unique (scope, slug)   (schema.ts)
 *
 * `scope` is `user:<id>` (a person's own subscription or key, which powers their agents and is seen by nobody else,
 * the instance owner included), `workspace:<id>` (shared by its members) or `install` (imported connections, one for
 * the whole server or desktop). A read by slug looks in the user's scope first, then the workspace's, then the
 * install's (`ConnectionContext`); the credential of a connection is addressed by its exact scope. `type` is the
 * provider type, `models` the fetched list,
 * `config` and `account` small JSON objects. The credential lives in the secrets domain as one JSON value per
 * connection (`Credential`); a connection only keeps its `secretId`, and neither the id nor the value is ever
 * returned: callers see `hasSecret`, and the server reads the value with `getCredential`. The default connection is
 * the install setting `defaultConnectionSlug`. Every write that touches a row and its secret is one transaction.
 */

export const INSTALL_SCOPE = 'install'
export const workspaceScope = (workspaceId: string) => `workspace:${workspaceId}`
export const userScope = (userId: string) => `user:${userId}`

/** Whose connections a lookup sees: the user's own, the workspace's, then the install's (the first with a slug wins). */
export type ConnectionContext = { workspaceId?: string | null; userId?: string | null; /** `false`: the install's connections are not looked at (a request that names one scope). */ installToo?: boolean }

/** What a setup or save asks for: the connection of one scope only (`undefined`: the first the context sees). */
export type ConnectionScopeKind = 'install' | 'workspace' | 'user'

/** The context narrowed to the one scope a request names. */
export function narrowContext(where: ConnectionContext, kind?: ConnectionScopeKind): ConnectionContext {
  if (kind === 'user') return { userId: where.userId, installToo: false }
  if (kind === 'workspace') return { workspaceId: where.workspaceId, installToo: false }
  return kind === 'install' ? {} : where
}

/** The provider types a connection may have. */
export const CONNECTION_TYPES = ['anthropic', 'pi', 'pi_compat'] as const

/** What a connection's secret holds: an API key, OAuth tokens, AWS IAM keys or a service account; whichever the auth type needs. */
export type Credential = {
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  idToken?: string
  expiresAt?: number
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  region?: string
  serviceAccountJson?: string
  projectId?: string
  email?: string
}

export type ConnectionConfig = {
  modelSelectionMode?: ModelSelectionMode
  piAuthProvider?: string
  customEndpoint?: CustomEndpointConfig
  midStreamBehavior?: MidStreamBehavior
}

export type ConnectionAccount = {
  oauthAccountUuid?: string
  oauthAccountEmail?: string
  oauthOrganizationUuid?: string
  oauthOrganizationName?: string
  verifiedAt?: number
}

export type Connection = {
  id: string
  scope: string
  slug: string
  type: LlmProviderType
  authType: LlmAuthType
  title: string
  baseUrl: string | null
  defaultModel: string | null
  models: Array<ModelDefinition | string> | null
  config: ConnectionConfig
  account: ConnectionAccount
  hasSecret: boolean
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ConnectionInput = {
  slug: string
  /** 'install' (default) or 'workspace:<id>'. */
  scope?: string
  type: LlmProviderType
  authType: LlmAuthType
  title: string
  baseUrl?: string | null
  defaultModel?: string | null
  models?: Array<ModelDefinition | string> | null
  config?: ConnectionConfig
  account?: ConnectionAccount
  lastUsedAt?: Date | null
  createdAt?: Date
}

/** A change to a connection: a field left out stays as it is; `models`, `config` and `account` are replaced whole. */
export type ConnectionPatch = Partial<Omit<ConnectionInput, 'slug' | 'scope' | 'createdAt'>>

type SecretsStore = ReturnType<typeof createSecretsStore>
type Row = typeof connections.$inferSelect

const parse = <T>(text: string | null, fallback: T): T => {
  if (text === null) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}
const toJson = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value))

function toConnection(row: Row): Connection {
  return {
    id: row.id,
    scope: row.scope,
    slug: row.slug ?? '',
    type: row.type as LlmProviderType,
    authType: row.authType as LlmAuthType,
    title: row.title,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    models: parse(row.models, null),
    config: parse(row.config, {}),
    account: parse(row.account, {}),
    hasSecret: row.secretId !== null,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  }
}

/**
 * A credential held in memory for a slug with no row yet in a scope: a sign-in finished before the connection was
 * saved, or a connection test. It is kept per scope (a user's is never found by another's setup).
 */
const STAGED_MS = 30 * 60_000

export function createConnectionsStore(db: Db, secrets: SecretsStore) {
  const staged = new Map<string, { credential: Credential; until: number }>()
  const stagedKey = (scope: string, slug: string) => `${scope}\n${slug}`
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach((listener) => listener())
  const rowOf = (id: string) => db.select().from(connections).where(eq(connections.id, id)).get()

  /** The connections this context sees, the user's own first, then the workspace's, then the install's; a slug shows once. */
  const rowsOf = (where?: ConnectionContext): Row[] => {
    const scopes = [where?.userId ? userScope(where.userId) : null, where?.workspaceId ? workspaceScope(where.workspaceId) : null, where?.installToo === false ? null : INSTALL_SCOPE].filter((scope): scope is string => scope !== null)
    const rows = db.select().from(connections).where(inArray(connections.scope, scopes)).orderBy(asc(connections.createdAt), sql`rowid`).all()
    const seen = new Set<string>()
    return scopes
      .flatMap((scope) => rows.filter((row) => row.scope === scope))
      .filter((row) => !seen.has(row.slug ?? '') && seen.add(row.slug ?? ''))
  }
  const lookup = (slug: string, where?: ConnectionContext): Row | undefined => rowsOf(where).find((row) => row.slug === slug)
  const exact = (slug: string, scope: string): Row | undefined =>
    db.select().from(connections).where(and(eq(connections.slug, slug), eq(connections.scope, scope))).get()

  const stagedCredential = (scope: string, slug: string): Credential | undefined => {
    const key = stagedKey(scope, slug)
    const entry = staged.get(key)
    if (entry && entry.until < Date.now()) staged.delete(key)
    return staged.get(key)?.credential
  }

  const store = {
    /** A connection by slug: the user's own first, then the workspace's, then the install's. */
    getConnection(slug: string, where?: ConnectionContext): Connection | undefined {
      const row = lookup(slug, where)
      return row && toConnection(row)
    },

    getConnectionById(id: string): Connection | undefined {
      const row = rowOf(id)
      return row && toConnection(row)
    },

    /** The connections a context sees (the user's own, then the workspace's, then the install's, one per slug); the install's alone without one. */
    getConnections(where?: ConnectionContext): Connection[] {
      return rowsOf(where).map(toConnection)
    },

    /** Every connection of every scope, for what serves the whole install (model refresh). */
    getAllConnections(): Connection[] {
      return db.select().from(connections).orderBy(asc(connections.createdAt), sql`rowid`).all().map(toConnection)
    },

    /** Creates the connection and, in the same transaction, its secret (the given credential, else one staged under the slug). */
    createConnection(input: ConnectionInput, credential?: Credential): Connection {
      const scope = input.scope ?? INSTALL_SCOPE
      const secret = credential ?? stagedCredential(scope, input.slug)
      const now = new Date()
      const row = db.transaction(() => {
        const secretId = secret ? secrets.createSecret(input.title, JSON.stringify(secret)) : null
        return db
          .insert(connections)
          .values({
            id: createId(),
            scope,
            slug: input.slug,
            type: input.type,
            authType: input.authType,
            title: input.title,
            baseUrl: input.baseUrl ?? null,
            defaultModel: input.defaultModel ?? null,
            models: toJson(input.models),
            config: toJson(input.config),
            account: toJson(input.account),
            secretId,
            lastUsedAt: input.lastUsedAt ?? null,
            createdAt: input.createdAt ?? now,
            updatedAt: now,
          })
          .returning()
          .get()
      })
      staged.delete(stagedKey(scope, input.slug))
      // the first connection of the install becomes its default
      if (scope === INSTALL_SCOPE && !getSetting(INSTALL, 'defaultConnectionSlug', db)) updateSetting(INSTALL, 'defaultConnectionSlug', row.slug, db)
      changed()
      return toConnection(row)
    },

    /**
     * Updates a connection and, in the same transaction, its secret: a credential replaces it (one is made when
     * there is none), `null` removes it, `undefined` leaves it.
     */
    updateConnection(id: string, patch: ConnectionPatch, credential?: Credential | null): Connection {
      const updated = db.transaction(() => {
        const row = rowOf(id)
        if (!row) throw new Error(`Connection ${id} does not exist`)
        let secretId = row.secretId
        if (credential === null) {
          if (secretId) secrets.deleteSecret(secretId)
          secretId = null
        } else if (credential !== undefined) {
          if (secretId) secrets.updateSecret(secretId, JSON.stringify(credential))
          else secretId = secrets.createSecret(patch.title ?? row.title, JSON.stringify(credential))
        }
        return db
          .update(connections)
          .set({
            type: patch.type,
            authType: patch.authType,
            title: patch.title,
            baseUrl: patch.baseUrl,
            defaultModel: patch.defaultModel,
            models: patch.models === undefined ? undefined : toJson(patch.models),
            config: patch.config === undefined ? undefined : toJson(patch.config),
            account: patch.account === undefined ? undefined : toJson(patch.account),
            lastUsedAt: patch.lastUsedAt,
            secretId,
            updatedAt: new Date(),
          })
          .where(eq(connections.id, id))
          .returning()
          .get()
      })
      if (Object.keys(patch).length > 0) changed()
      return toConnection(updated)
    },

    /** Removes the connection and its secret; the default moves to the first connection left when it was this one. */
    deleteConnection(id: string): void {
      const row = rowOf(id)
      if (!row) return
      db.transaction(() => {
        db.delete(connections).where(eq(connections.id, id)).run()
        if (row.secretId) secrets.deleteSecret(row.secretId)
      })
      if (row.scope === INSTALL_SCOPE && getSetting(INSTALL, 'defaultConnectionSlug', db) === row.slug) {
        updateSetting(INSTALL, 'defaultConnectionSlug', rowsOf()[0]?.slug ?? null, db)
      }
      changed()
    },

    /** Calls the listener after a connection is created, changed (not just its credential) or deleted; returns how to stop. */
    onConnectionsChange(listener: () => void): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    /** The credential of the connection of this exact scope (the install's by default), or the one staged under the slug while no connection has it. */
    getCredential(slug: string, scope: string = INSTALL_SCOPE): Credential | undefined {
      const row = exact(slug, scope)
      if (!row) return stagedCredential(scope, slug)
      return row.secretId ? parse<Credential | undefined>(secrets.getSecret(row.secretId) ?? null, undefined) : undefined
    },

    /** Replaces the credential in place (atomically); with no connection yet it is staged in memory for the one the setup creates next. */
    setCredential(slug: string, credential: Credential, scope: string = INSTALL_SCOPE): void {
      const row = exact(slug, scope)
      if (row) store.updateConnection(row.id, {}, credential)
      else staged.set(stagedKey(scope, slug), { credential, until: Date.now() + STAGED_MS })
    },

    deleteCredential(slug: string, scope: string = INSTALL_SCOPE): void {
      staged.delete(stagedKey(scope, slug))
      const row = exact(slug, scope)
      if (row?.secretId) store.updateConnection(row.id, {}, null)
    },

    /** The connection a chat uses when it names none: the person's own default, else their first own connection, else the install's default setting, else the first one the context sees. */
    getDefaultConnection(where?: ConnectionContext): Connection | undefined {
      const own = where?.userId ? getSetting(userEntity(where.userId), 'userDefaultConnectionSlug', db) : null
      const rows = rowsOf(where)
      const mine = rows.filter((row) => where?.userId && row.scope === userScope(where.userId))
      const installDefault = getSetting(INSTALL, 'defaultConnectionSlug', db)
      const row = (own ? mine.find((r) => r.slug === own) : undefined) ?? mine[0] ?? (installDefault ? rows.find((r) => r.slug === installDefault) : undefined) ?? rows[0]
      return row && toConnection(row)
    },

    /** Makes a connection the default (a person's own for their own connection, the install's otherwise); false when it does not exist. */
    setDefaultConnection(slug: string, where?: ConnectionContext): boolean {
      const row = lookup(slug, where)
      if (!row) return false
      if (row.scope.startsWith('user:')) updateSetting(userEntity(row.scope.slice('user:'.length)), 'userDefaultConnectionSlug', slug, db)
      else updateSetting(INSTALL, 'defaultConnectionSlug', slug, db)
      return true
    },
  }
  return store
}

let store: ReturnType<typeof createConnectionsStore> | undefined

function defaultStore() {
  return (store ??= createConnectionsStore(initDb(), initSecretsStore()))
}

export const getConnection = (slug: string, where?: ConnectionContext) => defaultStore().getConnection(slug, where)
export const getConnectionById = (id: string) => defaultStore().getConnectionById(id)
export const getConnections = (where?: ConnectionContext) => defaultStore().getConnections(where)
export const getAllConnections = () => defaultStore().getAllConnections()
export const createConnection = (input: ConnectionInput, credential?: Credential) => defaultStore().createConnection(input, credential)
export const updateConnection = (id: string, patch: ConnectionPatch, credential?: Credential | null) => defaultStore().updateConnection(id, patch, credential)
export const deleteConnection = (id: string) => defaultStore().deleteConnection(id)
export const getCredential = (slug: string, scope?: string) => defaultStore().getCredential(slug, scope)
export const setCredential = (slug: string, credential: Credential, scope?: string) => defaultStore().setCredential(slug, credential, scope)
export const deleteCredential = (slug: string, scope?: string) => defaultStore().deleteCredential(slug, scope)
export const onConnectionsChange = (listener: () => void) => defaultStore().onConnectionsChange(listener)
export const getDefaultConnection = (where?: ConnectionContext) => defaultStore().getDefaultConnection(where)
export const setDefaultConnection = (slug: string, where?: ConnectionContext) => defaultStore().setDefaultConnection(slug, where)
