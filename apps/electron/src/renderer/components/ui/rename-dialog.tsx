/**
 * RenameDialog: a name in a dialog (rename, or a create flow's name). The reference TanStack form (DESIGN.md,
 * Forms): the form owns the value, starting from `defaultValue` each time it opens; `onSubmit` gets it trimmed.
 */

import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useRegisterModal } from '@/context/modal-context'
import { submitForm } from '@/lib/form'

interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** The name when it opens. */
  defaultValue: string
  onSubmit: (name: string) => void | Promise<void>
  placeholder?: string
  /** The submit button's label; "Save" by default (a create flow says "Create"). */
  submitLabel?: string
}

export function RenameDialog({ open, onOpenChange, title, defaultValue, onSubmit, placeholder, submitLabel }: RenameDialogProps) {
  const { t } = useTranslation()
  // Registers so the X button / Cmd+W closes this dialog first.
  useRegisterModal(open, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: the field starts from `defaultValue` each time. */}
        <RenameForm
          title={title}
          defaultValue={defaultValue}
          placeholder={placeholder ?? t('common.enterName')}
          submitLabel={submitLabel ?? t('common.save')}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({ title, defaultValue, placeholder, submitLabel, onSubmit }: Pick<RenameDialogProps, 'title' | 'defaultValue' | 'onSubmit'> & { placeholder: string; submitLabel: string }) {
  const { t } = useTranslation()
  const schema = z.object({ name: z.string().trim().min(1, t('common.required')) })
  const form = useForm({
    defaultValues: { name: defaultValue },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      await onSubmit(value.name.trim())
    },
  })

  return (
    <form noValidate onSubmit={(event) => submitForm(event, form)} className="flex flex-col gap-6">
      <FieldGroup>
        <form.Field name="name">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  placeholder={placeholder}
                  aria-label={title}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                  autoFocus
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
                {submitLabel}
              </Button>
            </>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
