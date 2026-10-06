import type { ComponentEntry } from './types'
import { ChooseConnectionStep } from '@/components/onboarding/choose-connection-step'
import { ClaudeSubscriptionStep } from '@/components/onboarding/claude-subscription-step'
import { DeviceCodeStep } from '@/components/onboarding/device-code-step'
import { KeyConnectionStep } from '@/components/onboarding/key-connection-step'
import { GitBashWarning, type GitBashStatus } from '@/components/onboarding/git-bash-warning'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

const noopHandler = () => console.log('[Playground] Action triggered')

export const onboardingComponents: ComponentEntry[] = [
  {
    id: 'choose-connection-step',
    name: 'ChooseConnectionStep',
    category: 'Onboarding',
    description: 'Connect an AI provider: a Claude subscription, an Anthropic API key, ChatGPT, another provider or a custom endpoint (first run and Settings)',
    component: ChooseConnectionStep,
    props: [],
    variants: [
      { name: 'Settings', props: {} },
      { name: 'First run (with skip)', props: { onSkip: () => console.log('[Playground] Setup deferred') } },
    ],
    mockData: () => ({ onSelect: (kind: string) => console.log('[Playground] Selected:', kind) }),
  },
  {
    id: 'claude-subscription-step',
    name: 'ClaudeSubscriptionStep',
    category: 'Onboarding',
    description: 'A Claude subscription uses the sign-in of the user\'s own claude: its status and Check again, nothing to enter',
    component: ClaudeSubscriptionStep,
    props: [
      { name: 'saving', description: 'Connecting', control: { type: 'boolean' }, defaultValue: false },
      { name: 'errorMessage', description: 'Error message to display', control: { type: 'string', placeholder: 'Error message' }, defaultValue: '' },
    ],
    variants: [],
    mockData: () => ({ onConnect: noopHandler, onBack: noopHandler }),
  },
  {
    id: 'key-connection-step',
    name: 'KeyConnectionStep',
    category: 'Onboarding',
    description: 'The forms of the connections that take a key (TanStack Form)',
    component: KeyConnectionStep,
    props: [{ name: 'canShare', description: 'An owner may share it with the workspace', control: { type: 'boolean' }, defaultValue: false }],
    variants: [
      { name: 'Anthropic API key', props: { kind: 'anthropic' } },
      { name: 'Other providers', props: { kind: 'provider' } },
      { name: 'Custom endpoint', props: { kind: 'custom' } },
    ],
    mockData: () => ({
      onSubmit: async () => {
        console.log('[Playground] Submit')
        return null
      },
      onBack: noopHandler,
    }),
  },
  {
    id: 'device-code-step',
    name: 'DeviceCodeStep',
    category: 'Onboarding',
    description: 'ChatGPT sign-in with a device code',
    component: DeviceCodeStep,
    props: [
      {
        name: 'status',
        description: 'Sign-in status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Waiting', value: 'validating' },
            { label: 'Connected', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
    ],
    variants: [
      { name: 'Before sign-in', props: { provider: 'chatgpt', status: 'idle' } },
      { name: 'Waiting for approval', props: { provider: 'chatgpt', status: 'validating', deviceCode: { userCode: 'ABCD-1234', verificationUri: 'https://auth.openai.com/codex/device' } } },
    ],
    mockData: () => ({ onSignIn: noopHandler, onCancel: noopHandler }),
  },
  {
    id: 'git-bash-warning',
    name: 'GitBashWarning',
    category: 'Onboarding',
    description: 'Warning screen when Git Bash is not found on Windows',
    component: GitBashWarning,
    props: [{ name: 'isRechecking', description: 'Show loading state on re-check button', control: { type: 'boolean' }, defaultValue: false }],
    variants: [
      { name: 'Not Found', props: { status: { found: false, path: null, platform: 'win32' } as GitBashStatus } },
      { name: 'Rechecking', props: { status: { found: false, path: null, platform: 'win32' } as GitBashStatus, isRechecking: true } },
      { name: 'With Error', props: { status: { found: false, path: null, platform: 'win32' } as GitBashStatus, errorMessage: 'File does not exist at the specified path' } },
    ],
    mockData: () => ({
      status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
      onBrowse: async () => 'C:\\Program Files\\Git\\bin\\bash.exe',
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
      { name: 'Settings', props: {} },
      { name: 'First run', props: { onSkip: () => console.log('[Playground] Setup deferred') } },
    ],
    mockData: () => ({ existingSlugs: new Set<string>(), canShare: false, onSaved: noopHandler, onFinish: noopHandler }),
    layout: 'full',
  },
]
