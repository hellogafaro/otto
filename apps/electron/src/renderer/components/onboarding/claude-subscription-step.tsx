import { Trans, useTranslation } from 'react-i18next'
import { Check, TriangleAlert, UserRound } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { SettingsCard, SettingsRow } from '@/components/settings'
import { useClaudeCodeStatus } from '@/hooks/use-claude-code-status'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'

/**
 * ClaudeSubscriptionStep: a Claude subscription runs the person's own `claude` and its sign-in, so there is nothing
 * to enter: this shows whether `claude` is there ("Check again" asks again) and connects once it is. Personal only.
 */
export function ClaudeSubscriptionStep({
  saving,
  errorMessage,
  onConnect,
  onBack,
}: {
  saving: boolean
  errorMessage?: string
  onConnect: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { status, checking, check } = useClaudeCodeStatus()
  const found = status?.found === true

  return (
    <StepFormLayout
      title={t('connections.add.claudeCode.title')}
      description={t('connections.add.claudeCode.description')}
      actions={
        <>
          <BackButton onClick={onBack} disabled={saving} />
          <ContinueButton onClick={onConnect} loading={saving} disabled={!found}>
            {t('connections.connect')}
          </ContinueButton>
        </>
      }
    >
      <div className="space-y-3">
        <SettingsCard>
          <SettingsRow
            icon={found ? <Check className="text-success" /> : <TriangleAlert />}
            label={status === null ? t('connections.claudeCode.checking') : found ? t('connections.claudeCode.found') : t('connections.claudeCode.notFound')}
            description={found ? status?.version ?? status?.path : undefined}
          >
            <Button variant="outline" size="compact" loading={checking} onClick={() => void check()}>
              {t('connections.claudeCode.checkAgain')}
            </Button>
          </SettingsRow>
          <SettingsRow icon={<UserRound />} label={t('connections.claudeCode.personal')} description={t('connections.claudeCode.personalDescription')} />
        </SettingsCard>
        {status && !found && (
          <p className="text-xs text-muted-foreground">
            <Trans i18nKey="connections.claudeCode.install" components={{ code: <code className="font-mono" /> }} />
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('connections.claudeCode.terms')}</p>
        {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
      </div>
    </StepFormLayout>
  )
}
