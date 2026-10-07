/**
 * A project's Details (the sidecar, closed by default): Properties (Status, Active or Archived from a menu,
 * applied at once with the "Saved" toast; Created) and Chats, the chats bound to the project (session metadata
 * `projectId`), newest first; a row opens the chat. Live: it reads the project and the chats itself.
 */

import { useAtomValue } from 'jotai'
import { Archive, Calendar, Folder, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { toast } from '@workspace/ui/components/sonner'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useNavigation } from '@/contexts/navigation-context'
import { useProjects } from '@/hooks/use-projects'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { getSessionTitle } from '@/utils/session'
import type { ProjectStatus } from '../../../shared/types'

const STATUSES = [
  { status: 'active', icon: Folder },
  { status: 'archived', icon: Archive },
] as const

/** Archive or restore a project at once, with the one "Saved" toast (More actions and the Status row). */
export function useSetProjectStatus() {
  const { t } = useTranslation()
  const { setProjectStatus } = useProjects()
  return async (projectId: string, status: ProjectStatus) => {
    const result = await setProjectStatus(projectId, status)
    if (result.ok) toast.success(t('common.saved'), { id: 'saved' })
    else toast.error(t('projects.saveFailed'), { id: 'saved' })
  }
}

export function ProjectDetails({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation()
  const { navigateToSession } = useNavigation()
  const { projects } = useProjects()
  const setStatus = useSetProjectStatus()
  const metas = useAtomValue(sessionMetaMapAtom)
  const people = useWorkspaceMembers()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null

  const chats = Array.from(metas.values())
    .filter((meta) => meta.projectId === projectId)
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
  const current = STATUSES.find((s) => s.status === project.status) ?? STATUSES[0]

  return (
    <>
      <PropertySection title={t('projects.properties')}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<PropertyRow icon={<current.icon />} label={t('projects.status')} value={t(`projects.status_${current.status}`)} />}
          />
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuRadioGroup value={project.status} onValueChange={(status) => void setStatus(project.id, status as ProjectStatus)}>
              {STATUSES.map(({ status, icon: Icon }) => (
                <DropdownMenuRadioItem key={status} value={status} closeOnClick>
                  <Icon />
                  {t(`projects.status_${status}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <PropertyRow
          readOnly
          icon={<Calendar />}
          label={t('projects.created')}
          value={new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(project.createdAt)}
        />
      </PropertySection>
      <PropertySection title={t('projects.chats')} count={chats.length}>
        {chats.map((meta) => (
          <PropertyRow key={meta.id} icon={<MessageSquare />} value={getSessionTitle(meta, people)} onClick={() => navigateToSession(meta.id)} />
        ))}
      </PropertySection>
    </>
  )
}
