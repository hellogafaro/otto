import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { NativeSelect, NativeSelectOption } from '@workspace/ui/components/native-select'
import { submitForm } from '@/lib/form'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'
import { OPENAI_LABEL, type KeyFormValues } from './connection-kinds'

/**
 * KeyConnectionStep: the forms of the connections that take a key (TanStack Form, validated on blur and on submit).
 * `onSubmit` tests and saves, and returns what went wrong (shown under the fields) or null when it is done.
 */
export function KeyConnectionStep({
  canShare,
  onSubmit,
  onBack,
}: {
  /** An owner may make the connection the workspace's. */
  canShare: boolean
  onSubmit: (values: KeyFormValues) => Promise<string | null>
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const schema = z.object({ apiKey: z.string().trim().min(1, t('common.required')), scope: z.enum(['user', 'workspace']) })
  const form = useForm({
    defaultValues: { apiKey: '', scope: 'user' } as KeyFormValues,
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => setError(await onSubmit(value)),
  })

  return (
    <StepFormLayout
      title={OPENAI_LABEL}
      description={t('connections.form.apiKey')}
      actions={
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <>
              <BackButton onClick={onBack} disabled={isSubmitting} />
              <ContinueButton type="submit" form="connection-form" loading={isSubmitting}>
                {t('connections.connect')}
              </ContinueButton>
            </>
          )}
        </form.Subscribe>
      }
    >
      <form id="connection-form" noValidate onSubmit={(event) => submitForm(event, form)} className="flex flex-col gap-3">
        <FieldGroup>
          <form.Field name="apiKey">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{t('connections.form.apiKey')}</FieldLabel>
                  <Input id={field.name} name={field.name} type="password" value={field.state.value} aria-invalid={isInvalid} autoComplete="off" autoFocus onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          {canShare && (
            <form.Field name="scope">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t('connections.form.availableTo')}</FieldLabel>
                  <NativeSelect id={field.name} name={field.name} value={field.state.value} onChange={(event) => field.handleChange(event.target.value as KeyFormValues['scope'])}>
                    <NativeSelectOption value="user">{t('connections.form.justYou')}</NativeSelectOption>
                    <NativeSelectOption value="workspace">{t('connections.form.workspace')}</NativeSelectOption>
                  </NativeSelect>
                </Field>
              )}
            </form.Field>
          )}
        </FieldGroup>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    </StepFormLayout>
  )
}
