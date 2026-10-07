/**
 * A project's Overview tab, a blocks layout: the description in its card (the markdown editor, autosaved with the
 * title by the page), then Links (web links, library items and chats: `ResourceList`; "+" prefills the composer, remove
 * applies at once), Members, then the Activity (comments).
 */

import { useTranslation } from 'react-i18next'
import { PageCard, PageSection } from '@workspace/ui/components/page'
import { TiptapMarkdownEditor } from '@otto/ui'
import { ActivityFeed } from '@/components/comments/activity-feed'
import { NewLink, ResourceList } from '@/components/resources/resource-list'
import type { Resource } from '../../../shared/types'
import { ProjectMembers } from './project-members'

export function ProjectOverview({ projectId, members, onAddMember, onRemoveMember, description, onDescription, onBlur, resources, onResources }: {
  projectId: string
  members: string[]
  onAddMember: (actor: string) => Promise<{ ok: boolean }>
  onRemoveMember: (actor: string) => Promise<{ ok: boolean }>
  description: string
  onDescription: (markdown: string) => void
  /** Save the description now (it left the editor). */
  onBlur: () => void
  resources: Resource[]
  onResources: (next: Resource[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-10">
      <PageCard className="px-4 py-3" onBlur={onBlur}>
        <TiptapMarkdownEditor content={description} onUpdate={onDescription} placeholder={t('projects.descriptionPlaceholder')} />
      </PageCard>
      <PageSection title={t('resources.title')} action={<NewLink entity={`project:${projectId}`} resources={resources} />}>
        {resources.length > 0 && (
          <PageCard>
            <div className="flex flex-col gap-0.5 p-1">
              <ResourceList resources={resources} onChange={onResources} />
            </div>
          </PageCard>
        )}
      </PageSection>
      <ProjectMembers members={members} onAdd={onAddMember} onRemove={onRemoveMember} />
      <ActivityFeed entity={`project:${projectId}`} />
    </div>
  )
}
