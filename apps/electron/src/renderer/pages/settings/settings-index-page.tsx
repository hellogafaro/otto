/**
 * SettingsIndexPage - Settings' home: the data page BEFORE a settings page.
 *
 * A blocks page in the 768px column with the sidebar's two sections as `PageSection`s,
 * Account (yours) and Workspace (the workspace's), each a `PageGrid` of `GridCard`s: the
 * page's icon and its title inside the card, the whole card the link. Skills and Sources
 * are settings-area pages too and end the Workspace grid. Every page opened from here
 * has this page as its parent (Back).
 */

import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseZap, Zap } from 'lucide-react'
import { PageColumn, PageSection } from '@workspace/ui/components/page'
import { GridCard, PageGrid } from '@workspace/ui/components/grid-card'
import { PageHeader } from '@/components/app-shell/page-header'
import { SETTINGS_ICONS } from '@/components/icons/settings-icons'
import { navigate, routes, type Route } from '@/lib/navigate'
import { SETTINGS_NAV_GROUPS } from '../../../shared/menu-schema'

interface IndexItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  route: Route
}

export default function SettingsIndexPage() {
  const { t } = useTranslation()

  const groups = SETTINGS_NAV_GROUPS.map((group) => {
    const items: IndexItem[] = group.items.map((item) => ({
      id: item.id,
      label: t(item.labelKey),
      icon: SETTINGS_ICONS[item.id],
      route: routes.view.settings(item.id),
    }))
    if (group.title === 'Workspace') {
      items.push(
        { id: 'skills', label: t('sidebar.skills'), icon: Zap, route: routes.view.skills() },
        { id: 'sources', label: t('sidebar.sources'), icon: DatabaseZap, route: routes.view.sources() },
      )
    }
    return {
      title: group.title,
      label: group.title === 'Account' ? t('settingsIndex.account') : t('settings.workspace.title'),
      items,
    }
  })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('sidebar.settings')} />
      <PageColumn>
        {groups.map((group) => (
          <PageSection key={group.title} title={group.label}>
            <PageGrid>
              {group.items.map((item) => {
                const Icon = item.icon
                return <GridCard key={item.id} icon={<Icon />} title={item.label} onClick={() => navigate(item.route)} />
              })}
            </PageGrid>
          </PageSection>
        ))}
      </PageColumn>
    </div>
  )
}
