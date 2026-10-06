/**
 * New task: Title, Project (the filtered one, else the first), Assignees and Due date, then `createTask` (and
 * `setTaskStatus` when it starts in another status, from a group's "+"). Opens the new task after creating it.
 * A failure is a toast and the dialog stays open with what was typed. Also the date helpers of the due date.
 */

import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { NativeSelect, NativeSelectOption } from '@workspace/ui/components/native-select'
import { toast } from '@workspace/ui/components/sonner'
import { MAX_TITLE } from '@otto/shared/projects/limits'
import { AssigneePicker } from '@/components/people/assignee-picker'
import { useRegisterModal } from '@/context/modal-context'
import { useNavigation } from '@/contexts/navigation-context'
import { submitForm } from '@/lib/form'
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
  const schema = z.object({
    title: z.string().trim().min(1, t('common.required')).max(MAX_TITLE, t('common.tooLong', { max: MAX_TITLE })),
    projectId: z.string().min(1, t('common.required')),
    assignees: z.array(z.string()),
    due: z.string(),
  })
  const form = useForm({
    defaultValues: { title: '', projectId: defaults?.projectId ?? '', assignees: [] as string[], due: '' },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const created = await createTask({ projectId: value.projectId, title: value.title.trim(), assignees: value.assignees, dueAt: parseDateInput(value.due) })
      const status = defaults?.status
      const moved = created.ok && status && status !== 'todo' ? await setTaskStatus(created.value.id, status) : null
      if (!created.ok) {
        toast.error(t(created.code === 'invalid' ? 'tasks.errorInvalid' : 'tasks.errorUnknown'))
        return
      }
      // Created in Todo: say so when moving it to the group's status failed.
      if (moved && !moved.ok) toast.error(t('tasks.errorUnknown'))
      onDone()
      navigate(routes.view.tasks({ taskId: created.value.id }))
    },
  })

  // The filtered project when it is active, else the first one (also once the projects load).
  React.useEffect(() => {
    if (!active.some((p) => p.id === form.getFieldValue('projectId'))) {
      form.setFieldValue('projectId', active[0]?.id ?? '', { dontUpdateMeta: true, dontValidate: true })
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps -- runs after every render: `active` is a new array each time

  return (
    <form noValidate onSubmit={(event) => submitForm(event, form)} className="flex flex-col gap-6">
      <FieldGroup className="gap-4">
        <form.Field name="title">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t('tasks.fieldTitle')}</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  aria-invalid={isInvalid}
                  autoFocus
                  autoComplete="off"
                  placeholder={t('tasks.titlePlaceholder')}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
        <form.Field name="projectId">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t('tasks.project')}</FieldLabel>
                <NativeSelect
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  aria-invalid={isInvalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {active.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.title}</NativeSelectOption>)}
                </NativeSelect>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
        <form.Field name="assignees">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t('tasks.assignees')}</FieldLabel>
              <AssigneePicker id={field.name} value={field.state.value} onChange={field.handleChange} />
            </Field>
          )}
        </form.Field>
        <form.Field name="due">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t('tasks.dueDate')}</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="date"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <>
              <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>{t('common.cancel')}</DialogClose>
              <Button type="submit" loading={isSubmitting}>
                {t('common.create')}
              </Button>
            </>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
