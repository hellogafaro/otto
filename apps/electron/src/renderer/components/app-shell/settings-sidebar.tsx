/**
 * The sidebar's Settings content: inside Settings (its pages, Skills and Sources) it replaces
 * everything else in `AppSidebar`. The header row where the mark was is `SettingsBackRow`
 * (Back to app, a 28px row on the mark's axis), then `SettingsSidebarContent`: the Account and
 * Workspace groups of the registry (Agents, Skills and Sources end Workspace), each under its muted
 * group title, every page a 28px row with its icon, the open one filled. No footer.
 */

import { useTranslation } from 'react-i18next'
import { Bot, ChevronLeft, DatabaseZap, Shapes } from 'lucide-react'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@workspace/ui/components/sidebar'
import { SETTINGS_ICONS } from '@/components/icons/settings-icons'
import { navigate, routes, type Route } from '@/lib/navigate'
import { useNavigationState } from '@/contexts/navigation-context'
import { SETTINGS_NAV_GROUPS } from '../../../shared/menu-schema'

/** Back to app: where the mark is in the app's sidebar, it returns to the view Settings was entered from. */
export function SettingsBackRow({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <SidebarMenu className="titlebar-no-drag min-w-0 flex-1">
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={t('sidebar.backToApp')} onClick={onBack}>
          <ChevronLeft />
          <span>{t('sidebar.backToApp')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

interface Row {
  id: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  route: Route
}

export function SettingsSidebarContent() {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const open =
    navState.navigator === 'settings'
      ? navState.subpage
      : navState.navigator === 'skills' || navState.navigator === 'sources' || navState.navigator === 'agents'
        ? navState.navigator
        : null

  const groups = SETTINGS_NAV_GROUPS.map((group) => {
    const rows: Row[] = group.items.map((item) => ({
      id: item.id,
      labelKey: item.labelKey,
      icon: SETTINGS_ICONS[item.id],
      route: routes.view.settings(item.id),
    }))
    if (group.title === 'Workspace') {
      rows.push(
        { id: 'agents', labelKey: 'sidebar.agents', icon: Bot, route: routes.view.agents() },
        { id: 'skills', labelKey: 'sidebar.skills', icon: Shapes, route: routes.view.skills() },
        { id: 'sources', labelKey: 'sidebar.sources', icon: DatabaseZap, route: routes.view.sources() },
      )
    }
    return { title: group.title === 'Account' ? t('sidebar.account') : t('settings.workspace.title'), rows }
  })

  return (
    // It scrolls as a whole on a short window (the edge fade, no scrollbar).
    <SidebarContent className="no-scrollbar scroll-fade-y overflow-y-auto">
      {groups.map((group) => (
        <SidebarGroup key={group.title} className="shrink-0">
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarMenu>
            {group.rows.map((row) => (
              <SidebarMenuItem key={row.id}>
                <SidebarMenuButton isActive={open === row.id} tooltip={t(row.labelKey)} onClick={() => navigate(row.route)}>
                  <row.icon />
                  <span>{t(row.labelKey)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
  )
}
