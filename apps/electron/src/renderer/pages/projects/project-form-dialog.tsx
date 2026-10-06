/**
 * ProjectFormDialog - New project: Title and Description, then `createProject`.
 *
 * Used by the Projects index ("+" and its empty state), and open to the Tasks page and the
 * sidebar. After creating it opens the new project, unless the caller takes over with
 * `onCreated` (a picker that wants to stay where it is). A failure is a toast and the dialog
 * stays open with what was typed.
 */

import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Textarea } from '@workspace/ui/components/textarea'
import { toast } from '@workspace/ui/components/sonner'
import { MAX_DESCRIPTION, MAX_TITLE } from '@otto/shared/projects/limits'
import { submitForm } from '@/lib/form'
import { routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/navigation-context'
import { useRegisterModal } from '@/context/modal-context'
import { useProjects } from '@/hooks/use-projects'
import type { Project } from '../../../shared/types'

interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new project instead of opening it. */
  onCreated?: (project: Project) => void
}

export function ProjectFormDialog({ open, onOpenChange, onCreated }: ProjectFormDialogProps) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects.newProject')}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: the fields start empty each time. */}
        <ProjectForm onDone={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm({ onDone, onCreated }: { onDone: () => void; onCreated?: (project: Project) => void }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { createProject } = useProjects()
  const tooLong = (max: number) => t('common.tooLong', { max })
  const schema = z.object({
    title: z.string().trim().min(1, t('common.required')).max(MAX_TITLE, tooLong(MAX_TITLE)),
    description: z.string().trim().max(MAX_DESCRIPTION, tooLong(MAX_DESCRIPTION)),
  })
  const form = useForm({
    defaultValues: { title: '', description: '' },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const result = await createProject({ title: value.title.trim(), description: value.description.trim() })
      if (!result.ok) {
        toast.error(t('projects.createFailed'))
        return
      }
      onDone()
      if (onCreated) onCreated(result.value)
      else navigate(routes.view.projects({ projectId: result.value.id }))
    },
  })

  return (
    <form noValidate onSubmit={(event) => submitForm(event, form)} className="flex flex-col gap-6">
      <FieldGroup>
        <form.Field name="title">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t('projects.fieldTitle')}</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
        <form.Field name="description">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t('common.description')}</FieldLabel>
                <Textarea
                  id={field.name}
                  className="max-h-48"
                  name={field.name}
                  value={field.state.value}
                  aria-invalid={isInvalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
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
