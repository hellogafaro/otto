/**
 * TaskPage - one task (Otto v1's task page): its title in the title row and its description in the centerpiece,
 * both edited in place and saved by `useAutosave` (no Save button: 800 ms after the last change, on blur and on
 * leaving, one "Saved" toast; `conflict` reloads), then the Activity (events and comments in one feed, the comment
 * box at its end). The floating Details toggle opens the sidecar (closed by default): Properties (Status S,
 * Assignees, Due date D in the calendar popover, Project P in the searchable picker), Links ("+" prefills the
 * composer: an agent adds the link) and Time; More holds Copy link and Archive. A task id that is not in the
 * workspace shows the not-found page once the list and the server agree.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { format } from 'date-fns'
import { Box, CalendarDays, Users, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { DatePicker } from '@workspace/ui/components/date-picker'
import { PageCenterpiece, PageColumn } from '@workspace/ui/components/page'
import { PageScroll } from '@workspace/ui/components/page-frame'
import { PropertyRow, PropertySection } from '@workspace/ui/components/property-list'
import { TiptapMarkdownEditor } from '@otto/ui'
import { getDateLocale } from '@otto/shared/i18n'
import { useAction } from '@/actions'
import { PageHeader } from '@/components/app-shell/page-header'
import { ActivityFeed } from '@/components/comments/activity-feed'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { AssigneePicker } from '@/components/people/assignee-picker'
import { ProjectPicker } from '@/components/projects/project-picker'
import { NewLink, ResourceList } from '@/components/resources/resource-list'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import { SidecarDetails, useSidecar } from '@/context/sidecar-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useAutosave } from '@/hooks/use-autosave'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { Task } from '../../../shared/types'
import { statusLabelKey, TaskMenuItems, TaskStatusItems } from './task-row'
import { TaskTimeSection } from './task-time-section'
import { useTaskSave } from './use-task-save'

/** The task's Details in the sidecar: it reads the task itself, so it stays current while open. */
function TaskDetails({ taskId }: { taskId: string }) {
  const tasksApi = useTasks()
  const task = tasksApi.tasks.find((item) => item.id === taskId)
  return task ? <TaskProperties key={task.id} task={task} tasksApi={tasksApi} /> : null
}

function TaskProperties({ task, tasksApi }: { task: Task; tasksApi: ReturnType<typeof useTasks> }) {
  const { t, i18n } = useTranslation()
  const { projects } = useProjects()
  const { nameOf } = useWorkspaceMembers()
  const { open: sidecarOpen } = useSidecar()
  const { saveTask, runTaskAction } = useTaskSave(tasksApi)
  const latest = React.useRef(task)
  latest.current = task
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [dueOpen, setDueOpen] = React.useState(false)
  const [projectOpen, setProjectOpen] = React.useState(false)

  const onConflict = () => void tasksApi.refresh()
  const assignees = useAutosave(task.assignees, (value) => saveTask(latest.current, { assignees: value }), { onConflict })
  const due = useAutosave(task.dueAt, (value) => saveTask(latest.current, { dueAt: value }), { onConflict })

  // S, D and P open the status menu, the calendar and the project picker while the Details are open (the rows show the keys).
  useAction('task.changeStatus', () => setStatusOpen(true), { enabled: () => sidecarOpen })
  useAction('task.changeDueDate', () => setDueOpen(true), { enabled: () => sidecarOpen })
  useAction('task.changeProject', () => setProjectOpen(true), { enabled: () => sidecarOpen })

  const project = projects.find((p) => p.id === task.projectId)
  const locale = getDateLocale(i18n.language)

  return (
    <>
      <PropertySection title={t('tasks.properties')}>
        <DropdownMenu open={statusOpen} onOpenChange={setStatusOpen}>
          <DropdownMenuTrigger
            render={(
              <PropertyRow
                icon={<TaskStatusIcon status={task.status} />}
                label={t('tasks.status')}
                value={t(statusLabelKey(task.status))}
                kbd="S"
              />
            )}
          />
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel shortcut="S">{t('tasks.changeStatus')}</DropdownMenuLabel>
              <TaskStatusItems status={task.status} onStatus={(status) => void runTaskAction(task, { status })} />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <AssigneePicker
          value={assignees.value}
          onChange={assignees.change}
          trigger={(
            <PropertyRow
              icon={assignees.value[0] ? <ActorAvatar actor={assignees.value[0]} name={nameOf(assignees.value[0])} /> : <Users />}
              label={t('tasks.assignees')}
              value={assignees.value.map(nameOf).join(', ')}
              placeholder={t('tasks.noAssignees')}
            />
          )}
        />
        <DatePicker
          open={dueOpen}
          onOpenChange={setDueOpen}
          value={due.value === null ? null : new Date(due.value)}
          onValueChange={(date) => due.change(date ? date.getTime() : null)}
          clearLabel={t('tasks.clearDate')}
          todayLabel={t('tasks.today')}
          locale={locale}
          trigger={(
            <PropertyRow
              icon={<CalendarDays />}
              label={t('tasks.dueDate')}
              value={due.value === null ? undefined : format(due.value, 'MMM d, yyyy', { locale })}
              placeholder={t('tasks.noDueDate')}
              kbd="D"
              actions={due.value !== null && (
                <Button variant="ghost" size="icon-xs" aria-label={t('tasks.clearDueDate')} onClick={() => due.change(null)}>
                  <X />
                </Button>
              )}
            />
          )}
        />
        <ProjectPicker
          open={projectOpen}
          onOpenChange={setProjectOpen}
          value={task.projectId}
          onValueChange={(projectId) => { if (projectId !== task.projectId) void runTaskAction(task, { projectId }) }}
          trigger={<PropertyRow icon={<Box />} label={t('tasks.project')} value={project?.title} kbd="P" />}
        />
      </PropertySection>
      <PropertySection
        title={t('resources.title')}
        count={task.resources.length}
        action={<NewLink size="icon-xs" entity={`task:${task.id}`} resources={task.resources} />}
      >
        <ResourceList resources={task.resources} onChange={(resources) => void runTaskAction(task, { resources })} />
      </PropertySection>
      <TaskTimeSection taskId={task.id} />
    </>
  )
}

interface Draft {
  title: string
  description: string
}

function TaskView({ task, tasksApi }: { task: Task; tasksApi: ReturnType<typeof useTasks> }) {
  const { t, i18n } = useTranslation()
  const { nameOf } = useWorkspaceMembers()
  const { saveTask, runTaskAction } = useTaskSave(tasksApi)
  const latest = React.useRef(task)
  latest.current = task

  // Title and description are one draft (one save loop); a save sends only what changed, never an empty title.
  const save = async (draft: Draft) => {
    const current = latest.current
    const title = draft.title.trim()
    const patch: Partial<Draft> = {}
    if (title && title !== current.title) patch.title = title
    if (draft.description !== current.description) patch.description = draft.description
    if (patch.title !== undefined || patch.description !== undefined) await saveTask(current, patch)
  }
  const { value, change, flush } = useAutosave<Draft>(
    { title: task.title, description: task.description },
    save,
    { onConflict: () => void tasksApi.refresh() },
  )
  const latestDraft = React.useRef(value)
  latestDraft.current = value
  const update = (patch: Partial<Draft>) => {
    latestDraft.current = { ...latestDraft.current, ...patch }
    change(latestDraft.current)
  }

  return (
    <PageColumn fill>
      <PageHeader
        title={(
          <input
            aria-label={t('tasks.fieldTitle')}
            value={value.title}
            placeholder={t('tasks.titlePlaceholder')}
            onChange={(event) => update({ title: event.target.value })}
            onBlur={() => {
              if (!latestDraft.current.title.trim()) update({ title: latest.current.title })
              flush()
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        )}
        menu={<TaskMenuItems task={task} onAction={(item, action) => void runTaskAction(item, action)} />}
      />
      <PageCenterpiece>
        <PageScroll className="flex flex-col gap-3 px-5 py-5" onBlur={flush}>
          <p className="text-xs text-muted-foreground">
            {t('tasks.createdBy', { name: nameOf(task.createdBy), date: format(task.createdAt, 'MMM d, yyyy', { locale: getDateLocale(i18n.language) }) })}
          </p>
          <TiptapMarkdownEditor
            content={value.description}
            onUpdate={(markdown) => update({ description: markdown })}
            placeholder={t('tasks.descriptionPlaceholder')}
          />
          <ActivityFeed entity={`task:${task.id}`} className="mt-5" />
        </PageScroll>
      </PageCenterpiece>
      <SidecarDetails title={t('tasks.details')}><TaskDetails taskId={task.id} /></SidecarDetails>
    </PageColumn>
  )
}

export function TaskPage({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  useComposerContext({ key: `task:${taskId}`, entity: `task:${taskId}`, placeholder: t('composer.placeholder.task') })
  const { showNotFound } = useNavigation()
  const tasksApi = useTasks()
  const { tasks, loaded, refresh } = tasksApi
  const task = tasks.find((item) => item.id === taskId)

  // Not in the list: ask the server (a task created a moment ago may not be listed yet) before calling it missing.
  React.useEffect(() => {
    if (!loaded || task) return
    let cancelled = false
    window.electronAPI.getTask(taskId)
      .then((found) => {
        if (cancelled) return
        if (found && found.status !== 'deleted') void refresh()
        else showNotFound()
      })
      .catch(() => { if (!cancelled) showNotFound() })
    return () => { cancelled = true }
  }, [loaded, task, taskId, refresh, showNotFound])

  if (!task) return <div className="flex h-full flex-col"><PageHeader title="" /></div>
  return <TaskView key={task.id} task={task} tasksApi={tasksApi} />
}
