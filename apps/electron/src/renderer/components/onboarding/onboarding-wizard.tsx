import { cn } from '@/lib/utils'
import { useConnectionSetup } from '@/hooks/use-connection-setup'
import { ChooseConnectionStep } from './choose-connection-step'
import { ClaudeSubscriptionStep } from './claude-subscription-step'
import { DeviceCodeStep, type DeviceCodeProvider } from './device-code-step'
import { GitBashWarning } from './git-bash-warning'
import { KeyConnectionStep } from './key-connection-step'

/**
 * OnboardingWizard: the full-screen flow that connects an AI provider (first-run setup and Settings -> AI): choose
 * a Claude subscription, an Anthropic API key, ChatGPT, another provider's key or a custom endpoint, then that
 * connection's form. With `reauth` it opens on the device-code step of a connection that is signed out.
 */
export function OnboardingWizard({
  existingSlugs,
  canShare,
  onSaved,
  onFinish,
  onBack,
  onSkip,
  reauth,
  className,
}: {
  /** The slugs of every connection the person sees. */
  existingSlugs: ReadonlySet<string>
  /** An owner may make a key connection the workspace's. */
  canShare: boolean
  /** A connection was saved (and tested): refresh what lists connections. */
  onSaved: () => void
  /** The flow is over. */
  onFinish: () => void
  /** Back from the first step (Settings closes; the first run has no back). */
  onBack?: () => void
  /** "Skip for now" (first run only). */
  onSkip?: () => void
  reauth?: { slug: string; provider: DeviceCodeProvider }
  className?: string
}) {
  const flow = useConnectionSetup({ existingSlugs, onSaved, onFinish, onDismiss: onBack, reauth })

  const renderStep = () => {
    switch (flow.step) {
      case 'choose':
        return <ChooseConnectionStep onSelect={(kind) => void flow.select(kind)} onSkip={onSkip} />
      case 'git-bash':
        return (
          <GitBashWarning
            status={flow.gitBash!}
            onBrowse={flow.browseGitBash}
            onUsePath={(path) => void flow.applyGitBashPath(path)}
            onRecheck={() => void flow.recheckGitBash()}
            onBack={flow.back}
            isRechecking={flow.recheckingGitBash}
            errorMessage={flow.error}
            onClearError={flow.clearError}
          />
        )
      case 'claude-code':
        return <ClaudeSubscriptionStep saving={flow.saving} errorMessage={flow.error} onConnect={() => void flow.connectClaude()} onBack={flow.back} />
      case 'anthropic':
      case 'provider':
      case 'custom':
        return <KeyConnectionStep key={flow.step} kind={flow.step} canShare={canShare} onSubmit={(values, label) => flow.connectKey(flow.step as 'anthropic' | 'provider' | 'custom', values, label)} onBack={flow.back} />
      case 'openai-codex':
      case 'github-copilot': {
        const provider = flow.step === 'openai-codex' ? 'chatgpt' : 'copilot'
        return (
          <DeviceCodeStep
            provider={provider}
            status={flow.signIn.status}
            errorMessage={flow.signIn.error}
            deviceCode={flow.signIn.deviceCode}
            onSignIn={() => void flow.connectDeviceCode(provider)}
            onCancel={() => flow.cancelDeviceCode(provider)}
          />
        )
      }
    }
  }

  return (
    <div className={cn('overflow-y-auto bg-background text-foreground', !className?.includes('h-full') && 'h-dvh', className)}>
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content: min-h-full + flex center means: center when content fits,
          natural flow + scroll when content is taller than the viewport (mobile). */}
      <main className="flex min-h-full items-center justify-center p-4 sm:p-8">{renderStep()}</main>
    </div>
  )
}
