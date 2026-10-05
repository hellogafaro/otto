/**
 * SettingsNavigator
 *
 * The left list of Settings: two groups (Account, Workspace) of one-line rows,
 * an icon and a label each, the open one filled. No descriptions, no dividers.
 * Skills, Sources and Automations are areas that live here; selecting one opens
 * that area's own list and details.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SettingsSubpage } from '../../../shared/types'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'

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

function SettingsRow({ row, active }: { row: Row; active: boolean }) {
  const Icon = row.icon
  return (
    <button
      type="button"
      onClick={row.onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-7 w-full select-none items-center gap-2 rounded-sm px-1 text-left text-[13px] outline-none',
        'text-foreground/80 transition-colors duration-75 hover:bg-foreground/5',
        'focus-visible:ring-1 focus-visible:ring-ring',
        active && 'bg-foreground/8 text-foreground',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon className="size-3.5 opacity-70" />
      </span>
      <span className="truncate">{row.label}</span>
    </button>
  )
}

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
    <nav aria-label="Settings" className="flex h-full flex-col gap-3 overflow-y-auto px-2 pb-2">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.title}</div>
          {group.rows.map((row) => (
            <SettingsRow key={row.id} row={row} active={selectedSubpage === row.id} />
          ))}
        </div>
      ))}
    </nav>
  )
}
