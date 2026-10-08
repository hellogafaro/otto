/**
 * TasksPage - the Tasks index: the workspace's tasks across every project, grouped by status in the Settings card (`ListCard`)
 * (`TaskGroups`, the Chats index's pattern), no toolbar. The header carries Filter (Project, Assignee, Status,
 * Archived; in the URL, `useTaskFilters`), Search (the palette on Tasks) and New task (a dialog); active filters show as chips above the list.
 * Archived is the last, folded group, and the whole list (open) when Archived is the filter.
 *
 * Nothing at all: the section's empty state, whose button is New task, or New project while no project exists
 * (a task needs one; the new project then opens the New task dialog). Filters that keep nothing: `NoResults`.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Archive, Box, CircleCheck, CircleDashed, User } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField, type FilterValues } from '@workspace/ui/components/filters'
import { ListCard, ListRowSkeleton } from '@workspace/ui/components/list-group'
import { PageColumn } from '@workspace/ui/components/page'
import { PageHeader } from '@/components/app-shell/page-header'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { CreateButton } from '@/components/ui/create-button'
import { useNavigation } from '@/contexts/navigation-context'
import { routes } from '@/lib/navigate'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { ProjectFormDialog } from '../projects/project-form-dialog'
import { TASK_FILTER_STATUSES, type TasksSearch } from '../../../shared/section-search'
import type { Task } from '../../../shared/types'
import { TaskFormDialog, type NewTaskDefaults } from './task-form-dialog'
import { TaskGroups } from './task-list'
import { statusLabelKey } from './task-row'
import { hasTaskFilters, matchesTaskFilters, useTaskFilters } from './use-task-filters'
import { useTaskSave } from './use-task-save'

export function TasksPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:tasks' })
  const { navigate } = useNavigation()
  const [filters, setFilters] = useTaskFilters()
  const tasksApi = useTasks()
  const { tasks, loaded } = tasksApi
  const { projects } = useProjects()
  const { members, nameOf, me } = useWorkspaceMembers()
  const { runTaskAction } = useTaskSave(tasksApi)
  const [creating, setCreating] = React.useState<NewTaskDefaults | null>(null)
  const [creatingProject, setCreatingProject] = React.useState(false)

  const projectTitles = React.useMemo(() => new Map(projects.map((p) => [p.id, p.title])), [projects])
  const hasProject = projects.some((p) => p.status === 'active')
  const matching = React.useMemo(() => tasks.filter((task) => matchesTaskFilters(task, filters)), [tasks, filters])

  // The counts in the filter menu: tasks that are not archived (Archived counts its own).
  const counts = React.useMemo(() => {
    const open = tasks.filter((task) => task.status !== 'archived')
    const tally = (key: (task: Task) => string[]) => {
      const out: Record<string, number> = {}
      for (const task of open) for (const value of key(task)) out[value] = (out[value] ?? 0) + 1
      return out
    }
    return {
      project: tally((task) => task.projectId === null ? [] : [task.projectId]),
      assignee: tally((task) => task.assignees),
      status: tally((task) => [task.status]),
      archived: tasks.length - open.length,
    }
  }, [tasks])

  // Project, Assignee (you first, then people, then agents), Status, Archived.
  const people = [...members].sort((a, b) => Number(b.actor === me) - Number(a.actor === me) || Number(a.actor.startsWith('agent:')) - Number(b.actor.startsWith('agent:')))
  const fields: FilterField[] = [
    {
      key: 'project',
      label: t('tasks.project'),
      icon: <Box />,
      options: projects.map((p) => ({ value: p.id, label: p.title, icon: <Box />, count: counts.project[p.id] ?? 0 })),
    },
    {
      key: 'assignee',
      label: t('tasks.assignee'),
      icon: <User />,
      options: people.map((m) => ({
        value: m.actor,
        label: m.actor === me ? t('tasks.me') : m.name,
        icon: <ActorAvatar actor={m.actor} name={m.name} />,
        count: counts.assignee[m.actor] ?? 0,
      })),
    },
    {
      key: 'status',
      label: t('tasks.status'),
      icon: <CircleDashed />,
      options: TASK_FILTER_STATUSES.map((s) => ({ value: s, label: t(statusLabelKey(s)), icon: <TaskStatusIcon status={s} />, count: counts.status[s] ?? 0 })),
    },
    { key: 'archived', label: t('sidebar.archived'), icon: <Archive />, count: counts.archived },
  ]
  const values: FilterValues = {
    project: filters.project ? [filters.project] : [],
    assignee: filters.assignee ? [filters.assignee] : [],
    status: filters.status ?? [],
    archived: filters.archived ? ['true'] : [],
  }
  // Project and Assignee hold one value (the URL's): picking another replaces it.
  const changeFilter = (key: string, next: string[]) => {
    const value = key === 'archived' ? next.length > 0 || undefined : key === 'status' ? next : next.at(-1)
    setFilters({ ...filters, [key]: value } as TasksSearch)
  }

  const newTask = (status?: Task['status']) => {
    if (hasProject) setCreating({ projectId: filters.project, status })
    else setCreatingProject(true)
  }
  const openTask = (task: Task) => navigate(routes.view.tasks({ taskId: task.id, ...filters }))
  const dialogs = (
    <>
      <TaskFormDialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null) }} defaults={creating ?? undefined} />
      <ProjectFormDialog open={creatingProject} onOpenChange={setCreatingProject} onCreated={(project) => setCreating({ projectId: project.id })} />
    </>
  )

  // No tasks at all: only the empty state and its New task (New project while there is none).
  if (loaded && tasks.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<CircleCheck />} title={t('sectionEmpty.tasksTitle')} description={t('sectionEmpty.tasksDescription')}>
          <Button onClick={() => newTask()}>{hasProject ? t('sectionEmpty.newTask') : t('sectionEmpty.newProject')}</Button>
        </EntityListEmptyScreen>
        {dialogs}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('sidebar.tasks')}
        actions={(
          <>
            <FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('tasks.filterLabel')} />
            <CommandPaletteButton category="tasks" />
            <CreateButton label={t('tasks.newTask')} onClick={() => newTask()} />
          </>
        )}
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
            // Otto: the same card as the list (task-list.tsx).
            <ListCard aria-busy>
              <ul>{[0, 1, 2].map((i) => <ListRowSkeleton key={i} />)}</ul>
            </ListCard>
          ) : matching.length === 0 ? (
            <NoResults title={t('chatsIndex.noResults')} description={t('chatsIndex.noResultsDescription')}>
              {hasTaskFilters(filters) && (
                <Button variant="outline" onClick={() => setFilters({})}>{t('chatsIndex.clearFilters')}</Button>
              )}
            </NoResults>
          ) : (
            <TaskGroups
              tasks={matching}
              projectTitles={projectTitles}
              nameOf={nameOf}
              doneOpen={!!filters.status?.includes('done')}
              archivedOpen={!!filters.archived}
              onOpen={openTask}
              onAction={(task, action) => void runTaskAction(task, action)}
              onNewTask={newTask}
            />
          )}
        </div>
      </PageColumn>
      {dialogs}
    </div>
  )
}
