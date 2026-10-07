/**
 * The parent of the open view, by the route hierarchy, and how to go to it.
 *
 * One rule for Back (the floating navigation's Back button): Back goes to the parent
 * view, and there is no Back on a view without one. Sub-navigation is an index page
 * before the detail (Settings excepted: its own sidebar), so the parents are:
 * - A chat: the Chats index (the filter it was opened under).
 * - A task, a library item (a file or a document) or a project: its index. A task and a library item
 *   keep the index's search (filters, tab, `?folder=`), so Back returns to the same list.
 * - A skill or a source: its grid in Settings, under the filter it was opened with; an agent: the Agents gallery.
 * - An automation: its section.
 * - The full list of notifications: Home.
 * Home, the Chats, Tasks, Projects and Library indexes and the Skills and Sources grids have no
 * parent. Settings' own pages have none either: Settings has no index; its sidebar lists its pages
 * and leads with Back to app.
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
      case 'sessions':
        return navState.details ? { onBack: goToIndex } : null
      case 'automations':
      case 'tasks':
      case 'library':
      case 'skills':
      case 'sources':
      case 'agents':
        return navState.details ? { onBack: goToIndex } : null
      case 'projects':
        return navState.details ? { onBack: () => navigate(routes.view.projects()) } : null
      case 'home':
        return navState.notifications ? { onBack: () => navigate(routes.view.home()) } : null
      case 'settings':
        return null
    }
  }, [navState, navigate, goToIndex])
}
