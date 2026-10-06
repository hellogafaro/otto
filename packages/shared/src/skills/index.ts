import { getWorkspaceByNameOrId, getWorkspaces } from '../config/storage.ts'
import { initDb } from '../db/index.ts'
import { getBundleStore, isObjectStorage } from '../library/storage.ts'
import { domainError } from '../utils/errors.ts'
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts'
import { initSkillsImport as runSkillsImport } from './import.ts'
import { createSkillsStore } from './store.ts'

/**
 * Skills: a workspace's reusable instructions, each a folder (`SKILL.md`, an icon, scripts, references). Rows in
 * `skills` index them, the bytes are bundles in S3 (a folder of the workspace on disk) and `<workspace>/skills/<slug>/`
 * is the local copy agents read by path; see ./store.ts. Only workspace skills exist: there is no global or
 * per-project scope.
 */

export * from './types.ts'
export type { BundleFiles } from '../bundles/bundle.ts'
export { createSkillsStore, type SkillsTarget, type SyncStatus } from './store.ts'
export type { SkillsImportReport } from './import.ts'
export { loadAllSkills, loadSkill, parseSkillFile, skillNeedsIconDownload, downloadSkillIcon } from './storage.ts'

type Store = ReturnType<typeof createSkillsStore>

let store: Store | undefined

function defaultStore() {
  return (store ??= createSkillsStore(initDb(), (workspaceId) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw domainError('not_found', `Workspace ${workspaceId} does not exist`)
    return { store: getBundleStore(workspace.rootPath, workspace.id, 'skills'), dir: getWorkspaceSkillsPath(workspace.rootPath), remote: isObjectStorage() }
  }))
}

export const getSkills: Store['getSkills'] = (workspaceId) => defaultStore().getSkills(workspaceId)
export const getSkill: Store['getSkill'] = (workspaceId, slug) => defaultStore().getSkill(workspaceId, slug)
export const getLoadedSkills: Store['getLoadedSkills'] = (workspaceId) => defaultStore().getLoadedSkills(workspaceId)
export const createSkill: Store['createSkill'] = (input) => defaultStore().createSkill(input)
export const updateBundle: Store['updateBundle'] = (workspaceId, slug, files, expectedUpdatedAt) => defaultStore().updateBundle(workspaceId, slug, files, expectedUpdatedAt)
export const deleteSkill: Store['deleteSkill'] = (workspaceId, slug) => defaultStore().deleteSkill(workspaceId, slug)
export const syncLocalSkill: Store['syncLocalSkill'] = (workspaceId, slug) => defaultStore().syncLocalSkill(workspaceId, slug)
export const syncSkills: Store['syncSkills'] = (workspaceId) => defaultStore().syncSkills(workspaceId)

/** Imports the skill folders of every workspace once (see import.ts). */
export const initSkillsImport = (workspaces?: { id: string }[]) => runSkillsImport(defaultStore().syncSkills, initDb(), workspaces)

/**
 * Boot, once the schema is pushed (and when a workspace is added): imports what was never imported, then brings every
 * workspace's folders and bundles together, which on S3 is the materializer. A workspace that cannot be synced (the
 * bucket is down) is logged and left as it is; the server still starts and the folder that is there keeps working.
 */
export async function initSkills(): Promise<void> {
  await initSkillsImport()
  for (const workspace of getWorkspaces()) {
    if (workspace.remoteServer) continue
    await defaultStore().syncSkills(workspace.id).catch((error) => console.warn(`[skills] could not sync ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`))
  }
}
