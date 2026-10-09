import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { isActor, userActor } from '@otto/shared/actors'
import { getAgent } from '@otto/shared/agents'
import { createComment, deleteComment, getComments, getCommentsById, MAX_COMMENT, updateComment, type Comment } from '@otto/shared/comments'
import { getLibraryItem } from '@otto/shared/library'
import { addProjectMember, getProject, getProjects, MAX_DESCRIPTION, MAX_RESOURCES, MAX_RESOURCE_REF, MAX_RESOURCE_TITLE, MAX_TITLE, removeProjectMember, setProjectStatus, updateProject, type Resource } from '@otto/shared/projects'
import { createTask, createTimesheet, deleteTimesheet, getTask, getTasks, getTimesheets, MAX_ASSIGNEES, MAX_NOTES, MAX_TIME, setTaskStatus, updateTask } from '@otto/shared/tasks'
import { domainError } from '@otto/shared/utils'
import { isWorkspaceMember } from '@otto/shared/workspaces'

export const PROJECT_TASK_WRITE_TOOL_NAMES = new Set([
  'project_update', 'project_set_status', 'project_delete', 'project_add_member', 'project_remove_member',
  'task_create', 'task_update', 'task_set_status', 'task_delete', 'task_assign', 'task_set_due', 'task_set_resources',
  'comment_create', 'comment_update', 'comment_delete', 'timesheet_create', 'timesheet_delete',
])

export const PROJECT_TASK_DESTRUCTIVE_TOOL_NAMES = new Set([
  'project_set_status', 'project_delete', 'project_remove_member', 'task_set_status', 'task_delete', 'comment_delete', 'timesheet_delete',
])

export const PROJECT_TASK_NOTIFICATION_TOOL_NAMES = new Set([
  'project_add_member', 'project_remove_member', 'task_assign', 'comment_create', 'comment_update', 'comment_delete',
])

export function createMastraProjectTaskTools(scope: {
  workspaceId: string
  agentId: string
  assertAccess: () => void
  getUserId: () => string
  assertChatAccess: (id: string) => void
}) {
  const workspaceId = scope.workspaceId
  const id = z.string().regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]{12})$/)
  const actor = z.string().refine(isActor, 'Invalid actor')
  const title = z.string().trim().min(1).max(MAX_TITLE)
  const description = z.string().max(MAX_DESCRIPTION)
  const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  const dueAt = z.number().int().nonnegative().max(8_640_000_000_000_000).nullable()
  const projectStatus = z.enum(['active', 'archived', 'deleted'])
  const taskStatus = z.enum(['todo', 'doing', 'done', 'archived', 'deleted'])
  const resourceTitle = z.string().trim().min(1).max(MAX_RESOURCE_TITLE)
  const resources = z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), title: resourceTitle, ref: z.string().trim().max(MAX_RESOURCE_REF).refine((value) => {
      try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
    }, 'Expected an http or https URL') }).strict(),
    z.object({ type: z.literal('library'), title: resourceTitle, ref: id }).strict(),
    z.object({ type: z.literal('chat'), title: resourceTitle, ref: z.string().min(1).max(MAX_RESOURCE_REF).regex(/^[\w-]+$/) }).strict(),
  ])).max(MAX_RESOURCES)
  const entity = z.string().refine((value) => {
    const [type, ref, extra] = value.split(':')
    return (type === 'project' || type === 'task') && extra === undefined && id.safeParse(ref).success
  }, 'Expected a project or task reference')
  const content = z.string().max(MAX_COMMENT).refine((value) => !!value.trim(), 'A comment cannot be empty')

  const access = () => {
    scope.assertAccess()
    const userId = id.parse(scope.getUserId())
    if (!isWorkspaceMember(workspaceId, userId)) throw domainError('forbidden', 'The initiating person is not a workspace member')
    if (!getAgent(workspaceId, scope.agentId)) throw domainError('forbidden', 'The named agent is not in this workspace')
    return { humanActor: userActor(userId), agentActor: `agent:${scope.agentId}` }
  }
  const assertResources = (links: Resource[]) => {
    for (const link of links) {
      if (link.type === 'chat') scope.assertChatAccess(link.ref)
      if (link.type === 'library' && !getLibraryItem(workspaceId, link.ref)) throw domainError('not_found', 'Library resource not found in this workspace')
    }
  }
  const project = (projectId: string) => {
    const value = getProject(workspaceId, projectId)
    if (!value) throw domainError('not_found', 'Project not found in this workspace')
    assertResources(value.resources)
    return value
  }
  const task = (taskId: string) => {
    const value = getTask(workspaceId, taskId)
    if (!value) throw domainError('not_found', 'Task not found in this workspace')
    assertResources(value.resources)
    return value
  }
  const assertVersion = (value: { updatedAt: number }, expected: number) => {
    if (value.updatedAt !== expected) throw domainError('conflict', 'The item changed since it was loaded')
  }
  const assertActors = (values: string[]) => {
    for (const value of values) {
      if (value.startsWith('user:') ? !isWorkspaceMember(workspaceId, value.slice(5)) : !getAgent(workspaceId, value.slice(6))) {
        throw domainError('invalid', 'The selected actor is not in this workspace')
      }
    }
  }
  const assertEntity = (value: string) => {
    entity.parse(value)
    const [type, ref] = value.split(':')
    return type === 'task' ? task(ref!) : project(ref!)
  }
  const assertComment = (value: Comment) => {
    assertEntity(value.entity)
    if (value.event?.kind === 'links') {
      assertResources(value.event.added)
      assertResources(value.event.removed)
    }
    return value
  }
  const comment = (commentId: string) => {
    const value = getCommentsById(workspaceId, [commentId])[0]
    if (!value) throw domainError('not_found', 'Comment not found in this workspace')
    return assertComment(value)
  }

  return {
    project_list: createTool({
      id: 'project_list', description: 'List projects in this workspace, active by default. Includes full metadata and updatedAt versions; inaccessible linked resources refuse the read.',
      inputSchema: z.object({ status: z.array(projectStatus).min(1).max(3).optional() }).strict(),
      execute: async (input) => {
        access()
        return getProjects(workspaceId, input).map((value) => { assertResources(value.resources); return value })
      },
    }),
    project_get: createTool({
      id: 'project_get', description: 'Read a project and its updatedAt version, including archived or soft-deleted projects.',
      inputSchema: z.object({ id }).strict(),
      execute: async (input) => { access(); return project(input.id) },
    }),
    project_update: createTool({
      id: 'project_update', description: 'Update explicitly requested project fields using its read version. Resources replace the complete list; preserve links not explicitly removed.',
      inputSchema: z.object({ id, title: title.optional(), description: description.optional(), resources: resources.optional(), expectedUpdatedAt: version }).strict().refine((input) => input.title !== undefined || input.description !== undefined || input.resources !== undefined, 'Provide a field to update'),
      execute: async ({ id, ...patch }) => {
        access(); project(id)
        if (patch.resources) assertResources(patch.resources)
        return updateProject(workspaceId, id, patch)
      },
    }),
    project_set_status: createTool({
      id: 'project_set_status', description: 'Explicitly archive or restore a project using its read version after explicit approval, even in Allow-all. Selecting a project never changes its status. Use project_delete for soft deletion.',
      inputSchema: z.object({ id, status: z.enum(['active', 'archived']), expectedUpdatedAt: version }).strict(),
      execute: async (input) => { access(); assertVersion(project(input.id), input.expectedUpdatedAt); return setProjectStatus(workspaceId, input.id, input.status) },
    }),
    project_delete: createTool({
      id: 'project_delete', description: 'Soft-delete a project after explicit approval, even in Allow-all. Does not delete its tasks. Requires the read version.',
      inputSchema: z.object({ id, expectedUpdatedAt: version }).strict(),
      execute: async (input) => { access(); assertVersion(project(input.id), input.expectedUpdatedAt); return setProjectStatus(workspaceId, input.id, 'deleted') },
    }),
    project_add_member: createTool({
      id: 'project_add_member', description: 'Add an explicitly selected existing workspace actor to a project after explicit approval, even in Allow-all. Does not invite people or assign tasks.',
      inputSchema: z.object({ id, actor, expectedUpdatedAt: version }).strict(),
      execute: async (input) => { access(); assertVersion(project(input.id), input.expectedUpdatedAt); assertActors([input.actor]); return addProjectMember(workspaceId, input.id, input.actor) },
    }),
    project_remove_member: createTool({
      id: 'project_remove_member', description: 'Remove an explicitly selected project member after explicit approval, even in Allow-all. Does not revoke workspace or chat access.',
      inputSchema: z.object({ id, actor, expectedUpdatedAt: version }).strict(),
      execute: async (input) => { access(); assertVersion(project(input.id), input.expectedUpdatedAt); return removeProjectMember(workspaceId, input.id, input.actor) },
    }),
    task_list: createTool({
      id: 'task_list', description: 'List tasks in this workspace with read versions. Excludes archived and deleted tasks unless requested. Selecting or listing tasks never assigns them or changes their status.',
      inputSchema: z.object({ projectId: id.optional(), status: z.array(taskStatus).min(1).max(5).optional(), assignee: actor.optional() }).strict(),
      execute: async (input) => {
        access()
        if (input.projectId) project(input.projectId)
        return getTasks(workspaceId, input).map((value) => { assertResources(value.resources); return value })
      },
    }),
    task_get: createTool({
      id: 'task_get', description: 'Read an existing task and its updatedAt version, including archived or soft-deleted tasks.',
      inputSchema: z.object({ id }).strict(),
      execute: async (input) => { access(); return task(input.id) },
    }),
    task_create: createTool({
      id: 'task_create', description: 'Create an unassigned todo task in this workspace, optionally linked to an existing project, attributed to the current named agent. Omit projectId or pass null for no project. Do not invent deadlines, assignments, or changes of status; assignment is a separate approved action.',
      inputSchema: z.object({ projectId: id.nullable().optional(), title, description: description.optional(), dueAt: dueAt.optional(), resources: resources.optional() }).strict(),
      execute: async (input) => {
        const createdBy = access().agentActor
        if (input.projectId != null) project(input.projectId)
        assertResources(input.resources ?? [])
        return createTask({ workspaceId, ...input, createdBy })
      },
    }),
    task_update: createTool({
      strict: false,
      id: 'task_update', description: 'Update explicitly requested task text or project using its read version. Omit projectId to keep the current project, pass an existing project ID to link it, or null to unlink it. Does not assign, change status, deadline, or links.',
      inputSchema: z.object({ id, title: title.optional(), description: description.optional(), projectId: id.nullable().optional(), expectedUpdatedAt: version }).strict().refine((input) => input.title !== undefined || input.description !== undefined || input.projectId !== undefined, 'Provide a field to update'),
      execute: async ({ id, ...patch }) => {
        const by = access().agentActor; task(id)
        if (patch.projectId) project(patch.projectId)
        return updateTask(workspaceId, id, patch, by)
      },
    }),
    task_set_status: createTool({
      id: 'task_set_status', description: 'Apply an explicitly requested task status or restore a deleted task using its read version after explicit approval, even in Allow-all. Selection never changes status. Use task_delete for soft deletion.',
      inputSchema: z.object({ id, status: z.enum(['todo', 'doing', 'done', 'archived']), expectedUpdatedAt: version }).strict(),
      execute: async (input) => { const by = access().agentActor; assertVersion(task(input.id), input.expectedUpdatedAt); return setTaskStatus(workspaceId, input.id, input.status, by) },
    }),
    task_delete: createTool({
      id: 'task_delete', description: 'Soft-delete a task after explicit approval, even in Allow-all, using its read version. Keeps its comments and time entries.',
      inputSchema: z.object({ id, expectedUpdatedAt: version }).strict(),
      execute: async (input) => { const by = access().agentActor; assertVersion(task(input.id), input.expectedUpdatedAt); return setTaskStatus(workspaceId, input.id, 'deleted', by) },
    }),
    task_assign: createTool({
      id: 'task_assign', description: 'Replace task assignees with explicitly selected existing workspace actors after explicit approval, even in Allow-all. Newly assigned people receive domain notifications. An empty list unassigns everyone.',
      inputSchema: z.object({ id, assignees: z.array(actor).max(MAX_ASSIGNEES), expectedUpdatedAt: version }).strict(),
      execute: async ({ id, ...patch }) => { const by = access().agentActor; task(id); assertActors(patch.assignees); return updateTask(workspaceId, id, patch, by) },
    }),
    task_set_due: createTool({
      id: 'task_set_due', description: 'Set an explicitly requested task deadline in epoch milliseconds, or clear it with null, using its read version. Never invent a deadline.',
      inputSchema: z.object({ id, dueAt, expectedUpdatedAt: version }).strict(),
      execute: async ({ id, ...patch }) => { const by = access().agentActor; task(id); return updateTask(workspaceId, id, patch, by) },
    }),
    task_set_resources: createTool({
      id: 'task_set_resources', description: 'Replace task links using its read version. Preserve links not explicitly removed. Only http/https URLs, workspace Library items, and chats accessible to the initiating person are allowed.',
      inputSchema: z.object({ id, resources, expectedUpdatedAt: version }).strict(),
      execute: async ({ id, ...patch }) => { const by = access().agentActor; task(id); assertResources(patch.resources); return updateTask(workspaceId, id, patch, by) },
    }),
    comment_list: createTool({
      id: 'comment_list', description: 'Read a page of project/task comments and activity events, oldest first within the page. Pass before to page backward. Activity events cannot be edited or deleted.',
      inputSchema: z.object({ entity, before: id.optional(), limit: z.number().int().min(1).max(500).optional() }).strict(),
      execute: async ({ entity, ...page }) => {
        access(); assertEntity(entity)
        const result = getComments(workspaceId, entity, page)
        result.items.forEach(assertComment)
        return result
      },
    }),
    comment_get: createTool({
      id: 'comment_get', description: 'Read an existing comment or activity event and its updatedAt version.',
      inputSchema: z.object({ id }).strict(),
      execute: async (input) => { access(); return comment(input.id) },
    }),
    comment_create: createTool({
      id: 'comment_create', description: 'Post the exact reviewed comment on a project or task as the current named agent after explicit approval, even in Allow-all. Existing domain user mentions notify workspace members.',
      inputSchema: z.object({ entity, content }).strict(),
      execute: async (input) => { const createdBy = access().agentActor; assertEntity(input.entity); return createComment({ workspaceId, ...input, createdBy }) },
    }),
    comment_update: createTool({
      id: 'comment_update', description: 'Edit only the current named agent’s or initiating person’s own comment, acting as its existing author, using its read version and exact reviewed text after explicit approval, even in Allow-all. Edits do not send new mention notifications.',
      inputSchema: z.object({ id, content, expectedUpdatedAt: version }).strict(),
      execute: async (input) => {
        const { humanActor, agentActor } = access()
        const value = comment(input.id)
        return updateComment(workspaceId, input.id, value.createdBy === humanActor ? humanActor : agentActor, input.content, input.expectedUpdatedAt)
      },
    }),
    comment_delete: createTool({
      id: 'comment_delete', description: 'Hard-delete only the current named agent’s or initiating person’s own comment and its notifications, acting as its existing author, after explicit approval, even in Allow-all. Requires its read version; activity events cannot be deleted.',
      inputSchema: z.object({ id, expectedUpdatedAt: version }).strict(),
      execute: async (input) => {
        const { humanActor, agentActor } = access()
        const value = comment(input.id)
        assertVersion(value, input.expectedUpdatedAt)
        deleteComment(workspaceId, input.id, value.createdBy === humanActor ? humanActor : agentActor)
        return { id: input.id, deleted: true }
      },
    }),
    timesheet_list: createTool({
      id: 'timesheet_list', description: 'Read actual time entries for an existing task, most recently logged first. Time is milliseconds.',
      inputSchema: z.object({ taskId: id }).strict(),
      execute: async (input) => { access(); task(input.taskId); return getTimesheets(workspaceId, input.taskId) },
    }),
    timesheet_create: createTool({
      id: 'timesheet_create', description: 'Log an explicitly provided actual duration in whole milliseconds on a task as the current named agent. Never estimate or invent actual time. Time entries are immutable; corrections require deletion and a new entry.',
      inputSchema: z.object({ taskId: id, time: z.number().int().positive().max(MAX_TIME), notes: z.string().max(MAX_NOTES).optional() }).strict(),
      execute: async (input) => { const createdBy = access().agentActor; task(input.taskId); return createTimesheet({ workspaceId, ...input, createdBy }) },
    }),
    timesheet_delete: createTool({
      id: 'timesheet_delete', description: 'Hard-delete the explicitly selected immutable time entry on a task after explicit approval, even in Allow-all. Does not delete the task.',
      inputSchema: z.object({ id, taskId: id }).strict(),
      execute: async (input) => {
        access(); task(input.taskId)
        if (!getTimesheets(workspaceId, input.taskId).some((entry) => entry.id === input.id)) throw domainError('not_found', 'Time entry not found on this task')
        deleteTimesheet(workspaceId, input.id)
        return { id: input.id, deleted: true }
      },
    }),
  }
}
