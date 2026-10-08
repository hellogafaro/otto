import { cn } from '@/lib/utils'
import { useConnectionSetup } from '@/hooks/use-connection-setup'
import { ChooseConnectionStep } from './choose-connection-step'
import { KeyConnectionStep } from './key-connection-step'

export function OnboardingWizard({
  existingSlugs,
  canShare,
  onSaved,
  onFinish,
  onBack,
  onSkip,
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
  className?: string
}) {
  const flow = useConnectionSetup({ existingSlugs, onSaved, onFinish, onDismiss: onBack })

  const renderStep = () => {
    switch (flow.step) {
      case 'choose':
        return <ChooseConnectionStep onSelect={(kind) => void flow.select(kind)} onSkip={onSkip} />
      case 'openai':
        return <KeyConnectionStep canShare={canShare} onSubmit={flow.connectKey} onBack={flow.back} />
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
