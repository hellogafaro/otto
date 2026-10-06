import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageColumn } from '@workspace/ui/components/page'
import { PageHeader } from '@/components/app-shell/page-header'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { getSettingsPage, type SettingsSubpage } from '../../../shared/settings-registry'

/**
 * A settings page: its name alone in the title row (Settings has no floating navigation:
 * its sidebar lists the pages and leads with Back to app), then its sections in the page
 * column (`PageColumn`). Every settings page is one; dialogs can go in `children`.
 */
export function SettingsPage({ subpage, children }: { subpage: SettingsSubpage; children: ReactNode }) {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:settings', placeholder: t('composer.placeholder.start') })
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t(getSettingsPage(subpage).labelKey)} />
      <PageColumn>{children}</PageColumn>
    </div>
  )
}
