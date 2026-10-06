/**
 * ChangeKeyDialog: replace the API key of a connection. The new key is tested against the provider first, then
 * it replaces the stored one; the old key is never shown. A form (TanStack Form, validated on blur and on submit).
 */

import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { toast } from '@workspace/ui/components/sonner'
import { useRegisterModal } from '@/context/modal-context'
import { submitForm } from '@/lib/form'
import { CUSTOM_CONNECTION_TYPE } from '@config/llm-connections'
import type { LlmConnectionWithStatus } from '../../../shared/types'

export function ChangeKeyDialog({
  connection,
  onOpenChange,
  onSaved,
}: {
  /** The connection whose key changes; null while the dialog is closed. */
  connection: LlmConnectionWithStatus | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  useRegisterModal(connection !== null, () => onOpenChange(false))
  return (
    <Dialog open={connection !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open: the field starts empty each time. */}
        {connection && <ChangeKey connection={connection} onDone={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function ChangeKey({ connection, onDone, onSaved }: { connection: LlmConnectionWithStatus; onDone: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const schema = z.object({ apiKey: z.string().trim().min(1, t('common.required')) })
  const form = useForm({
    defaultValues: { apiKey: '' },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const apiKey = value.apiKey.trim()
      const custom = connection.type === CUSTOM_CONNECTION_TYPE
      try {
        const tested = await window.electronAPI.testLlmConnectionSetup({
          type: connection.type,
          apiKey,
          ...(custom ? { baseUrl: connection.baseUrl, model: connection.defaultModel, customEndpoint: connection.customEndpoint } : {}),
        })
        if (!tested.success) return setError(tested.error || t('connections.testFailed'))
        const saved = await window.electronAPI.setupLlmConnection({ slug: connection.slug, updateOnly: true, credential: apiKey })
        if (!saved.success) return setError(saved.error || t('connections.saveFailed'))
      } catch (cause) {
        return setError(cause instanceof Error ? cause.message : t('connections.saveFailed'))
      }
      toast.success(t('common.saved'), { id: 'saved' })
      onSaved()
      onDone()
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('connections.changeKey')}</DialogTitle>
        <DialogDescription>{t('connections.changeKeyDescription', { name: connection.name })}</DialogDescription>
      </DialogHeader>
      <form noValidate className="flex flex-col gap-6" onSubmit={(event) => submitForm(event, form)}>
        <FieldGroup>
          <form.Field name="apiKey">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    autoFocus
                    autoComplete="off"
                    value={field.state.value}
                    aria-label={t('connections.form.apiKey')}
                    aria-invalid={isInvalid}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      setError(null)
                      field.handleChange(event.target.value)
                    }}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  {error && <p className="text-xs text-destructive">{error}</p>}
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
                  {t('common.save')}
                </Button>
              </>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </>
  )
}
