import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { createLibraryItem, getLibraryItem, getLibraryItems, readLibraryText, updateLibraryItem } from '@otto/shared/library'
import { getProjects, MAX_DESCRIPTION, MAX_TITLE } from '@otto/shared/projects'
import { createTask, getTask, getTasks, updateTask } from '@otto/shared/tasks'

export function createMastraWorkTools(scope: { workspaceId: string; agentId: string; assertAccess: () => void }) {
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
      inputSchema: z.object({ title, content: text }).strict(),
      execute: async (input) => {
        scope.assertAccess()
        return createLibraryItem({ workspaceId, title: input.title, mime: 'text/markdown', bytes: new TextEncoder().encode(input.content), createdBy: actor })
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

export const MASTRA_WORK_WRITES = new Set(['create_document', 'update_document', 'create_task', 'update_task'])
