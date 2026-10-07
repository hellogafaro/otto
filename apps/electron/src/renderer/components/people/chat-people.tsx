/**
 * `ChatPeople`: the avatar group of a chat's participants, the agent it talks to first, then the other people who took
 * part (its `participants`, `user:<id>`). The viewer is never in it; with nobody else it is the agent's avatar alone.
 * At most three avatars, then "+N"; one tooltip names them all, like `TaskPeople`.
 */

import { Fragment } from 'react'
import { AvatarGroup, AvatarGroupCount } from '@workspace/ui/components/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { collapseGroup, otherParticipants } from '@/lib/actors'
import { agentOf, useLoadedAgents } from '@/hooks/use-agents'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { SessionMeta } from '@/atoms/sessions'
import { ActorAvatar } from './actor-avatar'
import { AgentAvatar } from './agent-avatar'

export function ChatPeople({ chat, tooltip = true }: { chat: Pick<SessionMeta, 'agentId' | 'participants'>; tooltip?: boolean }) {
  const agent = agentOf(useLoadedAgents(), chat.agentId)
  const { nameOf, me } = useWorkspaceMembers()
  const entries = [
    ...(agent ? [{ key: `agent:${agent.id}`, name: agent.title, avatar: <AgentAvatar agent={agent} size="sm" /> }] : []),
    ...otherParticipants(chat.participants, me).map((actor) => ({ key: actor, name: nameOf(actor), avatar: <ActorAvatar actor={actor} name={nameOf(actor)} /> })),
  ]
  if (entries.length === 0) return null
  const { shown, more } = collapseGroup(entries)
  const names = entries.map((entry) => entry.name).join(', ')
  const group = (
    <AvatarGroup aria-label={names}>
      {shown.map((entry) => <Fragment key={entry.key}>{entry.avatar}</Fragment>)}
      {more > 0 && <AvatarGroupCount>+{more}</AvatarGroupCount>}
    </AvatarGroup>
  )
  if (!tooltip) return group
  return (
    <Tooltip>
      <TooltipTrigger render={group} />
      <TooltipContent side="bottom">{names}</TooltipContent>
    </Tooltip>
  )
}
