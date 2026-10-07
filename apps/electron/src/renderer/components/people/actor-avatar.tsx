/** `ActorAvatar`: a person's colored initials, or an agent's own avatar (the bot glyph for an unknown one), from an actor string (`user:<id>`, `agent:<id>`). */

import { Bot } from 'lucide-react'
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar'
import { cn } from '@/lib/utils'
import { actorColorIndex, initialsOf, isAgentActor } from '@/lib/actors'
import { useLoadedAgents } from '@/hooks/use-agents'
import { AgentAvatar } from './agent-avatar'

// The status tokens' hues, softened to a tint: initials stay in the foreground color for contrast in both themes.
export const TINTS = ['bg-status-doing/20', 'bg-status-review/25', 'bg-status-done/20', 'bg-status-todo/20']

export function ActorAvatar({
  actor,
  name = '',
  size = 'sm',
  className,
}: {
  actor: string
  /** The person's name (`useWorkspaceMembers().nameOf(actor)`); its initials are shown. */
  name?: string
  size?: 'default' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const agents = useLoadedAgents()
  const agent = isAgentActor(actor) ? agents.find((candidate) => `agent:${candidate.id}` === actor) : undefined
  if (agent) return <AgentAvatar agent={agent} size={size} className={className} />
  // Without a name the id's first letter: never a person outline
  const initials = initialsOf(name) || initialsOf(actor.slice(actor.indexOf(':') + 1))
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback className={cn('font-medium text-foreground', TINTS[actorColorIndex(actor, TINTS.length)])}>
        {isAgentActor(actor) ? <Bot /> : initials}
      </AvatarFallback>
    </Avatar>
  )
}
