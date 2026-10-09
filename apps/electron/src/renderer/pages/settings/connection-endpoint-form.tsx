import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from '@tanstack/react-form'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { NativeSelect, NativeSelectOption } from '@workspace/ui/components/native-select'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { SettingsRow } from '@/components/settings'
import { submitForm } from '@/lib/form'
import type { LlmConnectionWithStatus } from '../../../shared/types'
import { endpointOrigin, endpointSetup, needsStoredKeyConsent, providerFamily, providerFormDefaults } from './provider-connection-form'

export function ConnectionEndpointForm({ connection, onSaved }: { connection: LlmConnectionWithStatus; onSaved: () => void }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const current = useRef(true)
  useEffect(() => { current.current = true; return () => { current.current = false } }, [])
  const family = providerFamily(connection)
  const form = useForm({
    defaultValues: { ...providerFormDefaults(family ?? 'openai', connection), approvedCredentialOrigin: '' },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        const { test, setup } = endpointSetup(connection, value)
        const tested = await window.electronAPI.testLlmConnectionSetup(test)
        if (!current.current) return
        if (!tested.success) return setError(t('connections.testFailed'))
        const saved = await window.electronAPI.setupLlmConnection(setup)
        if (!current.current) return
        if (!saved.success) return setError(t('connections.saveFailed'))
        onSaved()
      } catch (cause) {
        if (current.current) setError(cause instanceof Error ? cause.message : t('connections.saveFailed'))
      }
    },
  })
  if (!family || !connection.id) return null
  return <form noValidate onSubmit={(event) => submitForm(event, form)}>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(busy) => <fieldset disabled={busy}>
      <form.Field name="baseUrl">{(field) => <SettingsRow label={t('connections.form.baseUrl')}>
        <Input aria-label={t('connections.form.baseUrl')} type="url" autoComplete="off" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => { field.handleChange(event.target.value); form.setFieldValue('approvedCredentialOrigin', ''); setError(null) }} />
      </SettingsRow>}</form.Field>
      {family === 'openai' && <form.Field name="api">{(field) => <SettingsRow label={t('connections.form.protocol', { defaultValue: 'API protocol' })}>
        <NativeSelect aria-label={t('connections.form.protocol', { defaultValue: 'API protocol' })} value={field.state.value} onChange={(event) => { field.handleChange(event.target.value as typeof field.state.value); form.setFieldValue('approvedCredentialOrigin', ''); setError(null) }}>
          <NativeSelectOption value="openai-responses">Responses API</NativeSelectOption>
          <NativeSelectOption value="openai-completions">Chat Completions API</NativeSelectOption>
        </NativeSelect>
      </SettingsRow>}</form.Field>}
      <form.Field name="model">{(field) => <SettingsRow label={t('connections.form.optionalModel', { defaultValue: 'Model ID (optional)' })} description={t('connections.form.optionalModelDescription', { defaultValue: 'Leave empty to use a model returned by the endpoint.' })}>
        <Input aria-label={t('connections.form.optionalModel', { defaultValue: 'Model ID (optional)' })} autoComplete="off" value={field.state.value} onChange={(event) => { field.handleChange(event.target.value); form.setFieldValue('approvedCredentialOrigin', ''); setError(null) }} />
      </SettingsRow>}</form.Field>
      <form.Field name="apiKey">{(field) => <SettingsRow label={t('connections.form.apiKey')} description={t('connections.form.keepStoredKey', { defaultValue: 'Leave blank to keep this connection’s stored key.' })}>
        <Input aria-label={t('connections.form.apiKey')} type="password" autoComplete="off" value={field.state.value} onChange={(event) => { field.handleChange(event.target.value); form.setFieldValue('approvedCredentialOrigin', ''); setError(null) }} />
      </SettingsRow>}</form.Field>
      <form.Subscribe selector={(state) => [state.values.baseUrl, state.values.apiKey] as const}>{([baseUrl, apiKey]) => needsStoredKeyConsent(connection, baseUrl, apiKey) && <form.Field name="approvedCredentialOrigin">{(field) => <SettingsRow label={t('connections.form.originConsent', { origin: endpointOrigin(baseUrl) ?? '', defaultValue: 'Send the stored key to {{origin}}?' })}>
        <Checkbox aria-label={t('connections.form.approveOrigin', { defaultValue: 'Approve sending the stored key to this origin' })} checked={field.state.value === endpointOrigin(baseUrl)} onCheckedChange={(checked) => field.handleChange(checked ? endpointOrigin(baseUrl) ?? '' : '')} />
      </SettingsRow>}</form.Field>}</form.Subscribe>
      <SettingsRow label={error ? <span role="alert">{error}</span> : t('connections.form.testAndSave', { defaultValue: 'Test and save endpoint' })}>
        <Button type="submit" loading={busy}>{t('common.save')}</Button>
      </SettingsRow>
    </fieldset>}</form.Subscribe>
  </form>
}
