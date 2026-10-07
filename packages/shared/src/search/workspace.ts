import { searchComments } from '../comments/index.ts'
import { searchLibraryItems } from '../library/index.ts'
import { getProject, searchProjects } from '../projects/index.ts'
import { searchChats } from '../sessions/messages.ts'
import { getTask, searchTasks } from '../tasks/index.ts'
import { snippetOf } from '../utils/snippet.ts'
import type { SearchHit } from './types.ts'

/** The most results of each kind. */
export const SEARCH_LIMIT = 25
/** The longest query looked at. */
export const MAX_SEARCH_QUERY = 200

/** A snippet of `text` around the query, unless the title already shows it. */
const snippetUnlessTitle = (title: string, text: string, query: string) =>
  title.toLowerCase().includes(query.toLowerCase()) ? undefined : snippetOf(text, query) || undefined

/**
 * One search over what `actor` may see in a workspace. Each domain searches its own rows (chats: message text through
 * `messages_fts`, only the actor's own chats; tasks, projects: title and description; library: title; comments: text,
 * on tasks and projects that are still shown); this only merges them, by kind in `SEARCH_KINDS` order, at most `limit` of
 * each. A comment on an archived or deleted task or project is left out, like the task.
 */
export function searchWorkspace(workspaceId: string, actor: string, query: string, limit = SEARCH_LIMIT): SearchHit[] {
  const text = query.trim().slice(0, MAX_SEARCH_QUERY)
  if (!text) return []

  const chats = searchChats(workspaceId, actor, text, { limit, perChat: 1 }).map(
    (chat): SearchHit => ({ kind: 'chat', id: chat.sessionId, title: chat.title, snippet: chat.matches[0]?.snippet ?? '', matchCount: chat.matchCount }),
  )
  const tasks = searchTasks(workspaceId, text, limit).map(
    (task): SearchHit => ({ kind: 'task', id: task.id, title: task.title, status: task.status, projectId: task.projectId, snippet: snippetUnlessTitle(task.title, task.description, text) }),
  )
  const projects = searchProjects(workspaceId, text, limit).map(
    (project): SearchHit => ({ kind: 'project', id: project.id, title: project.title, snippet: snippetUnlessTitle(project.title, project.description, text) }),
  )
  const library = searchLibraryItems(workspaceId, text, limit).map(
    (item): SearchHit => ({ kind: 'library', id: item.id, title: item.title, type: item.type, parentId: item.parentId }),
  )
  // Some of the newest matches may be on things that are gone: look at a few times the limit, keep `limit`.
  const comments: SearchHit[] = []
  for (const comment of searchComments(workspaceId, text, limit * 3)) {
    const [type, id = ''] = comment.entity.split(':')
    const entity = type === 'task' ? getTask(workspaceId, id) : type === 'project' ? getProject(workspaceId, id) : undefined
    if (!entity || entity.status === 'archived' || entity.status === 'deleted') continue
    comments.push({ kind: 'comment', id: comment.id, entity: comment.entity, title: entity.title, snippet: snippetOf(comment.content, text) })
    if (comments.length === limit) break
  }
  return [...chats, ...tasks, ...projects, ...library, ...comments]
}
