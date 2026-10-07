/**
 * `ChatMembersDialog`: who is in a chat (the header menu's Members). Each member is a row (avatar, name, a muted
 * "You" or "Agent"); its creator removes anyone but themselves and adds workspace people and agents not yet in, anyone
 * else can leave. The server pushes the changed chat back (`session_created`), so the list follows on its own.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, LogOut, UserPlus, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Picker } from '@workspace/ui/components/picker'
import { toast } from '@workspace/ui/components/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useChatMembers, type ChatMember } from '@/hooks/use-chat-members'
import { useLoadedAgents } from '@/hooks/use-agents'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionCommand } from '../../../shared/types'
import { MemberAvatar } from './chat-people'

/** Who can be added, in the shared searchable `Picker`, opened from an outline button. */
function AddPicker({ label, icon, search, empty, items, onPick }: {
  label: string
  icon: React.ReactNode
  search: string
  empty: string
  items: ChatMember[]
  onPick: (member: ChatMember) => void
}) {
  const byActor = new Map(items.map((member) => [member.actor, member]))
  return (
    <Picker
      items={items.map((member) => member.actor)}
      value={null}
      onValueChange={(actor) => { const member = byActor.get(actor); if (member) onPick(member) }}
      itemLabel={(actor) => byActor.get(actor)?.name ?? actor}
      itemIcon={(actor) => { const member = byActor.get(actor); return member ? <MemberAvatar member={member} /> : null }}
      trigger={<Button variant="outline" size="compact">{icon}{label}</Button>}
      disabled={items.length === 0}
      search={search}
      empty={empty}
    />
  )
}

export function ChatMembersDialog({ chat, open, onOpenChange, onLeft }: {
  chat: Pick<SessionMeta, 'id' | 'agentId' | 'members'>
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After the viewer has left: the chat is no longer theirs. */
  onLeft: () => void
}) {
  const { t } = useTranslation()
  const { members, me, creator } = useChatMembers(chat)
  const workspace = useWorkspaceMembers()
  const agents = useLoadedAgents()
  const isCreator = !!me && me === creator
  const inChat = new Set(members.map((member) => member.actor))
  const people = workspace.members
    .filter((member) => member.actor.startsWith('user:') && member.actor !== me && !inChat.has(member.actor))
    .map((member) => ({ actor: member.actor, name: member.name }))
  const addableAgents = agents.filter((agent) => !inChat.has(`agent:${agent.id}`)).map((agent) => ({ actor: `agent:${agent.id}`, name: agent.title, agent }))

  const run = async (command: Extract<SessionCommand, { type: 'addMembers' | 'removeMember' | 'leave' }>, done: string) => {
    try {
      await window.electronAPI.sessionCommand(chat.id, command)
      toast.success(done)
      return true
    } catch {
      toast.error(t('members.error'))
      return false
    }
  }
  const leave = async () => {
    if (!(await run({ type: 'leave' }, t('chatMembers.left')))) return
    onOpenChange(false)
    onLeft()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chatMembers.title')}</DialogTitle>
        </DialogHeader>
        <div className="no-scrollbar scroll-fade-y -mx-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {members.map((member) => (
            <div key={member.actor} className="flex h-8 items-center gap-2 px-2 text-sm">
              <MemberAvatar member={member} />
              <span className="min-w-0 truncate">{member.name}</span>
              {member.actor === me && <span className="shrink-0 text-muted-foreground">{t('members.you')}</span>}
              {member.actor.startsWith('agent:') && <span className="shrink-0 text-muted-foreground">{t('chatMembers.agent')}</span>}
              {isCreator && member.actor !== me && member.actor !== `agent:${chat.agentId}` && (
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={t('chatMembers.remove', { name: member.name })} />}
                    onClick={() => void run({ type: 'removeMember', actor: member.actor }, t('members.removed', { name: member.name }))}
                  >
                    <X />
                  </TooltipTrigger>
                  <TooltipContent>{t('chatMembers.remove', { name: member.name })}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
        {(isCreator || (me && inChat.has(me))) && (
          <DialogFooter>
            {isCreator ? (
              <>
                <AddPicker label={t('chatMembers.addPeople')} icon={<UserPlus />} search={t('pickers.searchPeople')} empty={t('pickers.noPeople')} items={people} onPick={(member) => void run({ type: 'addMembers', actors: [member.actor] }, t('chatMembers.added', { name: member.name }))} />
                <AddPicker label={t('chatMembers.addAgent')} icon={<Bot />} search={t('pickers.searchAgents')} empty={t('pickers.noAgents')} items={addableAgents} onPick={(member) => void run({ type: 'addMembers', actors: [member.actor] }, t('chatMembers.added', { name: member.name }))} />
              </>
            ) : (
              <Button variant="destructive" size="compact" onClick={() => void leave()}>
                <LogOut />
                {t('chatMembers.leave')}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
