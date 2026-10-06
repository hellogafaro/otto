/** Library item (a file or a document): a placeholder (the section's empty state) until the page is built. */

import { useTranslation } from 'react-i18next'
import { Library } from 'lucide-react'
import { SectionEmpty } from '@/components/app-shell/section-empty'

export function LibraryItemPage(_props: { itemId: string }) {
  const { t } = useTranslation()
  return (
    <SectionEmpty
      icon={Library}
      title={t('sectionEmpty.libraryTitle')}
      description={t('sectionEmpty.libraryDescription')}
      cta={t('sectionEmpty.addToLibrary')}
    />
  )
}
