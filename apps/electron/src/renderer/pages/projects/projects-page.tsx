/**
 * ProjectsPage - the Projects index: a gallery of project tiles (3 columns, 16:9, the title under
 * the tile) straight on the frame, no card, no toolbar.
 *
 * The header carries Filter (one on/off field, Archived: `?status=archived` lists the archived
 * projects instead of the active ones, their titles muted), Search (the palette on Projects) and "+" (New project, a dialog). A tile
 * opens its project; its right-click menu (a long press on touch) is Open, Copy link, then
 * Archive or Restore (applies at once, one "Saved" toast). States: loading (skeleton tiles), no
 * projects at all (the section's empty state, whose button opens the same dialog), filtered with
 * nothing left (`NoResults`), and only archived projects (the empty state under the header, so
 * Filter stays reachable).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Archive, ArchiveRestore, Folder, Link, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@workspace/ui/components/context-menu'
import { FilterBar, FilterMenu, NoResults, type FilterField, type FilterValues } from '@workspace/ui/components/filters'
import { Gallery, GalleryItem, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PageColumn } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
import { routes } from '@/lib/navigate'
import { PageHeader } from '@/components/app-shell/page-header'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { CreateButton } from '@/components/ui/create-button'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { isProjectsNavigation, useNavigation } from '@/contexts/navigation-context'
import { useProjects } from '@/hooks/use-projects'
import { routeStringToLocation, workspaceSlugFromPathname } from '@/router/location'
import type { Project } from '../../../shared/types'
import { ProjectFormDialog } from './project-form-dialog'

/** A project's address in this workspace, absolute (the desktop app's is its own `otto://app` origin). */
export function projectUrl(projectId: string): string | null {
  const slug = workspaceSlugFromPathname(window.location.pathname)
  const location = slug ? routeStringToLocation(routes.view.projects({ projectId }), slug) : null
  return location ? `${window.location.origin}${location.pathname}` : null
}

interface TileActions {
  onOpen: (project: Project) => void
  onCopyLink: (project: Project) => void
  onToggleArchive: (project: Project) => void
}

/** The tile's menu list. */
function ProjectMenuItems({ project, actions }: { project: Project; actions: TileActions }) {
  const { t } = useTranslation()
  const archived = project.status === 'archived'
  return (
    <>
      <ContextMenuItem onClick={() => actions.onOpen(project)}><SquareArrowOutUpRight />{t('common.open')}</ContextMenuItem>
      <ContextMenuItem shortcut="C" onClick={() => actions.onCopyLink(project)}><Link />{t('projects.copyLink')}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem shortcut="A" onClick={() => actions.onToggleArchive(project)}>
        {archived ? <ArchiveRestore /> : <Archive />}
        {archived ? t('projects.restore') : t('projects.archive')}
      </ContextMenuItem>
    </>
  )
}

function ProjectTile({ project, actions }: { project: Project; actions: TileActions }) {
  return (
    <GalleryItem
      ratio="16:9"
      media={<Folder />}
      icon={<Folder />}
      title={project.title}
      muted={project.status === 'archived'}
      onClick={() => actions.onOpen(project)}
      menu={
        <ContextMenuContent>
          <ProjectMenuItems project={project} actions={actions} />
        </ContextMenuContent>
      }
    />
  )
}

export function ProjectsPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:projects' })
  const { navigate, navigationState } = useNavigation()
  const { projects, loaded, setProjectStatus } = useProjects()
  const [creating, setCreating] = React.useState(false)

  const archivedOnly = isProjectsNavigation(navigationState) && navigationState.search.status === 'archived'
  const archivedCount = projects.filter((p) => p.status === 'archived').length
  const shown = projects.filter((p) => (p.status === 'archived') === archivedOnly)

  const setArchivedOnly = (on: boolean) => navigate(routes.view.projects(on ? { status: 'archived' } : {}))
  const fields: FilterField[] = [{ key: 'archived', label: t('sidebar.archived'), icon: <Archive />, count: archivedCount }]
  const values: FilterValues = { archived: archivedOnly ? ['true'] : [] }
  const changeFilter = (_key: string, next: string[]) => setArchivedOnly(next.length > 0)

  const actions: TileActions = {
    onOpen: (project) => navigate(routes.view.projects({ projectId: project.id })),
    onCopyLink: async (project) => {
      const url = projectUrl(project.id)
      if (!url) return
      await navigator.clipboard.writeText(url)
      toast.success(t('toast.linkCopied'))
    },
    onToggleArchive: async (project) => {
      const result = await setProjectStatus(project.id, project.status === 'archived' ? 'active' : 'archived')
      if (result.ok) toast.success(t('common.saved'), { id: 'saved' })
      else toast.error(t('projects.saveFailed'), { id: 'saved' })
    },
  }

  const newProject = <CreateButton label={t('projects.newProject')} onClick={() => setCreating(true)} />
  const dialog = <ProjectFormDialog open={creating} onOpenChange={setCreating} />
  const emptyState = (
    <EntityListEmptyScreen
      icon={<Folder />}
      title={t('sectionEmpty.projectsTitle')}
      description={t('sectionEmpty.projectsDescription')}
    >
      <Button onClick={() => setCreating(true)}>{t('sectionEmpty.newProject')}</Button>
    </EntityListEmptyScreen>
  )

  // No projects at all: only the empty state; its button opens the New project dialog.
  if (loaded && projects.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        {emptyState}
        {dialog}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('sidebar.projects')}
        actions={<><FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('projects.filterLabel')} /><CommandPaletteButton category="projects" />{newProject}</>}
      />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-1 flex-col gap-3">
          <FilterBar
            fields={fields}
            values={values}
            onChange={changeFilter}
            isLabel={t('chatsIndex.is')}
            isAnyOfLabel={t('chatsIndex.isAnyOf')}
            removeLabel={(field) => `${t('common.remove')} ${field}`}
          />
          {!loaded ? (
            <Gallery columns={3} aria-busy>
              {[0, 1, 2].map((i) => <GalleryItemSkeleton key={i} ratio="16:9" />)}
            </Gallery>
          ) : shown.length === 0 ? (
            archivedOnly ? (
              <NoResults title={t('chatsIndex.noResults')} description={t('chatsIndex.noResultsDescription')}>
                <Button variant="outline" onClick={() => setArchivedOnly(false)}>{t('chatsIndex.clearFilters')}</Button>
              </NoResults>
            ) : emptyState
          ) : (
            <Gallery columns={3}>
              {shown.map((project) => <ProjectTile key={project.id} project={project} actions={actions} />)}
            </Gallery>
          )}
        </div>
      </PageColumn>
      {dialog}
    </div>
  )
}
