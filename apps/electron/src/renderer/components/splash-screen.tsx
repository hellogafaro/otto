import { useId, useLayoutEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Logo } from '@workspace/ui/components/logo'

interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
}

/**
 * The pre-load loader (index.html) fades the same mark in, and React can
 * replace it mid-fade. Its start on the document timeline is read as this
 * module loads, before React takes over, so the splash continues the same fade.
 */
let loaderFadeStart: number | null = null
if (typeof document !== 'undefined') {
  document
    .querySelector('#_loader svg')
    ?.getAnimations()[0]
    ?.ready.then((fade) => { loaderFadeStart = fade.startTime as number | null }, () => {})
}

/**
 * The Otto mark pressed into the page (see DESIGN.md, Logo). The glyph is the
 * floor of the recess: the foreground mixed into the page (35% light, 28% dark),
 * so it stays in the foreground's family. Lit from the top left, the wall casts
 * a soft shadow inside the top-left edges, the bottom-right inner walls catch a
 * bright rim, and in dark a faint light lip sits just outside the bottom-right
 * edges. The pre-load loader of both index.html files inlines the same filter
 * and values, so keep them in step.
 */
function DebossedLogo() {
  const id = `deboss-${useId().replace(/:/g, '')}`
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (loaderFadeStart === null || !ref.current) return
    const fade = ref.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' })
    fade.startTime = loaderFadeStart
  }, [])
  return (
    <div
      ref={ref}
      className="[--deboss-hi:transparent] [--deboss-ink:color-mix(in_srgb,var(--foreground)_35%,var(--background))] [--deboss-rim:rgb(255_255_255/0.9)] [--deboss-shadow:rgb(0_0_0/0.45)] dark:[--deboss-hi:rgb(255_255_255/0.14)] dark:[--deboss-ink:color-mix(in_srgb,var(--foreground)_28%,var(--background))] dark:[--deboss-rim:rgb(255_255_255/0.35)] dark:[--deboss-shadow:rgb(0_0_0/0.75)]"
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feComponentTransfer in="SourceAlpha" result="outside">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feOffset in="outside" dx="1.4" dy="1.4" />
          <feGaussianBlur stdDeviation="0.8" result="cast" />
          <feFlood style={{ floodColor: 'var(--deboss-shadow)' }} />
          <feComposite in2="cast" operator="in" />
          <feComposite in2="SourceAlpha" operator="in" result="shadow" />
          <feOffset in="outside" dx="-0.7" dy="-0.7" />
          <feGaussianBlur stdDeviation="0.35" result="lit" />
          <feFlood style={{ floodColor: 'var(--deboss-rim)' }} />
          <feComposite in2="lit" operator="in" />
          <feComposite in2="SourceAlpha" operator="in" result="rim" />
          <feOffset in="SourceAlpha" dx="0.5" dy="0.5" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="0.25" result="spill" />
          <feFlood style={{ floodColor: 'var(--deboss-hi)' }} />
          <feComposite in2="spill" operator="in" result="lip" />
          <feMerge>
            <feMergeNode in="lip" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shadow" />
            <feMergeNode in="rim" />
          </feMerge>
        </filter>
      </svg>
      <Logo
        className="h-auto w-10 overflow-visible"
        style={{ color: 'var(--deboss-ink)', filter: `url(#${id})` }}
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
 * mark in the same place; the splash continues that fade where it is.
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
