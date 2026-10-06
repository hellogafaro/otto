/**
 * New task: Title, Project (the filtered one, else the first), Assignees and Due date, then `createTask` (and
 * `setTaskStatus` when it starts in another status, from a group's "+"). Opens the new task after creating it.
 * A failure is a toast and the dialog stays open with what was typed. Also the date helpers of the due date.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { NativeSelect, NativeSelectOption } from '@workspace/ui/components/native-select'
import { toast } from '@workspace/ui/components/sonner'
import { Spinner } from '@workspace/ui/components/spinner'
import { MAX_TITLE } from '@otto/shared/projects/limits'
import { AssigneePicker } from '@/components/people/assignee-picker'
import { useRegisterModal } from '@/context/modal-context'
import { useNavigation } from '@/contexts/navigation-context'
import { routes } from '@/lib/navigate'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import type { TaskStatus } from '../../../shared/types'

/** A due date (epoch ms, local midnight) as a date input's `YYYY-MM-DD`; '' for none. */
export function dateInputValue(dueAt: number | null): string {
  if (dueAt === null) return ''
  const d = new Date(dueAt)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A date input's `YYYY-MM-DD` as local midnight in epoch ms; null when empty or not a date. */
export function parseDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null
}

export interface NewTaskDefaults {
  projectId?: string
  status?: TaskStatus
}

export function TaskFormDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults?: NewTaskDefaults }) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tasks.newTask')}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: the fields start empty each time. */}
        <TaskForm defaults={defaults} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function TaskForm({ defaults, onDone }: { defaults?: NewTaskDefaults; onDone: () => void }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { projects } = useProjects()
  const { createTask, setTaskStatus } = useTasks()
  const active = projects.filter((project) => project.status === 'active')
  const [title, setTitle] = React.useState('')
  const [projectId, setProjectId] = React.useState(() => defaults?.projectId ?? '')
  const [assignees, setAssignees] = React.useState<string[]>([])
  const [due, setDue] = React.useState('')
  const [pending, setPending] = React.useState(false)
  // The filtered project when it is active, else the first one (also once the projects load).
  const project = active.find((p) => p.id === projectId)?.id ?? active[0]?.id ?? ''

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || !title.trim() || !project) return
    setPending(true)
    const created = await createTask({ projectId: project, title: title.trim(), assignees, dueAt: parseDateInput(due) })
    const status = defaults?.status
    const moved = created.ok && status && status !== 'todo' ? await setTaskStatus(created.value.id, status) : null
    setPending(false)
    if (!created.ok) {
      toast.error(t(created.code === 'invalid' ? 'tasks.errorInvalid' : 'tasks.errorUnknown'))
      return
    }
    // Created in Todo: say so when moving it to the group's status failed.
    if (moved && !moved.ok) toast.error(t('tasks.errorUnknown'))
    onDone()
    navigate(routes.view.tasks({ taskId: created.value.id }))
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="task-title">{t('tasks.fieldTitle')}</FieldLabel>
          <Input
            id="task-title"
            value={title}
            maxLength={MAX_TITLE}
            autoFocus
            autoComplete="off"
            disabled={pending}
            placeholder={t('tasks.titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="task-project">{t('tasks.project')}</FieldLabel>
          <NativeSelect id="task-project" value={project} disabled={pending} onChange={(event) => setProjectId(event.target.value)}>
            {active.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.title}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="task-assignees">{t('tasks.assignees')}</FieldLabel>
          <AssigneePicker id="task-assignees" value={assignees} onChange={setAssignees} />
        </Field>
        <Field>
          <FieldLabel htmlFor="task-due">{t('tasks.dueDate')}</FieldLabel>
          <Input id="task-due" type="date" value={due} disabled={pending} onChange={(event) => setDue(event.target.value)} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>{t('common.cancel')}</DialogClose>
        <Button type="submit" disabled={pending || !title.trim() || !project}>
          {pending && <Spinner data-icon="inline-start" />}
          {t('common.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
