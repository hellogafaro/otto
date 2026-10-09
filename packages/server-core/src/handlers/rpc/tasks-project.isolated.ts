import { expect, it } from 'bun:test'
import { basename, join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { createProject, getProjects } from '@otto/shared/projects'
import { getTask } from '@otto/shared/tasks'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerTasksHandlers } from './tasks'

it('RPC task project inputs are optional, preserve omitted updates, and unlink only the scoped version', () => {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'RPC zero-project tasks', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const foreign = addWorkspace({ name: 'RPC foreign workspace', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const userId = crypto.randomUUID()
  createWorkspaceMember(workspace.id, userId, 'owner')
  const ctx: RequestContext = { clientId: 'fixture', userId, workspaceId: workspace.id, webContentsId: null }
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = { handle: (channel, handler) => { handlers.set(channel, handler) }, push() {}, invokeClient: async () => undefined }
  registerTasksHandlers(server, {} as HandlerDeps)
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(ctx, ...args)
  const created = call(RPC_CHANNELS.tasks.CREATE, { title: 'RPC unlinked task', description: 'Preserved brief', assignees: [`user:${userId}`], dueAt: 1_800_000_000_000 })
  const explicit = call(RPC_CHANNELS.tasks.CREATE, { title: 'RPC explicit null', projectId: null })
  expect(created).toMatchObject({ projectId: null, title: 'RPC unlinked task', status: 'todo', dueAt: 1_800_000_000_000, assignees: [`user:${userId}`], createdBy: `user:${userId}` })
  expect(explicit.projectId).toBeNull()
  expect(getProjects(workspace.id)).toEqual([])
  expect(call(RPC_CHANNELS.tasks.GET, created.id)).toEqual(created)
  expect(call(RPC_CHANNELS.tasks.LIST)).toContainEqual(created)
  const foreignProject = createProject({ workspaceId: foreign.id, title: 'Foreign project', createdBy: `user:${userId}` })
  expect(() => call(RPC_CHANNELS.tasks.CREATE, { title: 'Denied', projectId: foreignProject.id })).toThrow('does not exist')
  expect(() => call(RPC_CHANNELS.tasks.UPDATE, created.id, { projectId: foreignProject.id, expectedUpdatedAt: created.updatedAt })).toThrow('does not exist')
  const project = createProject({ workspaceId: workspace.id, title: 'Chosen project', createdBy: `user:${userId}` })
  const linked = call(RPC_CHANNELS.tasks.UPDATE, created.id, { projectId: project.id, expectedUpdatedAt: created.updatedAt })
  expect(linked.projectId).toBe(project.id)
  const edited = call(RPC_CHANNELS.tasks.UPDATE, created.id, { title: 'RPC text update', expectedUpdatedAt: linked.updatedAt })
  expect(edited.projectId).toBe(project.id)
  expect(() => call(RPC_CHANNELS.tasks.UPDATE, created.id, { projectId: null, expectedUpdatedAt: created.updatedAt })).toThrow('changed')
  const unlinked = call(RPC_CHANNELS.tasks.UPDATE, created.id, { projectId: null, expectedUpdatedAt: edited.updatedAt })
  expect(unlinked).toEqual({ ...created, title: 'RPC text update', updatedAt: unlinked.updatedAt })
  expect(getTask(workspace.id, created.id)).toEqual(unlinked)
  expect(call(RPC_CHANNELS.tasks.LIST, { projectId: project.id })).toEqual([])
  expect(handlers.get(RPC_CHANNELS.tasks.GET)!({ ...ctx, workspaceId: foreign.id }, created.id)).toBeNull()
  expect(() => handlers.get(RPC_CHANNELS.tasks.CREATE)!({ ...ctx, workspaceId: null }, { title: 'No workspace' })).toThrow('Cannot determine workspace')
  expect(() => handlers.get(RPC_CHANNELS.tasks.CREATE)!({ ...ctx, userId: null }, { title: 'No authenticated actor' })).toThrow('Sign in first')
})
