import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/app-shell/page-header'
import { SETTINGS_PAGES, type SettingsSubpage } from '../../../shared/settings-registry'

/** The header of a settings page: its name (Back and the Settings crumb come from the route, see `useParentView`). */
export function SettingsPageHeader({ subpage }: { subpage: SettingsSubpage }) {
  const { t } = useTranslation()
  const page = SETTINGS_PAGES.find((p) => p.id === subpage)!
  return <PageHeader title={t(page.labelKey)} />
}
