import appIcon from '@/assets/otto-app-icon.png'
import { cn } from '@/lib/utils'

/**
 * The colored Otto app icon as a 40px tile with 9px corners (22.37% of the
 * side, the iOS icon radius) and a hairline ring. It heads the
 * sign-in page and every onboarding step; the black `Logo` mark is for in-app chrome
 * and the splash (debossed).
 */
export function OttoAppIcon({ className }: { className?: string }) {
  return (
    <img
      src={appIcon}
      alt=""
      aria-hidden
      width={40}
      height={40}
      className={cn('size-10 shrink-0 rounded-[9px] ring-1 ring-foreground/10', className)}
    />
  )
}
