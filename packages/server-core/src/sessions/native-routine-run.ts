import { userActor } from '@otto/shared/actors'
import { canEditRoutine, getRoutine } from '@otto/shared/automations/routines'
import { runRoutine } from '@otto/shared/automations/routine-runner'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { getMemberRole } from '@otto/shared/workspaces'
import { domainError } from '@otto/shared/utils'
import type { ISessionManager } from '../handlers/session-manager-interface'

export async function runRoutineForHuman(manager: ISessionManager, workspaceId: string, routineId: string, userId: string, assertAccess: () => void, notify?: (workspaceId: string) => void): Promise<{ id: string; status: string }> {
  assertAccess()
  const routine = getRoutine(workspaceId, routineId)
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!routine || !workspace || !getMemberRole(workspaceId, userId) || !canEditRoutine(workspaceId, routine, userId)) throw domainError('forbidden', 'This routine is not available to the authorizing person.')
  if (routine.config.actions.some((action) => action.type !== 'prompt') || routine.config.webhook) throw domainError('invalid', 'This routine uses actions unavailable to native management.')
  const config = JSON.stringify(routine.config)
  const validate = () => {
    const current = getRoutine(workspaceId, routineId)
    if (!current || !getMemberRole(workspaceId, userId) || !canEditRoutine(workspaceId, current, userId) || JSON.stringify(current.config) !== config) throw domainError('forbidden', 'Routine authority or configuration changed before execution.')
  }
  validate()
  const handle = runRoutine({ ...routine, createdBy: userActor(userId) }, {
    onChange: notify,
    getWorkspaceRootPath: (id) => id === workspaceId ? workspace.rootPath : null,
    runPrompt: async ({ action }) => {
      validate()
      const result = await manager.executePromptAutomation({ workspaceId, workspaceRootPath: workspace.rootPath, prompt: action.prompt, createdBy: userActor(userId), agentId: routine.agentId ?? undefined, permissionMode: routine.config.permissionMode ?? 'safe', automationName: routine.title, automationId: routine.id, triggerEvent: 'Manual' })
      validate()
      return { chatId: result.sessionId }
    },
  })
  if (!handle) throw domainError('conflict', 'The routine could not start a run.')
  return { id: handle.run.id, status: handle.run.status }
}
