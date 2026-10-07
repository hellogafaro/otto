/**
 * AgentPicker - the new chat's "With" picker (the full composer's `tools`, DESIGN.md, Composer, With): a 28px chip
 * with the agent's avatar and title, opening the workspace's agents (the default first). Only an empty chat has it;
 * once a message is sent the chat shows its agent in the header.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@otto/ui'
import { ToolbarChip } from '@/components/ui/toolbar-chip'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { AgentAvatar } from '@/components/people/agent-avatar'
import type { Agent } from '../../../shared/types'

export function AgentPicker({ agents, agent, onChange }: { agents: Agent[]; agent: Agent; onChange: (agent: Agent) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarChip type="button" open={open} aria-label={t('composer.agent.label')} className="input-toolbar-btn max-w-40 text-foreground">
              <AgentAvatar agent={agent} size="sm" className="size-4 data-[size=sm]:size-4" />
              <span className="truncate">{agent.title}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            </ToolbarChip>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('composer.agent.label')}</TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-[200px] max-w-xs">
        {agents.map((entry) => (
          <StyledDropdownMenuItem key={entry.id} onSelect={() => onChange(entry)} className="justify-between">
            <span className="flex min-w-0 items-center gap-2">
              <AgentAvatar agent={entry} size="sm" className="size-4 data-[size=sm]:size-4" />
              <span className="truncate">{entry.title}</span>
            </span>
            {entry.id === agent.id && <Check className="shrink-0" />}
          </StyledDropdownMenuItem>
        ))}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
