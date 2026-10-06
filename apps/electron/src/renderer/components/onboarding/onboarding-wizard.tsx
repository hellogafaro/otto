import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { ProviderSelectStep, type ProviderChoice } from "./provider-select-step"
import { CredentialsStep, type ApiSetupMethod, type CredentialStatus } from "./credentials-step"
import { LocalModelStep, type LocalModelSubmitData } from "./local-model-step"
import { GitBashWarning, type GitBashStatus } from "./git-bash-warning"
import type { ApiKeySubmitData } from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

/** `complete` is not a screen: the wizard hands over to `onFinish` as soon as a connection is saved and tested. */
export type OnboardingStep =
  | 'git-bash'
  | 'provider-select'
  | 'local-model'
  | 'credentials'
  | 'complete'

export interface OnboardingState {
  step: OnboardingStep
  credentialStatus: CredentialStatus
  apiSetupMethod: ApiSetupMethod | null
  errorMessage?: string
  gitBashStatus?: GitBashStatus
  isRecheckingGitBash?: boolean
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onBack: () => void
  onSelectApiSetupMethod: (method: ApiSetupMethod) => void
  onSubmitCredential: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  /** A connection was saved and tested */
  onFinish: () => void

  // Copilot device flow
  deviceCode?: { userCode: string; verificationUri: string }

  // Git Bash (Windows)
  onBrowseGitBash?: () => Promise<string | null>
  onUseGitBashPath?: (path: string) => void
  onRecheckGitBash?: () => void
  onClearError?: () => void

  // Provider select (new flow)
  onSelectProvider?: (choice: ProviderChoice) => void
  /** Called when the person chooses "Skip for now" on provider select (first run only) */
  onSkipSetup?: () => void

  // Local model
  onSubmitLocalModel?: (data: LocalModelSubmitData) => void

  // Edit mode (pre-fill existing connection values)
  editInitialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    customApi?: CustomEndpointApi
  }

  className?: string
}

/**
 * OnboardingWizard - Full-screen flow that connects an AI provider (first-run setup and Settings → AI):
 * Provider Select (Claude / ChatGPT / Copilot / API Key / Local), then Credentials (API key or sign-in)
 * or Local Model; Git Bash first on Windows when it is missing.
 */
export function OnboardingWizard({
  state,
  onBack,
  onSelectApiSetupMethod,
  onSubmitCredential,
  onStartOAuth,
  onFinish,
  // Copilot device flow
  deviceCode,
  // Git Bash (Windows)
  onBrowseGitBash,
  onUseGitBashPath,
  onRecheckGitBash,
  onClearError,
  // Provider select (new flow)
  onSelectProvider,
  onSkipSetup,
  // Local model
  onSubmitLocalModel,
  // Edit mode
  editInitialValues,
  className
}: OnboardingWizardProps) {
  const done = state.step === 'complete'
  useEffect(() => {
    if (done) onFinish()
  }, [done, onFinish])

  const renderStep = () => {
    switch (state.step) {
      case 'git-bash':
        return (
          <GitBashWarning
            status={state.gitBashStatus!}
            onBrowse={onBrowseGitBash!}
            onUsePath={onUseGitBashPath!}
            onRecheck={onRecheckGitBash!}
            onBack={onBack}
            isRechecking={state.isRecheckingGitBash}
            errorMessage={state.errorMessage}
            onClearError={onClearError}
          />
        )

      case 'provider-select':
        return (
          <ProviderSelectStep
            onSelect={onSelectProvider!}
            onSkip={onSkipSetup}
          />
        )

      case 'local-model':
        return (
          <LocalModelStep
            onSubmit={onSubmitLocalModel!}
            onBack={onBack}
            status={state.credentialStatus === 'validating' ? 'validating' : state.credentialStatus === 'error' ? 'error' : 'idle'}
            errorMessage={state.errorMessage}
          />
        )

      case 'credentials':
        return (
          <CredentialsStep
            apiSetupMethod={state.apiSetupMethod!}
            status={state.credentialStatus}
            errorMessage={state.errorMessage}
            onSubmit={onSubmitCredential}
            onStartOAuth={onStartOAuth}
            onBack={onBack}
            editInitialValues={editInitialValues}
            deviceCode={deviceCode}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        "overflow-y-auto bg-background text-foreground",
        !className?.includes('h-full') && "h-dvh",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content — min-h-full + flex center means: center when content fits,
          natural flow + scroll when content is taller than the viewport (mobile). */}
      <main className="flex min-h-full items-center justify-center p-4 sm:p-8">
        {renderStep()}
      </main>
    </div>
  )
}
