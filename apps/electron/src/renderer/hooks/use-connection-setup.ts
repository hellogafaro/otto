/**
 * The state of the flow that connects an AI provider (first-run setup and Settings -> AI): `choose` what to
 * connect, then that connection's form. Each form's save lives here: a Claude subscription, a key (tested first), a
 * device-code sign-in (ChatGPT; Copilot only to sign an existing connection in again). A save refreshes what lists
 * connections (`onSaved`) and ends the flow (`onFinish`).
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DeviceCodeProvider, DeviceCodeStatus } from '@/components/onboarding/device-code-step'
import { keySetup, typeOfKind, uniqueSlug, type ConnectionKind, type KeyFormValues } from '@/components/onboarding/connection-kinds'
import type { GitBashStatus } from '../../shared/types'

export type SetupStep = 'choose' | 'git-bash' | ConnectionKind

interface Options {
  /** The slugs of every connection the person sees: a new one never takes one of them. */
  existingSlugs: ReadonlySet<string>
  onSaved: () => void
  onFinish: () => void
  /** Back from the first step. */
  onDismiss?: () => void
  /** Sign an existing connection in again: the flow opens on its device-code step. */
  reauth?: { slug: string; provider: DeviceCodeProvider }
}

const CHANNELS = {
  chatgpt: { type: 'openai-codex', kind: 'openai-codex' },
  copilot: { type: 'github-copilot', kind: 'github-copilot' },
} as const

export function useConnectionSetup({ existingSlugs, onSaved, onFinish, onDismiss, reauth }: Options) {
  const { t } = useTranslation()
  const [step, setStep] = useState<SetupStep>(reauth ? CHANNELS[reauth.provider].kind : 'choose')
  const [saving, setSaving] = useState(false)
  const [signIn, setSignIn] = useState<{ status: DeviceCodeStatus; error?: string; deviceCode?: { userCode: string; verificationUri: string } }>({ status: 'idle' })
  const [error, setError] = useState<string | undefined>()
  const [gitBash, setGitBash] = useState<GitBashStatus | undefined>()
  const [recheckingGitBash, setRecheckingGitBash] = useState(false)

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
    setError(undefined)
    if (step === 'choose' || reauth) return onDismiss?.()
    setStep('choose')
  }, [step, reauth, onDismiss])

  /** The Claude subscription needs `claude`, which on Windows needs Git Bash: ask for it first when it is missing. */
  const select = useCallback(async (kind: ConnectionKind) => {
    setError(undefined)
    if (kind === 'claude-code') {
      const status = await window.electronAPI.checkGitBash().catch(() => undefined)
      if (status && status.platform === 'win32' && !status.found) {
        setGitBash(status)
        return setStep('git-bash')
      }
    }
    setStep(kind)
  }, [])

  const connectClaude = useCallback(async () => {
    setSaving(true)
    setError(undefined)
    const failure = await setup({ slug: uniqueSlug('claude-code', existingSlugs), type: typeOfKind('claude-code'), title: t('connections.kind.claudeCode'), scope: 'user' })
    setSaving(false)
    if (failure) setError(failure)
    else saved()
  }, [setup, existingSlugs, t, saved])

  /** Tests the key, then saves; returns what went wrong, for the form to show. */
  const connectKey = useCallback(async (kind: 'anthropic' | 'provider' | 'custom', values: KeyFormValues, providerLabel: string): Promise<string | null> => {
    const title = kind === 'anthropic' ? t('connections.kind.anthropic') : kind === 'custom' ? values.name.trim() : providerLabel
    const base = kind === 'custom' ? 'custom' : typeOfKind(kind, values.provider)
    const { test, setup: payload } = keySetup(kind, values, { slug: uniqueSlug(base, existingSlugs), title })
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

  /** The device-code sign-in: the code is pushed here, the person approves it, then the connection is saved and tested. */
  const connectDeviceCode = useCallback(async (provider: DeviceCodeProvider) => {
    const { type } = CHANNELS[provider]
    const slug = reauth?.slug ?? uniqueSlug(type, existingSlugs)
    setSignIn({ status: 'validating' })
    const api = window.electronAPI
    const stop = provider === 'chatgpt'
      ? api.onChatGptDeviceCode((deviceCode) => setSignIn((s) => ({ ...s, deviceCode })))
      : api.onCopilotDeviceCode((deviceCode) => setSignIn((s) => ({ ...s, deviceCode })))
    try {
      const result = provider === 'chatgpt' ? await api.startChatGptOAuth(slug) : await api.startCopilotOAuth(slug)
      if (!result.success) return setSignIn({ status: result.error === 'Cancelled' ? 'idle' : 'error', error: result.error || t('connections.signInFailed') })
      const failure = await setup(reauth ? { slug, updateOnly: true } : { slug, type, title: t('connections.kind.chatgpt') })
      if (failure) return setSignIn({ status: 'error', error: failure })
      const tested = await api.testLlmConnection(slug)
      if (!tested.success) return setSignIn({ status: 'error', error: tested.error || t('connections.testFailed') })
      setSignIn({ status: 'success' })
      saved()
    } catch (cause) {
      setSignIn({ status: 'error', error: cause instanceof Error ? cause.message : t('connections.signInFailed') })
    } finally {
      stop()
    }
  }, [reauth, existingSlugs, setup, t, saved])

  /** Leave a device-code step: stop a sign-in that is still waiting for approval. */
  const cancelDeviceCode = useCallback((provider: DeviceCodeProvider) => {
    if (signIn.status === 'validating') void (provider === 'chatgpt' ? window.electronAPI.cancelChatGptOAuth() : window.electronAPI.cancelCopilotOAuth())
    setSignIn({ status: 'idle' })
    back()
  }, [signIn.status, back])

  const applyGitBashPath = useCallback(async (path: string) => {
    const result = await window.electronAPI.setGitBashPath(path)
    if (result.success) setStep('claude-code')
    else setError(result.error || t('connections.invalidPath'))
  }, [t])

  const recheckGitBash = useCallback(async () => {
    setRecheckingGitBash(true)
    try {
      const status = await window.electronAPI.checkGitBash()
      setGitBash(status)
      if (status.found) setStep('claude-code')
    } finally {
      setRecheckingGitBash(false)
    }
  }, [])

  return {
    step, saving, signIn, error, gitBash, recheckingGitBash,
    back, select, connectClaude, connectKey, connectDeviceCode, cancelDeviceCode,
    browseGitBash: () => window.electronAPI.browseForGitBash(),
    applyGitBashPath, recheckGitBash, clearError: () => setError(undefined),
  }
}
