import { useTranslation } from 'react-i18next'
import { ChevronRight, Server } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { SettingsCard, SettingsRow } from '@/components/settings'
import { ProviderLogo } from '@/components/icons/provider-logo'
import { providerIcons } from '@/lib/provider-icons'
import { StepFormLayout } from './primitives'
import { OFFERED_KINDS, type OfferedKind } from './connection-kinds'

const ICONS: Record<OfferedKind, React.ReactNode> = {
  'claude-code': <ProviderLogo src={providerIcons.anthropic} />,
  anthropic: <ProviderLogo src={providerIcons.anthropic} />,
  'openai-codex': <ProviderLogo src={providerIcons.openai} />,
  provider: <ProviderLogo src={providerIcons.openrouter} />,
  custom: <Server />,
}

/**
 * ChooseConnectionStep: what to connect (first-run setup and Settings -> AI). A row opens its form. Settings has
 * no skip; the first run does.
 */
export function ChooseConnectionStep({ onSelect, onSkip }: { onSelect: (kind: OfferedKind) => void; onSkip?: () => void }) {
  const { t } = useTranslation()
  const rows: Record<OfferedKind, { title: string; description: string }> = {
    'claude-code': { title: t('connections.add.claudeCode.title'), description: t('connections.add.claudeCode.description') },
    anthropic: { title: t('connections.add.anthropic.title'), description: t('connections.add.anthropic.description') },
    'openai-codex': { title: t('connections.add.chatgpt.title'), description: t('connections.add.chatgpt.description') },
    provider: { title: t('connections.add.provider.title'), description: t('connections.add.provider.description') },
    custom: { title: t('connections.add.custom.title'), description: t('connections.add.custom.description') },
  }

  return (
    <StepFormLayout title={t('setup.connection.title')} description={t('setup.connection.description')}>
      <SettingsCard>
        {OFFERED_KINDS.map((kind) => (
          <SettingsRow key={kind} icon={ICONS[kind]} label={rows[kind].title} description={rows[kind].description} onClick={() => onSelect(kind)}>
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
