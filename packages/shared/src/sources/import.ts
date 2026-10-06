import { basename } from 'node:path'
import { loadStoredConfig } from '../config/storage.ts'
import { getCredentialManager, type CredentialManager } from '../credentials/index.ts'
import { initDb, type Db } from '../db/index.ts'
import { INSTALL, getSetting, updateSetting } from '../settings/index.ts'
import { SourceCredentialManager } from './credential-manager.ts'
import { loadSource } from './storage.ts'
import type { SourceCredentialType, createSourcesStore, SyncStatus } from './store.ts'

/**
 * The importer of sources, once per workspace (recorded as `sources:<id>` in the `imports` setting):
 *
 * - the folders already in `<workspace>/sources/` become rows with their bundle in the store. It is `syncLocalSource`
 *   for every folder, so a folder with a `config.json` that has a name and a type and a slug of lowercase letters,
 *   digits and hyphens becomes a source made by the workspace's first owner; anything else is skipped and counted;
 * - the credential each source has in `credentials.enc` (`source_oauth`, `source_bearer`, `source_apikey` or
 *   `source_basic` of `{workspace folder name}::{slug}`: OAuth tokens of API and MCP sources, bearer tokens, API keys)
 *   becomes the secret of its row. The kind is the one `SourceCredentialManager.getCredentialId` picks for its config
 *   (an MCP source falls back to the other of OAuth and bearer, as `load` does).
 *
 * The old folders and `credentials.enc` are never deleted or changed. A source that already has a secret keeps it.
 */

export interface SourcesImportReport {
  workspaces: number
  imported: number
  skipped: number
  credentials: number
}

type Store = ReturnType<typeof createSourcesStore>

export async function initSourcesImport(
  store: Store,
  options: { db?: Db; workspaces?: { id: string; rootPath: string; remoteServer?: unknown }[]; manager?: CredentialManager } = {},
): Promise<SourcesImportReport> {
  const db = options.db ?? initDb()
  const workspaces = options.workspaces ?? loadStoredConfig()?.workspaces ?? []
  const report: SourcesImportReport = { workspaces: 0, imported: 0, skipped: 0, credentials: 0 }
  for (const { id, rootPath, remoteServer } of workspaces) {
    const key = `sources:${id}`
    if (remoteServer || getSetting(INSTALL, 'imports', db)[key]) continue
    try {
      const result: Partial<Record<SyncStatus, number>> = await store.syncSources(id)
      report.imported += result.created ?? 0
      report.skipped += result.invalid ?? 0
      report.credentials += await importCredentials(store, id, rootPath, options.manager ?? getCredentialManager())
      updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', db), [key]: Date.now() }, db)
      report.workspaces++
    } catch (error) {
      // not recorded: the next boot tries this workspace again
      console.warn(`[sources] workspace ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (report.workspaces) console.log(`[sources] imported ${report.imported} sources and ${report.credentials} credentials for ${report.workspaces} workspaces (${report.skipped} skipped)`)
  return report
}

/** The credentials of the old file for the workspace's sources, as secrets; the count of those imported. */
async function importCredentials(store: Store, workspaceId: string, rootPath: string, manager: CredentialManager): Promise<number> {
  const picker = new SourceCredentialManager()
  let imported = 0
  for (const { slug } of store.getSources(workspaceId)) {
    if (store.hasCredential(workspaceId, slug)) continue
    const source = loadSource(rootPath, slug)
    if (!source) continue
    const primary = picker.getCredentialId(source).type as SourceCredentialType
    const types: SourceCredentialType[] = source.config.type === 'mcp' ? [primary, primary === 'source_oauth' ? 'source_bearer' : 'source_oauth'] : [primary]
    for (const type of types) {
      // the old file keys a source by the name of its workspace's folder
      const stored = await manager.get({ type, workspaceId: basename(rootPath), sourceId: slug }).catch(() => null)
      if (!stored?.value) continue
      await store.setCredential(workspaceId, slug, type, stored)
      imported++
      break
    }
  }
  return imported
}
