import { useTranslation } from "react-i18next"
import { ChevronRight, Key, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { StepFormLayout } from "./primitives"

import { providerIcons } from "@/lib/provider-icons"
import { ProviderLogo } from "@/components/icons/provider-logo"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'claude' | 'chatgpt' | 'copilot' | 'api_key' | 'local'

interface ProviderOption {
  id: ProviderChoice
  name: string
  description: string
  icon: React.ReactNode
}

const PROVIDER_ICONS: Record<ProviderChoice, React.ReactNode> = {
  claude: <ProviderLogo src={providerIcons.anthropic} />,
  chatgpt: <ProviderLogo src={providerIcons.openai} />,
  copilot: <ProviderLogo src={providerIcons.copilot} />,
  api_key: <Key />,
  local: <Monitor />,
}

interface ProviderSelectStepProps {
  /** Called when the user selects a provider */
  onSelect: (choice: ProviderChoice) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
}

/**
 * ProviderSelectStep — First screen after install.
 *
 * Welcomes the user and asks them to pick their subscription / auth method.
 * Selecting a card immediately advances to the next step.
 */
export function ProviderSelectStep({ onSelect, onSkip }: ProviderSelectStepProps) {
  const { t } = useTranslation()

  const PROVIDER_OPTIONS: ProviderOption[] = [
    {
      id: 'claude',
      name: t("onboarding.providerSelect.claudeProMax"),
      description: t("onboarding.providerSelect.claudeProMaxDesc"),
      icon: PROVIDER_ICONS.claude,
    },
    {
      id: 'chatgpt',
      name: t("onboarding.providerSelect.codexChatGPT"),
      description: t("onboarding.providerSelect.codexChatGPTDesc"),
      icon: PROVIDER_ICONS.chatgpt,
    },
    {
      id: 'copilot',
      name: t("onboarding.providerSelect.githubCopilot"),
      description: t("onboarding.providerSelect.githubCopilotDesc"),
      icon: PROVIDER_ICONS.copilot,
    },
    {
      id: 'api_key',
      name: t("onboarding.providerSelect.otherProvider"),
      description: 'Anthropic, Bedrock, OpenRouter, Google and more',
      icon: PROVIDER_ICONS.api_key,
    },
    {
      id: 'local',
      name: t("onboarding.providerSelect.localModel"),
      description: 'Run models locally with Ollama',
      icon: PROVIDER_ICONS.local,
    },
  ]

  return (
    <StepFormLayout
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
    >
      <SettingsCard>
        {PROVIDER_OPTIONS.map((option) => (
          <SettingsRow
            key={option.id}
            icon={option.icon}
            label={option.name}
            description={option.description}
            onClick={() => onSelect(option.id)}
          >
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </SettingsRow>
        ))}
      </SettingsCard>

      {onSkip && (
        <Button variant="ghost" onClick={onSkip} className="mt-2 w-full text-muted-foreground">
          {t("onboarding.providerSelect.setupLater")}
        </Button>
      )}
    </StepFormLayout>
  )
}
