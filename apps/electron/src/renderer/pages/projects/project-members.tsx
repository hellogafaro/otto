/**
 * The Overview's Members section: one row per member (avatar, name, a remove button) and "Add member", a
 * searchable list of the workspace's people and agents not in the project yet. Everyone can change everything.
 * Each change applies at once with the "Saved" toast; the project list reloads after it.
 */

import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { PageCard, PageSection } from '@workspace/ui/components/page'
import { Picker } from '@workspace/ui/components/picker'
import { toast } from '@workspace/ui/components/sonner'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { CreateButton } from '@/components/ui/create-button'
import { SettingsRow } from '@/components/settings'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { getMemberCandidates } from './project-items'

/** "Add member": a 28px ghost button opening the searchable list of people and agents not in the project. */
function AddMember({ members, onAdd }: { members: string[]; onAdd: (actor: string) => void }) {
  const { t } = useTranslation()
  const { members: people, nameOf } = useWorkspaceMembers()
  const candidates = getMemberCandidates(people, members).map((person) => person.actor)
  return (
    <Picker
      items={candidates}
      value={null}
      onValueChange={onAdd}
      itemLabel={nameOf}
      itemIcon={(actor) => <ActorAvatar actor={actor} name={nameOf(actor)} />}
      trigger={<CreateButton label={t('projects.addMember')} />}
      search={t('pickers.searchPeople')}
      empty={t(candidates.length > 0 ? 'pickers.noPeople' : 'projects.everyoneAdded')}
      align="end"
    />
  )
}

export function ProjectMembers({ members, onAdd, onRemove }: {
  members: string[]
  onAdd: (actor: string) => Promise<{ ok: boolean }>
  onRemove: (actor: string) => Promise<{ ok: boolean }>
}) {
  const { t } = useTranslation()
  const { nameOf } = useWorkspaceMembers()

  const run = async (call: Promise<{ ok: boolean }>) => {
    if ((await call).ok) toast.success(t('common.saved'), { id: 'saved' })
    else toast.error(t('projects.saveFailed'), { id: 'saved' })
  }

  return (
    <PageSection title={t('projects.members')} action={<AddMember members={members} onAdd={(actor) => void run(onAdd(actor))} />}>
      <PageCard>
        {members.length === 0 ? (
          <SettingsRow label={<span className="font-normal text-muted-foreground">{t('projects.noMembers')}</span>} />
        ) : members.map((actor) => (
          <SettingsRow
            list
            key={actor}
            icon={<ActorAvatar actor={actor} name={nameOf(actor)} />}
            label={<span className="block truncate">{nameOf(actor)}</span>}
          >
            <Button variant="ghost" size="icon-compact" aria-label={t('common.remove')} onClick={() => void run(onRemove(actor))}>
              <X />
            </Button>
          </SettingsRow>
        ))}
      </PageCard>
    </PageSection>
  )
}
