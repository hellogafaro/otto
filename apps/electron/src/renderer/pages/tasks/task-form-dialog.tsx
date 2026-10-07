/**
 * New task: Title, Project (the filtered one, else the first; the searchable `ProjectPicker`), Assignees (the `AssigneePicker`) and Due
 * date (the calendar popover), then `createTask` (and `setTaskStatus` when it starts in another status, from a
 * group's "+"). Opens the new task after creating it. A failure is a toast and the dialog stays open with what was typed.
 */

import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { format } from 'date-fns'
import { Box, CalendarDays, ChevronDown, Users } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { DatePicker } from '@workspace/ui/components/date-picker'
import { Input } from '@workspace/ui/components/input'
import { toast } from '@workspace/ui/components/sonner'
import { getDateLocale } from '@otto/shared/i18n'
import { MAX_TITLE } from '@otto/shared/projects/limits'
import { AssigneePicker } from '@/components/people/assignee-picker'
import { ProjectPicker } from '@/components/projects/project-picker'
import { useRegisterModal } from '@/context/modal-context'
import { useNavigation } from '@/contexts/navigation-context'
import { submitForm } from '@/lib/form'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/navigate'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { TaskStatus } from '../../../shared/types'

/** A form field that opens a picker (the project, the due date): the input well with an icon, the value or the muted placeholder, and a chevron. */
function FieldTrigger({ icon, value, placeholder, className, children: _children, ...props }: React.ComponentProps<'button'> & { icon: React.ReactNode; value?: string; placeholder: string }) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-transparent bg-input/50 px-3 text-left text-sm outline-none transition-colors hover:bg-input/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-expanded:bg-input/70 aria-invalid:border-destructive [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {icon}
      <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
      <ChevronDown />
    </button>
  )
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
  const { t, i18n } = useTranslation()
  const locale = getDateLocale(i18n.language)
  const { navigate } = useNavigation()
  const { projects } = useProjects()
  const { createTask, setTaskStatus } = useTasks()
  const { nameOf } = useWorkspaceMembers()
  const active = projects.filter((project) => project.status === 'active')
  const schema = z.object({
    title: z.string().trim().min(1, t('common.required')).max(MAX_TITLE, t('common.tooLong', { max: MAX_TITLE })),
    projectId: z.string().min(1, t('common.required')),
    assignees: z.array(z.string()),
    due: z.number().nullable(),
  })
  const form = useForm({
    defaultValues: { title: '', projectId: defaults?.projectId ?? '', assignees: [] as string[], due: null as number | null },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const created = await createTask({ projectId: value.projectId, title: value.title.trim(), assignees: value.assignees, dueAt: value.due })
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
                <ProjectPicker
                  value={field.state.value}
                  onValueChange={(projectId) => {
                    field.handleChange(projectId)
                    field.handleBlur()
                  }}
                  className="w-(--anchor-width)"
                  trigger={(
                    <FieldTrigger
                      id={field.name}
                      icon={<Box />}
                      value={active.find((p) => p.id === field.state.value)?.title}
                      placeholder={t('tasks.chooseProject')}
                      aria-invalid={isInvalid}
                    />
                  )}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
        <form.Field name="assignees">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t('tasks.assignees')}</FieldLabel>
              <AssigneePicker
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
                className="w-(--anchor-width)"
                trigger={(
                  <FieldTrigger
                    id={field.name}
                    icon={<Users />}
                    value={field.state.value.map(nameOf).join(', ')}
                    placeholder={t('tasks.noAssignees')}
                  />
                )}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="due">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{t('tasks.dueDate')}</FieldLabel>
              <DatePicker
                value={field.state.value === null ? null : new Date(field.state.value)}
                onValueChange={(date) => field.handleChange(date ? date.getTime() : null)}
                clearLabel={t('tasks.clearDate')}
                todayLabel={t('tasks.today')}
                locale={locale}
                trigger={(
                  <FieldTrigger
                    id={field.name}
                    icon={<CalendarDays />}
                    value={field.state.value === null ? undefined : format(field.state.value, 'MMM d, yyyy', { locale })}
                    placeholder={t('tasks.noDueDate')}
                  />
                )}
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
