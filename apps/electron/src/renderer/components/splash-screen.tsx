import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Logo } from '@workspace/ui/components/logo'

interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
}

/**
 * The foreground-colored Otto mark pressed into the page (see DESIGN.md, Logo):
 * the glyph is a faint tint of the page, a soft shadow falls inside its top-left
 * edges and a 1px highlight catches the page just outside its bottom-right ones.
 * The same filter is inlined in the pre-load loader of both index.html files, so
 * keep their values in step.
 */
function DebossedLogo() {
  const id = `deboss-${useId().replace(/:/g, '')}`
  return (
    <div className="[--deboss-fill:color-mix(in_srgb,var(--foreground)_8%,transparent)] [--deboss-highlight:rgb(255_255_255/0.6)] [--deboss-shadow:rgb(0_0_0/0.22)] dark:[--deboss-fill:color-mix(in_srgb,var(--foreground)_6%,transparent)] dark:[--deboss-highlight:rgb(255_255_255/0.1)] dark:[--deboss-shadow:rgb(0_0_0/0.6)]">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceAlpha" dx="1" dy="1" result="shifted" />
          <feComposite in="shifted" in2="SourceAlpha" operator="out" result="edge" />
          <feFlood style={{ floodColor: 'var(--deboss-highlight)' }} />
          <feComposite in2="edge" operator="in" result="highlight" />
          <feComponentTransfer in="SourceAlpha" result="outside">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feGaussianBlur in="outside" stdDeviation="0.8" />
          <feOffset dx="0.8" dy="0.8" result="cast" />
          <feFlood style={{ floodColor: 'var(--deboss-shadow)' }} />
          <feComposite in2="cast" operator="in" />
          <feComposite in2="SourceAlpha" operator="in" result="inner" />
          <feFlood style={{ floodColor: 'var(--deboss-fill)' }} />
          <feComposite in2="SourceAlpha" operator="in" result="fill" />
          <feMerge>
            <feMergeNode in="fill" />
            <feMergeNode in="inner" />
            <feMergeNode in="highlight" />
          </feMerge>
        </filter>
      </svg>
      <Logo
        className="h-auto w-10 overflow-visible text-foreground"
        style={{ filter: `url(#${id})` }}
      />
    </div>
  )
}

/**
 * SplashScreen - Shows the debossed Otto mark during app initialization
 *
 * Displays the centered mark on the app background. When the app is ready the
 * mark fades out with a slight scale-up while the background fades slower.
 * The entrance is the pre-load loader's fade (index.html), which draws the same
 * mark in the same place, so the splash starts fully visible.
 */
export function SplashScreen({ isExiting, onExitComplete }: SplashScreenProps) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className="fixed inset-0 z-splash flex items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (isExiting && onExitComplete) {
          onExitComplete()
        }
      }}
    >
      <motion.div
        initial={{ scale: 1, opacity: 1 }}
        animate={{
          scale: isExiting && !reduceMotion ? 1.04 : 1,
          opacity: isExiting ? 0 : 1
        }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <DebossedLogo />
      </motion.div>
    </motion.div>
  )
}
