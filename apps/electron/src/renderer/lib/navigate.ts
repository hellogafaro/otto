/**
 * Navigation Utilities
 *
 * Provides a unified `navigate()` function for internal navigation.
 * Works by dispatching a custom event that the NavigationContext listens for.
 *
 * Usage:
 *   import { navigate, routes } from '@/lib/navigate'
 *
 *   navigate(routes.tab.settings())
 *   navigate(routes.action.newChat({ agentId: 'claude' }))
 *   navigate(routes.view.allSessions())
 */

import { routes, type Route } from '../../shared/routes'
import { routeStringToLocation, stringifySearch, workspaceSlugFromPathname } from '../router/location'

// Re-export routes for convenience
export { routes }
export type { Route }

// Event name for internal navigation
export const NAVIGATE_EVENT = 'otto-navigate'

/**
 * Navigate to a route
 *
 * This dispatches a custom event that the NavigationContext listens for.
 * Can be called from anywhere in the app.
 */
export function navigate(route: Route): void {
  const event = new CustomEvent(NAVIGATE_EVENT, {
    detail: { route },
    bubbles: true,
  })
  window.dispatchEvent(event)
}

/** The app URL of a view route in the open workspace, as the address bar shows it (Copy link). */
export function routeUrl(route: Route): string {
  const slug = workspaceSlugFromPathname(window.location.pathname) ?? ''
  const location = routeStringToLocation(route, slug)
  return location ? `${window.location.origin}${location.pathname}${stringifySearch(location.search)}` : window.location.href
}
