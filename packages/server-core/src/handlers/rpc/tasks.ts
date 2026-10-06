import { RPC_CHANNELS } from '@otto/shared/protocol'
import {
  createTask,
  createTimesheet,
  deleteTimesheet,
  getTask,
  getTasks,
  getTimesheets,
  setTaskStatus,
  updateTask,
  type TaskFilter,
  type TaskStatus,
  type TaskUpdate,
} from '@otto/shared/tasks'
import type { Resource } from '@otto/shared/projects'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.tasks.LIST,
  RPC_CHANNELS.tasks.GET,
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.UPDATE,
  RPC_CHANNELS.tasks.SET_STATUS,
  RPC_CHANNELS.timesheets.LIST,
  RPC_CHANNELS.timesheets.CREATE,
  RPC_CHANNELS.timesheets.DELETE,
] as const

export function registerTasksHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(ctx, deps).id

  server.handle(RPC_CHANNELS.tasks.LIST, (ctx, filter?: TaskFilter) => getTasks(workspaceOf(ctx), filter))

  server.handle(RPC_CHANNELS.tasks.GET, (ctx, id: string) => getTask(workspaceOf(ctx), id) ?? null)

  server.handle(
    RPC_CHANNELS.tasks.CREATE,
    (
      ctx,
      input: { projectId: string; title: string; description?: string; dueAt?: number | null; assignees?: string[]; resources?: Resource[] },
    ) =>
      createTask({
        workspaceId: workspaceOf(ctx),
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        assignees: input.assignees,
        resources: input.resources,
      }),
  )

  server.handle(RPC_CHANNELS.tasks.UPDATE, (ctx, id: string, patch: TaskUpdate) =>
    updateTask(workspaceOf(ctx), id, {
      projectId: patch.projectId,
      title: patch.title,
      description: patch.description,
      dueAt: patch.dueAt,
      assignees: patch.assignees,
      resources: patch.resources,
      expectedUpdatedAt: patch.expectedUpdatedAt,
    }),
  )

  server.handle(RPC_CHANNELS.tasks.SET_STATUS, (ctx, id: string, status: TaskStatus) => setTaskStatus(workspaceOf(ctx), id, status))

  server.handle(RPC_CHANNELS.timesheets.LIST, (ctx, taskId: string) => getTimesheets(workspaceOf(ctx), taskId))

  server.handle(RPC_CHANNELS.timesheets.CREATE, (ctx, input: { taskId: string; time: number; notes?: string }) =>
    createTimesheet({ workspaceId: workspaceOf(ctx), taskId: input.taskId, time: input.time, notes: input.notes }),
  )

  server.handle(RPC_CHANNELS.timesheets.DELETE, (ctx, id: string) => {
    deleteTimesheet(workspaceOf(ctx), id)
  })
}
