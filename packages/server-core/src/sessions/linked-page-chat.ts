import { userActor } from '@otto/shared/actors'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { getLibraryItem } from '@otto/shared/library'
import { getProject } from '@otto/shared/projects'
import type { Session } from '@otto/shared/protocol'
import { getChatWorkspaceId } from '@otto/shared/sessions'
import { getTask } from '@otto/shared/tasks'
import { domainError } from '@otto/shared/utils'
import { isWorkspaceMember } from '@otto/shared/workspaces'
import type { ISessionManager } from '../handlers/session-manager-interface'

const bootstraps = new Map<string, Promise<void>>()
const unavailable = () => domainError('not_found', 'Linked page conversation is unavailable')

export async function initLinkedPageChat(
  input: { workspaceId: string; userId: string; contextEntity: string },
  deps: {
    sessions: Pick<ISessionManager, 'createSession' | 'canSeeSession' | 'getSession'>
    findLinkedSessionId: (workspaceId: string, contextEntity: string) => string | undefined
  },
): Promise<Session> {
  const workspace = getWorkspaceByNameOrId(input.workspaceId)
  if (!workspace || !input.userId || !isWorkspaceMember(workspace.id, input.userId)) throw unavailable()
  if (typeof input.contextEntity !== 'string') throw unavailable()
  const [type, id, extra] = input.contextEntity.split(':')
  if (!type || !id || extra !== undefined || !['project', 'task', 'library'].includes(type)) throw unavailable()

  const page = () => {
    if (!isWorkspaceMember(workspace.id, input.userId)) throw unavailable()
    const value = type === 'project' ? getProject(workspace.id, id)
      : type === 'task' ? getTask(workspace.id, id)
      : getLibraryItem(workspace.id, id)
    if (!value || ('status' in value && value.status === 'deleted')) throw unavailable()
    for (const resource of 'resources' in value ? value.resources : []) {
      if (resource.type === 'chat' && (getChatWorkspaceId(resource.ref) !== workspace.id || !deps.sessions.canSeeSession(resource.ref, input.userId))) throw unavailable()
      if (resource.type === 'library' && !getLibraryItem(workspace.id, resource.ref)) throw unavailable()
    }
    return value
  }
  page()
  const key = JSON.stringify([workspace.id, input.contextEntity])
  const previous = bootstraps.get(key)
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  bootstraps.set(key, current)
  await previous
  try {
    const entity = page()
    let sessionId = deps.findLinkedSessionId(workspace.id, input.contextEntity)
    if (sessionId === undefined) {
      const created = await deps.sessions.createSession(workspace.id, { name: entity.title }, { createdBy: userActor(input.userId), contextEntity: input.contextEntity })
      sessionId = deps.findLinkedSessionId(workspace.id, input.contextEntity)
      if (sessionId !== created.id) throw unavailable()
    }
    if (!deps.sessions.canSeeSession(sessionId, input.userId)) throw unavailable()
    const session = await deps.sessions.getSession(sessionId, undefined, input.userId)
    page()
    if (!session || session.id !== sessionId || session.workspaceId !== workspace.id || session.contextEntity !== input.contextEntity || !deps.sessions.canSeeSession(sessionId, input.userId)) throw unavailable()
    return session
  } finally {
    release()
    if (bootstraps.get(key) === current) bootstraps.delete(key)
  }
}
