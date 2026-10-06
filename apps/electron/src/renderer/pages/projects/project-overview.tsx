/**
 * A project's Overview tab, a blocks layout: the description in its card (the markdown editor, autosaved with the
 * title by the page), then Links (web links, library items and chats: `ResourceList`, add and remove applied at
 * once), Members, then the comments.
 */

import { useTranslation } from 'react-i18next'
import { PageCard, PageSection } from '@workspace/ui/components/page'
import { TiptapMarkdownEditor } from '@otto/ui'
import { CommentThread } from '@/components/comments/comment-thread'
import { ResourceList } from '@/components/resources/resource-list'
import type { Resource } from '../../../shared/types'
import { ProjectMembers } from './project-members'

export function ProjectOverview({ projectId, description, onDescription, onBlur, resources, onResources }: {
  projectId: string
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
      <PageSection title={t('resources.title')}>
        <PageCard>
          <div className="flex flex-col gap-0.5 p-1">
            <ResourceList resources={resources} onChange={onResources} />
          </div>
        </PageCard>
      </PageSection>
      <ProjectMembers projectId={projectId} />
      <CommentThread entity={`project:${projectId}`} />
    </div>
  )
}
