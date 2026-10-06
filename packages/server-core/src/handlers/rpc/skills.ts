import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { deleteSkill, getLoadedSkills, getSkill } from '@otto/shared/skills'
import { getWorkspaceSkillsPath } from '@otto/shared/workspaces'
import { domainError } from '@otto/shared/utils'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

/**
 * Skills of a workspace: members read, a skill's creator or an owner deletes (`authorize.ts`); a delete pushes
 * `domain:changed` (`domain-changes.ts`). The list is the `skills` rows, each read from its local folder (the
 * materialized copy of its bundle) for what the rows do not hold; a skill is made or edited by an agent in that folder
 * and the config watcher pushes it (see `@otto/shared/skills`).
 */
export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  /** The workspace and the folder of one of its skills; throws `not_found` for a slug that is not a skill, so a client's string never becomes a path. */
  function skillFolder(workspaceId: string, skillSlug: string) {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw domainError('not_found', 'Workspace not found')
    if (!getSkill(workspace.id, skillSlug)) throw domainError('not_found', `Skill ${skillSlug} does not exist`)
    return { workspace, dir: join(getWorkspaceSkillsPath(workspace.rootPath), skillSlug) }
  }

  // Get all skills for a workspace
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    return getLoadedSkills(workspace.id)
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const { dir } = skillFolder(workspaceId, skillSlug)

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(dir)
  })

  // Delete a skill from a workspace: the row, its bundle and the local folder
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const { workspace } = skillFolder(workspaceId, skillSlug)
    await deleteSkill(workspace.id, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const { workspace, dir } = skillFolder(workspaceId, skillSlug)
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')
    await deps.platform.openPath?.(join(dir, 'SKILL.md'))
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const { workspace, dir } = skillFolder(workspaceId, skillSlug)
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')
    await deps.platform.showItemInFolder?.(dir)
  })
}
