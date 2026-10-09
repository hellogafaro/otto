import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { SettingsCard, SettingsRow } from '@/components/settings'
import { ProviderLogo } from '@/components/icons/provider-logo'
import { providerIcons } from '@/lib/provider-icons'
import { StepFormLayout } from './primitives'
import { connectionKindName, OFFERED_KINDS, type OfferedKind } from './connection-kinds'

/**
 * ChooseConnectionStep: what to connect (first-run setup and Settings -> AI). A row opens its form. Settings has
 * no skip; the first run does.
 */
export function ChooseConnectionStep({ onSelect, onSkip }: { onSelect: (kind: OfferedKind) => void; onSkip?: () => void }) {
  const { t } = useTranslation()

  return (
    <StepFormLayout title={t('setup.connection.title')} description={t('connections.form.apiKey')}>
      <SettingsCard>
        {OFFERED_KINDS.map((kind) => (
          <SettingsRow key={kind} icon={<ProviderLogo src={providerIcons[kind]} />} label={connectionKindName(kind)} description={t('connections.form.apiKey')} onClick={() => onSelect(kind)}>
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </SettingsRow>
        ))}
      </SettingsCard>

      {onSkip && (
        <Button variant="ghost" onClick={onSkip} className="mt-2 w-full text-muted-foreground">
          {t('setup.connection.skip')}
        </Button>
      )}
    </StepFormLayout>
  )
}
