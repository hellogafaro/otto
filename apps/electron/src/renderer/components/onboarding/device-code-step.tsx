import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, Copy } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { SettingsCard, SettingsRow } from '@/components/settings'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'

/** The accounts that sign in with a device code: the person approves the code on any device. */
export type DeviceCodeProvider = 'chatgpt' | 'copilot'

export type DeviceCodeStatus = 'idle' | 'validating' | 'success' | 'error'

/**
 * DeviceCodeStep: ChatGPT (and, to sign an imported connection in again, GitHub Copilot). "Sign in" asks the server
 * for a code and opens the provider's page; the code shows here to copy until it is approved.
 */
export function DeviceCodeStep({
  provider,
  status,
  errorMessage,
  deviceCode,
  onSignIn,
  onCancel,
}: {
  provider: DeviceCodeProvider
  status: DeviceCodeStatus
  errorMessage?: string
  deviceCode?: { userCode: string; verificationUri: string }
  onSignIn: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = provider === 'chatgpt'
    ? {
        title: t('onboarding.credentials.connectChatGPT'),
        description: t('onboarding.credentials.connectChatGPTDesc'),
        signIn: t('onboarding.credentials.signInChatGPT'),
        enterCode: t('onboarding.credentials.enterCodeOnChatGPT'),
        waiting: t('onboarding.credentials.chatGPTInstructions'),
        connected: t('onboarding.credentials.chatGPTConnected'),
      }
    : {
        title: t('onboarding.credentials.connectGitHub'),
        description: t('onboarding.credentials.connectGitHubDesc'),
        signIn: t('onboarding.credentials.signInGitHub'),
        enterCode: t('onboarding.credentials.enterCodeOnGitHub'),
        waiting: t('onboarding.credentials.clickToSignInGitHub'),
        connected: t('onboarding.credentials.copilotConnected'),
      }

  const copyCode = () => {
    if (!deviceCode) return
    navigator.clipboard.writeText(deviceCode.userCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }, () => {})
  }
  // The code is copied as soon as it appears; the button copies it again
  useEffect(() => {
    if (deviceCode?.userCode) copyCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new code copies
  }, [deviceCode?.userCode])

  return (
    <StepFormLayout
      title={copy.title}
      description={copy.description}
      actions={
        <>
          <BackButton onClick={onCancel} />
          <ContinueButton onClick={onSignIn} loading={status === 'validating'}>
            {copy.signIn}
            <ArrowUpRight data-icon="inline-end" />
          </ContinueButton>
        </>
      }
    >
      <div className="space-y-3">
        {deviceCode ? (
          <SettingsCard>
            <SettingsRow label={copy.enterCode}>
              <Button type="button" variant="secondary" onClick={copyCode} className="font-mono tracking-widest">
                {deviceCode.userCode}
                {copied ? <Check data-icon="inline-end" /> : <Copy data-icon="inline-end" />}
              </Button>
            </SettingsRow>
            <SettingsRow label={deviceCode.verificationUri.replace(/^https?:\/\//, '')}>
              <Button type="button" variant="ghost" onClick={() => void window.electronAPI.openUrl(deviceCode.verificationUri)}>
                {t('common.open')}
                <ArrowUpRight data-icon="inline-end" />
              </Button>
            </SettingsRow>
          </SettingsCard>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.waiting}</p>
        )}
        {status === 'error' && errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
        {status === 'success' && <p className="text-xs text-success">{copy.connected}</p>}
      </div>
    </StepFormLayout>
  )
}
