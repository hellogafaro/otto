import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { AvatarGroup, AvatarGroupCount } from '@workspace/ui/components/avatar'
import { Button } from '@workspace/ui/components/button'
import { ComposerFooter as ComposerFooterLayout } from '@workspace/ui/components/composer-footer'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { MemberAvatar } from '@/components/people/chat-people'
import type { ChatMember } from '@/hooks/use-chat-members'
import { collapseGroup } from '@/lib/actors'
import { AgentPicker } from './agent-picker'

export interface ComposerFooterProps {
  picker: ComponentProps<typeof AgentPicker> | null
  participants: readonly ChatMember[] | null
  disabled?: boolean
}

export function ComposerFooter({ picker, participants, disabled = false }: ComposerFooterProps) {
  const { t } = useTranslation()
  if (!picker && !participants?.length) return null
  const { shown, more } = collapseGroup(participants ?? [])
  const names = participants?.map((member) => member.name).join(', ')
  const label = t('composer.mention.members')
  return (
    <ComposerFooterLayout
      picker={picker ? <AgentPicker key={disabled || picker.disabled ? 'disabled' : 'enabled'} {...picker} size="compact" disabled={disabled || picker.disabled} /> : null}
      participants={participants?.length ? (
        <Popover key={disabled ? 'disabled' : 'enabled'}>
          <Tooltip>
            <TooltipTrigger render={
              <PopoverTrigger render={
                <Button type="button" variant="ghost" size="compact" disabled={disabled} aria-label={`${label}: ${names}`} />
              } />
            }>
              <AvatarGroup aria-hidden>
                {shown.map((member) => <MemberAvatar key={member.actor} member={member} />)}
                {more > 0 && <AvatarGroupCount>+{more}</AvatarGroupCount>}
              </AvatarGroup>
            </TooltipTrigger>
            <TooltipContent side="top">{names}</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="end">
            <PopoverHeader><PopoverTitle>{label}</PopoverTitle></PopoverHeader>
            <ul aria-label={label} className="max-h-60 overflow-y-auto">
              {participants.map((member) => (
                <li key={member.actor} className="flex items-center gap-2 px-2 py-1.5">
                  <MemberAvatar member={member} />
                  <span className="min-w-0 break-words">{member.name}</span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    />
  )
}
