import * as React from 'react'
import {
  Tooltip as DSTooltip,
  TooltipContent,
  TooltipProvider as DSTooltipProvider,
  TooltipTrigger as DSTooltipTrigger,
} from '@workspace/ui/components/tooltip'
import { asChildProps } from '../lib/as-child'

/**
 * Adapter over the design-system Tooltip (Base UI). Keeps the Radix-shaped API:
 * `asChild` on TooltipTrigger, `delayDuration` on TooltipProvider and Tooltip.
 *
 * Base UI tooltips work without a provider (a provider only shares the delay
 * between neighbouring tooltips), so call sites do not need one; the app root
 * still mounts one in App.tsx.
 */

const DelayContext = React.createContext<number | undefined>(undefined)

function TooltipProvider({
  delayDuration,
  delay,
  ...props
}: React.ComponentProps<typeof DSTooltipProvider> & { delayDuration?: number }) {
  return <DSTooltipProvider delay={delay ?? delayDuration} {...props} />
}

function Tooltip({
  delayDuration,
  ...props
}: React.ComponentProps<typeof DSTooltip> & { delayDuration?: number }) {
  return (
    <DelayContext.Provider value={delayDuration}>
      <DSTooltip {...props} />
    </DelayContext.Provider>
  )
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DSTooltipTrigger> & { asChild?: boolean }) {
  const delay = React.useContext(DelayContext)
  return <DSTooltipTrigger delay={delay} {...asChildProps({ asChild, children, ...props })} />
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
