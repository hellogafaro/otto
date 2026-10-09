/**
 * ProjectPage - one project (`/{ws}/projects/{id}?tab=`), a blocks page. The title row's title is the project's
 * title, edited in place; the floating Details toggle (the sidecar: Status, Created, Chats); More (Copy link, Archive /
 * Restore). Under it 32px tabs with their counts, in the URL: Overview (description, Links, Members), Tasks (the
 * grouped task list of this project, "New task"), Documents and Files (the project's library links as a gallery,
 * "Add from library"). Title and description autosave as one draft (no Save button: 800 ms after the last
 * change, on blur and on leaving, one "Saved" toast; `conflict` reloads); links apply at once.
 * A project id the workspace does not have shows the not-found page once the list and the server agree.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { AlignLeft, Archive, ArchiveRestore, CircleCheck, File, FileText, Link } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Count } from '@workspace/ui/components/count'
import { DropdownMenuItem, DropdownMenuSeparator } from '@workspace/ui/components/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { PageColumn } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { PageHeader } from '@/components/app-shell/page-header'
import { CreateButton } from '@/components/ui/create-button'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { SidecarDetails } from '@/context/sidecar-context'
import { isProjectsNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useAutosave } from '@/hooks/use-autosave'
import { useLibrary } from '@/hooks/use-library'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { routes } from '@/lib/navigate'
import { PROJECT_TABS, type ProjectTab } from '../../../shared/section-search'
import type { Project, ProjectUpdate, Resource } from '../../../shared/types'
import { dispatchPrefillInputEvent } from '@/components/app-shell/input/focus-input-events'
import { TaskGroups } from '../tasks/task-list'
import { useTaskSave } from '../tasks/use-task-save'
import { ProjectDetails, useSetProjectStatus } from './project-details'
import { getProjectTabCounts } from './project-items'
import { AddFromLibrary, ProjectLibraryTab } from './project-library-tab'
import { ProjectOverview } from './project-overview'
import { projectUrl } from './projects-page'

const TAB_LABELS: Record<ProjectTab, string> = {
  overview: 'projects.tabOverview',
  tasks: 'projects.tabTasks',
  documents: 'projects.tabDocuments',
  files: 'projects.tabFiles',
}

const TAB_ICONS = { overview: AlignLeft, tasks: CircleCheck, documents: FileText, files: File }

interface Draft {
  title: string
  description: string
}

/**
 * Saving the project: one queue, so the autosaved draft and a links change never race, each sending the newest
 * `updatedAt` known as `expectedUpdatedAt`. A failure throws with the domain's `code` (`useAutosave` reads it).
 */
function useProjectSave(project: Project, projectsApi: ReturnType<typeof useProjects>) {
  const { t } = useTranslation()
  const { updateProject, refresh } = projectsApi
  const version = React.useRef(project.updatedAt)
  version.current = Math.max(version.current, project.updatedAt)
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())

  const saveProject = (patch: Omit<ProjectUpdate, 'expectedUpdatedAt'>) => {
    const next = queue.current.then(async () => {
      const result = await updateProject(project.id, { ...patch, expectedUpdatedAt: version.current })
      if (!result.ok) throw Object.assign(new Error(t('projects.saveFailed')), { code: result.code })
      version.current = Math.max(version.current, result.value.updatedAt)
      return result.value
    })
    queue.current = next.catch(() => undefined)
    return next
  }

  /** A discrete change (links): applied at once with the "Saved" toast; a conflict reloads. */
  const saveResources = async (resources: Resource[]) => {
    try {
      await saveProject({ resources })
      toast.success(t('common.saved'), { id: 'saved' })
    } catch (error) {
      const conflict = (error as { code?: string }).code === 'conflict'
      toast.error(conflict ? t('common.changedElsewhere') : (error as Error).message, { id: 'saved' })
      if (conflict) void refresh()
    }
  }

  return { saveProject, saveResources }
}

function ProjectView({ project, projectsApi }: { project: Project; projectsApi: ReturnType<typeof useProjects> }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const tab: ProjectTab = (isProjectsNavigation(navState) && navState.search.tab) || 'overview'
  const tasksApi = useTasks()
  const { runTaskAction } = useTaskSave(tasksApi)
  const { items } = useLibrary()
  const { nameOf } = useWorkspaceMembers()
  const setStatus = useSetProjectStatus()
  const { saveProject, saveResources } = useProjectSave(project, projectsApi)
  const latest = React.useRef(project)
  latest.current = project

  // Title and description are one draft (one save loop); a save sends only what changed, never an empty title.
  const save = async (draft: Draft) => {
    const current = latest.current
    const title = draft.title.trim()
    const patch: Partial<Draft> = {}
    if (title && title !== current.title) patch.title = title
    if (draft.description !== current.description) patch.description = draft.description
    if (patch.title !== undefined || patch.description !== undefined) await saveProject(patch)
  }
  const { value, change, flush } = useAutosave<Draft>(
    { title: project.title, description: project.description },
    save,
    { onConflict: () => void projectsApi.refresh() },
  )
  const latestDraft = React.useRef(value)
  latestDraft.current = value
  const update = (patch: Partial<Draft>) => {
    latestDraft.current = { ...latestDraft.current, ...patch }
    change(latestDraft.current)
  }

  const tasks = React.useMemo(() => tasksApi.tasks.filter((task) => task.projectId === project.id), [tasksApi.tasks, project.id])
  const counts = getProjectTabCounts(project.id, project.resources, tasksApi.tasks, items)
  const archived = project.status === 'archived'

  const setTab = (next: ProjectTab) => navigate(routes.view.projects({ projectId: project.id, tab: next === 'overview' ? undefined : next }))
  const copyLink = async () => {
    const url = projectUrl(project.id)
    if (!url) return
    await navigator.clipboard.writeText(url)
    toast.success(t('toast.linkCopied'))
  }

  const libraryKind = tab === 'documents' ? 'document' : tab === 'files' ? 'file' : null
  const tabAction = tab === 'tasks' ? (
    <CreateButton label={t('tasks.newTask')} onClick={() => dispatchPrefillInputEvent(t('tasks.createPrompt', { defaultValue: 'Help me create a task{{context}}. Details: ', context: ` in project:${project.id}` }))} />
  ) : libraryKind ? (
    <AddFromLibrary key={libraryKind} kind={libraryKind} resources={project.resources} onResources={(next) => void saveResources(next)} />
  ) : null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={(
          <input
            aria-label={t('projects.fieldTitle')}
            value={value.title}
            placeholder={t('projects.titlePlaceholder')}
            onChange={(event) => update({ title: event.target.value })}
            onBlur={() => {
              if (!latestDraft.current.title.trim()) update({ title: latest.current.title })
              flush()
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        )}
        description={(
          <span className="inline-flex flex-wrap items-center gap-2">
            {project.members.length > 0 && (
              <span className="inline-flex items-center gap-1">
                {project.members.slice(0, 8).map((actor) => <ActorAvatar key={actor} actor={actor} name={nameOf(actor)} size="sm" />)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">{t('projects.members')}<Count>{project.members.length}</Count></span>
            {archived && <Badge variant="secondary">{t('projects.status_archived')}</Badge>}
          </span>
        )}
        menu={(
          <>
            <DropdownMenuItem shortcut="C" onClick={() => void copyLink()}>
              <Link />
              {t('projects.copyLink')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem shortcut="A" onClick={() => void setStatus(project.id, archived ? 'active' : 'archived')}>
              {archived ? <ArchiveRestore /> : <Archive />}
              {archived ? t('projects.restore') : t('projects.archive')}
            </DropdownMenuItem>
          </>
        )}
      />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={tab} onValueChange={(next) => setTab(next as ProjectTab)} className="min-w-0">
              <TabsList className="max-w-full flex-wrap" aria-label={t('projects.details')}>
                {PROJECT_TABS.map((id) => {
                  const count = id === 'overview' ? 0 : counts[id]
                  const Icon = TAB_ICONS[id]
                  return (
                    <TabsTrigger key={id} value={id}>
                      <Icon />
                      {t(TAB_LABELS[id])}
                      {count > 0 && <Count>{count}</Count>}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
            {tabAction && <div className="ml-auto">{tabAction}</div>}
          </div>
          {tab === 'overview' ? (
            <ProjectOverview
              projectId={project.id}
              members={project.members}
              onAddMember={(actor) => projectsApi.addProjectMember(project.id, actor)}
              onRemoveMember={(actor) => projectsApi.removeProjectMember(project.id, actor)}
              description={value.description}
              onDescription={(markdown) => update({ description: markdown })}
              onBlur={flush}
              resources={project.resources}
              onResources={(next) => void saveResources(next)}
            />
          ) : tab === 'tasks' ? (
            tasks.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('projects.noTasks')}</EmptyTitle>
                  <EmptyDescription>{t('projects.noTasksDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <TaskGroups
                tasks={tasks}
                nameOf={nameOf}
                onOpen={(task) => navigate(routes.view.tasks({ taskId: task.id }))}
                onAction={(task, action) => void runTaskAction(task, action)}
              />
            )
          ) : (
            <ProjectLibraryTab
              kind={libraryKind ?? 'file'}
              resources={project.resources}
              onResources={(next) => void saveResources(next)}
            />
          )}
        </div>
      </PageColumn>
      <SidecarDetails title={t('projects.details')}><ProjectDetails projectId={project.id} /></SidecarDetails>
    </div>
  )
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  useComposerContext({ key: `project:${projectId}`, entity: `project:${projectId}`, placeholder: t('composer.placeholder.project') })
  const { showNotFound } = useNavigation()
  const projectsApi = useProjects()
  const { projects, loaded, refresh } = projectsApi
  const project = projects.find((item) => item.id === projectId)

  // Not in the list: ask the server (a project created a moment ago may not be listed yet) before calling it missing.
  React.useEffect(() => {
    if (!loaded || project) return
    let cancelled = false
    window.electronAPI.getProject(projectId)
      .then((found) => {
        if (cancelled) return
        if (found && found.status !== 'deleted') void refresh()
        else showNotFound()
      })
      .catch(() => { if (!cancelled) showNotFound() })
    return () => { cancelled = true }
  }, [loaded, project, projectId, refresh, showNotFound])

  if (!project) return <div className="flex h-full flex-col"><PageHeader title="" /></div>
  return <ProjectView key={project.id} project={project} projectsApi={projectsApi} />
}
