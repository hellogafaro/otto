/**
 * `TaskGroups`: tasks grouped by status on the frame (DESIGN Data patterns 1, the Chats index's pattern):
 * Todo, In progress, Done (folded unless asked), then Archived (folded last unless asked), each a 36px
 * `ListGroup` over 44px `TaskRow`s; empty groups are not drawn. A group's "+" starts a new task in that status.
 * Reused by a project's Tasks tab (`projectTitles` left out hides the project badge).
 */

import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { ListGroup } from '@workspace/ui/components/list-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import type { Task, TaskStatus } from '../../../shared/types'
import { TaskRow, statusLabelKey, type TaskAction } from './task-row'
import { groupTasks, TASK_GROUPS } from './use-task-filters'

/** A group band's New task: a 24px ghost + with its label in a tooltip. */
function GroupNewTask({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} />}>
        <Plus />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function TaskGroups({
  tasks,
  projectTitles,
  nameOf,
  doneOpen = false,
  archivedOpen = false,
  onOpen,
  onAction,
  onNewTask,
}: {
  /** The tasks to show, already filtered, in the backend's order. */
  tasks: Task[]
  /** Project titles by id for the row badges; left out, rows show no project. */
  projectTitles?: Map<string, string>
  nameOf: (actor: string) => string
  doneOpen?: boolean
  archivedOpen?: boolean
  onOpen: (task: Task) => void
  onAction: (task: Task, action: TaskAction) => void
  /** A group's "+": a new task in that status. */
  onNewTask?: (status: TaskStatus) => void
}) {
  const { t } = useTranslation()
  const groups = groupTasks(tasks)
  return (
    <div className="divide-y divide-(--card-divider)">
      {TASK_GROUPS.map((status) => {
        const open = status === 'done' ? doneOpen : status === 'archived' ? archivedOpen : true
        return (
          <ListGroup
            // A new key when the default changes, so a filter that asks for the group opens it.
            key={`${status}:${open}`}
            icon={<TaskStatusIcon status={status} />}
            label={t(statusLabelKey(status))}
            count={groups[status].length}
            defaultOpen={open}
            action={onNewTask && status !== 'archived' && <GroupNewTask label={t('tasks.newTask')} onClick={() => onNewTask(status)} />}
          >
            {groups[status].map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projectTitle={projectTitles?.get(task.projectId)}
                nameOf={nameOf}
                onOpen={onOpen}
                onAction={onAction}
              />
            ))}
          </ListGroup>
        )
      })}
    </div>
  )
}
