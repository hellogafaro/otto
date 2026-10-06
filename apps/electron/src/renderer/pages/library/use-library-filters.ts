/**
 * The Library index's view, in the route (`library?tab=files&folder=f1&createdBy=agent`): the tab, the open
 * folder and the "Created by" filter. Back from an item returns to the same view (`useParentView`).
 */

import { routes } from '@/lib/navigate'
import { isLibraryNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import type { LibrarySearch } from '../../../shared/section-search'
import type { LibraryView } from './library-items'

export function useLibraryFilters() {
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const search: LibrarySearch = isLibraryNavigation(navState) ? navState.search : {}
  const view: LibraryView = { tab: search.tab ?? 'all', folder: search.folder ?? null, createdBy: search.createdBy }

  const setSearch = (patch: Partial<LibrarySearch>) => {
    const next = { ...search, ...patch }
    navigate(routes.view.library({
      tab: next.tab === 'all' ? undefined : next.tab,
      folder: next.folder || undefined,
      createdBy: next.createdBy || undefined,
    }))
  }

  /** An item of the open view, keeping the view for Back. */
  const openItem = (itemId: string) => navigate(routes.view.library({ itemId, ...search }))

  return { view, setSearch, openItem }
}
