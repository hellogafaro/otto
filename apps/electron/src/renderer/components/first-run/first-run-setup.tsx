/**
 * FirstRunSetup - what someone does before the app opens, rendered instead of the shell (no sidebar):
 * name a workspace when they have none, then, as its owner, connect an AI provider (or skip it).
 * `getFirstRunStep` decides which step, if any.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from '@tanstack/react-form'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { toast } from '@workspace/ui/components/sonner'
import { OnboardingWizard, StepFormLayout } from '@/components/onboarding'
import { AddWorkspacePage } from '@/components/workspace/primitives'
import { useCurrentUser } from '@/hooks/use-current-user'
import { submitForm } from '@/lib/form'
import type { FirstRunStep } from './first-run-step'

export function FirstRunSetup({ step, onWorkspaceCreated, onConfigSaved, onDone }: {
  step: FirstRunStep
  onWorkspaceCreated: (workspaceId: string) => void
  /** A connection was saved (refresh what lists connections). */
  onConfigSaved: () => void
  /** Connected or skipped: open the app. */
  onDone: () => void
}) {
  if (step === 'workspace') return <WorkspaceStep onCreated={onWorkspaceCreated} />
  return <ConnectionStep onConfigSaved={onConfigSaved} onDone={onDone} />
}

function WorkspaceStep({ onCreated }: { onCreated: (workspaceId: string) => void }) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const firstName = user?.name.split(/\s+/)[0]
  const defaultName = firstName ? t('setup.workspace.defaultName', { name: firstName }) : ''
  return (
    <AddWorkspacePage className="h-dvh">
      <StepFormLayout title={t('setup.workspace.title')} description={t('setup.workspace.description')}>
        {/* The name arrives a moment after the first paint: the form starts again with it. */}
        <WorkspaceForm key={defaultName} defaultName={defaultName} onCreated={onCreated} />
      </StepFormLayout>
    </AddWorkspacePage>
  )
}

function WorkspaceForm({ defaultName, onCreated }: { defaultName: string; onCreated: (workspaceId: string) => void }) {
  const { t } = useTranslation()
  const required = ({ value }: { value: string }) => (value.trim() ? undefined : t('common.required'))
  const form = useForm({
    defaultValues: { name: defaultName },
    onSubmit: async ({ value }) => {
      try {
        const workspace = await window.electronAPI.createServerWorkspace(value.name.trim())
        onCreated(workspace.id)
      } catch {
        toast.error(t('setup.workspace.createFailed'))
      }
    },
  })

  return (
    <form onSubmit={(event) => submitForm(event, form)} className="flex flex-col gap-3">
      <form.Field
        name="name"
        validators={{ onBlur: required, onSubmit: required }}
      >
        {(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={isInvalid}>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                placeholder={t('workspace.nameLabel')}
                aria-label={t('workspace.nameLabel')}
                aria-invalid={isInvalid}
                autoComplete="off"
                autoFocus
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {isInvalid && <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />}
            </Field>
          )
        }}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="w-full" loading={isSubmitting}>
            {t('workspace.createWorkspace')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}

const NO_SLUGS: ReadonlySet<string> = new Set()

function ConnectionStep({ onConfigSaved, onDone }: { onConfigSaved: () => void; onDone: () => void }) {
  // "Skip for now" is remembered for the whole server (`setupDeferred`), so it is not asked again.
  const skip = useCallback(async () => {
    await window.electronAPI.deferSetup().catch((error: unknown) => console.error('[FirstRun] Failed to defer setup:', error))
    onDone()
  }, [onDone])

  return (
    // The first run has no connections yet, and its connection is the person's own
    <OnboardingWizard existingSlugs={NO_SLUGS} canShare={false} onSaved={onConfigSaved} onFinish={onDone} onSkip={skip} />
  )
}
