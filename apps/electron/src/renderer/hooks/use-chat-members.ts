/**
 * A chat's members for the people UI: each actor with its name (an agent's title from the workspace's agents, a
 * person's from the workspace's members) and its agent row. `others` leaves the viewer out, agents first
 * (`otherMembers`); `creator` is the first member. A chat without `members` is its primary agent alone.
 */

import { useMemo } from 'react'
import { isAgentActor, otherMembers } from '@/lib/actors'
import type { SessionMeta } from '@/atoms/sessions'
import type { Agent } from '../../shared/types'
import { useLoadedAgents } from './use-agents'
import { useWorkspaceMembers } from './use-workspace-members'

export interface ChatMember {
  actor: string
  name: string
  /** The agent's row, for an agent of the workspace. */
  agent?: Agent
}

export function useChatMembers(chat: Pick<SessionMeta, 'agentId' | 'members'> | null | undefined) {
  const agents = useLoadedAgents()
  const { nameOf, me } = useWorkspaceMembers()
  const members = chat?.members
  const agentId = chat?.agentId
  return useMemo(() => {
    const actors = members ?? (agentId ? [`agent:${agentId}`] : [])
    const toMember = (actor: string): ChatMember => {
      const agent = isAgentActor(actor) ? agents.find((entry) => `agent:${entry.id}` === actor) : undefined
      return { actor, name: agent?.title ?? nameOf(actor), agent }
    }
    return { me, creator: members?.[0] ?? null, members: actors.map(toMember), others: otherMembers(actors, me).map(toMember) }
  }, [members, agentId, agents, nameOf, me])
}
