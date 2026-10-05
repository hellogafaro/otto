import { cn } from "@/lib/utils"
import { AmbientBackdrop } from "../onboarding/AmbientBackdrop"

/**
 * AddWorkspacePage - the page every workspace screen sits on.
 *
 * The same page as the onboarding wizard: background, the ambient dithered
 * backdrop and a centered column (steps bring their own `StepFormLayout`).
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
    <div className={cn("relative overflow-y-auto bg-background", className)}>
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />
      <AmbientBackdrop />
      {/* A soft glow behind the dither, one shade off the background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,color-mix(in_oklab,var(--foreground)_5%,transparent),transparent)]"
      />
      {action && (
        <div className="titlebar-no-drag fixed top-2.5 right-4 z-titlebar">{action}</div>
      )}
      <main className="relative flex min-h-full items-center justify-center p-4 sm:p-8">
        {children}
      </main>
    </div>
  )
}
