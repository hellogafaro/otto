import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { isActor } from '../actors.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { likeContains, likeRank } from '../db/like.ts'
import { domainError } from '../utils/errors.ts'
import { MAX_DESCRIPTION, MAX_MEMBERS, MAX_TITLE } from './limits.ts'
import { parseResources } from './resources.ts'
import { projects } from './schema.ts'
import type {
  Project,
  ProjectFilter,
  ProjectPromptContext,
  ProjectStatus,
  ProjectUpdate,
  Resource,
} from './types.ts'

/**
 * Projects: what a body of work is, with its tasks (../tasks) hanging off it.
 *
 *   projects(id, workspaceId, title, description, status, members, resources, createdAt, updatedAt)   (schema.ts)
 *
 * `status` is 'active', 'archived' or 'deleted'. Archiving and deleting only set it, rows are
 * never removed (there is no hard delete); lists hide both unless asked for with `status`, and
 * restoring is setting 'active'. `resources` link to urls, library items and chats (resources.ts).
 * `members` are 'user:<id>' or 'agent:<id>' (the creator first, at most MAX_MEMBERS); it is data only: nothing
 * enforces it. Chats bind to a project by id
 * (`getProjectPromptContext` is what the agent prompt reads). Every function takes the
 * workspace explicitly and only sees its rows.
 */

export { MAX_DESCRIPTION, MAX_MEMBERS, MAX_RESOURCES, MAX_RESOURCE_REF, MAX_RESOURCE_TITLE, MAX_TITLE } from './limits.ts'
export { parseResources } from './resources.ts'
export type * from './types.ts'

/** Replaces actor `from` by `to` in the members of the projects (of one workspace, or all). */
function replaceMember(db: Db | Tx, from: string, to: string, workspaceId?: string): void {
  const rows = db
    .select({ id: projects.id, members: projects.members })
    .from(projects)
    .where(and(workspaceId === undefined ? undefined : eq(projects.workspaceId, workspaceId), sql`exists (select 1 from json_each(${projects.members}) where json_each.value = ${from})`))
    .all()
  for (const { id, members } of rows) db.update(projects).set({ members: [...new Set(members.map((who) => (who === from ? to : who)))] }).where(eq(projects.id, id)).run()
}

/** Gives what the bare actor 'user' was on a project to `actor`: runs once, when the first user appears. */
export const updateLegacyUserActor = (db: Db | Tx, actor: string): void => replaceMember(db, 'user', actor)

/** Gives what actor `from` was on the projects of the workspace to `to` (`agent:default` to the agent that replaces it): see `initAgentsImport`. */
export const updateAgentActor = (db: Db | Tx, workspaceId: string, from: string, to: string): void => replaceMember(db, from, to, workspaceId)

const STATUSES: ProjectStatus[] = ['active', 'archived', 'deleted']

type Row = typeof projects.$inferSelect

function toProject(row: Row): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    members: row.members,
    resources: row.resources,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function assertTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim()) throw domainError('invalid', 'A title is required')
  if (title.trim().length > MAX_TITLE) throw domainError('invalid', `Titles are limited to ${MAX_TITLE} characters`)
  return title.trim()
}

function assertDescription(description: unknown): string {
  if (typeof description !== 'string') throw domainError('invalid', 'The description must be text')
  if (description.length > MAX_DESCRIPTION) throw domainError('invalid', `Descriptions are limited to ${MAX_DESCRIPTION} characters`)
  return description
}

const assertResources = (resources: unknown): Resource[] => parseResources(resources, (message) => domainError('invalid', message))

export function createProjectsStore(db: Db) {
  const find = (workspaceId: string, id: string) =>
    db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, id))).get()

  function getRow(workspaceId: string, id: string): Row {
    const row = find(workspaceId, id)
    if (!row) throw domainError('not_found', `Project ${id} does not exist`)
    return row
  }

  return {
    /** The creating actor becomes the first member. */
    createProject(input: {
      workspaceId: string
      title: string
      description?: string
      resources?: Resource[]
      createdBy: string
      creationId?: string
    }): Project {
      const title = assertTitle(input.title)
      const description = assertDescription(input.description ?? '')
      const resources = assertResources(input.resources ?? [])
      const createdBy = input.createdBy
      if (!isActor(createdBy)) throw domainError('invalid', `${createdBy} is not an actor`)
      if (input.creationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.creationId)) throw domainError('invalid', 'Invalid project creation ID')
      const now = new Date()
      return db.transaction((tx) => {
        if (input.creationId) {
          const existing = tx.select().from(projects).where(eq(projects.id, input.creationId)).get()
          if (existing) {
            if (existing.workspaceId !== input.workspaceId || existing.members[0] !== createdBy || existing.title !== title || existing.description !== description || JSON.stringify(existing.resources) !== JSON.stringify(resources)) throw domainError('conflict', 'This creation request already produced a different project')
            return toProject(existing)
          }
        }
        const row = tx
          .insert(projects)
          .values({ id: input.creationId ?? crypto.randomUUID(), workspaceId: input.workspaceId, title, description, status: 'active', members: [createdBy], resources, createdAt: now, updatedAt: now })
          .returning()
          .get()
        return toProject(row)
      })
    },

    getProject(workspaceId: string, id: string): Project | undefined {
      const row = find(workspaceId, id)
      return row && toProject(row)
    },

    /** Active projects unless `status` says otherwise; the most recently updated first. */
    getProjects(workspaceId: string, filter: ProjectFilter = {}): Project[] {
      const status = [filter.status ?? 'active'].flat()
      return db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), inArray(projects.status, status)))
        .orderBy(desc(projects.updatedAt))
        .all()
        .map(toProject)
    },

    /** Active projects whose title or description contains `query` (plain LIKE): a title that starts with it first, then one that contains it, then a description match; most recently updated first. */
    searchProjects(workspaceId: string, query: string, limit = 20): Project[] {
      const text = query.trim()
      if (!text) return []
      return db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.status, 'active'), or(likeContains(projects.title, text), likeContains(projects.description, text))))
        .orderBy(likeRank(projects.title, text), desc(projects.updatedAt))
        .limit(limit)
        .all()
        .map(toProject)
    },

    /**
     * Changes the given fields. With `expectedUpdatedAt`, a different stored `updatedAt` means
     * someone saved in between, and nothing changes (`conflict`). A deleted project cannot be changed.
     */
    updateProject(workspaceId: string, id: string, patch: ProjectUpdate): Project {
      const row = getRow(workspaceId, id)
      if (row.status === 'deleted') throw domainError('invalid', `Project ${id} is deleted; restore it first`)
      if (patch.expectedUpdatedAt !== undefined && patch.expectedUpdatedAt !== row.updatedAt.getTime()) {
        throw domainError('conflict', `Project ${id} changed since it was loaded`)
      }
      const changes: Partial<Row> = {}
      if (patch.title !== undefined) changes.title = assertTitle(patch.title)
      if (patch.description !== undefined) changes.description = assertDescription(patch.description)
      if (patch.resources !== undefined) changes.resources = assertResources(patch.resources)
      // Strictly after the stored value, so two saves in one millisecond still tell apart.
      changes.updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
      const updated = db
        .update(projects)
        .set(changes)
        .where(and(eq(projects.id, id), eq(projects.updatedAt, row.updatedAt)))
        .returning()
        .get()
      if (!updated) throw domainError('conflict', `Project ${id} changed since it was loaded`)
      return toProject(updated)
    },

    /** Archive ('archived'), soft delete ('deleted') or restore ('active'). */
    setProjectStatus(workspaceId: string, id: string, status: ProjectStatus): Project {
      if (!STATUSES.includes(status)) throw domainError('invalid', `${status} is not a project status`)
      const row = getRow(workspaceId, id)
      const updated = db
        .update(projects)
        .set({ status, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) })
        .where(eq(projects.id, id))
        .returning()
        .get()
      return toProject(updated!)
    },

    /** Adds the actor to the project's members (a member already there stays). */
    addProjectMember(workspaceId: string, projectId: string, actor: string): Project {
      const row = getRow(workspaceId, projectId)
      if (!isActor(actor)) throw domainError('invalid', `${actor} is not an actor`)
      if (row.members.includes(actor)) return toProject(row)
      if (row.members.length >= MAX_MEMBERS) throw domainError('invalid', `At most ${MAX_MEMBERS} members`)
      return toProject(db.update(projects).set({ members: [...row.members, actor] }).where(eq(projects.id, projectId)).returning().get()!)
    },

    removeProjectMember(workspaceId: string, projectId: string, actor: string): Project {
      const row = getRow(workspaceId, projectId)
      if (!row.members.includes(actor)) throw domainError('not_found', `${actor} is not a member of ${projectId}`)
      return toProject(db.update(projects).set({ members: row.members.filter((who) => who !== actor) }).where(eq(projects.id, projectId)).returning().get()!)
    },
  }
}

export type ProjectsStore = ReturnType<typeof createProjectsStore>

let store: ProjectsStore | undefined

/** The process-wide store, on the shared database. */
export const initProjectsStore = (): ProjectsStore => (store ??= createProjectsStore(initDb()))

export const createProject: ProjectsStore['createProject'] = (input) => initProjectsStore().createProject(input)
export const getProject: ProjectsStore['getProject'] = (workspaceId, id) => initProjectsStore().getProject(workspaceId, id)
export const getProjects: ProjectsStore['getProjects'] = (workspaceId, filter) => initProjectsStore().getProjects(workspaceId, filter)
export const searchProjects: ProjectsStore['searchProjects'] = (workspaceId, query, limit) => initProjectsStore().searchProjects(workspaceId, query, limit)
export const updateProject: ProjectsStore['updateProject'] = (workspaceId, id, patch) => initProjectsStore().updateProject(workspaceId, id, patch)
export const setProjectStatus: ProjectsStore['setProjectStatus'] = (workspaceId, id, status) => initProjectsStore().setProjectStatus(workspaceId, id, status)
export const addProjectMember: ProjectsStore['addProjectMember'] = (workspaceId, projectId, actor) => initProjectsStore().addProjectMember(workspaceId, projectId, actor)
export const removeProjectMember: ProjectsStore['removeProjectMember'] = (workspaceId, projectId, actor) =>
  initProjectsStore().removeProjectMember(workspaceId, projectId, actor)

/** What the agent prompt shows of a chat's project; none when the id is unknown or the project is deleted. */
export function getProjectPromptContext(workspaceId: string, projectId: string): ProjectPromptContext | undefined {
  const project = getProject(workspaceId, projectId)
  if (!project || project.status === 'deleted') return undefined
  return { title: project.title, description: project.description, resources: project.resources }
}
