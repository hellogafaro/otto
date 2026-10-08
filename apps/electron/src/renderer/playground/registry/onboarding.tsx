import type { ComponentEntry } from './types'
import { ChooseConnectionStep } from '@/components/onboarding/choose-connection-step'
import { KeyConnectionStep } from '@/components/onboarding/key-connection-step'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

const noopHandler = () => console.log('[Playground] Action triggered')

export const onboardingComponents: ComponentEntry[] = [
  {
    id: 'choose-connection-step',
    name: 'ChooseConnectionStep',
    category: 'Onboarding',
    description: 'Connect OpenAI with an API key (first run and Settings)',
    component: ChooseConnectionStep,
    props: [],
    variants: [
      { name: 'Settings', props: {} },
      { name: 'First run (with skip)', props: { onSkip: () => console.log('[Playground] Setup deferred') } },
    ],
    mockData: () => ({ onSelect: (kind: string) => console.log('[Playground] Selected:', kind) }),
  },
  {
    id: 'key-connection-step',
    name: 'KeyConnectionStep',
    category: 'Onboarding',
    description: 'OpenAI API-key form (TanStack Form)',
    component: KeyConnectionStep,
    props: [{ name: 'canShare', description: 'An owner may share it with the workspace', control: { type: 'boolean' }, defaultValue: false }],
    variants: [
      { name: 'OpenAI API key', props: {} },
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
