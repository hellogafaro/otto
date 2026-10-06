import { RPC_CHANNELS } from '@otto/shared/protocol'
import {
  createProject,
  getProject,
  getProjectMembers,
  getProjects,
  removeProjectMember,
  setProjectMember,
  setProjectStatus,
  updateProject,
  type MemberRole,
  type ProjectFilter,
  type ProjectStatus,
  type ProjectUpdate,
  type Resource,
} from '@otto/shared/projects'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { actorOf, assertWorkspaceActors, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.projects.LIST,
  RPC_CHANNELS.projects.GET,
  RPC_CHANNELS.projects.CREATE,
  RPC_CHANNELS.projects.UPDATE,
  RPC_CHANNELS.projects.SET_STATUS,
  RPC_CHANNELS.projects.GET_MEMBERS,
  RPC_CHANNELS.projects.SET_MEMBER,
  RPC_CHANNELS.projects.REMOVE_MEMBER,
] as const

export function registerProjectsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(ctx, deps).id

  server.handle(RPC_CHANNELS.projects.LIST, (ctx, filter?: ProjectFilter) => getProjects(workspaceOf(ctx), filter))

  server.handle(RPC_CHANNELS.projects.GET, (ctx, id: string) => getProject(workspaceOf(ctx), id) ?? null)

  server.handle(
    RPC_CHANNELS.projects.CREATE,
    (ctx, input: { title: string; description?: string; resources?: Resource[] }) =>
      createProject({ workspaceId: workspaceOf(ctx), title: input.title, description: input.description, resources: input.resources, createdBy: actorOf(ctx) }),
  )

  server.handle(RPC_CHANNELS.projects.UPDATE, (ctx, id: string, patch: ProjectUpdate) =>
    updateProject(workspaceOf(ctx), id, {
      title: patch.title,
      description: patch.description,
      resources: patch.resources,
      expectedUpdatedAt: patch.expectedUpdatedAt,
    }),
  )

  server.handle(RPC_CHANNELS.projects.SET_STATUS, (ctx, id: string, status: ProjectStatus) => setProjectStatus(workspaceOf(ctx), id, status))

  server.handle(RPC_CHANNELS.projects.GET_MEMBERS, (ctx, id: string) => getProjectMembers(workspaceOf(ctx), id))

  server.handle(RPC_CHANNELS.projects.SET_MEMBER, (ctx, id: string, actor: string, role: MemberRole) => {
    const workspaceId = workspaceOf(ctx)
    assertWorkspaceActors(workspaceId, [actor])
    return setProjectMember(workspaceId, id, actor, role)
  })

  server.handle(RPC_CHANNELS.projects.REMOVE_MEMBER, (ctx, id: string, actor: string) => {
    removeProjectMember(workspaceOf(ctx), id, actor)
  })
}
