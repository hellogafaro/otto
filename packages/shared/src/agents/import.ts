import { loadStoredConfig } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { INSTALL, getSetting, updateSetting } from '../settings/index.ts'
import { userActor } from '../actors.ts'
import { getFirstUser } from '../users/queries.ts'
import { updateAgentActor as updateLibraryActors } from '../library/index.ts'
import { updateAgentActor as updateProjectActors } from '../projects/index.ts'
import { updateAgentActor as updateTaskActors } from '../tasks/index.ts'
import { getWorkspaceOwnerIds } from '../workspaces/ownership.ts'
import { getDefaultAgent, getDefaultProvider, initAgentsSeed } from './index.ts'

/**
 * The importer of agents: every existing workspace gets its first agent and the one implicit actor that stood for
 * "the agent" before, `agent:default`, becomes that agent's `agent:<id>` in `tasks` (created by, assignees),
 * `timesheets`, `projects_members` and `library` (created by), all in one transaction per workspace. Recorded as
 * `agents:<workspaceId>` in the `imports` setting, so it runs once: after it nothing writes `agent:default`.
 *
 * The first agent is created by the workspace's first owner (else the first user) with the provider of that
 * person's default connection. A workspace with nobody to create it is left for the next boot (not recorded);
 * until then the first `agents:list` of a member seeds it. A workspace made later is seeded when it is created
 * (`initAgentsSeed`), and its next boot only finds nothing to change.
 */

export const LEGACY_AGENT_ACTOR = 'agent:default'

export interface AgentsImportReport {
  workspaces: number
  skipped: number
  warnings: string[]
}

export function initAgentsImport(
  db: Db = initDb(),
  workspaces: { id: string }[] = loadStoredConfig()?.workspaces ?? [],
  providerOf: (workspaceId: string, userId: string) => string = getDefaultProvider,
): AgentsImportReport {
  const report: AgentsImportReport = { workspaces: 0, skipped: 0, warnings: [] }
  for (const { id } of workspaces) {
    const key = `agents:${id}`
    if (getSetting(INSTALL, 'imports', db)[key]) continue
    try {
      const creator = getWorkspaceOwnerIds(id, db)[0] ?? getFirstUser(db)?.id
      if (!creator) {
        report.skipped++
        continue
      }
      db.transaction((tx) => {
        initAgentsSeed(id, userActor(creator), providerOf(id, creator), tx)
        const actor = `agent:${getDefaultAgent(id, tx)!.id}`
        updateTaskActors(tx, id, LEGACY_AGENT_ACTOR, actor)
        updateProjectActors(tx, id, LEGACY_AGENT_ACTOR, actor)
        updateLibraryActors(tx, id, LEGACY_AGENT_ACTOR, actor)
        updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', tx), [key]: Date.now() }, tx)
      })
      report.workspaces++
    } catch (error) {
      // rolled back and not recorded: the next boot tries this workspace again
      report.warnings.push(`workspace ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (report.workspaces || report.skipped || report.warnings.length) {
    console.log(`[agents] imported ${report.workspaces} workspaces (${report.skipped} waiting for a user, ${report.warnings.length} warnings)`)
    for (const warning of report.warnings) console.warn(`[agents] ${warning}`)
  }
  return report
}
