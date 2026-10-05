import { providerIcons } from '@/lib/provider-icons'
import { cn } from '@/lib/utils'

// Claude is the one bundled logo with its own color; favicons and any
// other URL keep theirs. The rest are single-color marks, drawn as a mask in
// the text color so they follow light and dark.
const COLORED = new Set<string>([providerIcons.anthropic])

interface ProviderLogoProps extends React.ComponentProps<'span'> {
  /** Icon URL from `getProviderIcon` */
  src: string
  /** Pixel size; omit for the 14px icon token (`size-3.5`), or size with `className` */
  size?: number
}

export function ProviderLogo({ src, size, className, style, ...props }: ProviderLogoProps) {
  const box = size ? { width: size, height: size } : undefined
  if (COLORED.has(src) || src.startsWith('http')) {
    return <img src={src} alt="" aria-hidden className={cn('size-3.5 shrink-0 rounded-xs', className)} style={{ ...box, ...style }} {...(props as object)} />
  }
  // Small SVGs are inlined as data URIs, which need the quotes.
  const mask = `url(${JSON.stringify(src)})`
  return (
    <span
      aria-hidden
      {...props}
      className={cn('inline-block size-3.5 shrink-0 bg-current', className)}
      style={{
        ...box,
        ...style,
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
