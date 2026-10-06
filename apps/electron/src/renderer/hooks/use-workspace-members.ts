/**
 * The people of the workspace: who can be assigned a task, own a project, be named as a creator. The members
 * come from the server (`getWorkspaceMembers`, loaded per workspace and again on window focus); the default
 * agent ends the list. `me` is the caller's entry (the server flags it, so the desktop app's local user is
 * known too); while the list loads, the signed-in person (web) stands in for it.
 */

import { useMemo } from 'react'
import { userActor } from '@otto/shared/actors'
import { AGENT_DEFAULT_NAME } from '@otto/shared/branding'
import { workspaceMembersAtom } from '@/atoms/workspace-members'
import { isAgentActor } from '@/lib/actors'
import type { WorkspaceMember as MemberRow } from '../../shared/types'
import { useCurrentUser, type CurrentUser } from './use-current-user'
import { useWorkspaceList } from './use-workspace-list'

export interface WorkspaceMember {
  /** `user:<id>` or `agent:<id>`. */
  actor: string
  name: string
  email?: string
  role?: string
}

export interface WorkspaceMembers {
  members: WorkspaceMember[]
  /** The name to show for an actor, also for one that is no longer a member (an agent is named like the default agent). */
  nameOf: (actor: string) => string
  /** The caller's actor; null until known. */
  me: string | null
}

export const DEFAULT_AGENT_ACTOR = 'agent:default'

/** `rows` are the server's members; `user` the signed-in person, listed alone until the rows are loaded. */
export function buildWorkspaceMembers(user: CurrentUser | null, rows: MemberRow[] = []): WorkspaceMembers {
  const me = rows.find((row) => row.me)?.actor ?? (user?.id ? userActor(user.id) : null)
  const members: WorkspaceMember[] = rows.map(({ actor, name, email, role }) => ({ actor, name: name || email, email, role }))
  if (me && user && !members.some((member) => member.actor === me)) {
    members.unshift({ actor: me, name: user.name || user.email, email: user.email || undefined })
  }
  members.push({ actor: DEFAULT_AGENT_ACTOR, name: AGENT_DEFAULT_NAME })
  const nameOf = (actor: string) =>
    members.find((member) => member.actor === actor)?.name ?? (isAgentActor(actor) ? AGENT_DEFAULT_NAME : actor.slice(actor.indexOf(':') + 1))
  return { members, nameOf, me }
}

const loadMembers = (workspaceId: string) => window.electronAPI.getWorkspaceMembers(workspaceId)

/** The server's member rows of the active workspace (with `userId` and the caller's `me`), and `refresh`. */
export function useWorkspaceMemberList() {
  return useWorkspaceList(workspaceMembersAtom, loadMembers, 'members')
}

export function useWorkspaceMembers(): WorkspaceMembers {
  const user = useCurrentUser()
  const { items } = useWorkspaceMemberList()
  return useMemo(() => buildWorkspaceMembers(user, items), [user, items])
}
