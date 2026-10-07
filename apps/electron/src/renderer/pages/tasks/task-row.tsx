/**
 * One task in the grouped list: a 44px `ListRow` that opens it (status icon, title, the assignees' avatars,
 * the project as an outline badge, the due date) and its right-click menu (a long press on touch): Open, Status, Copy link, Archive / Restore.
 * `TaskMenuItems` is the same list for the task page's More actions (Base UI's menu items work in both menus).
 */

import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { Archive, ArchiveRestore, Box, CircleDashed, Link, SquareArrowOutUpRight } from 'lucide-react'
import { AvatarGroup } from '@workspace/ui/components/avatar'
import { Badge } from '@workspace/ui/components/badge'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@workspace/ui/components/context-menu'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@workspace/ui/components/dropdown-menu'
import { ListRow } from '@workspace/ui/components/list-group'
import { toast } from '@workspace/ui/components/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { getDateLocale } from '@otto/shared/i18n'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import { workspaceSlugFromPathname } from '@/router/location'
import type { Task, TaskStatus } from '../../../shared/types'

/** The statuses a person picks (Archived is Archive / Restore), with their number keys. */
export const PICKABLE_STATUSES = ['todo', 'doing', 'done'] as const

/** A status's label key. */
export const statusLabelKey = (status: TaskStatus) => `tasks.status_${status === 'deleted' ? 'archived' : status}`

export type TaskAction = { status: TaskStatus }

/** The task's URL in this workspace, for Copy link. */
export function taskUrl(taskId: string): string {
  const slug = workspaceSlugFromPathname(window.location.pathname) ?? ''
  return new URL(`/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`, window.location.origin).href
}

export async function copyTaskLink(taskId: string, done: string) {
  await navigator.clipboard.writeText(taskUrl(taskId))
  toast.success(done)
}

/** The status choices as radio items with number keys (1 Todo, 2 In progress, 3 Done). */
export function TaskStatusItems({ status, onStatus }: { status: TaskStatus; onStatus: (status: TaskStatus) => void }) {
  const { t } = useTranslation()
  return (
    <DropdownMenuRadioGroup value={status} onValueChange={(next) => onStatus(next as TaskStatus)}>
      {PICKABLE_STATUSES.map((item, index) => (
        <DropdownMenuRadioItem key={item} value={item} shortcut={String(index + 1)} closeOnClick>
          <TaskStatusIcon status={item} />
          {t(statusLabelKey(item))}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** Copy link and Archive / Restore: the items the row menu and the task page's More actions share. */
export function TaskMenuItems({ task, onAction }: { task: Task; onAction: (task: Task, action: TaskAction) => void }) {
  const { t } = useTranslation()
  const archived = task.status === 'archived'
  return (
    <>
      <DropdownMenuItem shortcut="C" onClick={() => void copyTaskLink(task.id, t('toast.linkCopied'))}>
        <Link />
        {t('tasks.copyLink')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem shortcut="A" onClick={() => onAction(task, { status: archived ? 'todo' : 'archived' })}>
        {archived ? <ArchiveRestore /> : <Archive />}
        {archived ? t('tasks.restore') : t('tasks.archive')}
      </DropdownMenuItem>
    </>
  )
}

/** The assignees' 20px avatars, overlapping; one tooltip names them. */
export function TaskPeople({ actors, nameOf }: { actors: string[]; nameOf: (actor: string) => string }) {
  if (actors.length === 0) return null
  const names = actors.map(nameOf).join(', ')
  return (
    <Tooltip>
      <TooltipTrigger render={<AvatarGroup aria-label={names} />}>
        {actors.map((actor) => <ActorAvatar key={actor} actor={actor} name={nameOf(actor)} />)}
      </TooltipTrigger>
      <TooltipContent>{names}</TooltipContent>
    </Tooltip>
  )
}

export function TaskRow({
  task,
  projectTitle,
  nameOf,
  onOpen,
  onAction,
}: {
  task: Task
  /** The project badge's text; none hides the badge (the list of one project). */
  projectTitle?: string
  /** `useWorkspaceMembers().nameOf`, from the list (one members subscription per page). */
  nameOf: (actor: string) => string
  onOpen: (task: Task) => void
  onAction: (task: Task, action: TaskAction) => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <ListRow
      data-task-id={task.id}
      media={<TaskStatusIcon status={task.status} />}
      title={task.title}
      muted={task.status === 'done' || task.status === 'archived'}
      meta={(task.assignees.length > 0 || projectTitle) && (
        <>
          <TaskPeople actors={task.assignees} nameOf={nameOf} />
          {projectTitle && (
            <Badge variant="outline" className="max-w-36">
              <Box />
              <span className="truncate">{projectTitle}</span>
            </Badge>
          )}
        </>
      )}
      end={task.dueAt ? format(task.dueAt, 'MMM d', { locale: getDateLocale(i18n.language) }) : undefined}
      onClick={() => onOpen(task)}
      menu={(
        <ContextMenuContent className="w-48">
          <ContextMenuGroup>
            <ContextMenuItem onClick={() => onOpen(task)}>
              <SquareArrowOutUpRight />
              {t('tasks.open')}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <CircleDashed />
                {t('tasks.status')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuGroup>
                  <ContextMenuLabel>{t('tasks.changeStatus')}</ContextMenuLabel>
                  <TaskStatusItems status={task.status} onStatus={(status) => onAction(task, { status })} />
                </ContextMenuGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <TaskMenuItems task={task} onAction={onAction} />
          </ContextMenuGroup>
        </ContextMenuContent>
      )}
    />
  )
}
