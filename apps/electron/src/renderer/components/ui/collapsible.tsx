import * as React from "react"
import {
  Collapsible,
  CollapsibleContent as DsCollapsibleContent,
  CollapsibleTrigger as DsCollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { motion, AnimatePresence } from "motion/react"
import { asChildProps } from "./as-child"

type AsChild = { asChild?: boolean }

function CollapsibleTrigger(props: React.ComponentProps<typeof DsCollapsibleTrigger> & AsChild) {
  const rest = asChildProps(props)
  const tag = React.isValidElement(rest.render) ? rest.render.type : "button"
  return <DsCollapsibleTrigger nativeButton={tag === "button"} {...rest} />
}

function CollapsibleContent(props: React.ComponentProps<typeof DsCollapsibleContent> & AsChild) {
  return <DsCollapsibleContent {...asChildProps(props)} />
}

// Spring config - snappy, no bounce
const springTransition = {
  type: "spring" as const,
  stiffness: 1400,
  damping: 75,
}

interface AnimatedCollapsibleContentProps {
  isOpen: boolean
  children: React.ReactNode
  className?: string
}

/**
 * AnimatedCollapsibleContent - Motion-powered collapsible content
 *
 * Uses spring physics to animate height (0 → auto) and opacity.
 * Motion handles height: "auto" natively, which CSS cannot do.
 */
function AnimatedCollapsibleContent({
  isOpen,
  children,
  className
}: AnimatedCollapsibleContentProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={springTransition}
          className={className}
          style={{ clipPath: "inset(0 -20px)" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  AnimatedCollapsibleContent,
  springTransition,
}
