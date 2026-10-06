/** VisualViewport and DOMRects share layout CSS pixels. CSS `zoom` is a separate
 * conversion into component CSS pixels; VisualViewport already accounts for pinch
 * scale, so never multiply/divide its dimensions by `scale` a second time. */
export interface InputViewportRect {
  top: number
  left: number
  width: number
  height: number
  cssZoom: number
}

interface ViewportHost {
  innerWidth: number
  innerHeight: number
  visualViewport?: Pick<VisualViewport, 'width' | 'height' | 'offsetTop' | 'offsetLeft' | 'scale'> | null
}

export function getRootCssZoom(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1
  const zoom = Number.parseFloat(window.getComputedStyle(document.documentElement).zoom)
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

export function getViewportRect(
  host: ViewportHost | undefined = typeof window === 'undefined' ? undefined : window,
  cssZoom = getRootCssZoom(),
): InputViewportRect {
  const visual = host?.visualViewport
  return {
    top: visual?.offsetTop ?? 0,
    left: visual?.offsetLeft ?? 0,
    width: visual?.width ?? host?.innerWidth ?? 0,
    height: visual?.height ?? host?.innerHeight ?? 0,
    cssZoom: Number.isFinite(cssZoom) && cssZoom > 0 ? cssZoom : 1,
  }
}

/** The smallest height the visible viewport loses to count as an on-screen keyboard (browser toolbars are smaller). */
const KEYBOARD_MIN = 120

/** The on-screen keyboard's height: what the visible viewport lost against the layout one, 0 while pinch-zoomed (a zoom is no keyboard). */
export function getKeyboardHeight(host: ViewportHost | undefined = typeof window === 'undefined' ? undefined : window): number {
  const visual = host?.visualViewport
  if (!host || !visual || visual.scale > 1.01) return 0
  const lost = host.innerHeight - visual.height
  return lost >= KEYBOARD_MIN ? lost : 0
}

/**
 * Where a menu above a caret sits: `left` and `bottom` for a `fixed` box inside the (zoomed) root, `maxWidth` so it
 * fits the visible width. The caret's rect is in layout pixels and a zoomed box multiplies its own, so both are divided.
 */
export function placeMenuAbove(
  anchor: { x: number; y: number },
  width: number,
  host: ViewportHost | undefined = typeof window === 'undefined' ? undefined : window,
  cssZoom = getRootCssZoom(),
): { left: number; bottom: number; maxWidth: number } {
  const visible = getViewportRect(host, cssZoom)
  const maxWidth = Math.min(width, (visible.width - 16) / visible.cssZoom)
  const left = Math.max(8, Math.min(anchor.x - 10, visible.left + visible.width - maxWidth * visible.cssZoom - 8))
  return { left: left / visible.cssZoom, bottom: ((host?.innerHeight ?? 0) - anchor.y + 8) / visible.cssZoom, maxWidth }
}

/** Intersect physical bounds first, then convert once and reserve local UI space.
 * Parent bounds should be the stable panel content box (already inside safe-area
 * padding), NOT the composer's own height, which would create a resize loop. */
export function getInputAvailableHeight(
  viewport: InputViewportRect,
  parent?: { top: number; bottom: number },
  reservedHeight = 0,
): number {
  const top = Math.max(viewport.top, parent?.top ?? viewport.top)
  const bottom = Math.min(viewport.top + viewport.height, parent?.bottom ?? Infinity)
  return Math.max(0, Math.floor((bottom - top) / viewport.cssZoom - reservedHeight))
}

/** Read stable panel and outer-zone geometry. Insets on #root are safe areas;
 * child chat panels are already inside those insets, so do not subtract twice. */
export function measureInputAvailableHeight(element: HTMLElement): number {
  const viewport = getViewportRect()
  const bounds = element.closest<HTMLElement>('[data-focus-zone="chat"], [data-composer-bounds], #root')
  const rect = bounds?.getBoundingClientRect()
  const style = bounds ? window.getComputedStyle(bounds) : undefined
  const pixels = (value: string | undefined) => Number.parseFloat(value ?? '') || 0
  const parentBounds = rect ? {
    top: rect.top + (pixels(style?.paddingTop) + pixels(style?.borderTopWidth)) * viewport.cssZoom,
    bottom: rect.bottom - (pixels(style?.paddingBottom) + pixels(style?.borderBottomWidth)) * viewport.cssZoom,
  } : undefined
  const inputRect = element.getBoundingClientRect()
  const zoneRect = element.parentElement?.getBoundingClientRect()
  const outsideInput = zoneRect
    ? Math.max(0, zoneRect.height - inputRect.height) / viewport.cssZoom
    : 0
  // Keep a small transcript gap in addition to the actual badges/zone padding.
  return getInputAvailableHeight(viewport, parentBounds, outsideInput + 16)
}

type ViewportEventHost = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  visualViewport?: Pick<VisualViewport, 'addEventListener' | 'removeEventListener'> | null
}

/** Shared by React input sizing and the WebUI host. Callers coalesce layout reads. */
export function subscribeViewportChanges(host: ViewportEventHost, update: () => void): () => void {
  host.addEventListener('resize', update)
  host.addEventListener('orientationchange', update)
  const visual = host.visualViewport
  visual?.addEventListener('resize', update)
  visual?.addEventListener('scroll', update)
  return () => {
    host.removeEventListener('resize', update)
    host.removeEventListener('orientationchange', update)
    visual?.removeEventListener('resize', update)
    visual?.removeEventListener('scroll', update)
  }
}
