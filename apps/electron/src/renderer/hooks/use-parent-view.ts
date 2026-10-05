/**
 * The parent of the open view, by the route hierarchy, and how to go to it.
 *
 * One rule for Back (the floating navigation's Back button): Back goes to the parent
 * view, and there is no Back on a view without one. Sub-navigation is an index page
 * before the detail, never a sidebar list, so the parents are:
 * - A chat: the Chats index (the filter it was opened under).
 * - A settings page, a skill or a source (also the empty Skills / Sources page): the Settings index.
 * - A document: the Documents library (the card's own page).
 * - A project or an automation: its section.
 * The Chats and Settings indexes, and the Tasks section root, have no parent.
 *
 * Back is never history Back: that is the Electron buttons in the sidebar header and
 * the browser's own.
 */

import { useCallback, useMemo } from 'react'
import { useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { buildRouteFromNavigationState } from '../../shared/route-parser'
import { routes } from '@/lib/navigate'
import type { Route } from '../../shared/routes'

export interface ParentView {
  onBack: () => void
}

export function useParentView(): ParentView | null {
  const { navigate } = useNavigation()
  const navState = useNavigationState()

  /** The open view without its details: the index the detail was opened from. */
  const goToIndex = useCallback(() => {
    navigate(buildRouteFromNavigationState({ ...navState, details: null } as typeof navState) as Route)
  }, [navigate, navState])

  return useMemo(() => {
    switch (navState.navigator) {
      case 'settings':
        return navState.subpage === null ? null : { onBack: () => navigate(routes.view.settings()) }
      case 'pages':
        if (!navState.details) return null
        return { onBack: () => navigate(routes.view.pages()) }
      case 'sessions':
        return navState.details ? { onBack: goToIndex } : null
      case 'sources':
      case 'skills':
        return { onBack: () => navigate(routes.view.settings()) }
      case 'automations':
      case 'projects':
        return navState.details ? { onBack: goToIndex } : null
      case 'tasks':
        return null
    }
  }, [navState, navigate, goToIndex])
}
