import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { keySetup, OPENAI_LABEL, uniqueSlug, type ConnectionKind, type KeyFormValues } from '@/components/onboarding/connection-kinds'

export type SetupStep = 'choose' | ConnectionKind

interface Options {
  /** The slugs of every connection the person sees: a new one never takes one of them. */
  existingSlugs: ReadonlySet<string>
  onSaved: () => void
  onFinish: () => void
  /** Back from the first step. */
  onDismiss?: () => void
}

export function useConnectionSetup({ existingSlugs, onSaved, onFinish, onDismiss }: Options) {
  const { t } = useTranslation()
  const [step, setStep] = useState<SetupStep>('choose')
  const saved = useCallback(() => {
    onSaved()
    onFinish()
  }, [onSaved, onFinish])

  /** Saves a setup and returns what went wrong, or null. */
  const setup = useCallback(async (payload: Parameters<typeof window.electronAPI.setupLlmConnection>[0]): Promise<string | null> => {
    try {
      const result = await window.electronAPI.setupLlmConnection(payload)
      return result.success ? null : result.error || t('connections.saveFailed')
    } catch (cause) {
      return cause instanceof Error ? cause.message : t('connections.saveFailed')
    }
  }, [t])

  const back = useCallback(() => {
    if (step === 'choose') return onDismiss?.()
    setStep('choose')
  }, [step, onDismiss])

  const select = useCallback((kind: ConnectionKind) => setStep(kind), [])

  /** Tests the key, then saves; returns what went wrong, for the form to show. */
  const connectKey = useCallback(async (values: KeyFormValues): Promise<string | null> => {
    const { test, setup: payload } = keySetup('openai', values, { slug: uniqueSlug('openai', existingSlugs), title: OPENAI_LABEL })
    try {
      const tested = await window.electronAPI.testLlmConnectionSetup(test)
      if (!tested.success) return tested.error || t('connections.testFailed')
    } catch (cause) {
      return cause instanceof Error ? cause.message : t('connections.testFailed')
    }
    const failure = await setup(payload)
    if (!failure) saved()
    return failure
  }, [setup, existingSlugs, t, saved])

  return { step, back, select, connectKey }
}
