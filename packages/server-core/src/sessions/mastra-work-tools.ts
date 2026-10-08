import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { createLibraryFolder, createLibraryItem, getLibraryItem, getLibraryItems, readLibraryText, updateLibraryItem } from '@otto/shared/library'
import { createProject, getProjects, MAX_DESCRIPTION, MAX_TITLE } from '@otto/shared/projects'
import { createTask, getTask, getTasks, updateTask } from '@otto/shared/tasks'
import { createAgent, getAgent, MAX_INSTRUCTIONS } from '@otto/shared/agents'
import { createRoutine } from '@otto/shared/automations/routines'

export function createMastraWorkTools(scope: { workspaceId: string; agentId: string; assertAccess: () => void; getProjectDraft?: (creationId: string) => { title: string; description: string } | undefined; creator?: { getUserId: () => string; provider: string; model: string } }) {
  const workspaceId = scope.workspaceId
  const actor = `agent:${scope.agentId}`
  const id = z.string().refine((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) || /^[a-z0-9]{12}$/.test(value), 'Invalid stored item id')
  const title = z.string().trim().min(1).max(MAX_TITLE)
  const text = z.string().max(MAX_DESCRIPTION)
  const document = (documentId: string) => {
    const item = getLibraryItem(workspaceId, documentId)
    if (!item || item.type !== 'document') throw new Error('Document not found in this workspace.')
    return item
  }
  return {
    ...(scope.creator ? {
      create_agent: createTool({
        id: 'create_agent', description: 'Create an agent with reviewed name and instructions after explicit approval. Inherits the current model/provider and existing skill/source limits; cannot create credentials or expand capabilities.',
        inputSchema: z.object({ title, instructions: z.string().max(MAX_INSTRUCTIONS) }).strict(),
        execute: async (input) => {
          scope.assertAccess()
          const current = getAgent(workspaceId, scope.agentId)
          if (!current) throw new Error('The current agent is unavailable.')
          return createAgent({ workspaceId, ...input, provider: scope.creator!.provider, model: scope.creator!.model, skills: current.skills, sources: current.sources, createdBy: `user:${scope.creator!.getUserId()}` })
        },
      }),
      create_routine: createTool({
        id: 'create_routine', description: 'Create a reviewed scheduled prompt routine, paused by default, after explicit approval. Ask for the intended cron schedule and timezone; never invent them. Uses the current agent and creator, safe permission mode, no scripts/webhooks/credentials and no execution at creation. The person explicitly enables the routine separately.',
        inputSchema: z.object({ title, cron: z.string().trim().min(1).max(100), timezone: z.string().trim().min(1).max(100), prompt: text.min(1) }).strict(),
        execute: async (input) => {
          scope.assertAccess()
          return createRoutine({ workspaceId, title: input.title, agentId: scope.agentId, createdBy: `user:${scope.creator!.getUserId()}`, paused: true, config: { type: 'schedule', schedule: { cron: input.cron, timezone: input.timezone }, permissionMode: 'safe', actions: [{ type: 'prompt', prompt: input.prompt }] } })
        },
      }),
    } : {}),
    ...(scope.getProjectDraft ? {
      prepare_project: createTool({
        id: 'prepare_project', description: 'Prepare a project foundation for conversational review, without creating a project. Ask for any missing name and brief first. Compose concise Markdown covering purpose, desired outcome, scope, suggested steps, open questions and assumptions; never invent dates, owners or budgets. Present this result to the person and accept revisions before requesting create_project approval. Keep the returned creationId for that exact draft and every retry. Do not create tasks or invite people.',
        inputSchema: z.object({ title, description: text.min(1) }).strict(),
        execute: async (input) => {
          scope.assertAccess()
          return { creationId: crypto.randomUUID(), title: input.title, description: input.description }
        },
      }),
      create_project: createTool({
        id: 'create_project', description: 'Create the exact prepared project after the person reviews its foundation. Requires the creationId from prepare_project and explicit native approval, even in Allow-all. Retry that same ID after an uncertain result; never replace it automatically. Creates only a project, not tasks, invitations or work.',
        inputSchema: z.object({ creationId: z.uuid().refine((value) => value[14] === '4', 'Invalid project draft ID') }).strict(),
        execute: async ({ creationId }) => {
          scope.assertAccess()
          const draft = scope.getProjectDraft!(creationId)
          if (!draft) throw new Error('The prepared project draft is unavailable. Review a new foundation before creating it.')
          return createProject({ workspaceId, ...draft, creationId, createdBy: actor })
        },
      }),
    } : {}),
    list_work: createTool({
      id: 'list_work', description: 'List existing projects, tasks and documents in this workspace. No files or shell access.',
      inputSchema: z.object({}).strict(),
      execute: async () => {
        scope.assertAccess()
        return { projects: getProjects(workspaceId).slice(0, 50).map(({ id, title }) => ({ id, title })), tasks: getTasks(workspaceId).slice(0, 50).map(({ id, title, projectId, resources, updatedAt }) => ({ id, title, projectId, resources, updatedAt })), documents: getLibraryItems(workspaceId, { type: 'document' }).slice(0, 50) }
      },
    }),
    read_document: createTool({
      id: 'read_document', description: 'Read a Library document and its updatedAt version before editing.',
      inputSchema: z.object({ id }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        const item = document(input.id)
        const content = await readLibraryText(workspaceId, item.id)
        if (content.length > MAX_DESCRIPTION) throw new Error('This document is too large for the current work slice; use its document view.')
        return { ...item, content }
      },
    }),
    create_document: createTool({
      id: 'create_document', description: 'Create a Markdown document in Library, attributed to the current named agent.',
      inputSchema: z.object({ title, content: text, parentId: id.optional() }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        return createLibraryItem({ workspaceId, title: input.title, mime: 'text/markdown', bytes: new TextEncoder().encode(input.content), parentId: input.parentId, createdBy: actor })
      },
    }),
    create_folder: createTool({
      id: 'create_folder', description: 'Create a Library folder in this workspace, optionally under an existing folder. The named agent is attributed; cross-workspace parents are refused.',
      inputSchema: z.object({ title, parentId: id.optional() }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        return createLibraryFolder({ workspaceId, ...input, createdBy: actor })
      },
    }),
    update_document: createTool({
      id: 'update_document', description: 'Update a Library document using the version read previously. A changed version refuses the write.',
      inputSchema: z.object({ id, content: text, expectedUpdatedAt: z.number().int().nonnegative() }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        document(input.id)
        return updateLibraryItem(workspaceId, input.id, { content: new TextEncoder().encode(input.content), expectedUpdatedAt: input.expectedUpdatedAt })
      },
    }),
    create_task: createTool({
      id: 'create_task', description: 'Create a task in an existing project, optionally linked to a Library document. The current named agent is the creator.',
      inputSchema: z.object({ projectId: id, title, description: text.optional(), documentId: id.optional() }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        const item = input.documentId ? document(input.documentId) : undefined
        return createTask({ workspaceId, projectId: input.projectId, title: input.title, description: input.description, createdBy: actor, resources: item ? [{ type: 'library', title: item.title, ref: item.id }] : [] })
      },
    }),
    update_task: createTool({
      id: 'update_task', description: 'Update a task title and optionally add a document link, preserving other links. Use the updatedAt version from list_work.',
      inputSchema: z.object({ id, title, documentId: id.optional(), expectedUpdatedAt: z.number().int().nonnegative() }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        const task = getTask(workspaceId, input.id)
        if (!task) throw new Error('Task not found in this workspace.')
        const item = input.documentId ? document(input.documentId) : undefined
        const resources = item && !task.resources.some((resource) => resource.type === 'library' && resource.ref === item.id)
          ? [...task.resources, { type: 'library' as const, title: item.title, ref: item.id }] : task.resources
        return updateTask(workspaceId, task.id, { title: input.title, resources, expectedUpdatedAt: input.expectedUpdatedAt }, actor)
      },
    }),
  }
}

export const MASTRA_WORK_WRITES = new Set(['create_project', 'create_agent', 'create_routine', 'create_folder', 'create_document', 'update_document', 'create_task', 'update_task'])
