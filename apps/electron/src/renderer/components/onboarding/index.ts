// Shared primitives for building step components
export {
  StepFormLayout,
  BackButton,
  ContinueButton,
} from './primitives'

// Individual steps
export { ProviderSelectStep, type ProviderChoice } from './provider-select-step'
export { CredentialsStep, type ApiSetupMethod, type CredentialStatus } from './credentials-step'
export { LocalModelStep, type LocalModelSubmitData } from './local-model-step'
export { GitBashWarning, type GitBashStatus } from './git-bash-warning'

// Main wizard container
export { OnboardingWizard, type OnboardingState, type OnboardingStep } from './onboarding-wizard'
