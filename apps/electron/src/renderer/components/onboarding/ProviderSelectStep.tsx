import { useTranslation } from "react-i18next"
import { ChevronRight, Key, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"

import { providerIcons } from "@/lib/provider-icons"
import { ProviderLogo } from "@/components/icons/ProviderLogo"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'claude' | 'chatgpt' | 'copilot' | 'api_key' | 'local'

interface ProviderOption {
  id: ProviderChoice
  name: string
  icon: React.ReactNode
}

const PROVIDER_ICONS: Record<ProviderChoice, React.ReactNode> = {
  claude: <ProviderLogo src={providerIcons.anthropic} className="size-5" />,
  chatgpt: <ProviderLogo src={providerIcons.openai} className="size-5" />,
  copilot: <ProviderLogo src={providerIcons.copilot} className="size-5" />,
  api_key: <Key className="size-5" />,
  local: <Monitor className="size-5" />,
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
      icon: PROVIDER_ICONS.claude,
    },
    {
      id: 'chatgpt',
      name: t("onboarding.providerSelect.codexChatGPT"),
      icon: PROVIDER_ICONS.chatgpt,
    },
    {
      id: 'copilot',
      name: t("onboarding.providerSelect.githubCopilot"),
      icon: PROVIDER_ICONS.copilot,
    },
    {
      id: 'api_key',
      name: t("onboarding.providerSelect.otherProvider"),
      icon: PROVIDER_ICONS.api_key,
    },
    {
      id: 'local',
      name: t("onboarding.providerSelect.localModel"),
      icon: PROVIDER_ICONS.local,
    },
  ]

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-primary" />
        </div>
      }
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
    >
      <SettingsCard>
        {PROVIDER_OPTIONS.map((option) => (
          <SettingsRow
            key={option.id}
            label={
              <span className="flex items-center gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center text-foreground">
                  {option.icon}
                </span>
                {option.name}
              </span>
            }
            onClick={() => onSelect(option.id)}
          >
            <ChevronRight className="size-4 text-muted-foreground" />
          </SettingsRow>
        ))}
      </SettingsCard>

      {onSkip && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground">
            {t("onboarding.providerSelect.setupLater")}
          </Button>
        </div>
      )}
    </StepFormLayout>
  )
}
