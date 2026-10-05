import { useTranslation } from "react-i18next"
import { StepFormLayout, ContinueButton } from "./primitives"

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
  /** Whether the app is loading (e.g., checking Git Bash on Windows) */
  isLoading?: boolean
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * Shows different messaging for new vs existing users:
 * - New users: Welcome to Otto
 * - Existing users: Update your API connection settings
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false
}: WelcomeStepProps) {
  const { t } = useTranslation()

  return (
    <StepFormLayout
      title={isExistingUser ? t("onboarding.welcome.updateTitle") : t("onboarding.welcome.title")}
      description={
        isExistingUser
          ? t("onboarding.welcome.updateDescription")
          : t("onboarding.welcome.description")
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full" loading={isLoading}>
          {isExistingUser ? t("onboarding.welcome.continue") : t("onboarding.welcome.getStarted")}
        </ContinueButton>
      }
    />
  )
}
