/**
 * The search of the Tasks, Projects, Library, Skills and Inbox views: tasks filters, the project tab, the library
 * tab, folder and creator, the skills' scope, the inbox's unread filter. They live in the route string's query (`tasks?project=p1&status=todo`) and in
 * the URL's search, in the same form, so one value round-trips between the two (`router/location.ts`).
 * Each `normalize…Search` takes whatever was given and returns only valid keys, in a fixed order, so
 * equal searches are equal strings.
 */

import { isTruthyFlag } from './chat-filters'

export const PROJECT_TABS = ['overview', 'tasks', 'documents', 'files'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

export const LIBRARY_TABS = ['all', 'files', 'documents'] as const
export type LibraryTab = (typeof LIBRARY_TABS)[number]

/** The statuses a Tasks filter can pick; archived is its own flag, like the Chats index. */
export const TASK_FILTER_STATUSES = ['todo', 'doing', 'done'] as const
export type TaskFilterStatus = (typeof TASK_FILTER_STATUSES)[number]

/** `/{ws}/tasks[/id]`: one project, one assignee (an actor), any statuses, archived tasks too. */
export interface TasksSearch {
  project?: string
  assignee?: string
  status?: TaskFilterStatus[]
  archived?: true
}

/** `/{ws}/projects[/id]`: the open project's tab; `status=archived` lists the archived projects. */
export interface ProjectsSearch {
  tab?: ProjectTab
  status?: 'archived'
}

/** `/{ws}/library[/id]`: the tab, the open folder (an item id) and the creator filter (an actor). */
export interface LibrarySearch {
  tab?: LibraryTab
  folder?: string
  createdBy?: string
}

/** A query string as an object: a key given once is a string, a repeated key a list of strings. */
export function parseSearch(searchStr: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of new URLSearchParams(searchStr)) {
    const have = out[key]
    out[key] = have === undefined ? value : Array.isArray(have) ? [...have, value] : [have, value]
  }
  return out
}

/** An object as a query string (`''` or `?a=1&a=2`): lists repeat the key, `true` is `1`, empty and false are dropped. */
export function stringifySearch(search: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null || item === false || item === '') continue
      params.append(key, item === true ? '1' : String(item))
    }
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** The first value of a param given once or repeated, as non-empty text. */
function text(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'number') return String(first)
  return typeof first === 'string' && first ? first : undefined
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  const found = text(value)
  return allowed.find((item) => item === found)
}

export function normalizeTasksSearch(search: Record<string, unknown> = {}): TasksSearch {
  const out: TasksSearch = {}
  const project = text(search.project)
  if (project) out.project = project
  const assignee = text(search.assignee)
  if (assignee) out.assignee = assignee
  const given = Array.isArray(search.status) ? search.status : [search.status]
  const status = TASK_FILTER_STATUSES.filter((item) => given.includes(item))
  if (status.length > 0) out.status = status
  if (isTruthyFlag(search.archived)) out.archived = true
  return out
}

export function normalizeProjectsSearch(search: Record<string, unknown> = {}): ProjectsSearch {
  const out: ProjectsSearch = {}
  const tab = oneOf(PROJECT_TABS, search.tab)
  if (tab) out.tab = tab
  if (text(search.status) === 'archived') out.status = 'archived'
  return out
}

export function normalizeLibrarySearch(search: Record<string, unknown> = {}): LibrarySearch {
  const out: LibrarySearch = {}
  const tab = oneOf(LIBRARY_TABS, search.tab)
  if (tab) out.tab = tab
  const folder = text(search.folder)
  if (folder) out.folder = folder
  const createdBy = text(search.createdBy)
  if (createdBy) out.createdBy = createdBy
  return out
}

/** `/{ws}/settings/skills[/slug]`: no search (every skill is the workspace's; an old `?scope=` is dropped). */
export type SkillsSearch = Record<never, never>

export const normalizeSkillsSearch = (_search?: Record<string, unknown>): SkillsSearch => ({})

/** `/{ws}/inbox`: `unread=1` keeps only the unread notifications. */
export interface InboxSearch {
  unread?: true
}

export function normalizeInboxSearch(search: Record<string, unknown> = {}): InboxSearch {
  return isTruthyFlag(search.unread) ? { unread: true } : {}
}
