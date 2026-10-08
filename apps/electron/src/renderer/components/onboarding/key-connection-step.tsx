import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { NativeSelect, NativeSelectOption } from '@workspace/ui/components/native-select'
import { submitForm } from '@/lib/form'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'
import { connectionKindName, isHttpUrl, type ConnectionKind, type KeyFormValues } from './connection-kinds'

/**
 * KeyConnectionStep: the forms of the connections that take a key (TanStack Form, validated on blur and on submit).
 * `onSubmit` tests and saves, and returns what went wrong (shown under the fields) or null when it is done.
 */
export function KeyConnectionStep({
  kind = 'openai',
  canShare,
  onSubmit,
  onBack,
}: {
  kind?: ConnectionKind
  /** An owner may make the connection the workspace's. */
  canShare: boolean
  onSubmit: (values: KeyFormValues) => Promise<string | null>
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const custom = kind === 'custom'
  const schema = z.object({
    apiKey: z.string().trim().min(1, t('common.required')),
    scope: z.enum(['user', 'workspace']),
    baseUrl: z.string().refine((value) => !custom || isHttpUrl(value), t('connections.form.invalidBaseUrl', { defaultValue: 'Enter an HTTP or HTTPS base URL.' })),
    api: z.enum(['openai-responses', 'openai-completions']),
    model: z.string(),
  })
  const form = useForm({
    defaultValues: { apiKey: '', scope: 'user' as KeyFormValues['scope'], baseUrl: '', api: 'openai-responses' as NonNullable<KeyFormValues['api']>, model: '' },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => setError(await onSubmit(value)),
  })

  return (
    <StepFormLayout
      title={connectionKindName(kind)}
      description={custom ? t('connections.form.customProtocolDescription', { defaultValue: 'API key · Responses or Chat Completions API' }) : t('connections.form.apiKey')}
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
          {custom && (
            <>
              <form.Field name="baseUrl">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>{t('connections.form.baseUrl')}</FieldLabel>
                      <Input id={field.name} name={field.name} type="url" value={field.state.value} aria-invalid={isInvalid} autoComplete="off" placeholder="https://api.example.com/v1" autoFocus onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                      {isInvalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="api">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{t('connections.form.protocol', { defaultValue: 'API protocol' })}</FieldLabel>
                    <NativeSelect id={field.name} name={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value as NonNullable<KeyFormValues['api']>)}>
                      <NativeSelectOption value="openai-responses">Responses API</NativeSelectOption>
                      <NativeSelectOption value="openai-completions">Chat Completions API</NativeSelectOption>
                    </NativeSelect>
                    <FieldDescription>{t('connections.form.protocolDescription', { defaultValue: 'Choose the API your endpoint implements. Not every OpenAI-compatible endpoint supports both.' })}</FieldDescription>
                  </Field>
                )}
              </form.Field>
              <form.Field name="model">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{t('connections.form.optionalModel', { defaultValue: 'Model ID (optional)' })}</FieldLabel>
                    <Input id={field.name} name={field.name} value={field.state.value} autoComplete="off" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                    <FieldDescription>{t('connections.form.optionalModelDescription', { defaultValue: 'Leave empty to use a model returned by the endpoint.' })}</FieldDescription>
                  </Field>
                )}
              </form.Field>
            </>
          )}
          <form.Field name="apiKey">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{t('connections.form.apiKey')}</FieldLabel>
                  <Input id={field.name} name={field.name} type="password" value={field.state.value} aria-invalid={isInvalid} autoComplete="off" autoFocus={!custom} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
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
