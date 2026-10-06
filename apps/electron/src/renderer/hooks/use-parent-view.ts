/**
 * The parent of the open view, by the route hierarchy, and how to go to it.
 *
 * One rule for Back (the floating navigation's Back button): Back goes to the parent
 * view, and there is no Back on a view without one. Sub-navigation is an index page
 * before the detail (Settings excepted: its own sidebar), so the parents are:
 * - A chat: the Chats index (the filter it was opened under).
 * - A task, a library item (a file or a document) or a project: its index. A task and a library item
 *   keep the index's search (filters, tab, `?folder=`), so Back returns to the same list.
 * - An automation: its section.
 * The Chats, Tasks, Projects and Library indexes and the Inbox have no parent. Settings (its pages,
 * Skills and Sources) has none either: it has no index and no floating navigation; its own sidebar
 * lists its pages and leads with Back to app.
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
        return navState.details ? { onBack: goToIndex } : null
      case 'projects':
        return navState.details ? { onBack: () => navigate(routes.view.projects()) } : null
      case 'inbox':
      case 'settings':
      case 'sources':
      case 'skills':
        return null
    }
  }, [navState, navigate, goToIndex])
}
