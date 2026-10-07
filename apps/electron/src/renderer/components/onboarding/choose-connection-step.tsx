import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
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
  const [nativeOnly, setNativeOnly] = useState<boolean | null>(null)
  useEffect(() => {
    window.electronAPI.getPiApiKeyProviders().then((providers) => setNativeOnly(providers.length === 1 && providers[0]?.key === 'openai')).catch(() => setNativeOnly(null))
  }, [])
  const rows: Record<OfferedKind, { title: string; description: string }> = {
    'claude-code': { title: t('connections.add.claudeCode.title'), description: t('connections.add.claudeCode.description') },
    anthropic: { title: t('connections.add.anthropic.title'), description: t('connections.add.anthropic.description') },
    'openai-codex': { title: t('connections.add.chatgpt.title'), description: t('connections.add.chatgpt.description') },
    provider: { title: t('connections.add.provider.title'), description: t('connections.add.provider.description') },
    custom: { title: t('connections.add.custom.title'), description: t('connections.add.custom.description') },
  }

  return (
    <StepFormLayout title={t('setup.connection.title')} description={nativeOnly ? t('connections.form.apiKey') : nativeOnly === null ? '' : t('setup.connection.description')}>
      <SettingsCard>
        {(nativeOnly === null ? [] : nativeOnly ? ['provider'] as const : OFFERED_KINDS).map((kind) => (
          <SettingsRow key={kind} icon={nativeOnly ? <ProviderLogo src={providerIcons.openai} /> : ICONS[kind]} label={nativeOnly ? 'OpenAI' : rows[kind].title} description={nativeOnly ? t('connections.form.apiKey') : rows[kind].description} onClick={() => onSelect(kind)}>
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
