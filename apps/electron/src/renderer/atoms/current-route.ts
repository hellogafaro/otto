/**
 * The open view's route: the one place the navigation state comes from. Navigation
 * writes it (`navigate()` in the navigation context); everything else reads the
 * parsed state with `useNavigationState()` or the session id here.
 */

import { atom } from 'jotai'
import type { ViewRoute } from '../../shared/routes'

export const currentRouteAtom = atom<ViewRoute | null>(null)

export function parseSessionIdFromRoute(route: string): string | null {
  // Strip any query string first — a `?x=y` tail on the last segment would otherwise
  // leak into the extracted session id and poison every current-session consumer.
  const segments = route.split('?')[0].split('/')
  const idx = segments.indexOf('session')
  if (idx >= 0 && idx + 1 < segments.length) {
    return segments[idx + 1]
  }
  return null
}

/** The session open in the page card, if the view is a chat. */
export const currentSessionIdAtom = atom((get) => {
  const route = get(currentRouteAtom)
  return route ? parseSessionIdFromRoute(route) : null
})
