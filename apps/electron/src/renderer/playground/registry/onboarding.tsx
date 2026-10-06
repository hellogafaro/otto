import type { ComponentEntry } from './types'
import { ProviderSelectStep } from '@/components/onboarding/provider-select-step'
import { CredentialsStep } from '@/components/onboarding/credentials-step'
import { GitBashWarning, type GitBashStatus } from '@/components/onboarding/git-bash-warning'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import type { OnboardingState } from '@/components/onboarding/onboarding-wizard'

const createOnboardingState = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  step: 'provider-select',
  credentialStatus: 'idle',
  apiSetupMethod: null,
  gitBashStatus: { found: false, path: null, platform: 'win32' },
  isRecheckingGitBash: false,
  ...overrides,
})

const noopHandler = () => console.log('[Playground] Action triggered')

export const onboardingComponents: ComponentEntry[] = [
  {
    id: 'provider-select-step',
    name: 'ProviderSelectStep',
    category: 'Onboarding',
    description: 'Connect an AI provider: pick your subscription or API key (first run and Settings)',
    component: ProviderSelectStep,
    props: [],
    variants: [],
    mockData: () => ({
      onSelect: (choice: string) => console.log('[Playground] Provider selected:', choice),
      onSkip: () => console.log('[Playground] Setup deferred'),
    }),
  },
  {
    id: 'credentials-step-api-key',
    name: 'Credentials - API Key',
    category: 'Onboarding',
    description: 'API key + optional Base URL and Model for compatible APIs',
    component: CredentialsStep,
    props: [
      {
        name: 'status',
        description: 'Credential validation status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Idle', props: { apiSetupMethod: 'pi_api_key', status: 'idle' } },
      { name: 'Validating', props: { apiSetupMethod: 'pi_api_key', status: 'validating' } },
      { name: 'Success', props: { apiSetupMethod: 'pi_api_key', status: 'success' } },
      { name: 'Error', props: { apiSetupMethod: 'pi_api_key', status: 'error', errorMessage: 'Invalid API key. Please check and try again.' } },
    ],
    mockData: () => ({
      apiSetupMethod: 'pi_api_key',
      onSubmit: (data: { apiKey: string; baseUrl?: string; connectionDefaultModel?: string; models?: string[] }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'credentials-step-claude-code',
    name: 'Credentials - Claude subscription',
    category: 'Onboarding',
    description: 'Claude subscription through the user\'s own Claude Code sign-in (nothing to enter)',
    component: CredentialsStep,
    props: [
      {
        name: 'status',
        description: 'Save status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Idle', props: { apiSetupMethod: 'claude_code', status: 'idle' } },
      { name: 'Validating', props: { apiSetupMethod: 'claude_code', status: 'validating' } },
      { name: 'Error', props: { apiSetupMethod: 'claude_code', status: 'error', errorMessage: 'Failed to save connection.' } },
    ],
    mockData: () => ({
      apiSetupMethod: 'claude_code',
      onSubmit: (data: { apiKey: string }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'credentials-step-copilot',
    name: 'Credentials - Copilot',
    category: 'Onboarding',
    description: 'GitHub Copilot OAuth device flow authentication',
    component: CredentialsStep,
    props: [
      {
        name: 'status',
        description: 'OAuth status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Initial', props: { apiSetupMethod: 'pi_copilot_oauth', status: 'idle' } },
      {
        name: 'Device Code Shown',
        props: {
          apiSetupMethod: 'pi_copilot_oauth',
          status: 'validating',
          deviceCode: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' },
        },
      },
      { name: 'Validating', props: { apiSetupMethod: 'pi_copilot_oauth', status: 'validating' } },
      { name: 'Success', props: { apiSetupMethod: 'pi_copilot_oauth', status: 'success' } },
      {
        name: 'Error',
        props: {
          apiSetupMethod: 'pi_copilot_oauth',
          status: 'error',
          errorMessage: 'Authorization failed. Please try again.',
        },
      },
    ],
    mockData: () => ({
      apiSetupMethod: 'pi_copilot_oauth',
      onSubmit: noopHandler,
      onStartOAuth: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'git-bash-warning',
    name: 'GitBashWarning',
    category: 'Onboarding',
    description: 'Warning screen when Git Bash is not found on Windows',
    component: GitBashWarning,
    props: [
      {
        name: 'isRechecking',
        description: 'Show loading state on re-check button',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'Not Found',
        props: {
          status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
        },
      },
      {
        name: 'Rechecking',
        props: {
          status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
          isRechecking: true,
        },
      },
      {
        name: 'With Suggested Path',
        props: {
          status: { found: false, path: 'C:\\Program Files\\Git\\bin\\bash.exe', platform: 'win32' } as GitBashStatus,
        },
      },
      {
        name: 'With Error',
        props: {
          status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
          errorMessage: 'File does not exist at the specified path',
        },
      },
    ],
    mockData: () => ({
      status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
      onBrowse: async () => {
        console.log('[Playground] Browse clicked')
        return 'C:\\Program Files\\Git\\bin\\bash.exe'
      },
      onUsePath: (path: string) => console.log('[Playground] Use path:', path),
      onRecheck: noopHandler,
      onBack: noopHandler,
      onClearError: noopHandler,
    }),
  },
  {
    id: 'onboarding-wizard',
    name: 'OnboardingWizard',
    category: 'Onboarding',
    description: 'Full-screen flow that connects an AI provider',
    component: OnboardingWizard,
    props: [],
    variants: [
      {
        name: 'Provider Select',
        props: {
          state: createOnboardingState(),
        },
      },
      {
        name: 'Git Bash Warning',
        props: {
          state: createOnboardingState({ step: 'git-bash' }),
        },
      },
      {
        name: 'Git Bash Warning (Rechecking)',
        props: {
          state: createOnboardingState({ step: 'git-bash', isRecheckingGitBash: true }),
        },
      },
      {
        name: 'Credentials - API Key',
        props: {
          state: createOnboardingState({ step: 'credentials', apiSetupMethod: 'anthropic_api_key' }),
        },
      },
      {
        name: 'Credentials - Claude subscription',
        props: {
          state: createOnboardingState({ step: 'credentials', apiSetupMethod: 'claude_code' }),
        },
      },
    ],
    mockData: () => ({
      state: createOnboardingState(),
      className: 'min-h-0 h-full',
      onBack: noopHandler,
      onSelectProvider: (choice: string) => console.log('[Playground] Provider selected:', choice),
      onSelectApiSetupMethod: (method: string) => console.log('[Playground] Selected method:', method),
      onSubmitCredential: (data: { apiKey: string; baseUrl?: string; connectionDefaultModel?: string; models?: string[] }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onFinish: noopHandler,
      onBrowseGitBash: async () => {
        console.log('[Playground] Browse Git Bash clicked')
        return 'C:\\Program Files\\Git\\bin\\bash.exe'
      },
      onUseGitBashPath: (path: string) => console.log('[Playground] Use Git Bash path:', path),
      onRecheckGitBash: noopHandler,
      onClearError: noopHandler,
      onSkipSetup: () => console.log('[Playground] Setup deferred'),
    }),
  },
]
