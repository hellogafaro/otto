// Shared primitives for building step components
export {
  StepFormLayout,
  BackButton,
  ContinueButton,
} from './primitives'

// Individual steps
export { ProviderSelectStep, type ProviderChoice } from './provider-select-step'
export { WelcomeStep } from './welcome-step'
export { APISetupStep, type ApiSetupMethod } from './api-setup-step'
export { CredentialsStep, type CredentialStatus } from './credentials-step'
export { CompletionStep } from './completion-step'
export { LocalModelStep, type LocalModelSubmitData } from './local-model-step'
export { GitBashWarning, type GitBashStatus } from './git-bash-warning'

// Main wizard container
export { OnboardingWizard, type OnboardingState, type OnboardingStep, type LoginStatus } from './onboarding-wizard'

// Re-export all types for convenient import
export type {
  OnboardingStep as OnboardingStepType,
  OnboardingState as OnboardingStateType,
} from './onboarding-wizard'

export type {
  ApiSetupMethod as ApiSetupMethodType,
} from './api-setup-step'

export type {
  CredentialStatus as CredentialStatusType,
} from './credentials-step'
