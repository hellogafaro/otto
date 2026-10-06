import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { z } from 'zod'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { NativeSelect, NativeSelectOption } from '@workspace/ui/components/native-select'
import { submitForm } from '@/lib/form'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'
import { isHttpUrl, isLoopbackUrl, parseModelList, type KeyFormValues } from './connection-kinds'

/** The three setups that take a key: an Anthropic API key, a provider's key (OpenRouter and the rest), a custom endpoint. */
export type KeyKind = 'anthropic' | 'provider' | 'custom'

const DEFAULT_PROVIDER = 'openrouter'
/** Providers with their own entry in the list, or that sign in with more than a key (Bedrock's IAM keys). */
const NOT_IN_THE_LIST = new Set(['anthropic', 'amazon-bedrock'])

function schemaFor(kind: KeyKind, t: TFunction) {
  const required = t('common.required')
  const base = { provider: z.string(), name: z.string(), baseUrl: z.string(), api: z.enum(['openai-completions', 'anthropic-messages']), apiKey: z.string(), models: z.string(), scope: z.enum(['user', 'workspace']) }
  if (kind === 'anthropic') return z.object({ ...base, apiKey: z.string().trim().min(1, required) })
  if (kind === 'provider') return z.object({ ...base, provider: z.string().min(1, required), apiKey: z.string().trim().min(1, required) })
  return z.object({
    ...base,
    name: z.string().trim().min(1, required),
    baseUrl: z.string().trim().min(1, required).refine(isHttpUrl, t('connections.form.invalidUrl')),
    models: z.string().refine((value) => parseModelList(value).length > 0, required),
  }).superRefine((value, ctx) => {
    // a local server may be keyless; any other endpoint needs its key
    if (!value.apiKey.trim() && !isLoopbackUrl(value.baseUrl)) ctx.addIssue({ code: 'custom', path: ['apiKey'], message: required })
  })
}

/**
 * KeyConnectionStep: the forms of the connections that take a key (TanStack Form, validated on blur and on submit).
 * `onSubmit` tests and saves, and returns what went wrong (shown under the fields) or null when it is done.
 */
export function KeyConnectionStep({
  kind,
  canShare,
  onSubmit,
  onBack,
}: {
  kind: KeyKind
  /** An owner may make the connection the workspace's. */
  canShare: boolean
  onSubmit: (values: KeyFormValues, providerLabel: string) => Promise<string | null>
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<Array<{ key: string; label: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const schema = schemaFor(kind, t)
  const form = useForm({
    defaultValues: { provider: DEFAULT_PROVIDER, name: '', baseUrl: '', api: 'openai-completions', apiKey: '', models: '', scope: 'user' } as KeyFormValues,
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => setError(await onSubmit(value, providers.find((p) => p.key === value.provider)?.label ?? value.provider)),
  })

  useEffect(() => {
    if (kind !== 'provider') return
    window.electronAPI
      .getPiApiKeyProviders()
      .then((list) => {
        const rows = list.filter((p) => !NOT_IN_THE_LIST.has(p.key))
        setProviders(rows)
        if (rows.length && !rows.some((p) => p.key === DEFAULT_PROVIDER)) form.setFieldValue('provider', rows[0]!.key)
      })
      .catch(() => setProviders([]))
  }, [kind, form])

  const title = t(`connections.add.${kind}.title`)
  const keyLabel = kind === 'custom' ? t('connections.form.apiKeyOptional') : t('connections.form.apiKey')

  return (
    <StepFormLayout
      title={title}
      description={t(`connections.form.${kind}Description`)}
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
          {kind === 'provider' && (
            <form.Field name="provider">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t('connections.form.provider')}</FieldLabel>
                  <NativeSelect id={field.name} name={field.name} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)}>
                    {providers.length === 0 && <NativeSelectOption value={field.state.value}>{field.state.value}</NativeSelectOption>}
                    {providers.map((p) => <NativeSelectOption key={p.key} value={p.key}>{p.label}</NativeSelectOption>)}
                  </NativeSelect>
                </Field>
              )}
            </form.Field>
          )}
          {kind === 'custom' && (
            <>
              <form.Field name="name">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>{t('connections.form.name')}</FieldLabel>
                      <Input id={field.name} name={field.name} value={field.state.value} aria-invalid={isInvalid} autoComplete="off" autoFocus onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                      {isInvalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="baseUrl">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>{t('connections.form.baseUrl')}</FieldLabel>
                      <Input id={field.name} name={field.name} type="url" value={field.state.value} placeholder="http://localhost:11434/v1" aria-invalid={isInvalid} autoComplete="off" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                      {isInvalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="api">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>{t('connections.form.protocol')}</FieldLabel>
                    <NativeSelect id={field.name} name={field.name} value={field.state.value} onChange={(event) => field.handleChange(event.target.value as KeyFormValues['api'])}>
                      <NativeSelectOption value="openai-completions">{t('connections.form.protocolOpenai')}</NativeSelectOption>
                      <NativeSelectOption value="anthropic-messages">{t('connections.form.protocolAnthropic')}</NativeSelectOption>
                    </NativeSelect>
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
                  <FieldLabel htmlFor={field.name}>{keyLabel}</FieldLabel>
                  <Input id={field.name} name={field.name} type="password" value={field.state.value} aria-invalid={isInvalid} autoComplete="off" autoFocus={kind !== 'custom'} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          {kind === 'custom' && (
            <form.Field name="models">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t('connections.form.models')}</FieldLabel>
                    <Input id={field.name} name={field.name} value={field.state.value} placeholder="qwen3-coder, llama3.3" aria-invalid={isInvalid} autoComplete="off" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                    {isInvalid ? <FieldError errors={field.state.meta.errors} /> : <p className="text-xs text-muted-foreground">{t('connections.form.modelsHelp')}</p>}
                  </Field>
                )
              }}
            </form.Field>
          )}
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
