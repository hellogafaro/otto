/**
 * The people of the workspace: who can be assigned a task, own a project, be named as a creator.
 * A stub until the members RPC lands: the signed-in person (web) and the default agent. Electron has no
 * sessions, so its local person has no actor (`me` is null) and only the agent is listed. The members
 * work replaces the body of `useWorkspaceMembers`; its callers do not change.
 */

import { useMemo } from 'react'
import { userActor } from '@otto/shared/actors'
import { AGENT_DEFAULT_NAME } from '@otto/shared/branding'
import { isAgentActor } from '@/lib/actors'
import { useCurrentUser, type CurrentUser } from './use-current-user'

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
  /** The signed-in person's actor; null without a session. */
  me: string | null
}

export const DEFAULT_AGENT_ACTOR = 'agent:default'

export function buildWorkspaceMembers(user: CurrentUser | null): WorkspaceMembers {
  const me = user?.id ? userActor(user.id) : null
  const members: WorkspaceMember[] = []
  if (me && user) members.push({ actor: me, name: user.name || user.email, email: user.email || undefined })
  members.push({ actor: DEFAULT_AGENT_ACTOR, name: AGENT_DEFAULT_NAME })
  const nameOf = (actor: string) =>
    members.find((member) => member.actor === actor)?.name ?? (isAgentActor(actor) ? AGENT_DEFAULT_NAME : actor.slice(actor.indexOf(':') + 1))
  return { members, nameOf, me }
}

export function useWorkspaceMembers(): WorkspaceMembers {
  const user = useCurrentUser()
  return useMemo(() => buildWorkspaceMembers(user), [user])
}
