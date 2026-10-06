import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { BundleFiles } from '../bundles/bundle.ts'
import { createBundleStore, type BundleTable, type BundleTarget, type SyncStatus } from '../bundles/store.ts'
import type { StoredCredential } from '../credentials/types.ts'
import type { Db } from '../db/index.ts'
import type { createSecretsStore } from '../secrets/index.ts'
import { domainError } from '../utils/errors.ts'
import { sources } from './schema.ts'
import { loadSource } from './storage.ts'
import type { FolderSourceConfig, LoadedSource, Source, SourceAuthStatus, SourceType } from './types.ts'

/**
 * Sources on rows plus bundles: `createBundleStore` (../bundles/store.ts, which holds the write order and the sync of
 * folder and bucket) with the sources table. A source is a folder whose `config.json` has a name and a type (`mcp`,
 * `api`, `local`); with `guide.md`, an icon and `permissions.json` it is the bundle, and the row indexes it.
 *
 * The credential of a source (OAuth tokens, a bearer token, an API key) is not part of the bundle: it is one secret
 * of the `secrets` table, whose id the row keeps as `secret_id`, holding the credential and the kind it is
 * (`source_oauth`, `source_bearer`, ...). It is never in S3 and a write of it leaves `updated_at` and the bundle alone.
 */

export type SourcesTarget = BundleTarget
export type { SyncStatus }

type Row = typeof sources.$inferSelect
type SecretsStore = ReturnType<typeof createSecretsStore>

/** The kinds of credential a source keeps (`credentials/types.ts` `SOURCE_CREDENTIAL_TYPES`). */
export type SourceCredentialType = 'source_oauth' | 'source_bearer' | 'source_apikey' | 'source_basic'

const SOURCE_TYPES: readonly string[] = ['mcp', 'api', 'local']

const toSource = (row: Row): Source => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  type: row.type as SourceType,
  authStatus: row.authStatus as SourceAuthStatus,
  createdBy: row.createdBy,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
})

/** What `config.json` says about signing in: the same reading as `isSourceUsable` (storage.ts) and the connection test's result. */
export function authStatusOf(config: Pick<FolderSourceConfig, 'mcp' | 'api' | 'isAuthenticated' | 'connectionStatus'>): SourceAuthStatus {
  if (config.connectionStatus === 'failed') return 'error'
  if (config.connectionStatus === 'needs_auth') return 'needs_auth'
  const authType = config.mcp?.authType || config.api?.authType
  return authType && authType !== 'none' && config.isAuthenticated !== true ? 'needs_auth' : 'ok'
}

function indexSource(files: BundleFiles) {
  const raw = files.get('config.json')
  if (!raw) throw domainError('invalid', 'A source needs a config.json')
  let config: Partial<FolderSourceConfig>
  try {
    config = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw domainError('invalid', 'config.json is not valid JSON')
  }
  if (typeof config?.name !== 'string' || !config.name || !SOURCE_TYPES.includes(config.type as string)) {
    throw domainError('invalid', 'config.json needs a name and a type (mcp, api or local)')
  }
  return { title: config.name, type: config.type as SourceType, authStatus: authStatusOf(config) }
}

export function createSourcesStore(db: Db, secrets: SecretsStore, targetFor: (workspaceId: string) => SourcesTarget) {
  const bundles = createBundleStore(
    db,
    {
      noun: 'source',
      kind: 'sources',
      table: sources as unknown as BundleTable,
      mainFile: 'config.json',
      index: indexSource,
      toItem: (row: Row) => toSource(row),
      afterDelete: (row: Row) => {
        if (row.secretId) secrets.deleteSecret(row.secretId)
      },
    },
    targetFor,
  )
  const { rows, row: find } = bundles

  const readSecret = (row: Row): ({ type: SourceCredentialType } & StoredCredential) | undefined => {
    if (!row.secretId) return undefined
    const raw = secrets.getSecret(row.secretId)
    return raw ? (JSON.parse(raw) as { type: SourceCredentialType } & StoredCredential) : undefined
  }

  return {
    getSources: bundles.getItems,
    getSource: bundles.getItem,

    /** The workspace's sources as clients show them: one per row, read from its folder when the folder is there. */
    getLoadedSources(workspaceId: string): LoadedSource[] {
      const target = targetFor(workspaceId)
      const root = dirname(target.dir)
      return rows(workspaceId).map(
        (row) =>
          loadSource(root, row.slug) ?? {
            // The folder is not on this machine yet (the bucket was down at boot): what the row knows, switched off.
            config: { id: row.id, name: row.title, slug: row.slug, enabled: false, provider: 'custom', type: row.type as SourceType },
            guide: null,
            folderPath: join(target.dir, row.slug),
            workspaceRootPath: root,
            workspaceId,
          },
      )
    },

    /** Removes the row, its credential, the bundle and the local folder. */
    deleteSource: bundles.delete,
    syncLocalSource: bundles.syncLocal,
    syncSources: bundles.sync,

    /** The credential of this kind a source keeps, or undefined (none, or another kind). */
    getCredential(workspaceId: string, slug: string, type: SourceCredentialType): StoredCredential | undefined {
      const row = find(workspaceId, slug)
      const stored = row && readSecret(row)
      if (!stored || stored.type !== type) return undefined
      const { type: _type, ...credential } = stored
      return credential
    },

    /**
     * Replaces the credential of a source (a source keeps one; saving another kind replaces it). A source whose folder
     * is not a row yet (an agent just made it) is synced first.
     */
    async setCredential(workspaceId: string, slug: string, type: SourceCredentialType, credential: StoredCredential): Promise<void> {
      let row = find(workspaceId, slug)
      if (!row) {
        await bundles.syncLocal(workspaceId, slug)
        row = find(workspaceId, slug)
      }
      if (!row) throw domainError('not_found', `Source ${slug} does not exist`)
      const value = JSON.stringify({ ...credential, type })
      if (row.secretId) secrets.updateSecret(row.secretId, value)
      else {
        const secretId = secrets.createSecret(row.title, value)
        db.update(sources).set({ secretId }).where(eq(sources.id, row.id)).run()
      }
    },

    /** Removes the credential of this kind (any kind when none is named); false when there was none. */
    deleteCredential(workspaceId: string, slug: string, type?: SourceCredentialType): boolean {
      const row = find(workspaceId, slug)
      if (!row?.secretId) return false
      if (type && readSecret(row)?.type !== type) return false
      secrets.deleteSecret(row.secretId)
      db.update(sources).set({ secretId: null }).where(eq(sources.id, row.id)).run()
      return true
    },

    /** Whether the source has a credential: what the importer asks before reading the old files. */
    hasCredential(workspaceId: string, slug: string): boolean {
      return !!find(workspaceId, slug)?.secretId
    },

    /** Removes every credential of a workspace (it was removed). */
    deleteWorkspaceCredentials(workspaceId: string): void {
      for (const row of rows(workspaceId)) {
        if (!row.secretId) continue
        secrets.deleteSecret(row.secretId)
        db.update(sources).set({ secretId: null }).where(eq(sources.id, row.id)).run()
      }
    },
  }
}
