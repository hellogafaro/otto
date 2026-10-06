import { cn } from "@/lib/utils"
import { Button, type ButtonProps } from "@/components/ui/button"
import { OttoAppIcon } from "@/components/icons/otto-app-icon"

/* =============================================================================
   ONBOARDING PRIMITIVES

   Shared components for consistent styling across all onboarding steps.
   These primitives make it easy to:
   - Change styles globally (one place to update)
   - Maintain consistent spacing and typography
   - Keep step components focused on their logic
============================================================================= */

// =============================================================================
// STEP LAYOUT
// =============================================================================

interface StepFormLayoutProps {
  /** Step title */
  title: string
  /** Step description */
  description?: React.ReactNode
  /** Action buttons at the bottom */
  actions?: React.ReactNode
  /** Form content */
  children?: React.ReactNode
  /** Whether children should grow to fill available space (for scrollable content) */
  grow?: boolean
  /** Whether to fill parent height without max-height limit */
  fillHeight?: boolean
  className?: string
}

/**
 * StepFormLayout - Unified layout for onboarding steps
 *
 * The same left-aligned header as the sign-in page: the colored app icon
 * (40px tile), 20px below it the title (`text-base`, weight 500), 4px below
 * that the muted description, then the content 32px below and the actions.
 */
export function StepFormLayout({
  title,
  description,
  actions,
  children,
  grow = false,
  fillHeight = false,
  className
}: StepFormLayoutProps) {
  return (
    <div className={cn(
      "flex w-full max-w-[28rem] flex-col",
      grow && !fillHeight && "h-full max-h-[600px]",
      fillHeight && "h-full",
      className
    )}>
      <div className="shrink-0">
        <div className="mb-5 flex size-10 items-center">
          <OttoAppIcon />
        </div>
        <h1 className="text-base font-medium">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {children && (
        <div className={cn(
          "mt-8 w-full empty:hidden",
          (grow || fillHeight) && "flex-1 min-h-0"
        )}>
          {children}
        </div>
      )}

      {actions && (
        // The main action on top, Back (or Cancel) under it, both full width
        <div className="mt-6 flex w-full shrink-0 flex-col-reverse gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// BUTTON HELPERS
// =============================================================================

interface BackButtonProps extends Omit<ButtonProps, 'variant' | 'children'> {
  children?: React.ReactNode
}

/**
 * BackButton - Consistent back/cancel button
 */
export function BackButton({ children = 'Back', className, ...props }: BackButtonProps) {
  return (
    <Button variant="ghost" className={cn("w-full", className)} {...props}>
      {children}
    </Button>
  )
}

interface ContinueButtonProps extends Omit<ButtonProps, 'children'> {
  children?: React.ReactNode
}

/**
 * ContinueButton - Consistent primary action button (`loading` keeps the label)
 */
export function ContinueButton({ children = 'Continue', className, ...props }: ContinueButtonProps) {
  return (
    <Button className={cn("w-full", className)} {...props}>
      {children}
    </Button>
  )
}
