/**
 * SettingsNavigator
 *
 * Settings' section of the sidebar: two groups (Account, Workspace) of 28px rows like
 * the pages above, an icon and a label each, the open one filled, each group under a
 * quiet 28px label. No descriptions, no dividers; the section scrolls, not the list.
 * Skills, Sources and Automations are areas that live here; selecting one opens
 * that area's own list and details.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@workspace/ui/components/sidebar'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SettingsSubpage } from '../../../shared/types'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import { SETTINGS_ICONS } from '@/components/icons/settings-icons'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'navigator',
}

/** Another area that lives under Settings: selecting it opens that area's own list and details. */
export interface SettingsAreaLink {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  onSelect: () => void
}

interface SettingsNavigatorProps {
  /**
   * Currently selected settings subpage. `null` means the bare `settings`
   * route (no row highlighted) — happens in compact mode where the navigator
   * stands alone before the user drills into a subpage.
   */
  selectedSubpage: SettingsSubpage | null
  /** Called when a subpage is selected */
  onSelectSubpage: (subpage: SettingsSubpage) => void
  /** Areas moved under Settings (Workspace group, after the settings pages). */
  areaLinks?: SettingsAreaLink[]
}

interface Row {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  onSelect: () => void
}

/** Pages that belong to you; everything else belongs to the workspace. */
const ACCOUNT_PAGES = new Set<string>(['app', 'ai', 'appearance', 'input', 'shortcuts', 'preferences'])

export default function SettingsNavigator({
  selectedSubpage,
  onSelectSubpage,
  areaLinks = [],
}: SettingsNavigatorProps) {
  const { t } = useTranslation()

  const groups = useMemo(() => {
    const pages: Row[] = SETTINGS_ITEMS.map((item) => ({
      id: item.id,
      label: t(item.labelKey),
      icon: SETTINGS_ICONS[item.id],
      onSelect: () => onSelectSubpage(item.id as SettingsSubpage),
    }))
    return [
      { title: 'Account', rows: pages.filter((row) => ACCOUNT_PAGES.has(row.id)) },
      {
        title: 'Workspace',
        rows: [
          ...pages.filter((row) => !ACCOUNT_PAGES.has(row.id)),
          ...areaLinks.map((link) => ({ ...link })),
        ],
      },
    ]
  }, [t, onSelectSubpage, areaLinks])

  return (
    <nav aria-label="Settings" className="flex flex-col gap-0.5">
      {groups.map((group) => (
        <SidebarGroup key={group.title}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarMenu>
            {group.rows.map((row) => {
              const Icon = row.icon
              return (
                <SidebarMenuItem key={row.id}>
                  <SidebarMenuButton isActive={selectedSubpage === row.id} onClick={row.onSelect}>
                    <Icon />
                    <span>{row.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  )
}
