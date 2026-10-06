import { loadStoredConfig } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { INSTALL, getSetting, updateSetting } from '../settings/index.ts'
import { createSkillsStore, type SyncStatus } from './store.ts'

/**
 * The importer of skills: the folders already in `<workspace>/skills/` become rows with their bundle in the store,
 * once per workspace (recorded as `skills:<id>` in the `imports` setting). It is `syncLocalSkill` for every folder, so
 * a folder with a valid SKILL.md and a slug of lowercase letters, digits and hyphens becomes a skill made by the
 * workspace's first owner; anything else is skipped and counted. The old folders are never deleted or changed
 * (a folder that is a skill now is the local copy). The global (`~/.agents/skills`) and project scopes are not imported.
 */

export interface SkillsImportReport {
  workspaces: number
  imported: number
  skipped: number
}

type Sync = ReturnType<typeof createSkillsStore>['syncSkills']

export async function initSkillsImport(
  syncSkills: Sync,
  db: Db = initDb(),
  workspaces: { id: string }[] = loadStoredConfig()?.workspaces ?? [],
): Promise<SkillsImportReport> {
  const report: SkillsImportReport = { workspaces: 0, imported: 0, skipped: 0 }
  for (const { id } of workspaces) {
    const key = `skills:${id}`
    if (getSetting(INSTALL, 'imports', db)[key]) continue
    try {
      const result: Partial<Record<SyncStatus, number>> = await syncSkills(id)
      report.imported += result.created ?? 0
      report.skipped += result.invalid ?? 0
      updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', db), [key]: Date.now() }, db)
      report.workspaces++
    } catch (error) {
      // not recorded: the next boot tries this workspace again
      console.warn(`[skills] workspace ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (report.workspaces) console.log(`[skills] imported ${report.imported} skills for ${report.workspaces} workspaces (${report.skipped} skipped)`)
  return report
}
