import { getWorkspaceByNameOrId } from '../config/storage.ts'
import { initDb } from '../db/index.ts'
import { getBundleStore, isObjectStorage } from '../library/storage.ts'
import { initSecretsStore } from '../secrets/index.ts'
import { domainError } from '../utils/errors.ts'
import { getWorkspaceSourcesPath } from '../workspaces/storage.ts'
import { createSourcesStore } from './store.ts'

/**
 * The process-wide sources store: the `sources` table of the install's database, the bundles of the workspace's
 * store (S3, or its `sources` folder on disk) and the `secrets` table for credentials; see ./store.ts. Its own file
 * so the credential manager can use it without importing the rest of the domain.
 */

type Store = ReturnType<typeof createSourcesStore>

let store: Store | undefined

function defaultStore() {
  return (store ??= createSourcesStore(initDb(), initSecretsStore(), (workspaceId) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw domainError('not_found', `Workspace ${workspaceId} does not exist`)
    return { store: getBundleStore(workspace.rootPath, workspace.id, 'sources'), dir: getWorkspaceSourcesPath(workspace.rootPath), remote: isObjectStorage() }
  }))
}

/** The process-wide store, set up on first use. */
export const initSourcesStore = defaultStore

export const getSources: Store['getSources'] = (workspaceId) => defaultStore().getSources(workspaceId)
export const getSource: Store['getSource'] = (workspaceId, slug) => defaultStore().getSource(workspaceId, slug)
export const getLoadedSources: Store['getLoadedSources'] = (workspaceId) => defaultStore().getLoadedSources(workspaceId)
export const deleteSource: Store['deleteSource'] = (workspaceId, slug) => defaultStore().deleteSource(workspaceId, slug)
export const syncLocalSource: Store['syncLocalSource'] = (workspaceId, slug, createdBy) => defaultStore().syncLocalSource(workspaceId, slug, createdBy)
export const syncSources: Store['syncSources'] = (workspaceId) => defaultStore().syncSources(workspaceId)
export const getSourceCredential: Store['getCredential'] = (workspaceId, slug, type) => defaultStore().getCredential(workspaceId, slug, type)
export const setSourceCredential: Store['setCredential'] = (workspaceId, slug, type, credential) => defaultStore().setCredential(workspaceId, slug, type, credential)
export const deleteSourceCredential: Store['deleteCredential'] = (workspaceId, slug, type) => defaultStore().deleteCredential(workspaceId, slug, type)
export const hasSourceCredential: Store['hasCredential'] = (workspaceId, slug) => defaultStore().hasCredential(workspaceId, slug)
export const deleteWorkspaceSourceCredentials: Store['deleteWorkspaceCredentials'] = (workspaceId) => defaultStore().deleteWorkspaceCredentials(workspaceId)
