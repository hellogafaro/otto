import { RPC_CHANNELS } from '@otto/shared/protocol'
import { parsePromptReferences } from '@otto/shared/automations'
import { createRoutine, deleteRoutine, getRoutine, getRoutines, updateRoutine } from '@otto/shared/automations/routines'
import { dropWebhookSecret, prepareWebhookConfig, resetWebhookSecret } from '@otto/shared/automations/routine-webhook'
import { runRoutine, startRoutineScheduler, type RoutineRunnerDeps } from '@otto/shared/automations/routine-runner'
import { routineWebhookPath, type Routine, type RoutineInput, type RoutineRun, type RoutineSaved, type RoutineUpdate } from '@otto/shared/automations/routine-types'
import { domainError } from '@otto/shared/utils'
import type { RpcServer } from '@otto/server-core/transport'
import { checkAutomationCondition } from '../../decisions/automation-condition'
import type { HandlerDeps } from '../handler-deps'
import { actorOf, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.routines.LIST,
  RPC_CHANNELS.routines.GET,
  RPC_CHANNELS.routines.CREATE,
  RPC_CHANNELS.routines.UPDATE,
  RPC_CHANNELS.routines.DELETE,
  RPC_CHANNELS.routines.PAUSE,
  RPC_CHANNELS.routines.RESUME,
  RPC_CHANNELS.routines.RUN,
  RPC_CHANNELS.routines.RESET_WEBHOOK,
] as const

/**
 * What a run needs from the server: a chat for each prompt action (owned by the routine's creator, on its agent) and
 * the decision model's verdict on a `semanticCondition`. `notify` tells the workspace's clients its routines changed.
 * A person's Run now skips the verdict: they asked for it.
 */
export function routineRunnerDeps(deps: Pick<HandlerDeps, 'sessionManager'>, notify: (workspaceId: string) => void, { judge = true } = {}): RoutineRunnerDeps {
  return {
    onChange: notify,
    runPrompt: async ({ routine, action, workspaceRootPath }) => {
      const { sessionId } = await deps.sessionManager.executePromptAutomation({
        workspaceId: routine.workspaceId,
        workspaceRootPath,
        prompt: action.prompt,
        labels: action.labels,
        projectId: action.projectId,
        permissionMode: routine.config.permissionMode,
        mentions: parsePromptReferences(action.prompt).mentions,
        llmConnection: action.llmConnection,
        model: action.model,
        thinkingLevel: action.thinkingLevel,
        automationName: routine.title,
        automationId: routine.id,
        // The routine's runs and their chats belong to its creator, on its agent (absent: the workspace's default).
        createdBy: routine.createdBy,
        agentId: routine.agentId ?? undefined,
      })
      return { chatId: sessionId }
    },
    shouldRun: judge
      ? async (routine) => {
          const verdict = await checkAutomationCondition(routine.config.semanticCondition!, { event: routine.config.event ?? 'Schedule', automationName: routine.title }, { matcherId: routine.id })
          return !verdict || verdict.run ? { run: true } : { run: false, reason: `condition not met ("yes" probability ${verdict.probability.toFixed(2)})` }
        }
      : undefined,
  }
}

/** Tells the workspace's clients its routines changed (`domain:changed`). */
export const routinesNotifier = (server: RpcServer) => (workspaceId: string) =>
  server.push(RPC_CHANNELS.domain.CHANGED, { to: 'workspace', workspaceId }, { domain: 'routines', workspaceId })

/** Starts the scheduler: every minute it fires the schedule routines that are due, once. Returns its stop function. */
export function startRoutines(server: RpcServer, deps: Pick<HandlerDeps, 'sessionManager' | 'platform'>): () => void {
  return startRoutineScheduler(routineRunnerDeps(deps, routinesNotifier(server)), deps.platform.logger)
}

/**
 * The workspace's routines (docs/final-plan.md 2.8): any member lists, gets and creates; changing, pausing, resuming,
 * running and deleting one is its creator or a workspace owner (`bootstrap/authorize.ts`, `ROUTINE_WRITE_CHANNELS`).
 * A change by anyone but the creator makes the routine theirs, and Run now runs as the person who asked.
 * Writes push `domain:changed` (`domain-changes.ts`). A run starts in the background: Run now returns its row
 * (`running`) and the end arrives as another `domain:changed`.
 */
export function registerRoutinesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(ctx).id

  server.handle(RPC_CHANNELS.routines.LIST, (ctx): Routine[] => getRoutines(workspaceOf(ctx)))

  server.handle(RPC_CHANNELS.routines.GET, (ctx, id: string) => getRoutine(workspaceOf(ctx), id) ?? null)

  // A webhook routine's secret is the server's: made here, shown once in the answer (`webhookSecret`), never taken from the caller
  server.handle(RPC_CHANNELS.routines.CREATE, (ctx, input: Omit<RoutineInput, 'workspaceId' | 'createdBy'>): RoutineSaved => {
    const prepared = prepareWebhookConfig(input.config, String(input.title ?? ''))
    try {
      const routine = createRoutine({ workspaceId: workspaceOf(ctx), title: input.title, agentId: input.agentId, config: prepared.config, paused: input.paused, createdBy: actorOf(ctx) })
      return prepared.secret ? { ...routine, webhookSecret: prepared.secret } : routine
    } catch (error) {
      dropWebhookSecret(prepared.secretId)
      throw error
    }
  })

  // A change by someone other than the creator makes the routine theirs (`updateRoutine`'s `by`)
  server.handle(RPC_CHANNELS.routines.UPDATE, (ctx, id: string, patch: RoutineUpdate): RoutineSaved => {
    const workspaceId = workspaceOf(ctx)
    const before = patch.config === undefined ? undefined : getRoutine(workspaceId, id)
    const prepared = patch.config === undefined ? undefined : prepareWebhookConfig(patch.config, patch.title ?? before?.title ?? '', before?.config)
    try {
      const routine = updateRoutine(workspaceId, id, { title: patch.title, agentId: patch.agentId, config: prepared?.config, paused: patch.paused, by: actorOf(ctx) })
      dropWebhookSecret(prepared?.drop)
      return prepared?.secret ? { ...routine, webhookSecret: prepared.secret } : routine
    } catch (error) {
      dropWebhookSecret(prepared?.secretId)
      throw error
    }
  })

  server.handle(RPC_CHANNELS.routines.DELETE, (ctx, id: string) => {
    const workspaceId = workspaceOf(ctx)
    const secretId = getRoutine(workspaceId, id)?.config.webhook?.secretId
    deleteRoutine(workspaceId, id)
    dropWebhookSecret(secretId)
  })

  // The new path is the only time the secret is shown; the old URL stops working at once
  server.handle(RPC_CHANNELS.routines.RESET_WEBHOOK, (ctx, id: string): { path: string } => {
    const routine = getRoutine(workspaceOf(ctx), id)
    if (!routine) throw domainError('not_found', `Routine ${id} does not exist`)
    return { path: routineWebhookPath(routine.id, resetWebhookSecret(routine)) }
  })

  server.handle(RPC_CHANNELS.routines.PAUSE, (ctx, id: string) => updateRoutine(workspaceOf(ctx), id, { paused: true, by: actorOf(ctx) }))

  server.handle(RPC_CHANNELS.routines.RESUME, (ctx, id: string) => updateRoutine(workspaceOf(ctx), id, { paused: false, by: actorOf(ctx) }))

  server.handle(RPC_CHANNELS.routines.RUN, (ctx, id: string): RoutineRun => {
    const routine = getRoutine(workspaceOf(ctx), id)
    if (!routine) throw domainError('not_found', `Routine ${id} does not exist`)
    // Run now runs as the person who asked: its chats and connections are theirs, not the creator's
    const handle = runRoutine({ ...routine, createdBy: actorOf(ctx) }, routineRunnerDeps(deps, routinesNotifier(server), { judge: false }))
    if (!handle) throw domainError('conflict', 'The routine could not start a run')
    return handle.run
  })
}
