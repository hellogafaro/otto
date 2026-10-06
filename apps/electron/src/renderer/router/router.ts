/**
 * The app's router, one for the web app and for Electron: real path URLs on the browser's
 * history (`createBrowserHistory`, never a hash). Electron loads the renderer from `otto://app/`
 * (packaged) or the Vite URL (dev), the web server answers every app path with `index.html`; see
 * docs/routing.md.
 *
 * No route-level code splitting yet (`defaultPreload: false`): the routes have no components.
 */

import type { ComponentType } from 'react'
import { createBrowserHistory, createRouter, type RouterHistory } from '@tanstack/react-router'
import { parseSearch, stringifySearch, translateLegacyUrl } from './location'
import { routeTree, type RootProps } from './route-tree'

/**
 * `Root` is what the root route renders: `App` on Electron, the adapter wrapper around it on the web.
 * `history` is the browser's except in tests and the playground.
 */
export function createAppRouter(Root: ComponentType<RootProps>, history: RouterHistory = createBrowserHistory()) {
  // A legacy `?ws=&route=` URL (a saved window, a bookmark) becomes its path, once, before the first match.
  const legacy = translateLegacyUrl(history.location.pathname, history.location.search)
  if (legacy) history.replace(legacy)

  return createRouter({
    routeTree,
    history,
    context: { Root },
    defaultPreload: false,
    // Plain query strings with repeated keys for lists (`?status=a&status=b&flagged=1`), not TanStack's JSON form.
    parseSearch,
    stringifySearch,
    // A render error is the entry's to show (Sentry's boundary on Electron, the crash screen on the web), not the router's.
    disableGlobalCatchBoundary: true,
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
