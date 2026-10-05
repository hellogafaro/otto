import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'
import { navigate, routes } from '@/lib/navigate'
import { SETTINGS_PAGES, type SettingsSubpage } from '../../../shared/settings-registry'

/** The header of a settings page: Settings › this page, each with its icon. */
export function SettingsPageHeader({ subpage }: { subpage: SettingsSubpage }) {
  const { t } = useTranslation()
  const page = SETTINGS_PAGES.find((p) => p.id === subpage)!
  return (
    <PanelHeader
      crumbs={[
        { icon: Settings, label: t('sidebar.settings'), onClick: () => navigate(routes.view.settings()) },
        { icon: SETTINGS_ICONS[subpage], label: t(page.labelKey) },
      ]}
    />
  )
}
