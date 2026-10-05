/**
 * The parent of the open view, by the route hierarchy, and how to go to it.
 *
 * One rule for Back in the page header: Back goes to the parent view, and there is
 * no Back on a view without one.
 * - A settings page below the landing page: Settings.
 * - A document: the Documents library (the card's own page).
 * - An item of a list (a chat, a source, a skill, a project, an automation): its
 *   list. The list lives in the sidebar, so below 768px (where the sidebar is a
 *   sheet) Back opens the sheet on it; otherwise it closes the item, leaving the list.
 *
 * Back is never history Back: that is the Electron buttons in the sidebar header and
 * the browser's own.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSidebar } from '@workspace/ui/components/sidebar'
import { useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { buildRouteFromNavigationState } from '../../shared/route-parser'
import { routes } from '@/lib/navigate'
import type { Route } from '../../shared/routes'

export interface ParentView {
  /** The parent's name for the crumb trail; none for a chat (the list has no page title). */
  label?: string
  onBack: () => void
}

export function useParentView(): ParentView | null {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const { isMobile, setOpenMobile } = useSidebar()

  const goToList = useCallback(() => {
    if (isMobile) {
      setOpenMobile(true)
      return
    }
    navigate(buildRouteFromNavigationState({ ...navState, details: null } as typeof navState) as Route, { skipAutoSelect: true })
  }, [isMobile, setOpenMobile, navigate, navState])

  return useMemo(() => {
    switch (navState.navigator) {
      case 'settings':
        if (navState.subpage === null || navState.subpage === 'app') return null
        return { label: t('sidebar.settings'), onBack: () => navigate(routes.view.settings()) }
      case 'pages':
        if (!navState.details) return null
        return { label: t('sidebar.documents'), onBack: () => navigate(routes.view.pages()) }
      case 'sessions':
        return navState.details ? { onBack: goToList } : null
      case 'sources':
        return navState.details ? { label: t('sidebar.sources'), onBack: goToList } : null
      case 'skills':
        return navState.details ? { label: t('sidebar.skills'), onBack: goToList } : null
      case 'automations':
        return navState.details ? { label: t('sidebar.automations'), onBack: goToList } : null
      case 'projects':
        return navState.details ? { label: t('sidebar.projects'), onBack: goToList } : null
    }
  }, [navState, t, navigate, goToList])
}
