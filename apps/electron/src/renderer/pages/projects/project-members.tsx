/**
 * The Overview's Members section: one row per member (avatar, name, the role as an outline Badge, a ⋯ menu to
 * change the role or remove them) and "Add member", a searchable list of the workspace's people and agents not
 * in the project yet (added as Contributor). Roles are data only: everyone can change everything. Each change
 * applies at once with the "Saved" toast; the list reloads after it and when the server says projects changed.
 */

import * as React from 'react'
import { Ellipsis, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
} from '@workspace/ui/components/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { PageCard, PageSection } from '@workspace/ui/components/page'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { toast } from '@workspace/ui/components/sonner'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { SettingsRow } from '@/components/settings'
import { useAppShellContext } from '@/context/app-shell-context'
import { useLiveData } from '@/hooks/use-live-data'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { MemberRole, ProjectMember } from '../../../shared/types'
import { getMemberCandidates } from './project-items'

const ROLES: MemberRole[] = ['contributor', 'viewer']

/** "Add member": a 28px ghost button opening the searchable list of people and agents not in the project. */
function AddMember({ members, onAdd }: { members: ProjectMember[]; onAdd: (actor: string) => void }) {
  const { t } = useTranslation()
  const { members: people, nameOf } = useWorkspaceMembers()
  const candidates = getMemberCandidates(people, members).map((person) => person.actor)
  return (
    <Combobox items={candidates} value={null} itemToStringLabel={nameOf} onValueChange={(actor) => actor && onAdd(actor as string)}>
      <ComboboxTrigger render={<Button variant="ghost" size="compact"><Plus />{t('projects.addMember')}</Button>} />
      <ComboboxContent align="end" className="w-60">
        <ComboboxSearch placeholder={t('projects.search')} />
        <ComboboxEmpty>{t(candidates.length > 0 ? 'projects.noMatches' : 'projects.everyoneAdded')}</ComboboxEmpty>
        <ComboboxList>
          {(actor: string) => (
            <ComboboxItem key={actor} value={actor}>
              <ActorAvatar actor={actor} name={nameOf(actor)} />
              <span className="truncate">{nameOf(actor)}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function ProjectMembers({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { nameOf } = useWorkspaceMembers()
  const [members, setMembers] = React.useState<ProjectMember[] | null>(null)

  const load = React.useCallback(async () => {
    try {
      setMembers(await window.electronAPI.getProjectMembers(projectId))
    } catch {
      setMembers((current) => current ?? [])
    }
  }, [projectId])
  React.useEffect(() => { void load() }, [load])
  const mutate = useLiveData('projects', activeWorkspaceId, load)

  const run = async (call: () => Promise<unknown>) => {
    const result = await mutate(call)
    if (result.ok) toast.success(t('common.saved'), { id: 'saved' })
    else toast.error(t('projects.saveFailed'), { id: 'saved' })
  }
  const setRole = (actor: string, role: MemberRole) => run(() => window.electronAPI.setProjectMember(projectId, actor, role))
  const remove = (actor: string) => run(() => window.electronAPI.removeProjectMember(projectId, actor))

  return (
    <PageSection
      title={t('projects.members')}
      action={members && <AddMember members={members} onAdd={(actor) => void setRole(actor, 'contributor')} />}
    >
      {!members ? (
        <div className="space-y-2" aria-busy>
          {[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <PageCard>
          {members.length === 0 ? (
            <SettingsRow label={<span className="font-normal text-muted-foreground">{t('projects.noMembers')}</span>} />
          ) : members.map((member) => (
            <SettingsRow
              list
              key={member.actor}
              icon={<ActorAvatar actor={member.actor} name={nameOf(member.actor)} />}
              label={<span className="block truncate">{nameOf(member.actor)}</span>}
            >
              <Badge variant="outline">{t(`projects.role_${member.role}`)}</Badge>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('projects.role')}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={member.role} onValueChange={(role) => void setRole(member.actor, role as MemberRole)}>
                      {ROLES.map((role) => (
                        <DropdownMenuRadioItem key={role} value={role} closeOnClick>{t(`projects.role_${role}`)}</DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void remove(member.actor)}>{t('common.remove')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsRow>
          ))}
        </PageCard>
      )}
    </PageSection>
  )
}
