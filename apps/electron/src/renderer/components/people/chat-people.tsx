/**
 * `ChatPeople`: the avatar group of a chat's members other than the viewer, the agents first (`AgentAvatar`), then the
 * people (`ActorAvatar`), from its `members` (`useChatMembers`). The viewer is never in it; a chat without `members`
 * shows its primary agent alone. At most three avatars, then "+N"; one tooltip names them all, like `TaskPeople`.
 */

import { AvatarGroup, AvatarGroupCount } from '@workspace/ui/components/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { collapseGroup } from '@/lib/actors'
import { useChatMembers, type ChatMember } from '@/hooks/use-chat-members'
import type { SessionMeta } from '@/atoms/sessions'
import { ActorAvatar } from './actor-avatar'
import { AgentAvatar } from './agent-avatar'

/** A member's 20px avatar: an agent's picture, else the person's initials. */
export function MemberAvatar({ member, className }: { member: ChatMember; className?: string }) {
  return member.agent
    ? <AgentAvatar agent={member.agent} size="sm" className={className} />
    : <ActorAvatar actor={member.actor} name={member.name} className={className} />
}

export function ChatPeople({ chat, tooltip = true }: { chat: Pick<SessionMeta, 'agentId' | 'members'>; tooltip?: boolean }) {
  const { others } = useChatMembers(chat)
  if (others.length === 0) return null
  const { shown, more } = collapseGroup(others)
  const names = others.map((member) => member.name).join(', ')
  const group = (
    <AvatarGroup aria-label={names}>
      {shown.map((member) => <MemberAvatar key={member.actor} member={member} />)}
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
