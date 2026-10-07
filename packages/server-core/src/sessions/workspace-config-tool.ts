import { userActor } from '@otto/shared/actors'
import { updateWorkspacePermissions, getWorkspacePermissions } from '@otto/shared/agent'
import { canEditAgent, createAgent, deleteAgent, getAgent, getAgents, getDefaultProvider, updateAgent, type Agent, type AgentUpdate } from '@otto/shared/agents'
import { canEditRoutine, createRoutine, deleteRoutine, getRoutine, getRoutines, updateRoutine } from '@otto/shared/automations/routines'
import type { Routine, RoutineConfig, RoutineRun } from '@otto/shared/automations/routine-types'
import { createLabel, deleteLabel, moveLabel, reorderLabels, updateLabel } from '@otto/shared/labels/crud'
import { getLabels } from '@otto/shared/labels/storage'
import { createStatus, deleteStatus, reorderStatuses, setDefaultStatus, updateStatus } from '@otto/shared/statuses/crud'
import { getStatuses } from '@otto/shared/statuses/storage'
import { domainError } from '@otto/shared/utils'
import { getMemberRole } from '@otto/shared/workspaces'

/**
 * What the agent tools `labels_edit`, `statuses_edit`, `permissions_edit`, `agents_edit` and `routines_edit` do: the domain
 * functions, as the chat's user, bounded to the chat's workspace (the guard of `bootstrap/authorize.ts`: members read, owners
 * write; agents and routines: any member creates, only the creator or an owner changes, runs or deletes one).
 * They replace the agents editing `labels/config.json`, `statuses/config.json`, `permissions.json` and `automations.json` by
 * path, which nothing reads any more; the Python `otto` CLI will take over from them (docs/data-architecture.md, PT).
 */

export type WorkspaceConfigDomain = 'labels' | 'statuses' | 'permissions' | 'agents' | 'routines'

const READS: Record<WorkspaceConfigDomain, string[]> = { labels: ['list'], statuses: ['list'], permissions: ['get'], agents: ['list', 'get'], routines: ['list', 'get'] }

const str = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value) throw domainError('invalid', `${name} is required`)
  return value
}
const strList = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw domainError('invalid', `${name} must be a list of ids`)
  return value as string[]
}

/** A status icon that is an image data URL is not worth an agent's context: it says it is an image. */
const withoutImageData = <T extends { icon?: string }>(status: T): T => (status.icon?.startsWith('data:') ? { ...status, icon: '[image]' } : status)

/** A listing leaves out the instructions (up to 20,000 characters each); `get` has them. */
const withoutInstructions = ({ instructions: _, ...agent }: Agent) => agent

const agentFields = (args: Record<string, unknown>): AgentUpdate => ({
  title: args.title as string | undefined,
  instructions: args.instructions as string | undefined,
  provider: args.provider as string | undefined,
  model: args.model as string | null | undefined,
  thinkingLevel: args.thinkingLevel as AgentUpdate['thinkingLevel'],
  skills: args.skills as string[] | undefined,
  sources: args.sources as string[] | undefined,
  avatar: args.avatar as string | undefined,
})

/**
 * Runs one action for `userId` in the workspace. Returns what to tell the agent and whether anything changed
 * (so the caller can push `domain:changed`). Throws `forbidden` for a non-member, or a non-owner who writes.
 * `runRoutine` starts a run of a routine (the routines RPC's runner); without it `routines_edit` cannot run one.
 */
export function runWorkspaceConfigAction(
  workspaceId: string,
  userId: string | null,
  domain: WorkspaceConfigDomain,
  args: Record<string, unknown>,
  runRoutine?: (routine: Routine) => RoutineRun | undefined,
): { result: unknown; wrote: boolean } {
  const action = str(args.action, 'action')
  const role = userId ? getMemberRole(workspaceId, userId) : null
  if (!role) throw domainError('forbidden', 'You are not a member of this workspace')
  const wrote = !READS[domain].includes(action)
  if (wrote && domain !== 'agents' && domain !== 'routines' && role !== 'owner') throw domainError('forbidden', `Only an owner of this workspace can change its ${domain}`)

  if (domain === 'labels') {
    const id = () => str(args.id, 'id')
    switch (action) {
      case 'list':
        return { result: getLabels(workspaceId), wrote }
      case 'create':
        return { result: createLabel(workspaceId, { name: str(args.name, 'name'), color: args.color as never, parentId: args.parentId as string | undefined, valueType: args.valueType as never, autoRules: args.autoRules as never }), wrote }
      case 'update':
        return { result: updateLabel(workspaceId, id(), { name: args.name as string | undefined, color: args.color as never, valueType: args.valueType as never, autoRules: args.autoRules as never }), wrote }
      case 'delete':
        return { result: deleteLabel(workspaceId, id()), wrote }
      case 'move':
        moveLabel(workspaceId, id(), (args.parentId as string | null | undefined) ?? null)
        return { result: getLabels(workspaceId), wrote }
      case 'reorder':
        reorderLabels(workspaceId, (args.parentId as string | null | undefined) ?? null, strList(args.orderedIds, 'orderedIds'))
        return { result: getLabels(workspaceId), wrote }
    }
  } else if (domain === 'statuses') {
    const id = () => str(args.id, 'id')
    switch (action) {
      case 'list':
        return { result: getStatuses(workspaceId).map(withoutImageData), wrote }
      case 'create':
        return { result: withoutImageData(createStatus(workspaceId, { label: str(args.label, 'label'), color: args.color as never, icon: args.icon as string | undefined, category: args.category as never })), wrote }
      case 'update':
        return { result: withoutImageData(updateStatus(workspaceId, id(), { label: args.label as string | undefined, color: args.color as never, icon: args.icon as string | undefined, category: args.category as never })), wrote }
      case 'delete':
        return { result: deleteStatus(workspaceId, id()), wrote }
      case 'reorder':
        reorderStatuses(workspaceId, strList(args.orderedIds, 'orderedIds'))
        return { result: getStatuses(workspaceId).map(withoutImageData), wrote }
      case 'set_default':
        setDefaultStatus(workspaceId, id())
        return { result: getStatuses(workspaceId).map(withoutImageData), wrote }
    }
  } else if (domain === 'agents') {
    const owned = (): Agent => {
      const agent = getAgent(workspaceId, str(args.id, 'id'))
      if (!agent) throw domainError('not_found', `Agent ${String(args.id)} does not exist`)
      if (!canEditAgent(workspaceId, agent, userId!)) throw domainError('forbidden', 'Only the creator of this agent or an owner of this workspace can change it')
      return agent
    }
    switch (action) {
      case 'list':
        return { result: getAgents(workspaceId).map(withoutInstructions), wrote }
      case 'get': {
        const agent = getAgent(workspaceId, str(args.id, 'id'))
        if (!agent) throw domainError('not_found', `Agent ${String(args.id)} does not exist`)
        return { result: agent, wrote }
      }
      case 'create':
        return { result: createAgent({ ...agentFields(args), title: str(args.title, 'title'), provider: (args.provider as string | undefined) ?? getDefaultProvider(workspaceId, userId), workspaceId, createdBy: userActor(userId!) }), wrote }
      case 'update':
        return { result: updateAgent(workspaceId, owned().id, agentFields(args)), wrote }
      case 'delete':
        deleteAgent(workspaceId, owned().id)
        return { result: { deleted: args.id }, wrote }
    }
  } else if (domain === 'routines') {
    // A routine runs as its creator: a change by anyone else makes it theirs (`by`), and a run runs as the caller
    const actor = userActor(userId!)
    const owned = (): Routine => {
      const routine = getRoutine(workspaceId, str(args.id, 'id'))
      if (!routine) throw domainError('not_found', `Routine ${String(args.id)} does not exist`)
      if (!canEditRoutine(workspaceId, routine, userId!)) throw domainError('forbidden', 'Only the creator of this routine or an owner of this workspace can change it')
      return routine
    }
    const fields = { title: args.title as string | undefined, agentId: args.agentId as string | null | undefined, config: args.config as RoutineConfig | undefined }
    switch (action) {
      case 'list':
        return { result: getRoutines(workspaceId).map(({ runs: _, ...routine }) => routine), wrote }
      case 'get': {
        const routine = getRoutine(workspaceId, str(args.id, 'id'))
        if (!routine) throw domainError('not_found', `Routine ${String(args.id)} does not exist`)
        return { result: routine, wrote }
      }
      case 'create':
        return { result: createRoutine({ ...fields, title: str(args.title, 'title'), config: args.config as RoutineConfig, paused: args.paused === true, workspaceId, createdBy: actor }), wrote }
      case 'update':
        return { result: updateRoutine(workspaceId, owned().id, { ...fields, by: actor }), wrote }
      case 'pause':
      case 'resume':
        return { result: updateRoutine(workspaceId, owned().id, { paused: action === 'pause', by: actor }), wrote }
      case 'run': {
        const routine = owned()
        if (!runRoutine) throw domainError('invalid', 'A routine cannot be run from here')
        const run = runRoutine({ ...routine, createdBy: actor })
        if (!run) throw domainError('conflict', 'The routine could not start a run')
        return { result: run, wrote }
      }
      case 'delete':
        deleteRoutine(workspaceId, owned().id)
        return { result: { deleted: args.id }, wrote }
    }
  } else {
    switch (action) {
      case 'get':
        return { result: getWorkspacePermissions(workspaceId), wrote }
      case 'update':
        return { result: updateWorkspacePermissions(workspaceId, args.rules), wrote }
    }
  }
  throw domainError('invalid', `Unknown ${domain} action: ${action}`)
}
