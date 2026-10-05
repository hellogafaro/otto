import { cn } from "@/lib/utils"

/**
 * AddWorkspacePage - the page every workspace screen sits on.
 *
 * The same page as the onboarding wizard: the plain page layer and a centered
 * column (steps bring their own `StepFormLayout`).
 * `action` is a control pinned to the top right of the window.
 */
export function AddWorkspacePage({
  children,
  action,
  className,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-y-auto bg-background text-foreground", className)}>
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />
      {action && (
        <div className="titlebar-no-drag fixed top-2.5 right-4 z-titlebar">{action}</div>
      )}
      <main className="flex min-h-full items-center justify-center p-4 sm:p-8">
        {children}
      </main>
    </div>
  )
}
