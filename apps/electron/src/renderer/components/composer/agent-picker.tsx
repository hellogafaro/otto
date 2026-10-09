/**
 * AgentPicker - the new chat's "With" picker (the full composer's `tools`, DESIGN.md, Composer, With): a 28px chip
 * with who the chat is with (the agent's avatar and title, or the picked person's), opening two groups: the
 * workspace's agents (the protected default first), then its people (when the chat allows choosing them).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@otto/ui'
import { ToolbarChip } from '@/components/ui/toolbar-chip'
import { DropdownMenu, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { AgentAvatar } from '@/components/people/agent-avatar'
import type { WorkspaceMember } from '@/hooks/use-workspace-members'
import type { Agent } from '../../../shared/types'

const AVATAR = 'size-4 data-[size=sm]:size-4'

export function AgentPicker({ agents, agent, people = [], person = null, onChange, onPickPerson, disabled, size = 'default' }: {
  agents: Agent[]
  agent?: Agent
  /** The workspace's people other than the viewer. */
  people?: WorkspaceMember[]
  /** The picked person ('user:<id>'), else the chat is with `agent`. */
  person?: string | null
  onChange: (agent: Agent) => void
  onPickPerson?: (actor: string) => void
  disabled?: boolean
  size?: 'default' | 'compact'
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const picked = person ? people.find((entry) => entry.actor === person) : undefined
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarChip size={size} type="button" open={open} disabled={disabled} aria-label={t('composer.agent.label')} className="input-toolbar-btn max-w-40 text-foreground">
              {picked
                ? <ActorAvatar actor={picked.actor} name={picked.name} className={AVATAR} />
                : agent && <AgentAvatar agent={agent} size="sm" className={AVATAR} />}
              <span className="truncate">{picked ? picked.name : agent?.title ?? t('composer.agent.label')}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            </ToolbarChip>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('composer.agent.label')}</TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-[200px] max-w-xs">
        <DropdownMenuLabel>{t('composer.mention.agents')}</DropdownMenuLabel>
        {[...agents.filter((entry) => entry.isDefault), ...agents.filter((entry) => !entry.isDefault)].map((entry) => (
          <StyledDropdownMenuItem key={entry.id} onSelect={() => onChange(entry)} className="justify-between">
            <span className="flex min-w-0 items-center gap-2">
              <AgentAvatar agent={entry} size="sm" className={AVATAR} />
              <span className="truncate">{entry.title}</span>
            </span>
            {!picked && entry.id === agent?.id && <Check className="shrink-0" />}
          </StyledDropdownMenuItem>
        ))}
        {people.length > 0 && onPickPerson && (
          <>
            <StyledDropdownMenuSeparator />
            <DropdownMenuLabel>{t('composer.mention.people')}</DropdownMenuLabel>
            {people.map((entry) => (
              <StyledDropdownMenuItem key={entry.actor} onSelect={() => onPickPerson(entry.actor)} className="justify-between">
                <span className="flex min-w-0 items-center gap-2">
                  <ActorAvatar actor={entry.actor} name={entry.name} className={AVATAR} />
                  <span className="truncate">{entry.name}</span>
                </span>
                {entry.actor === picked?.actor && <Check className="shrink-0" />}
              </StyledDropdownMenuItem>
            ))}
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
